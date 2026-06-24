# Import seed data

Drop your already-scraped legacy JSON files here to have them **automatically
loaded onto the `/data` volume the first time the container starts**.

## What goes here

The page-level JSON produced by the scraper (`scripts/migrate-site/spider.js`).
Copy the **contents** of the scraper's output folder (normally
`scripts/migrate-site/migrate/`, including its `_manifest.json` if present) into
this directory. The folder structure is preserved.

Example layout:

```
import-seed/
  _manifest.json
  admin/
    studentfile/...json
    reports/registrations_*.json
  ...
```

## How it works

On container startup, `docker-entrypoint.sh` checks the import volume
(`IMPORT_DATA_DIR`, default `/data/migrate`). If that volume has **no** `.json`
files yet and this `import-seed/` folder **does**, the files are copied onto the
volume once. After that, the volume is the source of truth and this folder is
ignored on subsequent boots (so a re-scrape on the volume is never overwritten).

Nothing is imported into the database automatically — after the first boot, open
**Data Migration → Import to Database** in the admin UI and click **Run Import**.

## Privacy note

These files contain real student data (PII). They are **gitignored** on purpose
(only this README and `.gitkeep` are tracked) so the data is never committed to
Git. Place the files here on your deploy machine just before building the image.
