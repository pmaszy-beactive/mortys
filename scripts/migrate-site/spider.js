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

let DELAY_MS = 2000;
let MAX_PAGES = 1000;
// Number of extra navigation attempts on failure (0 = original behavior: a
// single attempt). Configurable via env or --max-retries so a flaky run can be
// made more resilient without code edits. Retry attempts are logged at debug.
let MAX_RETRIES = parseInt(process.env.SCRAPE_MAX_RETRIES || '0', 10);
if (!Number.isFinite(MAX_RETRIES) || MAX_RETRIES < 0) MAX_RETRIES = 0;

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
        this.pagesScraped = 0;
        this.browser = null;
        this.page = null;
        
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
            
            return true;
        } catch {
            return false;
        }
    }
    
    saveState() {
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
        fs.appendFileSync(VISITED_FILE, url + '\n');
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
                log.error('  2. Copy the new cookie to scripts/cookie.txt');
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
            log.error(`Failed to scrape ${url} (hash ${urlHash}): ${e.message}`);
            if (e.stack) log.debug(e.stack);
            this.visitedHashes.add(urlHash);
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
        log.info(`Delay: ${DELAY_MS}ms between requests | max pages: ${MAX_PAGES} | retries: ${MAX_RETRIES} | log level: ${log.getLevel()}`);
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
            await this.page.setCookie(...this.cookies);
        }
        
        this.queue.push(this.seedUrl);
        
        try {
            while (this.queue.length > 0 && this.pagesScraped < MAX_PAGES) {
                const url = this.queue.shift();
                const result = await this.scrapePage(url);
                
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

function parseCookieString(cookieStr, domain) {
    const cookies = [];
    const parts = cookieStr.split(';');
    
    for (const part of parts) {
        const trimmed = part.trim();
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
            const name = trimmed.slice(0, eqIndex).trim();
            const value = trimmed.slice(eqIndex + 1).trim();
            if (name && !['path', 'domain', 'expires', 'max-age', 'secure', 'httponly', 'samesite'].includes(name.toLowerCase())) {
                cookies.push({
                    name,
                    value,
                    domain,
                    path: '/',
                    httpOnly: true,
                    secure: true
                });
            }
        }
    }
    
    return cookies;
}

function loadCookies(domain) {
    if (fs.existsSync(COOKIE_FILE)) {
        const cookieStr = fs.readFileSync(COOKIE_FILE, 'utf8').trim();
        if (cookieStr) {
            // Never log the cookie contents — only that one was found.
            log.info(`Loaded cookie from: ${COOKIE_FILE}`);
            log.debug(`Cookie file present (${cookieStr.length} chars, values not logged)`);
            return parseCookieString(cookieStr, domain);
        }
    }
    log.warn(`No cookie file found at ${COOKIE_FILE} — scraping unauthenticated`);
    return [];
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node spider.js <seed_url> [--delay <ms>] [--max-pages <n>] [--max-retries <n>] [--log-level <error|warn|info|debug|trace>] [--debug] [--trace]');
        console.log('Example: node spider.js https://example.com/admin --delay 2000 --max-pages 100 --log-level debug');
        console.log('Log level can also be set via the SCRAPE_LOG_LEVEL env var (CLI flag overrides it).');
        process.exit(1);
    }
    
    let seedUrl = args[0];
    
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--delay' && args[i + 1]) {
            DELAY_MS = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--max-pages' && args[i + 1]) {
            MAX_PAGES = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--max-retries' && args[i + 1]) {
            const n = parseInt(args[i + 1], 10);
            if (Number.isFinite(n) && n >= 0) MAX_RETRIES = n;
            i++;
        } else if (args[i] === '--log-level' && args[i + 1]) {
            if (!log.setLevel(args[i + 1])) {
                log.warn(`Unknown --log-level "${args[i + 1]}" — keeping "${log.getLevel()}"`);
            }
            i++;
        } else if (args[i] === '--debug') {
            log.setLevel('debug');
        } else if (args[i] === '--trace') {
            log.setLevel('trace');
        }
    }
    
    if (!seedUrl.startsWith('http')) {
        seedUrl = 'https://' + seedUrl;
    }
    
    const domain = new URL(seedUrl).hostname;
    const cookies = loadCookies(domain);
    
    const spider = new SiteMigrationSpider(seedUrl, cookies);
    await spider.run();
}

main().catch(e => {
    log.error(`Fatal: ${e.message}`);
    if (e.stack) log.debug(e.stack);
    process.exit(1);
});
