-- Independent admin-only timing-test advances for Auto Phases 2–4.
-- Existing Phase 1 columns and values are intentionally left unchanged.
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase2_timing_advance_days" integer DEFAULT 0 NOT NULL;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase2_timing_override_reason" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase2_timing_override_set_at" timestamp;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase2_timing_override_set_by" varchar REFERENCES "users"("id");

ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase3_timing_advance_days" integer DEFAULT 0 NOT NULL;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase3_timing_override_reason" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase3_timing_override_set_at" timestamp;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase3_timing_override_set_by" varchar REFERENCES "users"("id");

ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase4_timing_advance_days" integer DEFAULT 0 NOT NULL;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase4_timing_override_reason" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase4_timing_override_set_at" timestamp;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase4_timing_override_set_by" varchar REFERENCES "users"("id");