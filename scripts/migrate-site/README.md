# Site Migration Spider

Tools to crawl an ASP.NET website with authentication and extract all content to JSON for database migration. Available in both Python and Node.js (Puppeteer) versions.

## Features

- **Authenticated crawling** - Uses cookie from `../cookie.txt`
- **SHA256 deduplication** - Never visits the same page twice
- **Slow crawling** - Configurable delay between requests (default 2s)
- **Resumable** - Saves state and can resume from interruption
- **Full data extraction** - Extracts text, forms, tables, links, images, metadata
- **Raw HTML backup** - Saves original HTML for each page

## Setup

### Python Version
```bash
pip install requests beautifulsoup4 lxml playwright
playwright install chromium  # for screenshots
```

### Node.js/Puppeteer Version (Recommended for local use)
```bash
cd scripts/migrate-site
npm install
```

## Cookie Setup

Put your auth cookie in `scripts/cookie.txt`:
```
ASP.NET_SessionId=abc123; .ASPXAUTH=xyz789; locationId_new=2
```

Get this from browser DevTools (F12) > Network tab > Copy the Cookie header from any authenticated request.

## Usage

### Python Spider
```bash
cd scripts/migrate-site
python spider.py https://mortys.drivetraqr.ca/admin

# With options
python spider.py https://mortys.drivetraqr.ca/admin --delay 3.0 --max-pages 500
```

### Node.js/Puppeteer Spider (better for local use)
```bash
cd scripts/migrate-site
node spider.js https://mortys.drivetraqr.ca/admin

# With options
node spider.js https://mortys.drivetraqr.ca/admin --delay 2000 --max-pages 500
```

### Screenshot Verification (Python)
```bash
python screenshot.py https://example.com/app/page
```

## Targeted-student queue (priority re-scrape)

Sometimes you need a *specific* legacy student re-scraped now rather than waiting
for them to show up in the last-7-days registration scan. The queue builder lets
you search the legacy site by name and queue the matching students for the next
scrape run.

It is a two-piece, **purely additive** flow:

1. **Build the queue** — `server/scripts/build-scrape-queue.ts` searches the
   legacy site's student-search endpoint for one or more terms, turns each match
   into a `studentfile` seed URL, skips students already imported into the
   database and URLs already queued, and **appends** the survivors to a queue
   file (one URL per line).
2. **Drain the queue** — `spider.js --queue-file <path>` scrapes every queued
   URL *first* (before any normal crawl), then removes each one from the queue
   file as it succeeds. Failed entries stay queued for the next run. The nightly
   scrape does this automatically before its registration scan.

### Building the queue

```bash
# Dev (tsx). Terms can be partial names; pass as many as you like.
tsx server/scripts/build-scrape-queue.ts pa john "smith"

# From a file (one term per line), optionally combined with inline terms:
tsx server/scripts/build-scrape-queue.ts --file terms.txt
tsx server/scripts/build-scrape-queue.ts pa --file terms.txt

# Production container (compiled to dist by the Docker build):
docker exec -it <container> node dist/build-scrape-queue.js pa john
```

It prints a summary: students found, skipped (already imported), skipped
(duplicate), and added to the queue. It **fails loudly** (non-zero exit, no queue
written) if the session cookie is missing or expired, so you never get a silent
empty queue.

### Draining the queue manually

```bash
# Uses the default queue file (SCRAPE_QUEUE_FILE or <output_dir>/scrape-queue.txt)
node spider.js --queue-file --max-pages 2000

# Or an explicit path
node spider.js --queue-file /data/migrate/scrape-queue.txt --max-pages 2000
```

The nightly run (`nightly-scrape.sh`) drains the queue automatically **before**
the registration scrape. If the queue drain hits an expired session it skips the
registration scrape and the existing failure alert fires.

After draining, load the freshly scraped JSON the usual way: admin **Data
Migration → Import to Database → Run Import**.

## Environment variables

`spider.js` honors these so it can run the same way locally and inside the
production Docker container:

