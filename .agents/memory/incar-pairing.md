---
name: In-Car 12/13 pairing queue
description: Design invariants for the combined In-Car 12/13 paired-lesson queue.
---

- 12/13 is ONE combined session with a strict canonical class shape (auto course, driving #12, 120 min, exactly 2 seats); #13 is never directly bookable and is awarded by expansion from an attended canonical #12.
- **Why:** the expansion silently never fires if capacity or course type is missing from the enrollment rows fed into completed-class computation — every new call site must supply them.
- **How to apply:** treat missing duration/maxStudents/courseType as non-canonical everywhere; never relax the predicate.
- All pairing state transitions must follow one lock protocol: student advisory locks, then the class row FOR UPDATE, then re-read and status-guard before mutating; offer transitions are conditional UPDATE ... WHERE status='pending' claims — zero rows means another actor won, abort without side effects.
- Completion requires BOTH enrollments attended; no-show conversion requires the selected student checked-in/attended and the partner absent/no-show, then atomically awards consecutive solo #11 and #14 while cancelling combined credit.
- Deferral returns the student to `waiting` with a priority boost (no terminal 'deferred' state) so they remain offerable.
- A pending, unexpired offer must survive confirmation-horizon lifecycle sweeps until the school-local class start; the receiving student can accept it any time before start.
- **Why:** withdrawing a live offer at the 24-hour horizon made the notification action fail with “Offer is no longer available” even though the class had not begun.
- **How to apply:** preserve both queue rows while the live offer exists, reject new accepts at/after class start, and treat duplicate accepts as success only when the same offer already has a complete paired session and enrollment.
- Auto In-Car #11 and #14 stay locked until a pending or accepted offer exists for a strict canonical combined #12 class. Terminal or malformed offers never qualify; the gate is not admin-overridable.
- **Why:** receiving a concrete 12/13 pairing slot establishes Phase 4 scheduling priority before the student books #11 or #14.
- **How to apply:** derive proof from the offer joined to its class, not queue status alone, and pass it through every booking, availability, reschedule, admin, and assistant validation path.
- Upcoming #12/#13 progress is booked only when an active paired/confirmed session references the student's uncancelled enrollment in the same strict canonical class; queue or offer state alone is insufficient.
- **Why:** the first student is enrolled before acceptance, and stale or malformed lifecycle rows must not make either curriculum row appear booked.
- **How to apply:** project one active canonical enrollment onto both progress rows, but keep completion tied to attended enrollment rules and keep #13 independently unbookable.
- A student-originated release of an enrolled canonical 12/13 seat strictly under 24 hours before start incurs a taxable CAD $100 fee; exactly 24 hours or earlier is free.
- **Why:** late cancellations disrupt both students and the replacement queue, while school/system actions are outside the student's control.
- **How to apply:** create one idempotent invoice per cancelled enrollment after the cancellation transaction commits. Missing/failed payment leaves the invoice due; never bill offer declines, deferrals, or staff/system actions.
