CREATE TABLE "course_start_dates" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_type" text NOT NULL,
	"module" integer DEFAULT 1 NOT NULL,
	"start_date" text NOT NULL,
	"start_time" text,
	"capacity" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exam_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"class_id" integer,
	"test_code" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"answers" json DEFAULT '{}'::json,
	"flagged_questions" json DEFAULT '[]'::json,
	"score" integer,
	"correct_count" integer,
	"total_questions" integer,
	"passed" boolean,
	"integrity_agreed" boolean DEFAULT false NOT NULL,
	"integrity_signature" text,
	"integrity_name" text,
	"integrity_declared_at" timestamp,
	"started_at" timestamp DEFAULT now(),
	"submitted_at" timestamp,
	"results_visible_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "referral_source" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "referral_detail" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "selected_start_date_id" integer;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;