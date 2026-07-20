---
name: Class times are school-local wall clock
description: How class date/time strings must be interpreted on a UTC server
---
Class `date`/`time` columns are wall-clock strings in the school's local timezone, but the server (dev + prod Docker) runs in UTC.

**Why:** Comparing `new Date(\`${date}T${time}\`)` against `Date.now()` on a UTC server misjudges start times by the UTC/Toronto offset — attendance was blocked for hours after a class actually started.

**How to apply:** Any server-side "has the class started / how long until start" check must convert via the school timezone (env `SCHOOL_TIMEZONE`, default America/Toronto) — see the shared `getClassStartTime`/`hasClassStarted` helpers at module scope in the routes file. Never parse class times as server-local for time gating.

Also learned: a migration SQL file is only applied if it has an entry in `migrations/meta/_journal.json`; parallel task agents can ship the .sql without the journal entry, silently skipping the migration ("Schema is up to date" while the table is missing).