| Variable | Purpose | Default |
| --- | --- | --- |
| `IMPORT_DATA_DIR` / `MIGRATE_OUTPUT_DIR` | Where scraped JSON/HTML is written | `./migrate` |
| `MIGRATE_COOKIE_FILE` | Path to the auth cookie file | `../cookie.txt` |
| `MIGRATE_BASE_URL` | Legacy site origin used by the queue builder for search/seed URLs | `https://mortys.drivetraqr.ca` |
| `SCRAPE_QUEUE_FILE` | Targeted-student queue file (builder appends, spider drains) | `<output_dir>/scrape-queue.txt` |
| `SCRAPE_QUEUE_MAX_PAGES` | Max pages the nightly queue drain will scrape | `2000` |
| `PUPPETEER_EXECUTABLE_PATH` | Chromium binary (set in the container) | bundled Chromium |
| `SCRAPE_LOG_LEVEL` | Log verbosity: `error`, `warn`, `info`, `debug`, or `trace` | `info` |
| `SCRAPE_MAX_RETRIES` | Extra navigation attempts on failure (0 = single attempt) | `0` |

## Logging

`spider.js` has a small leveled logger. Every line is prefixed with an ISO
timestamp and a severity tag, e.g.:

```
2026-06-29T22:00:03.142Z [INFO] [1] Scraping: https://mortys.drivetraqr.ca/admin/reports/registrations/?date=29%2F06%2F2026
2026-06-29T22:00:08.901Z [INFO]     Done (status 200, 5621ms, 37 new links)
```

This makes `/data/logs/nightly-scrape.log` greppable and time-ordered.

### Levels

| Level | What you get |
| --- | --- |
| `error` | Failures only (scrape errors, login-redirect / expired-cookie marker). Always shown. |
| `warn` | The above plus recoverable problems (state load failure, extract errors, navigation retries, missing cookie). |
| `info` (default) | The above plus per-page start/finish (URL, status, timing, new link count) and run summary. Roughly matches the previous output volume. |
| `debug` | The above plus per-page diagnostics: hash, queue depth, navigation timing, requested-vs-final URL, redirect chain, links found/queued/skipped, extraction counts (forms/tables/headings), retry attempts, output path. |
| `trace` | The above plus the most verbose details (e.g. "no redirects"). |

Cookie **contents are never logged** at any level — only whether a cookie file
was found.

### Setting the level

Use the env var or a CLI flag (the flag overrides the env var):

```bash
# Env var
SCRAPE_LOG_LEVEL=debug node spider.js https://mortys.drivetraqr.ca/admin

# CLI flags
node spider.js https://mortys.drivetraqr.ca/admin --log-level debug
node spider.js https://mortys.drivetraqr.ca/admin --debug    # shortcut for --log-level debug
node spider.js https://mortys.drivetraqr.ca/admin --trace    # shortcut for --log-level trace
```

`scrape-registrations.sh` honors `SCRAPE_LOG_LEVEL` from the environment and
passes it through to the spider:

```bash
SCRAPE_LOG_LEVEL=debug ./scrape-registrations.sh 29/06/2026 7
```

### Debug scrape inside the production container (Docker)

The nightly run stays at `info`. To run a one-off debug scrape inside the
container (output still lands on the `/data` volume):

```bash
docker exec -it <container> \
  env SCRAPE_LOG_LEVEL=debug \
  node scripts/migrate-site/spider.js https://mortys.drivetraqr.ca/admin
```

To temporarily raise the **nightly** verbosity without code changes, set
`SCRAPE_LOG_LEVEL` (and optionally `SCRAPE_MAX_RETRIES`) in the container's
environment — `docker-entrypoint.sh` forwards both into the cron environment
and `nightly-scrape.sh` exports them for the scraper.

## Running inside the production container (Docker)

The prod image bundles this scraper plus a headless Chromium. Output and the
cookie live on a Docker volume mounted at `/data` so they survive restarts:

- `IMPORT_DATA_DIR=/data/migrate` — scraped pages + `_spider_state.json` (dedup
  state) persist here, so re-running the scraper resumes instead of starting over.
- `MIGRATE_COOKIE_FILE=/data/cookie.txt` — put the auth cookie here once
  (e.g. `docker cp cookie.txt <container>:/data/cookie.txt`).

Run the scraper inside the container:

```bash
docker exec -it <container> node scripts/migrate-site/spider.js https://mortys.drivetraqr.ca/admin
```

