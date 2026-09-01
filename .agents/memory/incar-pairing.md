---
name: In-Car 12/13 pairing queue
description: Design invariants for the combined In-Car 12/13 paired-lesson queue.
---

- 12/13 is ONE combined session with a strict canonical class shape (auto course, driving #12, 120 min, exactly 2 seats); #13 is never directly bookable and is awarded by expansion from an attended canonical #12.
- **Why:** the expansion silently never fires if capacity or course type is missing from the enrollment rows fed into completed-class computation — every new call site must supply them.
- **How to apply:** treat missing duration/maxStudents/courseType as non-canonical everywhere; never relax the predicate.
- All pairing state transitions must follow one lock protocol: student advisory locks, then the class row FOR UPDATE, then re-read and status-guard before mutating; offer transitions are conditional UPDATE ... WHERE status='pending' claims — zero rows means another actor won, abort without side effects.
- Completion requires BOTH enrollments attended; day-of solo conversion is gated on class start passed + partner marked absent/no-show, and cancels the present student's combined enrollment so 12/13 can never be awarded from a converted session.
- Deferral returns the student to `waiting` with a priority boost (no terminal 'deferred' state) so they remain offerable.
- Auto In-Car #11 and #14 stay locked until a pending or accepted offer exists for a strict canonical combined #12 class. Terminal or malformed offers never qualify; the gate is not admin-overridable.
- **Why:** receiving a concrete 12/13 pairing slot establishes Phase 4 scheduling priority before the student books #11 or #14.
- **How to apply:** derive proof from the offer joined to its class, not queue status alone, and pass it through every booking, availability, reschedule, admin, and assistant validation path.
- A student-originated release of an enrolled canonical 12/13 seat strictly under 24 hours before start incurs a taxable CAD $100 fee; exactly 24 hours or earlier is free.
- **Why:** late cancellations disrupt both students and the replacement queue, while school/system actions are outside the student's control.
- **How to apply:** create one idempotent invoice per cancelled enrollment after the cancellation transaction commits. Missing/failed payment leaves the invoice due; never bill offer declines, deferrals, or staff/system actions.
