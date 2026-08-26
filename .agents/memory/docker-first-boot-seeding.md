---
name: Docker first-boot seeding
description: Startup-readiness and data-safety constraints for the custom Docker deployment's persistent import volume.
---

Large first-boot import-volume hydration must run outside the application startup critical path. Stage the complete bundle in an importer-hidden directory, use an OS-released advisory lock for single-writer publication, then expose it with an atomic directory rename.

**Why:** the custom deployment health check allows 300 seconds, but copying tens of thousands of small seed files synchronously prevented the web server from starting and forced rollback. Direct background copying into live paths also risks partial imports and overwriting scraper data.

**How to apply:** start migrations and the web process without waiting for bundled import data. Preserve any existing live JSON as authoritative, never publish partial files, use per-container stages, supervise copy shutdown, and ensure hard-killed workers cannot leave a permanent lock.