---
name: Drizzle migration baseline vs db:push drift
description: Why post-merge migrations can fail with "relation already exists" and how to reconcile
---

The dev database sometimes receives new schema via `drizzle-kit push` (or a prior merge) before the corresponding SQL migration file is tracked in `drizzle.__drizzle_migrations`. The post-merge migrator (`scripts/db-migrate.ts`) then replays the migration and fails with `42P07 relation ... already exists`.

**Why:** `scripts/db-migrate.ts` only auto-baselines when the tracking table is completely empty. If some migrations are tracked but a newer one's objects already exist, it fails.

**How to apply:** Verify the migration's objects genuinely exist in the DB, then insert its hash into `drizzle.__drizzle_migrations` using `readMigrationFiles({ migrationsFolder })` from `drizzle-orm/migrator` (Drizzle's own hash, plus `folderMillis`), then re-run `npx tsx scripts/db-migrate.ts` so remaining migrations apply. Run helper scripts from the workspace root (not /tmp) so node module resolution works, and use a `.mts` file — `tsx -e` can't do top-level await.

**Inverse failure mode (prod deploy crash):** push-created columns can exist in dev and in the meta snapshots but in NO migration SQL — production (built purely from migration files) then lacks them, and `drizzle-kit generate` will NOT emit the fix because the snapshot already claims the column exists. Write the guarded ALTER by hand (`ADD COLUMN IF NOT EXISTS`) and register new files in `migrations/meta/_journal.json` (the migrator only reads files listed there). Editing an already-applied migration file is safe for re-runs: the Drizzle migrator compares `folderMillis` timestamps, not hashes.

**Journal ordering gotcha:** the Drizzle migrator only applies a migration if its journal `when` (folderMillis) is GREATER than the last applied migration's `created_at`. If a new entry in `migrations/meta/_journal.json` gets a `when` earlier than an existing later entry (e.g. parallel task agents picking arbitrary millis), it is silently skipped in any DB that already applied the later one — "Schema is up to date" with missing columns. Always ensure new journal `when` values are strictly greater than every existing entry; bumping the `when` is safe (guarded SQL re-applies as a no-op).

**Drift check before deploys:** build a scratch DB from migrations only (`CREATE DATABASE mig_test;` on dev Neon works, then run db-migrate with DATABASE_URL pointed at it) and diff `information_schema.columns` against dev (sort with `LC_ALL=C` before `comm`). Zero diff = prod-safe.
