---
name: Stale task-branch merges reintroduce duplicate type names
description: Why "no scraped data found" can mean the dev server is down, and how a merged stale branch caused a PhaseProgress type collision in server/routes.ts
---

# Merged stale branches can crash the server via duplicate type names

When an isolated task agent branches from an older main and is later merged,
its copy of a large shared file (e.g. `server/routes.ts`) can reintroduce an
import that now collides with a type added on main after the branch point.

**Concrete case:** a merge re-added `import type { ..., PhaseProgress, ... } from
"@shared/phaseConfig"` while main already had a *local* `interface PhaseProgress`
(a different shape) used by `calculatePhaseProgress`. Result: TS2440
"Import declaration conflicts with local declaration" → dev server failed to
start (`/health` 000).

**Why it mattered:** the admin Data Migration manifest endpoint
(`GET /api/import/manifest`) was unreachable, so the UI showed "no scraped data
found" even though 15,965 JSON files were present. The importer was fine — the
server was down.

**Resolution rule:** when two `PhaseProgress`-style names collide, keep the
*shared* type import (here it feeds `buildPhaseProgress` → `PhaseProgressData`)
and rename the *local* interface (renamed to `PhaseProgressSummary`, updating its
declaration, the function return type, and any `Type['field']` index access).

**Debugging rule:** "no scraped data found but there are 1000s of records" → FIRST
check the dev server is actually up (`curl localhost:5000/health`) and typecheck
`server/routes.ts`. Only after confirming the server runs should you suspect
`IMPORT_DATA_DIR` / data-path / seeding issues. After any task merge, run
`npx tsc --noEmit` before assuming behavior changes are intentional.
