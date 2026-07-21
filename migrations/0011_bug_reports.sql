CREATE TABLE IF NOT EXISTS "bug_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"submitter_type" text NOT NULL,
	"submitter_id" text NOT NULL,
	"submitter_name" text,
	"submitter_email" text,
	"submitter_role" text,
	"page_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bug_reports_created_at_idx" ON "bug_reports" ("created_at");
