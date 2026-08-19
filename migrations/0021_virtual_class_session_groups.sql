ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "session_group_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classes_session_group_id_idx" ON "classes" USING btree ("session_group_id");