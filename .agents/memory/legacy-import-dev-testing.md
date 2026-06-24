---
name: Testing the legacy JSON importer in Replit dev
description: Why import-seed/ does not auto-load in dev, and how to make the importer see data locally
---

The first-boot seeding that copies `import-seed/` → the import data dir runs ONLY in the
Docker container (`docker-entrypoint.sh`). It does NOT run under the Replit dev workflow
(`npm run dev`), so dropping data in `import-seed/` does not make it importable in dev.

**Why:** dev has no entrypoint script; the importer just reads `getImportDataDir()`.

**How to apply:** In dev, `getImportDataDir()` = `IMPORT_DATA_DIR` env, else
`<cwd>/scripts/migrate-site/migrate`. To test against `import-seed/` data, either set
`IMPORT_DATA_DIR` to the data path, or symlink `scripts/migrate-site/migrate` → `import-seed`
(that path is gitignored, so the symlink/data never gets committed). The importer is
manifest-driven (`_manifest.json`), so macOS `._*`/dot junk from a Mac copy is ignored and
harmless. Importing the full legacy set creates a large number of records in the dev DB
(idempotent, re-runnable).

## Zoom screenshots imported as student documents
Zoom attendance screenshot images live ONLY in the admin studentfile JSON `links[]`:
each S3 image href (`//zoomscreenshots.s3...jpg`, link text "Zoom screenshot") is
immediately followed by its `/zoomscreenshot/?...&courseComponentId=N&screenshotNo=M`
link (the standalone zoomscreenshot page JSON does NOT contain the image URL — only raw HTML JS).
So both the image URL and its component/screenshot mapping are available at import time
with no scraper change.

**Decision:** import them as `studentDocuments` rows (documentType "zoom_screenshot"),
reusing the existing S3 upload + `/api/student-documents/:id/file` download endpoint.
documentType is free text, so no schema migration. Idempotency key (legacyDocumentId) =
`${legacyId}_zoomimg_${componentId}_${screenshotNo}`, preloaded into ctx.docKeys in buildContext.

**Why the insert order matters:** in the S3 path, insert the row WITHOUT legacyDocumentId
first, upload to S3, then stamp documentData + legacyDocumentId only on success (delete the
placeholder row on upload failure). Stamping the key before a successful upload would make
buildContext preload it and skip that screenshot forever on every later run. Dead source URLs
are skipped WITHOUT marking the key done, so they retry on a later run.

## Online-test question images imported the same way
Online knowledge-test results pages (`/onlinetest/results/?...`, classified "onlinetest",
routed to importOnlineTest) embed the SAAQ quiz question images in `page.images[]` with
src on `examensenlignes.s3.ca-central-1.amazonaws.com`. These are GENERIC (same q01.jpg for
every student of a given test version), not student-specific like zoom screenshots.

Stored as `online_test_image` student documents via the shared helper `importImageAsDocument`
(refactored out of the zoom path; both zoom + test images now go through it). Idempotency key =
`${legacyId}_testimg_${slug}` where slug = last two path segments minus extension
(e.g. `quebecconduite5_q01`), so a student's repeated test attempts of the same version don't
duplicate. buildContext now preloads docKeys from ALL studentDocuments with non-null
legacyDocumentId (zoom + test keys have distinct prefixes, no collision).

**Security:** fetchImage enforces a strict exact-hostname allowlist (ALLOWED_IMAGE_HOSTS) +
https-only before fetching, so a crafted import file can't drive server-side fetches to
arbitrary hosts (SSRF). The `.includes(...)` checks in the parsers are only selectors.

UI: student-profile Documents tab has two galleries — "Zoom Screenshots" and "Online Test
Questions" — each filtering by documentType.
