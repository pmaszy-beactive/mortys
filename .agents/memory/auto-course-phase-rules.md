---
name: Auto course phase rules
description: Source of truth for the auto (car) 4-phase curriculum rules and where they're enforced; scooter uses the simplified 2-phase model; moto now has its own real 4-phase program (see moto-curriculum.md).
---

The 4-phase curriculum documents (12 theory + 15 in-car, 28/28/56/56-day phase minimums) apply to the **auto (car) course only**. Scooter = 6 theory + 8 riding, simplified 2-phase (all theory before practical). Moto no longer uses the simplified model — it has its own real program (2 theory + 4 closed-circuit + 3 road, see moto-curriculum.md).

Key rules and their homes:
- Phase ordering + duration rules: `validateAutoRules` in `shared/bookingRules.ts` (docs allow T2–4 any order, Phase 3/4 flexible after opener — the strict one-at-a-time sequential layer is intentionally skipped for auto and applies to simplified courses only).
- 3-hours-per-day cap (auto, only when an in-car is involved; theory assumed 120 min when duration null): `checkMaxHoursPerDay`. Callers must pass `sameDayAlreadyBookedMinutes`/`sameDayAlreadyBookedHasDriving` — there are FOUR entry points (student book, reschedule, available-classes, admin `POST /api/class-enrollments`); forgetting one silently disables the rule there.
- Full-curriculum recurrence planner: `fullCurriculum` flag on `POST /api/admin/classes/bulk` — 27 classes, recommended order, anchors T5≥T1+28d, IC4≥T6+28d, IC10≥T8+56d, IC15≥T11+56d, IC12/13 shared (maxStudents 2), T5 hasTest.

**Why:** the school's printed phase documents are the contract-level source; earlier confusion arose when the same documents were briefly believed to be the moto rules.
