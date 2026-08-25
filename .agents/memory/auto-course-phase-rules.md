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

For early Phase 1 testing, advance the student's **computed elapsed-day count** by an additive number of days; never rewrite Theory #1 attendance dates or class schedules. Keep the control owner/admin-only, reason-required, reversible, and audit every set/clear with accurate before/after values.

**Why:** test data still needs truthful attendance history, while staff need to exercise Theory #5 eligibility before the real 28-day wait has elapsed.

**How to apply:** pass the per-student advance through every booking/progression entry point, but apply it only to the Auto Theory #5 28-day calculation unless the school explicitly expands the override's scope.
