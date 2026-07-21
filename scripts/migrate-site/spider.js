#!/usr/bin/env node
/**
 * Site Migration Spider (Puppeteer/Node.js version)
 * Crawls an ASP.NET website with authentication and extracts all content to JSON.
 * Uses SHA256 hashing to avoid revisiting pages.
 * 
 * Usage:
 *   node spider.js <seed_url>
 *   node spider.js https://mortys.drivetraqr.ca/admin --max-pages 100 --delay 2000
 * 
 * Cookie: Reads from ../cookie.txt
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const SCRIPT_DIR = __dirname;
// Output + cookie paths honor env vars so the scraper can write to a Docker
// volume at runtime. Defaults preserve the original repo-relative behavior.
//   MIGRATE_OUTPUT_DIR  — where page-level JSON/HTML is written (the "migrate" dir)
//   IMPORT_DATA_DIR     — fallback root; output goes to <root>/migrate
//   MIGRATE_COOKIE_FILE — path to the session cookie file
const OUTPUT_DIR = process.env.MIGRATE_OUTPUT_DIR
    ? path.resolve(process.env.MIGRATE_OUTPUT_DIR)
    : (process.env.IMPORT_DATA_DIR
        ? path.join(path.resolve(process.env.IMPORT_DATA_DIR), 'migrate')
        : path.join(SCRIPT_DIR, 'migrate'));
const STATE_FILE = path.join(OUTPUT_DIR, '_spider_state.json');
const COOKIE_FILE = process.env.MIGRATE_COOKIE_FILE
    ? path.resolve(process.env.MIGRATE_COOKIE_FILE)
    : (process.env.IMPORT_DATA_DIR
        ? path.join(path.resolve(process.env.IMPORT_DATA_DIR), 'cookie.txt')
        : path.join(SCRIPT_DIR, '..', 'cookie.txt'));
const VISITED_FILE = path.join(OUTPUT_DIR, '_visited_urls.txt');
// Targeted-student priority queue (filled by server/scripts/build-scrape-queue.ts).
// One seed URL per line. Lives on the persistent data volume alongside the
// spider state so it survives container restarts. Overridable via
// SCRAPE_QUEUE_FILE; defaults next to the scrape output/state.
const QUEUE_FILE = process.env.SCRAPE_QUEUE_FILE
    ? path.resolve(process.env.SCRAPE_QUEUE_FILE)
    : path.join(OUTPUT_DIR, 'scrape-queue.txt');

// Per-URL retry cap for the persistent scrape queue. A genuinely dead URL
// (deleted record, permanent 404) would otherwise fail every nightly drain,
// stay in the queue forever, and trigger a skipped-pages alert every night.
// After this many consecutive failed runs the entry is dropped from the queue
// (logged as "ABANDONED" so the nightly wrapper can alert the office once).
// Failure counts live in a JSON sidecar next to the queue file so they survive
// restarts; a successful scrape clears the URL's count.
let MAX_QUEUE_FAILURES = parseInt(process.env.SCRAPE_QUEUE_MAX_FAILURES || '5', 10);
if (!Number.isFinite(MAX_QUEUE_FAILURES) || MAX_QUEUE_FAILURES < 1) MAX_QUEUE_FAILURES = 5;

function queueFailuresFileFor(queueFile) {
    return process.env.SCRAPE_QUEUE_FAILURES_FILE
        ? path.resolve(process.env.SCRAPE_QUEUE_FAILURES_FILE)
        : `${queueFile}.failures.json`;
}

let DELAY_MS = 2000;
let MAX_PAGES = 1000;
// Number of extra navigation attempts on failure. Defaults to 2 (so a page is
// tried up to 3 times with backoff) so transient timeouts don't silently leave
// gaps in the imported data — retries only fire on failure, so a healthy run is
// unaffected. Set to 0 for the original single-attempt behavior. Configurable
// via env (SCRAPE_MAX_RETRIES) or --max-retries. Retry attempts are logged at
// warn so flaky pages are visible in the nightly log.
let MAX_RETRIES = parseInt(process.env.SCRAPE_MAX_RETRIES || '2', 10);
if (!Number.isFinite(MAX_RETRIES) || MAX_RETRIES < 0) MAX_RETRIES = 2;
// How many times a page that fails every navigation attempt is pushed back onto
// the queue for a fresh try later in the run (after other pages and a delay),
// instead of being marked visited and skipped forever. Capped to avoid an
// infinite loop on a genuinely dead URL. Configurable via SCRAPE_MAX_REQUEUES.
let MAX_REQUEUES = parseInt(process.env.SCRAPE_MAX_REQUEUES || '1', 10);
if (!Number.isFinite(MAX_REQUEUES) || MAX_REQUEUES < 0) MAX_REQUEUES = 1;

// --- Leveled logger --------------------------------------------------------
// A tiny internal logger so operators can crank up scraper detail on demand
// (SCRAPE_LOG_LEVEL env var or --log-level/--debug/--trace CLI flags) while the
// nightly run stays readable at the default `info` level. Every line is
// prefixed with an ISO timestamp + severity tag so /data/logs/nightly-scrape.log
// is greppable and time-ordered. Never log secret values (e.g. cookie contents).
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
let LOG_LEVEL = 'info';

function resolveLogLevel(value) {
    if (value === undefined || value === null) return null;
    const v = String(value).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(LOG_LEVELS, v) ? v : null;
}

const log = {
    setLevel(value) {
        const resolved = resolveLogLevel(value);
        if (resolved) {
            LOG_LEVEL = resolved;
            return true;
        }
        return false;
    },
    getLevel() {
        return LOG_LEVEL;
    },
    enabled(level) {
        return LOG_LEVELS[level] <= LOG_LEVELS[LOG_LEVEL];
    },
    _emit(level, args) {
        if (LOG_LEVELS[level] > LOG_LEVELS[LOG_LEVEL]) return;
        const prefix = `${new Date().toISOString()} [${level.toUpperCase()}]`;
        const stream = level === 'error' || level === 'warn' ? console.error : console.log;
        stream(prefix, ...args);
    },
    error(...args) { this._emit('error', args); },
    warn(...args) { this._emit('warn', args); },
    info(...args) { this._emit('info', args); },
    debug(...args) { this._emit('debug', args); },
    trace(...args) { this._emit('trace', args); },
};

// Pick up the level from the environment at load time. CLI flags (parsed in
// main()) override this afterwards.
log.setLevel(process.env.SCRAPE_LOG_LEVEL);
// ---------------------------------------------------------------------------

class SiteMigrationSpider {
    constructor(seedUrl, cookies) {
        if (!seedUrl.startsWith('http://') && !seedUrl.startsWith('https://')) {
            seedUrl = 'https://' + seedUrl;
        }
        this.seedUrl = seedUrl;
        this.baseDomain = new URL(seedUrl).hostname;
        this.cookies = cookies;
        
        this.visitedHashes = new Set();
        this.visitedUrls = new Set();
        this.queue = [];
        // Per-page re-queue counter (urlHash -> times re-queued after a total
        // navigation failure). In-memory only; the queue itself is persisted, so
        // a re-queued page survives a restart while the counter resets to give a
        // fresh run another chance.
        this.failedAttempts = new Map();
        this.pagesScraped = 0;
        // Pages permanently given up on (every navigation attempt + every
        // re-queue failed). Surfaced in the run summary so gaps are obvious.
        this.skippedPages = 0;
        // Of those, how many were appended to the persistent scrape queue file
        // so the next nightly run's queue drain re-fetches them automatically.
        this.skippedQueuedForRetry = 0;
        // Queue seeds permanently dropped this run after hitting the per-URL
        // consecutive-failure cap (MAX_QUEUE_FAILURES). Surfaced in the run
        // summary and via per-URL "ABANDONED" log lines so the nightly wrapper
        // can alert the office once.
        this.abandonedPages = 0;
        this.browser = null;
        this.page = null;

        // Queue mode (optional, enabled via setQueue()): holds the targeted
        // student seed URLs to scrape first and lets us drop each from the
        // persistent queue file as it succeeds. Off by default so the normal
        // single-seed crawl is completely unchanged.
        this.queueMode = false;
        this.queueFile = null;
        this.queueSeedUrls = [];
        this.pendingQueue = new Set();
        // Persistent per-URL consecutive-failure counts for queue seeds
        // (normalized URL -> failed drains). Loaded from / saved to a JSON
        // sidecar next to the queue file in setQueue().
        this.queueFailures = new Map();
        this.queueFailuresFile = null;
        this.explicitSeed = true;
        
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }
        
        this.loadVisitedUrls();
        this.loadState();
        this.reorganizeExistingFiles();
    }
    
    reorganizeExistingFiles() {
        const entries = fs.readdirSync(OUTPUT_DIR);
        const jsonFiles = entries.filter(f => f.endsWith('.json') && !f.startsWith('_'));
        if (jsonFiles.length === 0) return;

        log.debug(`Checking ${jsonFiles.length} existing files for reorganization...`);
        let moved = 0;

        for (const file of jsonFiles) {
            const filePath = path.join(OUTPUT_DIR, file);
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const targetUrl = data.final_url || data.url;
                if (!targetUrl) continue;

                const { dir, base } = this.outputPathFromUrl(targetUrl);
                if (dir === OUTPUT_DIR) continue;

                const hash = path.basename(file, '.json');
                fs.mkdirSync(dir, { recursive: true });

                const newJsonPath = path.join(dir, `${base}_${hash}.json`);
                fs.renameSync(filePath, newJsonPath);

                const htmlFile = path.join(OUTPUT_DIR, `${hash}.html`);
                if (fs.existsSync(htmlFile)) {
                    const newHtmlPath = path.join(dir, `${base}_${hash}.html`);
                    fs.renameSync(htmlFile, newHtmlPath);
                }

                moved++;
            } catch {}
        }

        if (moved > 0) {
            log.info(`Reorganized ${moved} file(s) into path-based directories.`);
        }
    }

    urlHash(url) {
        const normalized = this.normalizeUrl(url);
        return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    }
    
    normalizeUrl(url) {
        try {
            const parsed = new URL(url);
            let path = parsed.pathname.replace(/\/+$/, '') || '/';
            return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
        } catch {
            return url;
        }
    }
    
    isValidUrl(url) {
        try {
            const parsed = new URL(url);
            if (parsed.hostname !== this.baseDomain) return false;
            if (!['http:', 'https:'].includes(parsed.protocol)) return false;
            
            const skipExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.ico', '.pdf', '.zip', '.exe', '.svg', '.woff', '.woff2', '.ttf', '.eot'];
            const lowerPath = parsed.pathname.toLowerCase();
            if (skipExtensions.some(ext => lowerPath.endsWith(ext))) return false;
            
            if (lowerPath.includes('/logout')) return false;

            // Class-list action/noise sub-links: the per-student "Sign in" page
            // performs an action, and the zoom/email sub-pages are noise. Match
            // exact path segments so /zoomscreenshot/ pages are NOT excluded.
            if (lowerPath.includes('individualsignin')) return false;
            if (/(^|\/)(zoom|email)(\/|$)/.test(lowerPath)) return false;

            return true;
        } catch {
            return false;
        }
    }
    
    // Enable queue mode: scrape `urls` first (each crawled as a full record by
    // the normal BFS), removing each from `queueFile` on disk as it succeeds.
    setQueue(queueFile, urls) {
        this.queueMode = true;
        this.queueFile = queueFile;
        this.queueSeedUrls = urls.slice();
        this.pendingQueue = new Set(urls.map(u => this.normalizeUrl(u)));
        this.loadQueueFailures();

        // Isolate queue runs from the shared resume state (_spider_state.json /
        // _visited_urls.txt) loaded by the constructor. Otherwise a queued URL
        // that hard-failed on a PRIOR run would already be in visitedHashes, so
        // scrapePage() would short-circuit it as "already visited" and it would
        // never actually be retried — defeating the whole point of keeping
        // failed entries queued. Starting each queue drain with empty visited
        // sets guarantees every queued URL is genuinely scraped this run.
        // Re-scraping a page we already have is harmless (the DB import is
        // idempotent); a silently-skipped targeted student is not.
        this.visitedHashes = new Set();
        this.visitedUrls = new Set();
    }

    // Drop a finished queue-file entry and persist the smaller queue. No-op for
    // discovered child links (only original queue seeds live in pendingQueue).
    removeQueueEntry(url) {
        const norm = this.normalizeUrl(url);
        if (!this.pendingQueue.has(norm)) return;
        this.pendingQueue.delete(norm);
        this.rewriteQueueFile();
        log.debug(`    Removed from queue file: ${url} (${this.pendingQueue.size} still queued)`);
    }

    // --- Persistent per-URL failure counts (queue retry cap) ----------------
    // Loaded once when queue mode is enabled. Entries whose URL is no longer in
    // the queue file are pruned so the sidecar can't grow unbounded.
    loadQueueFailures() {
        this.queueFailuresFile = queueFailuresFileFor(this.queueFile);
        this.queueFailures = new Map();
        try {
            if (fs.existsSync(this.queueFailuresFile)) {
                const raw = JSON.parse(fs.readFileSync(this.queueFailuresFile, 'utf8'));
                if (raw && typeof raw === 'object') {
                    for (const [u, n] of Object.entries(raw)) {
                        const count = parseInt(n, 10);
                        if (Number.isFinite(count) && count > 0 && this.pendingQueue.has(this.normalizeUrl(u))) {
                            this.queueFailures.set(this.normalizeUrl(u), count);
                        }
                    }
                }
            }
        } catch (e) {
            log.warn(`Could not read queue failure counts (${this.queueFailuresFile}): ${e.message} — starting fresh.`);
            this.queueFailures = new Map();
        }
        if (this.queueFailures.size > 0) {
            log.info(`Loaded prior failure counts for ${this.queueFailures.size} queued URL(s) (cap: ${MAX_QUEUE_FAILURES} runs).`);
        }
    }

    saveQueueFailures() {
        if (!this.queueFailuresFile) return;
        try {
            const obj = Object.fromEntries(this.queueFailures);
            const tmp = `${this.queueFailuresFile}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
            fs.renameSync(tmp, this.queueFailuresFile);
        } catch (e) {
            log.warn(`Could not update queue failure counts ${this.queueFailuresFile}: ${e.message}`);
        }
    }

    // A queue seed was scraped successfully: forget its failure streak.
    clearQueueSeedFailure(url) {
        const norm = this.normalizeUrl(url);
        if (this.queueFailures.delete(norm)) {
            this.saveQueueFailures();
        }
    }

    // A queue seed hard-failed this run. Bump its consecutive-failure count;
    // once it hits MAX_QUEUE_FAILURES, drop it from the queue file for good and
    // log an "ABANDONED" line (the nightly wrapper turns those into a one-time
    // office alert). Below the cap the seed simply stays queued as before.
    recordQueueSeedFailure(url) {
        const norm = this.normalizeUrl(url);
        if (!this.pendingQueue.has(norm)) return;
        const count = (this.queueFailures.get(norm) || 0) + 1;
        if (count >= MAX_QUEUE_FAILURES) {
            this.pendingQueue.delete(norm);
            this.queueFailures.delete(norm);
            this.rewriteQueueFile();
            this.saveQueueFailures();
            this.abandonedPages++;
            log.error(`    ABANDONED ${url} — removed from the scrape queue after ${count} consecutive failed run(s). It will NOT be retried automatically.`);
        } else {
            this.queueFailures.set(norm, count);
            this.saveQueueFailures();
            log.warn(`    ${url} has now failed ${count}/${MAX_QUEUE_FAILURES} consecutive run(s) — will retry next run.`);
        }
    }

    // A page the spider permanently gave up on (retries + re-queues exhausted)
    // is appended to the persistent scrape queue file so the next nightly
    // run's queue drain automatically re-fetches it — no manual work needed.
    // De-duplicated against entries already in the file. In queue mode a
    // failed queue seed already stays in the file (it is only removed on
    // success), so this is a no-op for those; skipped DISCOVERED links found
    // during a drain are folded into the in-memory seed list instead of a raw
    // append, because rewriteQueueFile() rewrites the file from that list and
    // would otherwise wipe a bare appended line.
    queueSkippedPageForRetry(url) {
        const norm = this.normalizeUrl(url);
        try {
            if (this.queueMode) {
                if (this.pendingQueue.has(norm)) {
                    // Failed queue seed: stays in the queue file by design.
                    log.warn(`    ${url} remains in the scrape queue file for the next run.`);
                    return;
                }
                if (this.queueSeedUrls.some(u => this.normalizeUrl(u) === norm)) return;
                // Keep it in pendingQueue so later rewrites (as other seeds
                // succeed) preserve the entry. It was marked visited on skip,
                // so it won't be re-scraped (or removed on success) this run.
                this.queueSeedUrls.push(url);
                this.pendingQueue.add(norm);
                this.rewriteQueueFile();
                // It already failed once (this run) — start its streak at 1 so
                // the retry cap counts every failed night consistently.
                this.queueFailures.set(norm, 1);
                this.saveQueueFailures();
                this.skippedQueuedForRetry++;
                log.warn(`    Queued ${url} for automatic retry on the next run (${this.queueFile})`);
                return;
            }
            const queueFile = QUEUE_FILE;
            const existing = fs.existsSync(queueFile)
                ? new Set(
                      fs.readFileSync(queueFile, 'utf8')
                          .split('\n')
                          .map(l => l.trim())
                          .filter(Boolean)
                          .map(u => this.normalizeUrl(u))
                  )
                : new Set();
            if (existing.has(norm)) {
                log.debug(`    ${url} is already in the scrape queue file — not re-adding.`);
                return;
            }
            fs.mkdirSync(path.dirname(queueFile), { recursive: true });
            fs.appendFileSync(queueFile, url + '\n');
            this.skippedQueuedForRetry++;
            log.warn(`    Queued ${url} for automatic retry on the next run (${queueFile})`);
        } catch (e) {
            log.warn(`    Could not queue skipped page for retry (${url}): ${e.message}`);
        }
    }

    // Rewrite the queue file with only the still-pending entries. Crash-safe:
    // write to a temp file then atomically rename so an interrupted run never
    // truncates or double-processes the queue.
    rewriteQueueFile() {
        if (!this.queueFile) return;
        try {
            const remaining = this.queueSeedUrls.filter(
                u => this.pendingQueue.has(this.normalizeUrl(u))
            );
            const tmp = `${this.queueFile}.tmp`;
            fs.writeFileSync(tmp, remaining.length ? remaining.join('\n') + '\n' : '');
            fs.renameSync(tmp, this.queueFile);
        } catch (e) {
            log.warn(`Could not update queue file ${this.queueFile}: ${e.message}`);
        }
    }

    saveState() {
        // In queue mode we deliberately don't touch the shared resume state:
        // persisting a queued page's hash (especially a hard-failed one) would
        // suppress its retry on the next run, and we don't want a targeted drain
        // to interfere with the registration scrape's resume state either. In-
        // memory dedup for this run is unaffected (visitedHashes still grows).
        if (this.queueMode) return;
        const state = {
            visitedHashes: Array.from(this.visitedHashes),
            queue: this.queue,
            pagesScraped: this.pagesScraped,
            seedUrl: this.seedUrl,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    }
    
    loadVisitedUrls() {
        if (fs.existsSync(VISITED_FILE)) {
            const lines = fs.readFileSync(VISITED_FILE, 'utf8').split('\n').filter(l => l.trim());
            lines.forEach(url => this.visitedUrls.add(url.trim()));
            log.info(`Loaded ${this.visitedUrls.size} visited URLs from _visited_urls.txt`);
        }
    }
    
    saveVisitedUrl(url) {
        // Keep the in-memory set (intra-run dedup) but don't persist to the
        // shared _visited_urls.txt during a queue drain — see saveState().
        if (!this.queueMode) {
            fs.appendFileSync(VISITED_FILE, url + '\n');
        }
        this.visitedUrls.add(url);
    }
    
    loadState() {
        if (fs.existsSync(STATE_FILE)) {
            try {
                const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                if (state.seedUrl === this.seedUrl) {
                    this.visitedHashes = new Set(state.visitedHashes || []);
                    this.queue = state.queue || [];
                    this.pagesScraped = state.pagesScraped || 0;
                    log.info(`Resumed state: ${this.visitedHashes.size} pages visited, ${this.queue.length} in queue`);
                }
            } catch (e) {
                log.warn('Could not load state:', e.message);
            }
        }
    }
    
    async extractPageData(url) {
        const pageData = {
            url: url,
            url_hash: this.urlHash(url),
            scraped_at: new Date().toISOString(),
            title: '',
            meta: {},
            headings: [],
            text_content: '',
            forms: [],
            tables: [],
            links: [],
            images: [],
            label_values: {},
            raw_html_length: 0
        };
        
        try {
            pageData.title = await this.page.title();
            
            const data = await this.page.evaluate(() => {
                const result = {
                    meta: {},
                    headings: [],
                    text_content: '',
                    forms: [],
                    tables: [],
                    links: [],
                    images: [],
                    label_values: {}
                };
                
                document.querySelectorAll('meta').forEach(meta => {
                    const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
                    const content = meta.getAttribute('content') || '';
                    if (name && content) result.meta[name] = content;
                });
                
                for (let level = 1; level <= 6; level++) {
                    document.querySelectorAll(`h${level}`).forEach(h => {
                        result.headings.push({ level, text: h.textContent.trim() });
                    });
                }
                
                const main = document.querySelector('main') || document.querySelector('article') || 
                             document.querySelector('#content') || document.querySelector('.content') || document.body;
                if (main) {
                    const clone = main.cloneNode(true);
                    clone.querySelectorAll('script, style').forEach(el => el.remove());
                    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null, false);
                    const parts = [];
                    while (walker.nextNode()) {
                        const node = walker.currentNode;
                        if (node.nodeType === Node.TEXT_NODE) {
                            const text = node.textContent.trim();
                            if (text) parts.push(text);
                        } else if (node.nodeType === Node.ELEMENT_NODE) {
                            const tag = node.tagName.toLowerCase();
                            if (['div', 'p', 'br', 'hr', 'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'blockquote', 'dt', 'dd'].includes(tag)) {
                                if (parts.length > 0 && parts[parts.length - 1] !== ' ') {
                                    parts.push(' ');
                                }
                            }
                        }
                    }
                    result.text_content = parts.join(' ').replace(/\s+/g, ' ').trim();
                }
                
                document.querySelectorAll('form').forEach(form => {
                    const formData = {
                        action: form.getAttribute('action') || '',
                        method: form.getAttribute('method') || 'get',
                        id: form.getAttribute('id') || '',
                        name: form.getAttribute('name') || '',
                        fields: [],
                        field_data: {}
                    };
                    form.querySelectorAll('input, select, textarea').forEach(input => {
                        const fieldName = input.getAttribute('name') || '';
                        const fieldId = input.getAttribute('id') || '';
                        const fieldKey = fieldName || fieldId;
                        let fieldValue = '';
                        
                        if (input.tagName === 'SELECT') {
                            fieldValue = input.value || '';
                        } else if (input.type === 'checkbox' || input.type === 'radio') {
                            fieldValue = input.checked ? (input.value || 'on') : '';
                        } else {
                            fieldValue = input.value || '';
                        }
                        
                        const field = {
                            tag: input.tagName.toLowerCase(),
                            name: fieldName,
                            type: input.getAttribute('type') || 'text',
                            id: fieldId,
                            value: fieldValue,
                            placeholder: input.getAttribute('placeholder') || '',
                            checked: input.checked || false,
                            disabled: input.disabled || false,
                            readonly: input.readOnly || false
                        };
                        
                        if (input.tagName === 'SELECT') {
                            field.options = Array.from(input.options).map(opt => ({
                                value: opt.value,
                                text: opt.textContent.trim(),
                                selected: opt.selected
                            }));
                            field.selectedIndex = input.selectedIndex;
                        }
                        
                        if (input.tagName === 'TEXTAREA') {
                            field.value = input.textContent || input.value || '';
                        }
                        
                        formData.fields.push(field);
                        
                        if (fieldKey && fieldValue) {
                            formData.field_data[fieldKey] = fieldValue;
                        }
                    });
                    result.forms.push(formData);
                });
                
                document.querySelectorAll('table').forEach((table, tableIndex) => {
                    const tableData = {
                        id: table.getAttribute('id') || '',
                        class: table.getAttribute('class') || '',
                        name: table.getAttribute('name') || '',
                        caption: '',
                        headers: [],
                        rows: [],
                        records: []
                    };
                    
                    const caption = table.querySelector('caption');
                    if (caption) tableData.caption = caption.textContent.trim();
                    
                    const headerRow = table.querySelector('thead tr') || table.querySelector('tr:first-child');
                    if (headerRow) {
                        const headerCells = headerRow.querySelectorAll('th, td');
                        headerCells.forEach(cell => {
                            tableData.headers.push(cell.textContent.trim());
                        });
                    }
                    
                    const bodyRows = table.querySelectorAll('tbody tr') || table.querySelectorAll('tr');
                    bodyRows.forEach((tr, rowIndex) => {
                        const cells = tr.querySelectorAll('td');
                        if (cells.length === 0) return;
                        
                        const rowArray = Array.from(cells).map(cell => cell.textContent.trim());
                        tableData.rows.push(rowArray);
                        
                        if (tableData.headers.length > 0) {
                            const record = { _row_index: rowIndex };
                            tableData.headers.forEach((header, colIndex) => {
                                const key = header || `column_${colIndex}`;
                                record[key] = cells[colIndex] ? cells[colIndex].textContent.trim() : '';
                            });
                            tableData.records.push(record);
                        }
                    });
                    
                    if (tableData.rows.length > 0 || tableData.headers.length > 0) {
                        result.tables.push(tableData);
                    }
                });
                
                document.querySelectorAll('a[href]').forEach(a => {
                    result.links.push({
                        href: a.getAttribute('href'),
                        text: a.textContent.trim(),
                        title: a.getAttribute('title') || ''
                    });
                });
                
                document.querySelectorAll('img').forEach(img => {
                    result.images.push({
                        src: img.getAttribute('src') || '',
                        alt: img.getAttribute('alt') || '',
                        title: img.getAttribute('title') || ''
                    });
                });
                
                document.querySelectorAll('label').forEach(label => {
                    const labelText = label.textContent.trim().replace(/:$/, '').trim();
                    if (!labelText) return;
                    
                    let valueElement = label.nextElementSibling;
                    while (valueElement && valueElement.tagName === 'BR') {
                        valueElement = valueElement.nextElementSibling;
                    }
                    
                    if (valueElement) {
                        const tag = valueElement.tagName.toLowerCase();
                        if (['div', 'span', 'p', 'td', 'dd', 'strong', 'b', 'em', 'i'].includes(tag)) {
                            const valueText = valueElement.textContent.trim();
                            if (valueText && !valueElement.querySelector('input, select, textarea')) {
                                result.label_values[labelText] = valueText;
                            }
                        }
                    }
                    
                    const forId = label.getAttribute('for');
                    if (forId) {
                        const target = document.getElementById(forId);
                        if (target && !['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
                            const valueText = target.textContent.trim();
                            if (valueText) {
                                result.label_values[labelText] = valueText;
                            }
                        }
                    }
                });
                
                document.querySelectorAll('dt').forEach(dt => {
                    const labelText = dt.textContent.trim().replace(/:$/, '').trim();
                    const dd = dt.nextElementSibling;
                    if (dd && dd.tagName === 'DD') {
                        const valueText = dd.textContent.trim();
                        if (labelText && valueText) {
                            result.label_values[labelText] = valueText;
                        }
                    }
                });
                
                document.querySelectorAll('tr').forEach(tr => {
                    const cells = tr.querySelectorAll('td, th');
                    if (cells.length === 2) {
                        const first = cells[0];
                        const second = cells[1];
                        if (first.tagName === 'TH' || first.querySelector('label') || first.querySelector('strong') || first.querySelector('b')) {
                            const labelText = first.textContent.trim().replace(/:$/, '').trim();
                            const valueText = second.textContent.trim();
                            if (labelText && valueText && !second.querySelector('input, select, textarea')) {
                                result.label_values[labelText] = valueText;
                            }
                        }
                    }
                });
                
                return result;
            });
            
            Object.assign(pageData, data);
            pageData.raw_html_length = (await this.page.content()).length;
            
        } catch (e) {
            log.warn(`Extract error for ${url}: ${e.message}`);
        }
        
        return pageData;
    }
    
    outputPathFromUrl(finalUrl) {
        try {
            const parsed = new URL(finalUrl);
            let urlPath = parsed.pathname.replace(/\/+$/, '') || '/index';
            urlPath = urlPath.replace(/^\/+/, '');
            if (!urlPath) urlPath = 'index';
            const dir = path.join(OUTPUT_DIR, urlPath);
            const base = path.basename(urlPath);
            return { dir, base };
        } catch {
            return { dir: OUTPUT_DIR, base: 'unknown' };
        }
    }

    async scrapePage(url) {
        const urlHash = this.urlHash(url);
        
        if (this.visitedHashes.has(urlHash) || this.visitedUrls.has(url)) {
            return null;
        }
        
        log.info(`[${this.pagesScraped + 1}] Scraping: ${url}`);
        log.debug(`    Hash: ${urlHash} | queue depth: ${this.queue.length}`);
        
        try {
            // Navigate with optional retries. The default (MAX_RETRIES=0) keeps
            // the original single-attempt behavior; each attempt and any backoff
            // is logged at debug/warn so flaky pages are diagnosable.
            let response = null;
            const navStart = Date.now();
            for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
                try {
                    log.debug(`    Navigating (attempt ${attempt}/${MAX_RETRIES + 1})...`);
                    response = await this.page.goto(url, {
                        waitUntil: 'networkidle2',
                        timeout: 60000
                    });
                    break;
                } catch (navErr) {
                    if (attempt > MAX_RETRIES) throw navErr;
                    const backoff = 2000 * attempt;
                    log.warn(`    Navigation attempt ${attempt} failed for ${url}: ${navErr.message} — retrying in ${backoff}ms`);
                    await new Promise(r => setTimeout(r, backoff));
                }
            }
            const navMs = Date.now() - navStart;
            
            const status = response ? response.status() : 'unknown';
            const finalUrlRaw = this.page.url();
            log.debug(`    Navigation finished in ${navMs}ms | status: ${status} | final URL: ${finalUrlRaw}`);
            if (finalUrlRaw !== url) {
                log.debug(`    Requested URL differs from final URL (redirect occurred)`);
            }
            
            // Redirect chain (each entry is a request that was redirected).
            if (log.enabled('debug') && response) {
                try {
                    const chain = response.request().redirectChain();
                    if (chain && chain.length > 0) {
                        log.debug(`    Redirect chain (${chain.length}): ${chain.map(r => r.url()).join(' -> ')}`);
                    } else {
                        log.trace(`    No redirects`);
                    }
                } catch (chainErr) {
                    log.trace(`    Could not read redirect chain: ${chainErr.message}`);
                }
            }
            
            const finalUrl = finalUrlRaw.toLowerCase();
            if (finalUrl.includes('/login') || finalUrl.includes('/requestpasswordreset') || finalUrl.includes('/signin')) {
                // Always-on, clearly identifiable marker — the nightly wrapper
                // greps for "Redirected to login" / "session cookie has expired".
                log.error('!'.repeat(60));
                log.error('ERROR: Redirected to login/password reset page!');
                log.error(`Final URL: ${finalUrlRaw}`);
                log.error('Your session cookie has expired. Please:');
                log.error('  1. Log in again in your browser');
                log.error(`  2. Copy the new cookie to ${COOKIE_FILE}`);
                log.error('  3. Delete migrate/_spider_state.json to start fresh');
                log.error('  4. Re-run the spider');
                log.error('!'.repeat(60));
                this.saveState();
                await this.browser.close();
                process.exit(1);
            }

            // A raw 401/403 (no login redirect — the site stayed on the same URL)
            // is also an expired/invalid session. Emit the same always-on marker
            // lines the nightly wrapper greps for ("Redirected to login" /
            // "session cookie has expired") so the existing alert pipeline fires,
            // and call out the HTTP status so the operator knows it was an
            // auth/permission error, not only a redirect.
            if (status === 401 || status === 403) {
                log.error('!'.repeat(60));
                log.error(`ERROR: Authentication failed — server returned HTTP ${status} (${status === 401 ? 'Unauthorized' : 'Forbidden'})!`);
                log.error('Redirected to login (treated as): the request was rejected as unauthenticated.');
                log.error(`Final URL: ${finalUrlRaw}`);
                log.error('Your session cookie has expired or is invalid. Please:');
                log.error('  1. Log in again in your browser');
                log.error(`  2. Copy the new cookie to ${COOKIE_FILE}`);
                log.error('  3. Delete migrate/_spider_state.json to start fresh');
                log.error('  4. Re-run the spider');
                log.error('!'.repeat(60));
                this.saveState();
                await this.browser.close();
                process.exit(1);
            }
            
            this.visitedHashes.add(urlHash);
            this.pagesScraped++;
            
            const html = await this.page.content();
            const pageData = await this.extractPageData(url);
            pageData.status_code = status;
            pageData.final_url = finalUrlRaw;
            
            log.debug(`    Extracted: ${pageData.forms.length} form(s), ${pageData.tables.length} table(s), ${pageData.headings.length} heading(s), ${pageData.raw_html_length} html bytes`);
            
            const { dir, base } = this.outputPathFromUrl(finalUrlRaw);
            fs.mkdirSync(dir, { recursive: true });
            const outputFile = path.join(dir, `${base}_${urlHash}.json`);
            const htmlFile = path.join(dir, `${base}_${urlHash}.html`);
            
            const links = await this.page.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href]'))
                    .map(a => a.href)
                    .filter(href => href.startsWith('http'));
            });
            
            let newLinks = 0;
            let skippedLinks = 0;
            for (const link of links) {
                if (this.isValidUrl(link)) {
                    const linkHash = this.urlHash(link);
                    if (!this.visitedHashes.has(linkHash) && !this.queue.includes(link)) {
                        this.queue.push(link);
                        newLinks++;
                    } else {
                        skippedLinks++;
                    }
                } else {
                    skippedLinks++;
                }
            }
            
            fs.writeFileSync(outputFile, JSON.stringify(pageData, null, 2));
            fs.writeFileSync(htmlFile, html);
            this.saveVisitedUrl(url);
            
            log.debug(`    Output: ${path.relative(OUTPUT_DIR, outputFile)}`);
            log.debug(`    Links: ${links.length} found, ${newLinks} queued, ${skippedLinks} skipped | queue depth: ${this.queue.length}`);
            log.info(`    Done (status ${status}, ${navMs}ms, ${newLinks} new links)`);
            
            return pageData;
            
        } catch (e) {
            // Errors always log with full context regardless of level.
            log.error(`Failed to scrape ${url} (hash ${urlHash}) after ${MAX_RETRIES + 1} navigation attempt(s): ${e.message}`);
            if (e.stack) log.debug(e.stack);

            // Re-queue transient failures rather than marking them visited, so a
            // flaky page gets a fresh try later in the run (after other pages and
            // a delay) instead of silently leaving a gap in the imported data.
            // Cap the re-queues per page so a genuinely dead URL can't loop.
            const priorRequeues = this.failedAttempts.get(urlHash) || 0;
            if (priorRequeues < MAX_REQUEUES) {
                this.failedAttempts.set(urlHash, priorRequeues + 1);
                this.queue.push(url);
                log.warn(`    Re-queued ${url} for a later retry (re-queue ${priorRequeues + 1}/${MAX_REQUEUES}, queue depth now ${this.queue.length})`);
            } else {
                this.visitedHashes.add(urlHash);
                this.skippedPages++;
                log.error(`    SKIPPING ${url} — gave up after ${MAX_RETRIES + 1} attempt(s) x ${MAX_REQUEUES + 1} pass(es). This page is MISSING from the scrape.`);
                // Bump the persistent per-URL failure count for queue seeds
                // BEFORE deciding whether to keep it queued: at the cap the
                // seed is dropped (ABANDONED) and queueSkippedPageForRetry
                // below becomes a no-op for it.
                if (this.queueMode) this.recordQueueSeedFailure(url);
                this.queueSkippedPageForRetry(url);
            }
            return { url, error: e.message };
        }
    }
    
    async run() {
        log.info('='.repeat(60));
        log.info('Site Migration Spider (Puppeteer)');
        log.info('='.repeat(60));
        log.info(`Seed URL: ${this.seedUrl}`);
        log.info(`Domain: ${this.baseDomain}`);
        log.info(`Cookies: ${this.cookies.length} cookies loaded`);
        log.info(`Output: ${OUTPUT_DIR}`);
        log.info(`Delay: ${DELAY_MS}ms between requests | max pages: ${MAX_PAGES} | retries: ${MAX_RETRIES} | re-queues: ${MAX_REQUEUES} | log level: ${log.getLevel()}`);
        log.info('='.repeat(60));
        
        this.browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        this.page = await this.browser.newPage();
        
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');
        
        await this.page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        });
        
        if (this.cookies.length > 0) {
            try {
                await this.page.setCookie(...this.cookies);
            } catch (e) {
                // Belt-and-braces: parsing validates up front, but if Chromium
                // still rejects a cookie, fail with the same actionable
                // marker lines instead of a raw protocol error stack.
                log.error('!'.repeat(60));
                log.error(`ERROR: Cookie file is invalid — the browser rejected the cookies (${e.message}).`);
                logCookieGuidance();
                log.error('!'.repeat(60));
                await this.browser.close();
                process.exit(1);
            }
        }
        
        if (this.queueMode) {
            log.info(`Queue mode: draining ${this.queueSeedUrls.length} targeted URL(s) from ${this.queueFile} first`);
            for (const u of this.queueSeedUrls) this.queue.push(u);
            if (this.explicitSeed) this.queue.push(this.seedUrl);
        } else {
            this.queue.push(this.seedUrl);
        }
        
        try {
            while (this.queue.length > 0 && this.pagesScraped < MAX_PAGES) {
                const url = this.queue.shift();
                const isQueueEntry = this.queueMode && this.pendingQueue.has(this.normalizeUrl(url));
                const result = await this.scrapePage(url);

                // Only drop a queue-file seed when it was ACTUALLY scraped
                // successfully this run (scrapePage returns the page data with no
                // `error`). A hard failure (`{ error }`) or an already-visited
                // skip (`null`) is NOT a success, so we leave the entry in the
                // queue file for the next run to retry. Combined with the state
                // isolation in setQueue(), this guarantees a failed student stays
                // queued and is genuinely re-attempted next time, never silently
                // dropped. (A `null` here can only happen if the same URL was
                // already scraped earlier in THIS run — harmless to leave queued;
                // it gets removed once it is freshly scraped.)
                if (isQueueEntry && result && !result.error) {
                    this.clearQueueSeedFailure(url);
                    this.removeQueueEntry(url);
                }

                if (result) {
                    this.saveState();
                    await new Promise(r => setTimeout(r, DELAY_MS));
                }
            }
        } catch (e) {
            log.error(`Spider run aborted: ${e.message}`);
            if (e.stack) log.debug(e.stack);
        } finally {
            await this.browser.close();
        }
        
        log.info('='.repeat(60));
        log.info('Spider Complete!');
        log.info(`Pages scraped: ${this.pagesScraped}`);
        if (this.skippedPages > 0) {
            log.error(`Pages SKIPPED after exhausting retries/re-queues: ${this.skippedPages} (these are MISSING from the scrape — search the log for "SKIPPING")`);
            log.error(`Skipped pages queued for automatic retry on the next run: ${this.skippedQueuedForRetry}${this.queueMode ? ` (plus any failed queue seeds left in ${this.queueFile})` : ` (${QUEUE_FILE})`}`);
            if (this.abandonedPages > 0) {
                log.error(`Pages ABANDONED (dropped from the queue after ${MAX_QUEUE_FAILURES} consecutive failed runs): ${this.abandonedPages} — search the log for "ABANDONED". These will NOT be retried automatically.`);
            }
        } else {
            log.info(`Pages skipped: 0`);
        }
        log.info(`Output directory: ${OUTPUT_DIR}`);
        log.info('='.repeat(60));
        
        this.generateManifest();
    }
    
    findJsonFiles(dir) {
        let results = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results = results.concat(this.findJsonFiles(fullPath));
            } else if (entry.name.endsWith('.json') && !entry.name.startsWith('_')) {
                results.push(fullPath);
            }
        }
        return results;
    }

    generateManifest() {
        const manifest = {
            generated_at: new Date().toISOString(),
            seed_url: this.seedUrl,
            base_domain: this.baseDomain,
            total_pages: this.pagesScraped,
            pages: []
        };
        
        const files = this.findJsonFiles(OUTPUT_DIR);
        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                manifest.pages.push({
                    file: path.relative(OUTPUT_DIR, file),
                    url: data.url || '',
                    title: data.title || '',
                    scraped_at: data.scraped_at || ''
                });
            } catch {}
        }
        
        const manifestFile = path.join(OUTPUT_DIR, '_manifest.json');
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
        log.info(`Manifest generated: ${manifestFile} (${manifest.pages.length} page(s) indexed)`);
    }
}

// Cookie names the legacy site requires for an authenticated session. Matched
// case-insensitively when warning (the site has been seen setting
// locationid_new in lowercase).
const REQUIRED_COOKIE_NAMES = ['ASP.NET_SessionId', '.ASPXAUTH', 'locationId_new'];

// RFC 6265-ish validation: cookie names are tokens (no whitespace, control
// chars, or separators); values must not contain whitespace, control chars,
// semicolons, or commas. Chromium rejects anything looser with a cryptic
// "Protocol error (Network.setCookies): Invalid cookie fields".
const COOKIE_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE_RE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

// Parse a cookie file into Puppeteer cookie objects. Tolerates common
// formatting mistakes: a leading "Cookie:" header prefix, surrounding quotes,
// one-cookie-per-line files (newline-separated instead of "; "-separated),
// blank lines/segments, and set-cookie attribute noise (path, secure, ...).
// Returns { cookies, invalidNames } — invalidNames lists the NAMES (never
// values) of segments that would be rejected by the browser.
function parseCookieString(cookieStr, domain) {
    let str = cookieStr.trim();
    // Strip an accidental "Cookie:" header prefix.
    str = str.replace(/^cookie\s*:\s*/i, '');
    // Strip one pair of surrounding quotes.
    if (str.length >= 2 && ((str[0] === '"' && str.endsWith('"')) || (str[0] === "'" && str.endsWith("'")))) {
        str = str.slice(1, -1);
    }

    const cookies = [];
    const invalidNames = [];
    // Split on semicolons AND newlines so both header-style single-line files
    // and one-cookie-per-line files work.
    const parts = str.split(/[;\r\n]+/);

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex <= 0) {
            // Attribute flags like "secure"/"httponly" have no '=' — ignore.
            continue;
        }
        const name = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (!name || ['path', 'domain', 'expires', 'max-age', 'secure', 'httponly', 'samesite'].includes(name.toLowerCase())) {
            continue;
        }
        if (!COOKIE_NAME_RE.test(name) || !COOKIE_VALUE_RE.test(value)) {
            // Never log the value — only the (truncated) name.
            invalidNames.push(name.slice(0, 60) || '(unnamed)');
            continue;
        }
        cookies.push({
            name,
            value,
            domain,
            path: '/',
            httpOnly: true,
            secure: true
        });
    }

    return { cookies, invalidNames };
}

