---
name: Drizzle migration baseline vs db:push drift
description: Why post-merge migrations can fail with "relation already exists" and how to reconcile
---

The dev database sometimes receives new schema via `drizzle-kit push` (or a prior merge) before the corresponding SQL migration file is tracked in `drizzle.__drizzle_migrations`. The post-merge migrator (`scripts/db-migrate.ts`) then replays the migration and fails with `42P07 relation ... already exists`.

**Why:** `scripts/db-migrate.ts` only auto-baselines when the tracking table is completely empty. If some migrations are tracked but a newer one's objects already exist, it fails.

**How to apply:** Verify the migration's objects genuinely exist in the DB, then insert its hash into `drizzle.__drizzle_migrations` using `readMigrationFiles({ migrationsFolder })` from `drizzle-orm/migrator` (Drizzle's own hash, plus `folderMillis`), then re-run `npx tsx scripts/db-migrate.ts` so remaining migrations apply. Run helper scripts from the workspace root (not /tmp) so node module resolution works, and use a `.mts` file — `tsx -e` can't do top-level await.
