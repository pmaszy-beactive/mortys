CREATE TABLE IF NOT EXISTS "jobs" (
        "id" serial PRIMARY KEY NOT NULL,
        "type" text NOT NULL,
        "category" text DEFAULT 'general' NOT NULL,
        "payload" jsonb,
        "status" text DEFAULT 'queued' NOT NULL,
        "attempts" integer DEFAULT 0 NOT NULL,
        "max_attempts" integer DEFAULT 3 NOT NULL,
        "scheduled_for" timestamp DEFAULT now() NOT NULL,
        "output" text DEFAULT '' NOT NULL,
        "hold_override" boolean DEFAULT false NOT NULL,
        "locked_by" text,
        "lease_expires_at" timestamp,
        "last_error" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "started_at" timestamp,
        "finished_at" timestamp,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_jobs_status_scheduled" ON "jobs" ("status","scheduled_for");
