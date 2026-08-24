-- Admin-only testing override for Auto Phase 1 elapsed-day progression.
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase1_timing_advance_days" integer DEFAULT 0 NOT NULL;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase1_timing_override_reason" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase1_timing_override_set_at" timestamp;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phase1_timing_override_set_by" varchar REFERENCES "users"("id");