// Log the standard actionable refresh-the-cookie guidance (same wording the
// expired-session paths use so the nightly wrapper's grep catches it too).
function logCookieGuidance() {
    log.error('Your session cookie has expired or is invalid. Please:');
    log.error(`  1. Log in again in your browser`);
    log.error(`  2. Copy the new cookie to ${COOKIE_FILE}`);
    log.error('  3. Delete migrate/_spider_state.json to start fresh');
    log.error('  4. Re-run the spider');
}

function loadCookies(domain) {
    if (fs.existsSync(COOKIE_FILE)) {
        const cookieStr = fs.readFileSync(COOKIE_FILE, 'utf8').trim();
        if (cookieStr) {
            // Never log the cookie contents — only that one was found.
            log.info(`Loaded cookie from: ${COOKIE_FILE}`);
            log.debug(`Cookie file present (${cookieStr.length} chars, values not logged)`);
            const { cookies, invalidNames } = parseCookieString(cookieStr, domain);

            if (invalidNames.length > 0) {
                // Fail fast with an actionable message instead of letting
                // Chromium throw a cryptic "Invalid cookie fields" later.
                log.error('!'.repeat(60));
                log.error(`ERROR: Cookie file is invalid — cookie(s) with illegal characters: ${invalidNames.join(', ')} (values not logged).`);
                log.error(`Check the format of ${COOKIE_FILE}: either a single "name=value; name2=value2" line or one name=value per line.`);
                logCookieGuidance();
                log.error('!'.repeat(60));
                process.exit(1);
            }

            const presentLower = new Set(cookies.map(c => c.name.toLowerCase()));
            const missing = REQUIRED_COOKIE_NAMES.filter(n => !presentLower.has(n.toLowerCase()));
            if (missing.length > 0) {
                log.warn(`Cookie file is missing expected cookie(s): ${missing.join(', ')} — the scrape will likely be treated as unauthenticated.`);
            }
            return cookies;
        }
    }
    log.warn(`No cookie file found at ${COOKIE_FILE} — scraping unauthenticated`);
    return [];
}

