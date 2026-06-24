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

## Environment variables

`spider.js` honors these so it can run the same way locally and inside the
production Docker container:

| Variable | Purpose | Default |
| --- | --- | --- |
| `IMPORT_DATA_DIR` / `MIGRATE_OUTPUT_DIR` | Where scraped JSON/HTML is written | `./migrate` |
| `MIGRATE_COOKIE_FILE` | Path to the auth cookie file | `../cookie.txt` |
| `PUPPETEER_EXECUTABLE_PATH` | Chromium binary (set in the container) | bundled Chromium |

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

> Note: the in-app importer does **not** require `_manifest.json`. It recursively
> walks `IMPORT_DATA_DIR` for `*.json` files (skipping any whose name starts
> with `_`), so it works even when the scraper writes nested per-URL folders.

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
