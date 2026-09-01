---
name: Scooter curriculum
description: Contract-level scooter course structure, isolation from Auto/Moto, and transfer-credit constraints.
---

The scooter program is exactly one 3-hour theory session followed by one 3-hour practical session. It has no additional phases, class numbers, or practical sessions and must never inherit the Auto or Moto curriculum. The practical class allows 1–5 students per instructor and defaults to 5.

**Why:** the prior generic “simplified course” assumption incorrectly gave scooter 6 theory and 8 practical sessions.

**How to apply:** every count, progress display, booking rule, scheduler, class create/update path, and recommendation must recognize only Theory #1 and Practical #1 at 180 minutes each. Reject other numbers, durations, and practical capacities above 5 rather than falling back.

Scooter transfer credits may recognize only Theory #1 and Practical #1, must deduplicate against attended records, and must participate in every authoritative booking/progress path.

**Why:** transferred students need to continue from valid prior training without creating fake attendance, while malformed legacy arrays must not unlock nonexistent sessions.

**How to apply:** merge validated scooter credits into computed completion state; do not rewrite attendance history or accept out-of-range credit numbers.