Then use the admin **Data Migration → Import to Database** tab to load the
scraped JSON into the database (see "In-app importer" below).

## In-app importer

The admin **Data Migration** page has an **Import to Database** tab that walks
the scraped JSON in `IMPORT_DATA_DIR` and idempotently upserts students,
contracts, payments, evaluations, lessons, notes, course-transfer/phase progress,
online tests, and Zoom attendance.

- It is **idempotent**: every page is tracked in the `imported_pages` table by
  its `url_hash`, and a content hash lets re-runs skip files that have not
  changed. Child records carry deterministic legacy keys so re-running never
  duplicates rows. Tick **"Re-process every file"** to force a full re-import.
- Backend: `server/services/json-importer.ts`; endpoints `GET /api/import/manifest`,
  `POST /api/import/start`, `GET /api/import/status`.

## Output Structure

```
migrate/
├── _manifest.json          # Index of all scraped pages
├── _spider_state.json      # Resumable state file
├── <sha256_hash>.json      # Extracted data for each page
├── <sha256_hash>.html      # Raw HTML for each page
└── screenshots/            # Verification screenshots
    └── <hash>.png
```

> Note: the in-app importer uses `_manifest.json` as the source of truth for
> which pages to import and the counts shown by page type. If `_manifest.json`
> is missing or unreadable, it falls back to recursively walking
> `IMPORT_DATA_DIR` for `*.json` files (skipping any whose name starts with `_`),
> so it still works on partial or manually-assembled data dumps.

## JSON Data Format

Each page produces a JSON file with:

```json
{
  "url": "https://example.com/page",
  "url_hash": "a1b2c3d4e5f6g7h8",
  "scraped_at": "2024-01-15T10:30:00.000000",
  "title": "Page Title",
  "meta": { "description": "...", "keywords": "..." },
  "headings": [{ "level": 1, "text": "Main Title" }],
  "text_content": "All visible text content...",
  "forms": [{
    "action": "/submit",
    "method": "post",
    "id": "userForm",
    "name": "userForm",
    "fields": [{
      "tag": "input",
      "name": "email",
      "type": "text",
      "id": "txtEmail",
      "value": "user@example.com",
      "placeholder": "Enter email",
      "checked": false,
      "disabled": false,
      "readonly": false
    }],
    "field_data": {
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe"
    }
  }],
  "tables": [{
    "id": "dataGrid",
    "class": "table table-striped",
    "caption": "User List",
    "headers": ["ID", "Name", "Email"],
    "rows": [
      ["1", "John Doe", "john@example.com"],
      ["2", "Jane Smith", "jane@example.com"]
    ],
    "records": [
      { "_row_index": 0, "ID": "1", "Name": "John Doe", "Email": "john@example.com" },
      { "_row_index": 1, "ID": "2", "Name": "Jane Smith", "Email": "jane@example.com" }
    ]
  }],
  "links": [{ "href": "/other-page", "text": "Link text" }],
  "images": [{ "src": "/img/photo.jpg", "alt": "Description" }],
  "status_code": 200,
  "raw_html_length": 45678
}
```

### Key Data Structures

**Forms with `field_data`**: Easy key-value access to form values
- `fields[]` - detailed info about each input (name, id, value, type, etc.)
- `field_data{}` - simple key-value pairs for direct database import

**Tables with `records`**: JSON-ready for database import
- `rows[]` - raw array format
- `records[]` - object format with column headers as keys (ideal for cross-loading)

**Label-Value pairs** (`label_values`): Extracts display data from common patterns
- `<label>Name</label><div>John Doe</div>` → `{"Name": "John Doe"}`
- `<dt>Email</dt><dd>john@example.com</dd>` → `{"Email": "john@example.com"}`
- Two-column tables with header/value → `{"Status": "Active"}`

## Tips

1. **Resuming**: If interrupted, just run the same command again - it will skip already-visited pages

2. **Rate limiting**: Increase `--delay` if you get blocked (Python uses seconds, Node uses milliseconds)

3. **Clear state**: Delete `migrate/_spider_state.json` to start fresh

4. **Puppeteer recommended**: For local use, the Puppeteer version handles JavaScript-rendered content better