// Read the targeted-student queue file: one seed URL per line, blanks ignored,
// deduped while preserving order. Missing/unreadable file → empty list.
function loadQueueFile(file) {
    try {
        if (!fs.existsSync(file)) return [];
        const lines = fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
        const seen = new Set();
        const out = [];
        for (const l of lines) {
            if (!seen.has(l)) { seen.add(l); out.push(l); }
        }
        return out;
    } catch (e) {
        log.warn(`Could not read queue file ${file}: ${e.message}`);
        return [];
    }
}

function printUsage() {
    console.log('Usage: node spider.js <seed_url> [options]');
    console.log('   or: node spider.js --queue-file [path] [options]   (drain targeted-student queue first)');
    console.log('Options: [--delay <ms>] [--max-pages <n>] [--max-retries <n>] [--max-requeues <n>] [--queue-file [path]] [--log-level <error|warn|info|debug|trace>] [--debug] [--trace]');
    console.log('Example: node spider.js https://example.com/admin --delay 2000 --max-pages 100 --log-level debug');
    console.log('Example: node spider.js --queue-file /data/migrate/scrape-queue.txt --max-pages 2000');
    console.log('Queue file defaults to SCRAPE_QUEUE_FILE or <output_dir>/scrape-queue.txt.');
    console.log('Log level can also be set via the SCRAPE_LOG_LEVEL env var (CLI flag overrides it).');
}

