---
name: Module 5 exam engine
description: How the online proctored-lite exam and course start-dates features work in Morty's app
---

# Module 5 Online Exam (proctored-lite)

- Camera visibility is via Zoom ONLY — there is deliberately NO in-app proctoring/webcam capture. Do not add one.
- Pass mark = 75%. First attempt uses test code A-240115-133030; the single free retake uses A-240115-133143. One retake max.
- "Begin Test" unlocks at class start + 60 min; results become visible at end of the 2nd hour (class start + duration). Server is authoritative for both windows and for grading.
- Exam support email = info@mortys.ca (flagged-question emails go there).
- Backend engine + routes live in server/routes.ts; answer keys + helpers (testCodeForAttempt, questionImagePath, EXAM_OPTIONS, EXAM_PASS_PERCENT) in shared/examData.ts. Question images served at /exam-assets/{code}/qN.png (24 per test).

- Grading is self-healing: student result/status endpoints always re-grade stored answers against the key and repair a stale stored score (never trust a stored 0); answer-save/reopen null out score/passed/correctCount; admin backfill endpoint POST /api/admin/exam-attempts/recalculate.

**Why:** these were locked product decisions; changing them silently breaks compliance expectations. A stored score written before answers were final once showed a student a wrong 0% — stored grades must never be treated as final over a fresh grading.

**How to apply:** when touching exam flow, keep grading/timing server-side; instructor endpoints (/api/exam/class/:classId/attempts, /api/exam/attempt/:id/review) must enforce that instructors only see their own assigned classes (admins via req.user see all, instructors via req.instructor are restricted).
