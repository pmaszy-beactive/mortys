CREATE TABLE "student_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"author_role" text NOT NULL,
	"note_type" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "communications" ALTER COLUMN "author_id" SET DATA TYPE varchar;--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "author_id" SET DATA TYPE varchar;--> statement-breakpoint
ALTER TABLE "zoom_attendance" ALTER COLUMN "adjusted_by" SET DATA TYPE varchar;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "student_signature" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "student_signature_date" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "learner_permit_valid_date" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "upcoming_class_reminder_time" text DEFAULT '24h';--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "notify_schedule_openings" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password" varchar;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;