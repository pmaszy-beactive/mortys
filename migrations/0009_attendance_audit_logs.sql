CREATE TABLE IF NOT EXISTS "attendance_audit_logs" (
        "id" serial PRIMARY KEY NOT NULL,
        "actor_type" text NOT NULL,
        "actor_id" text NOT NULL,
        "actor_name" text,
        "action" text NOT NULL,
        "class_id" integer,
        "enrollment_id" integer,
        "student_id" integer,
        "instructor_id" integer,
        "previous_status" text,
        "new_status" text,
        "outcome" text NOT NULL,
        "block_reason" text,
        "details" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_audit_logs" ADD CONSTRAINT "attendance_audit_logs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_audit_logs" ADD CONSTRAINT "attendance_audit_logs_enrollment_id_class_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."class_enrollments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_audit_logs" ADD CONSTRAINT "attendance_audit_logs_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_audit_logs" ADD CONSTRAINT "attendance_audit_logs_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_audit_logs_class_id_idx" ON "attendance_audit_logs" ("class_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_audit_logs_instructor_id_idx" ON "attendance_audit_logs" ("instructor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_audit_logs_created_at_idx" ON "attendance_audit_logs" ("created_at");
