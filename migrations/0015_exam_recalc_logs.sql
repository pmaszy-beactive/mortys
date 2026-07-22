CREATE TABLE IF NOT EXISTS "exam_recalc_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"admin_email" text,
	"admin_name" text,
	"checked_count" integer NOT NULL,
	"corrected_count" integer NOT NULL,
	"changes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
