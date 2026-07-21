ALTER TABLE "bug_reports" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'open';
