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
