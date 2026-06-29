---
name: Scrape queue file contract
description: The two halves of the targeted-student scrape queue must agree on path + URL shape or students silently vanish.
---

# Targeted-student scrape queue contract

Two independently-runnable pieces share one plain-text queue file (one seed URL
per line):
- `server/scripts/build-scrape-queue.ts` (TS, tsx in dev / `dist/build-scrape-queue.js` in prod) APPENDS studentfile URLs.
- `scripts/migrate-site/spider.js --queue-file` DRAINS it, removing each entry on success.

**The contract that must stay in lockstep:**
- Queue file path resolution: `SCRAPE_QUEUE_FILE` || `<output_dir>/scrape-queue.txt`,
  where output_dir = `MIGRATE_OUTPUT_DIR` || `IMPORT_DATA_DIR/migrate` || cwd-relative
  `scripts/migrate-site/migrate`. Both files implement this independently — change one, change both.
- Seed URL shape: `<MIGRATE_BASE_URL>/admin/studentfile/?studentUserId=<id>&courseId=<id>`.
  The spider dedupes/normalizes URLs, so the builder must emit the exact form the spider expects.

**Why:** if the two disagree on path, the builder writes a file the spider never
reads (and vice versa) — no error, just zero targeted students scraped.

**How to apply:** when touching either file's path/URL logic, grep both for
`scrape-queue`/`studentfile` and keep them identical. The builder fails loudly on
missing/expired cookie (login redirect / 401/403) specifically so it never writes
an EMPTY queue silently — preserve that.
