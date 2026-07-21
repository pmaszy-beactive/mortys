CREATE TABLE IF NOT EXISTS "assistant_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_role" text NOT NULL,
	"user_id" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_logs_created_at_idx" ON "assistant_logs" ("created_at");
