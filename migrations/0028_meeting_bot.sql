-- Meeting-bot integration: sessions dispatched to join Zoom meetings,
-- retrieve transcripts/recordings, and reconcile attendance.

-- New columns on class_enrollments: track manual attendance overrides so
-- the reconciler never clobbers an admin-set attendance status.
ALTER TABLE "class_enrollments" ADD COLUMN IF NOT EXISTS "attendance_manually_overridden" boolean NOT NULL DEFAULT false;
ALTER TABLE "class_enrollments" ADD COLUMN IF NOT EXISTS "attendance_override_at" timestamptz;
ALTER TABLE "class_enrollments" ADD COLUMN IF NOT EXISTS "attendance_override_by" varchar REFERENCES "users"("id");

-- Primary meeting-bot sessions table.
CREATE TABLE IF NOT EXISTS "meeting_bot_meetings" (
  "id" serial PRIMARY KEY,
  "class_id" integer NOT NULL UNIQUE REFERENCES "classes"("id"),
  "zoom_native_meeting_id" text NOT NULL,
  "zoom_passcode" text,
  "meeting_id" text UNIQUE,
  "session_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  -- pending | joining | active | completed | failed | stopped
  "dispatched_at" timestamptz,
  "ended_at" timestamptz,
  "transcript" jsonb,
  "recording_available" boolean NOT NULL DEFAULT false,
  "reconcile_report" jsonb,
  "reconciled_at" timestamptz,
  "dispatch_job_id" integer REFERENCES "jobs"("id"),
  "reconcile_job_id" integer REFERENCES "jobs"("id"),
  "dispatch_generation" integer NOT NULL DEFAULT 0,
  "dispatch_uncertain" boolean NOT NULL DEFAULT false,
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_mbm_class_id" ON "meeting_bot_meetings"("class_id");
CREATE INDEX IF NOT EXISTS "IDX_mbm_status" ON "meeting_bot_meetings"("status");
CREATE INDEX IF NOT EXISTS "IDX_mbm_meeting_id" ON "meeting_bot_meetings"("meeting_id");