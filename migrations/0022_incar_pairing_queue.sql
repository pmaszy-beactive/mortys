-- =====================================================================
-- Task 272 (revised): Auto In-Car 12/13 combined pairing queue.
--
-- ONE queue for the combined 12/13 session.  The canonical class is an
-- auto driving class with classNumber=12, duration=120, maxStudents=2.
-- Booking In-Car #13 directly is blocked at the application layer.
--
-- Lifecycle:
--   Student 1 calls bookCombinedSlot(studentId, classId) → enrolled
--   (attendanceStatus=registered) with status=booked_first.
--   Offer is sent to next waiting queue student (student 2).
--   Student 2 accepts → enrolled in same class; pair status=paired.
--   Confirmation requests sent ~24 h before class (waking hours).
--   Both confirm → confirmed. Either declines → pair dissolved, seat
--   re-offered to next waiting candidate; declining student re-queued.
--   Completion marks both In-Car 12 and In-Car 13 attended for both.
--   Day-of no-show → convert present student to solo In-Car 11 or 14.
-- =====================================================================

-- Queue of students waiting to be paired for In-Car 12/13.
-- sessionNumber is always 12 (the canonical slot); 13 is implicit.
CREATE TABLE IF NOT EXISTS "incar_pairing_queue" (
  "id"              serial PRIMARY KEY,
  "student_id"      integer NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  -- Always 12 (the combined 12/13 slot canonical number).
  "session_number"  integer NOT NULL DEFAULT 12 CHECK ("session_number" = 12),
  "status"          text NOT NULL DEFAULT 'waiting'
                      CHECK ("status" IN (
                        'waiting',      -- in queue, no active pair
                        'offered',      -- offer sent to this student (they are student 2)
                        'booked_first', -- student 1: enrolled, awaiting partner
                        'paired',       -- fully paired (both enrolled)
                        'confirmed',    -- both confirmed attendance
                        'completed',    -- session done (counts 12+13)
                        'deferred',     -- partner not found before horizon; enrollment cancelled
                        'converted_solo', -- converted to solo In-Car 11 or 14
                        'cancelled'     -- removed from system
                      )),
  -- Lower number = higher priority; FIFO tie-break via queued_at.
  "priority"        integer NOT NULL DEFAULT 100,
  "queued_at"       timestamp NOT NULL DEFAULT now(),
  -- classId the student is booked into (set for booked_first + paired).
  "booked_class_id" integer REFERENCES "classes"("id"),
  -- enrollmentId in classEnrollments for this student (set once enrolled).
  "enrollment_id"   integer REFERENCES "class_enrollments"("id"),
  "updated_at"      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_incar_pq_student"
  ON "incar_pairing_queue" ("student_id");
CREATE INDEX IF NOT EXISTS "idx_incar_pq_status_priority"
  ON "incar_pairing_queue" ("status", "priority", "queued_at");
CREATE INDEX IF NOT EXISTS "idx_incar_pq_class"
  ON "incar_pairing_queue" ("booked_class_id") WHERE "booked_class_id" IS NOT NULL;

-- At most one ACTIVE (non-terminal) queue entry per student. Terminal states
-- (completed, converted_solo, cancelled, deferred) may accumulate historically.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_incar_pq_active_per_student"
  ON "incar_pairing_queue" ("student_id")
  WHERE "status" IN ('waiting', 'offered', 'booked_first', 'paired', 'confirmed');

-- Active paired sessions: one row per pair of students sharing a class.
CREATE TABLE IF NOT EXISTS "incar_paired_sessions" (
  "id"                  serial PRIMARY KEY,
  -- The two queue entry rows that make up this pair.
  "queue_entry_id_a"    integer NOT NULL REFERENCES "incar_pairing_queue"("id"),
  "queue_entry_id_b"    integer NOT NULL REFERENCES "incar_pairing_queue"("id"),
  -- Denormalised student IDs (student A = booked first; B = accepted offer).
  "student_id_a"        integer NOT NULL REFERENCES "students"("id"),
  "student_id_b"        integer NOT NULL REFERENCES "students"("id"),
  -- The canonical In-Car 12 class both are enrolled in.
  "class_id"            integer NOT NULL REFERENCES "classes"("id"),
  -- Enrollment IDs for quick look-up / cancellation.
  "enrollment_id_a"     integer REFERENCES "class_enrollments"("id"),
  "enrollment_id_b"     integer REFERENCES "class_enrollments"("id"),
  "status"              text NOT NULL DEFAULT 'paired'
                          CHECK ("status" IN (
                            'paired',     -- both enrolled, awaiting confirmation window
                            'confirmed',  -- both confirmed attendance
                            'completed',  -- session completed (12+13 awarded)
                            'dissolved',  -- pair fell apart (decline/no-show/cancel)
                            'cancelled'   -- admin-cancelled
                          )),
  "paired_at"           timestamp NOT NULL DEFAULT now(),
  "completed_at"        timestamp,
  "dissolved_at"        timestamp,
  "dissolution_reason"  text,
  "notes"               text,
  "created_at"          timestamp NOT NULL DEFAULT now(),
  "updated_at"          timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "incar_ps_different_students" CHECK ("student_id_a" <> "student_id_b")
);

CREATE INDEX IF NOT EXISTS "idx_incar_ps_students"
  ON "incar_paired_sessions" ("student_id_a", "student_id_b");
CREATE INDEX IF NOT EXISTS "idx_incar_ps_class"
  ON "incar_paired_sessions" ("class_id");
CREATE INDEX IF NOT EXISTS "idx_incar_ps_status"
  ON "incar_paired_sessions" ("status");

-- Offer sent to a waiting student (student 2) for a specific class slot.
-- Only one pending offer may exist per queue entry at a time
-- (enforced by the unique partial index below).
CREATE TABLE IF NOT EXISTS "incar_pairing_offers" (
  "id"                serial PRIMARY KEY,
  -- The queue entry of the student receiving this offer (student 2).
  "queue_entry_id"    integer NOT NULL REFERENCES "incar_pairing_queue"("id"),
  "student_id"        integer NOT NULL REFERENCES "students"("id"),
  -- The class slot being offered.
  "class_id"          integer NOT NULL REFERENCES "classes"("id"),
  -- Set once the offer is accepted and the pair is created.
  "paired_session_id" integer REFERENCES "incar_paired_sessions"("id"),
  "status"            text NOT NULL DEFAULT 'pending'
                        CHECK ("status" IN (
                          'pending',   -- awaiting student 2 response
                          'accepted',  -- student 2 accepted → enrolled
                          'declined',  -- student 2 declined → next candidate offered
                          'expired',   -- 24 h deadline passed → next candidate offered
                          'withdrawn'  -- offer cancelled by system (e.g. class cancelled)
                        )),
  -- 24-hour response deadline.
  "expires_at"        timestamp NOT NULL,
  "responded_at"      timestamp,
  "decline_reason"    text,
  "created_at"        timestamp NOT NULL DEFAULT now(),
  "updated_at"        timestamp NOT NULL DEFAULT now()
);

-- Exactly one pending offer per queue entry.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_incar_po_active_per_entry"
  ON "incar_pairing_offers" ("queue_entry_id")
  WHERE "status" = 'pending';

-- Exactly one pending offer per class slot: a class only ever has ONE open
-- second-seat offer outstanding at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_incar_po_active_per_class"
  ON "incar_pairing_offers" ("class_id")
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "idx_incar_po_student_status"
  ON "incar_pairing_offers" ("student_id", "status");
CREATE INDEX IF NOT EXISTS "idx_incar_po_class"
  ON "incar_pairing_offers" ("class_id");

-- Confirmation requests sent ~24 h before a paired session.
-- One row per student per paired session.
CREATE TABLE IF NOT EXISTS "incar_session_confirmations" (
  "id"                  serial PRIMARY KEY,
  "paired_session_id"   integer NOT NULL REFERENCES "incar_paired_sessions"("id"),
  "student_id"          integer NOT NULL REFERENCES "students"("id"),
  "queue_entry_id"      integer NOT NULL REFERENCES "incar_pairing_queue"("id"),
  "status"              text NOT NULL DEFAULT 'pending'
                          CHECK ("status" IN ('pending', 'confirmed', 'declined')),
  "requested_at"        timestamp NOT NULL DEFAULT now(),
  "responded_at"        timestamp,
  "decline_reason"      text,
  "created_at"          timestamp NOT NULL DEFAULT now(),
  "updated_at"          timestamp NOT NULL DEFAULT now(),
  UNIQUE ("paired_session_id", "student_id")
);

CREATE INDEX IF NOT EXISTS "idx_incar_sc_student_status"
  ON "incar_session_confirmations" ("student_id", "status");

-- Immutable audit log for every state transition.
CREATE TABLE IF NOT EXISTS "incar_pairing_audit" (
  "id"                serial PRIMARY KEY,
  "event_type"        text NOT NULL,
  "queue_entry_id"    integer REFERENCES "incar_pairing_queue"("id"),
  "paired_session_id" integer REFERENCES "incar_paired_sessions"("id"),
  "offer_id"          integer REFERENCES "incar_pairing_offers"("id"),
  "confirmation_id"   integer REFERENCES "incar_session_confirmations"("id"),
  "student_id"        integer REFERENCES "students"("id"),
  "class_id"          integer REFERENCES "classes"("id"),
  "actor_id"          text,
  "actor_role"        text,
  "previous_status"   text,
  "new_status"        text,
  "details"           jsonb,
  "created_at"        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_incar_pa_queue_entry"
  ON "incar_pairing_audit" ("queue_entry_id");
CREATE INDEX IF NOT EXISTS "idx_incar_pa_student"
  ON "incar_pairing_audit" ("student_id");
CREATE INDEX IF NOT EXISTS "idx_incar_pa_created_at"
  ON "incar_pairing_audit" ("created_at" DESC);
