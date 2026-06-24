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

- **Post-merge runs db:push with stdin closed.** `scripts/post-merge.sh` runs
  `npm run db:push`. The post-merge runner closes stdin, so any drizzle prompt
  gets EOF and the whole post-merge step fails (or silently mis-applies drift).
  A migration-only, non-interactive post-merge is safer.

**Why:** production applies SQL via the `dist/migrate.js` runner (idempotent,
journal-ordered), so prod is fine; the fragile path is dev/post-merge `push`.

**How to apply:** when adding schema, write/trim a SQL migration and rely on the
migrate runner; do not depend on `db:push` landing cleanly until the drift is
resolved.