async function main() {
    const args = process.argv.slice(2);

    let seedUrl = null;
    let queueFile = null;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--queue-file') {
            // Optional path; bare --queue-file uses the default QUEUE_FILE.
            if (args[i + 1] && !args[i + 1].startsWith('--')) {
                queueFile = args[i + 1];
                i++;
            } else {
                queueFile = QUEUE_FILE;
            }
        } else if (a === '--delay' && args[i + 1]) {
            DELAY_MS = parseInt(args[i + 1]);
            i++;
        } else if (a === '--max-pages' && args[i + 1]) {
            MAX_PAGES = parseInt(args[i + 1]);
            i++;
        } else if (a === '--max-retries' && args[i + 1]) {
            const n = parseInt(args[i + 1], 10);
            if (Number.isFinite(n) && n >= 0) MAX_RETRIES = n;
            i++;
        } else if (a === '--max-requeues' && args[i + 1]) {
            const n = parseInt(args[i + 1], 10);
            if (Number.isFinite(n) && n >= 0) MAX_REQUEUES = n;
            i++;
        } else if (a === '--log-level' && args[i + 1]) {
            if (!log.setLevel(args[i + 1])) {
                log.warn(`Unknown --log-level "${args[i + 1]}" — keeping "${log.getLevel()}"`);
            }
            i++;
        } else if (a === '--debug') {
            log.setLevel('debug');
        } else if (a === '--trace') {
            log.setLevel('trace');
        } else if (!a.startsWith('--') && seedUrl === null) {
            seedUrl = a;
        }
    }

    if (!seedUrl && !queueFile) {
        printUsage();
        process.exit(1);
    }

    let queueUrls = [];
    if (queueFile) {
        queueUrls = loadQueueFile(queueFile);
        log.info(`Queue file ${queueFile}: ${queueUrls.length} targeted URL(s)`);
    }

    // The domain/cookies come from the explicit seed when given, else the first
    // queued URL.
    let domainSource = seedUrl || queueUrls[0];
    if (!domainSource) {
        log.info(`Queue file ${queueFile} is empty — nothing to scrape. Exiting.`);
        process.exit(0);
    }
    if (!domainSource.startsWith('http')) {
        domainSource = 'https://' + domainSource;
        if (seedUrl) seedUrl = domainSource;
    }

    const domain = new URL(domainSource).hostname;
    const cookies = loadCookies(domain);

    const spider = new SiteMigrationSpider(domainSource, cookies);
    spider.explicitSeed = !!seedUrl;
    if (queueFile) {
        spider.setQueue(queueFile, queueUrls);
    }
    await spider.run();
}

// Only auto-run when invoked directly (node spider.js ...), not when require()d
// (e.g. by a test). Keeps the CLI behavior identical while making the class
// reusable.
if (require.main === module) {
    main().catch(e => {
        log.error(`Fatal: ${e.message}`);
        if (e.stack) log.debug(e.stack);
        process.exit(1);
    });
}

module.exports = { SiteMigrationSpider };
