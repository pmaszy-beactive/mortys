---
name: Auto course phase rules
description: Source of truth for the auto (car) 4-phase curriculum rules and where they're enforced; moto and scooter have separate programs.
---

The 4-phase curriculum documents (12 theory + 15 in-car, 28/28/56/56-day phase minimums) apply to the **auto (car) course only**. Moto and scooter each have their own separate curriculum; never apply Auto phase structure to either.

Key rules and their homes:
- Phase ordering + duration rules: `validateAutoRules` in `shared/bookingRules.ts` (docs allow T2–4 any order, Phase 3/4 flexible after opener — the strict one-at-a-time sequential layer is intentionally skipped for auto and applies to simplified courses only).
- 3-hours-per-day cap (auto, only when an in-car is involved; theory assumed 120 min when duration null): `checkMaxHoursPerDay`. Callers must pass `sameDayAlreadyBookedMinutes`/`sameDayAlreadyBookedHasDriving` — there are FOUR entry points (student book, reschedule, available-classes, admin `POST /api/class-enrollments`); forgetting one silently disables the rule there.
- Full-curriculum recurrence planner: `fullCurriculum` flag on `POST /api/admin/classes/bulk` — 27 classes, recommended order, anchors T5≥T1+28d, IC4≥T6+28d, IC10≥T8+56d, IC15≥T11+56d, IC12/13 shared (maxStudents 2), T5 hasTest.

**Why:** the school's printed phase documents are the contract-level source; earlier confusion arose when the same documents were briefly believed to be the moto rules.

For timing-gate testing, each Auto phase has its own additive advance to the **computed elapsed-day count**: Phase 1 T1→T5, Phase 2 T6→IC4, Phase 3 T8→T11, and Phase 4 T11→IC15. Never rewrite attendance dates or class schedules. Keep controls owner/admin-only, reason-required, independently reversible, and audit every set/clear with accurate before/after values.

**Why:** test data still needs truthful attendance history, while staff need to exercise every timing gate before the official 28/28/56/56-day waits have elapsed.

**How to apply:** pass all four advances through every booking/progression entry point, but apply each value only to its matching Auto elapsed-day gate. Never use them for Moto or Scooter prerequisites.
