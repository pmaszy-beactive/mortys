---
name: drizzle-kit push drift + post-merge hangs
description: Why new migrations here are hand-trimmed and how db:push can break task merges
---

# drizzle-kit push, schema drift, and post-merge

This repo has pre-existing schema drift: `shared/schema.ts` contains columns
(refund / reset-password / vehicle related) that are NOT in the SQL migration
files. Because of this:

- **Generating a migration picks up unrelated drift.** `drizzle-kit generate`
  emits the new table PLUS the drift columns. When adding one table, hand-trim
  the generated SQL down to only the intended change (e.g. a single
  `CREATE TABLE IF NOT EXISTS`), so unrelated drift is not applied.

- **`drizzle-kit push` prompts on drift.** `npm run db:push` asks interactive
  questions (e.g. "is this a rename or a new column?") whenever it sees the
  ambiguous drift. In dev that blocks; create the table directly via SQL instead.

- **Post-merge no longer uses db:push.** `scripts/post-merge.sh` now runs
  `npx tsx scripts/db-migrate.ts`, a non-interactive migrator that applies only
  the committed SQL files in `./migrations` (never reads `schema.ts`, so no
  drift is ever applied, and it never prompts).

**Adoption/baseline gotcha:** the dev DB was built via `db:push`, so it had the
full schema but NO `drizzle.__drizzle_migrations` tracking table. Running the
ORM migrator as-is would replay `0000` (bare `CREATE TABLE`) and crash. So
`db-migrate.ts` baselines on first run: if the tracking table is empty AND
`public.users` already exists, it records every committed migration as applied
(using Drizzle's own `readMigrationFiles` hashes so they match what the migrator
checks). Fresh/empty DB → no baseline, migrator builds from `0000`.

**Why:** production already applies SQL via the `dist/migrate.js` ORM migrator
(journal-ordered, idempotent). `db-migrate.ts` brings that same SQL-migration
path to dev/post-merge instead of the fragile, drift-prone `push`.

**How to apply:** when adding schema, write/trim a SQL migration + journal entry
and rely on the migrate runner. `db:push` (`drizzle-kit push`) still exists in
package.json but is interactive/drift-prone — avoid it in automation.
