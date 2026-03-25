CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "billing_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"receipt_number" text NOT NULL,
	"pdf_path" text,
	"generated_at" timestamp DEFAULT now(),
	CONSTRAINT "billing_receipts_receipt_number_unique" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "booking_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"policy_type" text NOT NULL,
	"course_type" text,
	"class_type" text,
	"value" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"effective_from" timestamp DEFAULT now(),
	"effective_to" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "booking_policy_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"policy_type" text NOT NULL,
	"course_type" text,
	"class_type" text,
	"value" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"description" text,
	"effective_from" timestamp,
	"effective_to" timestamp,
	"changed_by" varchar NOT NULL,
	"change_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer,
	"student_id" integer,
	"attendance_status" text DEFAULT 'registered',
	"test_score" integer,
	"cancelled_at" timestamp,
	"last_payment_intent_id" text,
	"payment_status" text DEFAULT 'not_required',
	"paid_amount" integer,
	"check_in_signature" text,
	"check_in_at" timestamp,
	"check_out_signature" text,
	"check_out_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_type" text NOT NULL,
	"class_type" text DEFAULT 'theory' NOT NULL,
	"class_number" integer NOT NULL,
	"date" text NOT NULL,
	"time" text NOT NULL,
	"duration" integer DEFAULT 120 NOT NULL,
	"instructor_id" integer,
	"vehicle_id" integer,
	"vehicle_confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp,
	"room" text,
	"max_students" integer DEFAULT 15 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"lesson_type" text DEFAULT 'regular' NOT NULL,
	"is_extra" boolean DEFAULT false NOT NULL,
	"price" integer,
	"topic" text,
	"confirmation_status" text DEFAULT 'pending' NOT NULL,
	"change_request_reason" text,
	"change_request_time" text,
	"change_requested_at" timestamp,
	"zoom_link" text,
	"has_test" boolean DEFAULT false NOT NULL,
	"attendance_signature" text,
	"attendance_signed_at" text,
	"attendance_signed_by" integer
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_id" integer,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"recipients" json,
	"message_type" text NOT NULL,
	"send_date" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"open_rate" integer DEFAULT 0,
	"click_rate" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"course_type" text NOT NULL,
	"base_amount" numeric(10, 2) NOT NULL,
	"description" text,
	"terms_and_conditions" text,
	"payment_methods" json DEFAULT '["full","installment"]'::json,
	"default_payment_method" text DEFAULT 'full',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer,
	"template_id" integer,
	"course_type" text NOT NULL,
	"contract_date" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payment_method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"special_notes" text,
	"attestation_generated" boolean DEFAULT false NOT NULL,
	"auto_generated" boolean DEFAULT false NOT NULL,
	"legacy_contract_id" text,
	"contract_number" text,
	"original_amount" numeric(10, 2),
	"discount_amount" numeric(10, 2) DEFAULT '0.00',
	"tax_amount" numeric(10, 2) DEFAULT '0.00',
	"payment_schedule" json,
	"payment_history" json,
	"parent_guardian_name" text,
	"parent_guardian_signature" text,
	"contract_document" text,
	"signed_date" text,
	"witness_name" text,
	"witness_signature" text
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer,
	"instructor_id" integer,
	"class_id" integer,
	"evaluation_date" text NOT NULL,
	"session_type" text NOT NULL,
	"strengths" text,
	"weaknesses" text,
	"checklist" json,
	"ratings" json,
	"overall_rating" integer,
	"comments" text,
	"notes" text,
	"signed_off" boolean DEFAULT false NOT NULL,
	"instructor_signature" text,
	"signature_date" text,
	"signature_ip_address" text,
	"submitted_at" timestamp,
	"legacy_evaluation_id" text,
	"session_number" integer,
	"duration" integer,
	"vehicle_type" text,
	"weather_conditions" text,
	"traffic_conditions" text,
	"route_description" text,
	"skills_assessed" json,
	"recommendations_for_next" text,
	"student_self_assessment" text,
	"parental_feedback" text,
	"evaluation_photos" json
);
--> statement-breakpoint
CREATE TABLE "instructor_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"instructor_id" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructor_reminder_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"instructor_id" integer NOT NULL,
	"availability_reminder_enabled" boolean DEFAULT true NOT NULL,
	"reminder_frequency" text DEFAULT 'weekly' NOT NULL,
	"reminder_day_of_week" integer DEFAULT 0,
	"reminder_time" text DEFAULT '09:00',
	"email_enabled" boolean DEFAULT true NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"last_reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "instructor_reminder_settings_instructor_id_unique" UNIQUE("instructor_id")
);
--> statement-breakpoint
CREATE TABLE "instructors" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"specializations" json,
	"instructor_license_number" text,
	"permit_number" text,
	"location_assignment" text,
	"secondary_locations" json,
	"vehicle_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"digital_signature" text,
	"hire_date" text,
	"certification_expiry" text,
	"emergency_contact" text,
	"emergency_phone" text,
	"notes" text,
	"invite_token" text,
	"invite_expiry" timestamp,
	"account_status" text DEFAULT 'pending_invite' NOT NULL,
	"invite_sent_at" timestamp,
	"invite_accepted_at" timestamp,
	"terms_accepted_at" timestamp,
	"password" text,
	CONSTRAINT "instructors_email_unique" UNIQUE("email"),
	CONSTRAINT "instructors_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "lesson_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lesson_count" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"course_type" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lesson_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"instructor_id" integer,
	"lesson_date" text NOT NULL,
	"lesson_type" text NOT NULL,
	"duration" integer NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"skills_practiced" json,
	"legacy_lesson_id" text,
	"vehicle_used" text,
	"start_location" text,
	"end_location" text,
	"weather_conditions" text,
	"instructor_feedback" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"province" text NOT NULL,
	"country" text DEFAULT 'Canada' NOT NULL,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"location_code" text,
	"operating_hours" json,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "locations_name_unique" UNIQUE("name"),
	CONSTRAINT "locations_location_code_unique" UNIQUE("location_code")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer,
	"author_id" integer,
	"content" text NOT NULL,
	"visibility" text NOT NULL,
	"note_date" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" text NOT NULL,
	"recipient_email" text,
	"recipient_name" text,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"read_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" text NOT NULL,
	"notification_type" text NOT NULL,
	"email_enabled" boolean DEFAULT true,
	"in_app_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_type" text NOT NULL,
	"channel" text NOT NULL,
	"subject_template" text,
	"body_template" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"payload" json,
	"triggered_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "parents" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"relationship" text,
	"password" text,
	"selected_student_id" integer,
	"invite_token" text,
	"invite_expiry" timestamp,
	"account_status" text DEFAULT 'pending_invite' NOT NULL,
	"invite_sent_at" timestamp,
	"invite_accepted_at" timestamp,
	"reset_password_token" text,
	"reset_password_expiry" timestamp,
	CONSTRAINT "parents_email_unique" UNIQUE("email"),
	CONSTRAINT "parents_invite_token_unique" UNIQUE("invite_token"),
	CONSTRAINT "parents_reset_password_token_unique" UNIQUE("reset_password_token")
);
--> statement-breakpoint
CREATE TABLE "payer_profile_students" (
	"id" serial PRIMARY KEY NOT NULL,
	"payer_profile_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payer_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"payer_type" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"student_id" integer,
	"parent_id" integer,
	"relationship" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_intake_id" integer NOT NULL,
	"student_transaction_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"allocated_by" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_intake_id" integer NOT NULL,
	"action" text NOT NULL,
	"actor_id" varchar,
	"previous_data" json,
	"new_data" json,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_intakes" (
	"id" serial PRIMARY KEY NOT NULL,
	"payer_name" text NOT NULL,
	"payer_email" text,
	"payer_phone" text,
	"amount" numeric(10, 2) NOT NULL,
	"payment_method" text NOT NULL,
	"reference_number" text,
	"received_date" text NOT NULL,
	"notes" text,
	"student_id" integer,
	"payer_profile_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"allocated_amount" numeric(10, 2) DEFAULT '0.00',
	"reconciled_by" varchar,
	"reconciled_at" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"contract_id" integer,
	"transaction_date" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payment_method" text NOT NULL,
	"transaction_type" text NOT NULL,
	"receipt_number" text,
	"notes" text,
	"processed_by" text,
	"legacy_transaction_id" text,
	"balance_after" numeric(10, 2),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_access_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"user_email" text,
	"user_role" text,
	"action" text NOT NULL,
	"filters" json,
	"ip_address" text,
	"user_agent" text,
	"success" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "permit_numbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"permit_id" integer NOT NULL,
	"number" integer NOT NULL,
	"is_assigned" boolean DEFAULT false NOT NULL,
	"assigned_to_student_id" integer,
	"assigned_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "policy_fee_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"enrollment_id" integer NOT NULL,
	"status" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "policy_fee_payments_payment_intent_id_unique" UNIQUE("payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "policy_override_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_user_id" varchar NOT NULL,
	"action_type" text NOT NULL,
	"policy_type" text NOT NULL,
	"reason" text NOT NULL,
	"student_id" integer,
	"class_id" integer,
	"enrollment_id" integer,
	"original_value" text,
	"overridden_value" text,
	"notification_sent" boolean DEFAULT false,
	"notification_recipients" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_permits" (
	"id" serial PRIMARY KEY NOT NULL,
	"permit_code" text NOT NULL,
	"location" text NOT NULL,
	"course_types" text NOT NULL,
	"start_number" integer NOT NULL,
	"end_number" integer NOT NULL,
	"total_numbers" integer NOT NULL,
	"available_numbers" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"issue_date" text,
	"expiry_date" text,
	"renewal_reminder_sent" boolean DEFAULT false,
	"document_url" text,
	"document_file_name" text,
	"document_uploaded_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"course_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"phase" text,
	"instructor_id" integer,
	"favorite_instructor_id" integer,
	"attestation_number" text,
	"contract_number" text,
	"started" integer,
	"enrollment_date" text,
	"completion_date" text,
	"total_hours_completed" integer,
	"total_hours_required" integer,
	"theory_hours_completed" integer,
	"practical_hours_completed" integer,
	"current_theory_class" integer,
	"current_in_car_session" integer,
	"completed_theory_classes" json,
	"completed_in_car_sessions" json,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"reason" text NOT NULL,
	"transaction_id" integer,
	"expiry_date" text,
	"is_used" boolean DEFAULT false NOT NULL,
	"used_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer,
	"registration_id" integer,
	"document_type" text NOT NULL,
	"document_name" text NOT NULL,
	"document_data" text,
	"upload_date" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"legacy_document_id" text,
	"is_signed" boolean DEFAULT false,
	"signed_date" text,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verified_by" varchar,
	"verified_at" timestamp,
	"rejection_reason" text,
	"folder_name" text,
	"expiry_date" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"payload" json,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student_parents" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"permission_level" text DEFAULT 'view_only' NOT NULL,
	"added_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "student_payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"card_brand" text,
	"last4" text,
	"expiry_month" integer,
	"expiry_year" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "student_payment_methods_stripe_payment_method_id_unique" UNIQUE("stripe_payment_method_id")
);
--> statement-breakpoint
CREATE TABLE "student_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"verification_token_id" integer,
	"email_verified" boolean DEFAULT false NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"onboarding_data" json,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "student_registrations_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "student_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"date" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"gst" numeric(10, 2) DEFAULT '0.00',
	"pst" numeric(10, 2) DEFAULT '0.00',
	"total" numeric(10, 2) NOT NULL,
	"transaction_type" text NOT NULL,
	"payment_method" text,
	"reference_number" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"home_phone" text,
	"primary_language" text DEFAULT 'English',
	"date_of_birth" text NOT NULL,
	"address" text NOT NULL,
	"city" text,
	"postal_code" text,
	"province" text,
	"country" text DEFAULT 'Canada',
	"course_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"phase" text,
	"instructor_id" integer,
	"favorite_instructor_id" integer,
	"location_id" integer,
	"attestation_number" text,
	"contract_number" text,
	"started" integer,
	"emergency_contact" text NOT NULL,
	"emergency_phone" text NOT NULL,
	"legacy_id" text,
	"enrollment_date" text,
	"completion_date" text,
	"transferred_from" text,
	"transferred_credits" integer,
	"total_hours_completed" integer,
	"total_hours_required" integer,
	"theory_hours_completed" integer,
	"practical_hours_completed" integer,
	"total_amount_due" numeric(10, 2),
	"amount_paid" numeric(10, 2),
	"payment_plan" text,
	"last_payment_date" text,
	"stripe_customer_id" text,
	"government_id" text,
	"driver_license_number" text,
	"license_expiry_date" text,
	"learner_permit_number" text,
	"learner_permit_expiry_date" text,
	"learner_permit_photo" text,
	"medical_certificate" boolean,
	"vision_test" boolean,
	"profile_photo" text,
	"digital_signature" text,
	"signature_consent" boolean,
	"test_scores" json,
	"final_exam_score" integer,
	"road_test_date" text,
	"road_test_result" text,
	"special_needs" text,
	"accommodations" text,
	"language_preference" text,
	"current_theory_class" integer,
	"current_in_car_session" integer,
	"completed_theory_classes" json,
	"completed_in_car_sessions" json,
	"invite_token" text,
	"invite_expiry" timestamp,
	"account_status" text DEFAULT 'pending_invite' NOT NULL,
	"invite_sent_at" timestamp,
	"invite_accepted_at" timestamp,
	"password" text,
	"reset_password_token" text,
	"reset_password_expiry" timestamp,
	"email_notifications_enabled" boolean DEFAULT true,
	"sms_notifications_enabled" boolean DEFAULT false,
	"notify_upcoming_classes" boolean DEFAULT true,
	"notify_schedule_changes" boolean DEFAULT true,
	"notify_payment_receipts" boolean DEFAULT true,
	CONSTRAINT "students_email_unique" UNIQUE("email"),
	CONSTRAINT "students_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "students_invite_token_unique" UNIQUE("invite_token"),
	CONSTRAINT "students_reset_password_token_unique" UNIQUE("reset_password_token")
);
--> statement-breakpoint
CREATE TABLE "transfer_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"previous_school" text NOT NULL,
	"learner_permit_date" text NOT NULL,
	"current_phase" integer NOT NULL,
	"phase_start_date" text NOT NULL,
	"completed_courses" text[] DEFAULT '{}' NOT NULL,
	"course_type" text NOT NULL,
	"transfer_date" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"equivalency_notes" text,
	"credits_earned" integer DEFAULT 0,
	"total_credits_required" integer DEFAULT 0,
	"theory_hours" integer DEFAULT 0,
	"practical_hours" integer DEFAULT 0,
	"credit_value" numeric(10, 2) DEFAULT '0.00',
	"verification_document" text,
	"verified_by" text,
	"adjustment_amount" numeric(10, 2) DEFAULT '0.00'
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"role" varchar DEFAULT 'staff',
	"can_override_booking_policies" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_plate" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"vehicle_type" text NOT NULL,
	"color" text,
	"vin" text,
	"status" text DEFAULT 'active' NOT NULL,
	"registration_expiry" text,
	"insurance_expiry" text,
	"last_maintenance_date" text,
	"maintenance_notes" text,
	"fuel_type" text,
	"transmission" text,
	"notes" text,
	CONSTRAINT "vehicles_license_plate_unique" UNIQUE("license_plate"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "zoom_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"zoom_meeting_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"participant_name" text NOT NULL,
	"join_time" timestamp NOT NULL,
	"leave_time" timestamp NOT NULL,
	"duration" integer NOT NULL,
	"attendance_status" text DEFAULT 'present' NOT NULL,
	"is_manually_adjusted" boolean DEFAULT false NOT NULL,
	"adjusted_by" integer,
	"adjustment_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zoom_meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"zoom_meeting_id" text NOT NULL,
	"meeting_uuid" text,
	"join_url" text NOT NULL,
	"start_url" text NOT NULL,
	"passcode" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"actual_start_time" timestamp,
	"actual_end_time" timestamp
);
--> statement-breakpoint
CREATE TABLE "zoom_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"minimum_attendance_minutes" integer DEFAULT 30 NOT NULL,
	"minimum_attendance_percentage" integer DEFAULT 75 NOT NULL,
	"auto_mark_attendance" boolean DEFAULT true NOT NULL,
	"webhook_url" text,
	"api_key" text,
	"api_secret" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_receipts" ADD CONSTRAINT "billing_receipts_transaction_id_student_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."student_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_policy_versions" ADD CONSTRAINT "booking_policy_versions_policy_id_booking_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."booking_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_policy_versions" ADD CONSTRAINT "booking_policy_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_attendance_signed_by_instructors_id_fk" FOREIGN KEY ("attendance_signed_by") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_availability" ADD CONSTRAINT "instructor_availability_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_reminder_settings" ADD CONSTRAINT "instructor_reminder_settings_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_records" ADD CONSTRAINT "lesson_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_records" ADD CONSTRAINT "lesson_records_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parents" ADD CONSTRAINT "parents_selected_student_id_students_id_fk" FOREIGN KEY ("selected_student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_profile_students" ADD CONSTRAINT "payer_profile_students_payer_profile_id_payer_profiles_id_fk" FOREIGN KEY ("payer_profile_id") REFERENCES "public"."payer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_profile_students" ADD CONSTRAINT "payer_profile_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_profiles" ADD CONSTRAINT "payer_profiles_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_intake_id_payment_intakes_id_fk" FOREIGN KEY ("payment_intake_id") REFERENCES "public"."payment_intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_student_transaction_id_student_transactions_id_fk" FOREIGN KEY ("student_transaction_id") REFERENCES "public"."student_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_allocated_by_users_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_payment_intake_id_payment_intakes_id_fk" FOREIGN KEY ("payment_intake_id") REFERENCES "public"."payment_intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intakes" ADD CONSTRAINT "payment_intakes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intakes" ADD CONSTRAINT "payment_intakes_payer_profile_id_payer_profiles_id_fk" FOREIGN KEY ("payer_profile_id") REFERENCES "public"."payer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intakes" ADD CONSTRAINT "payment_intakes_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intakes" ADD CONSTRAINT "payment_intakes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_logs" ADD CONSTRAINT "payroll_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_numbers" ADD CONSTRAINT "permit_numbers_permit_id_school_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."school_permits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_numbers" ADD CONSTRAINT "permit_numbers_assigned_to_student_id_students_id_fk" FOREIGN KEY ("assigned_to_student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_fee_payments" ADD CONSTRAINT "policy_fee_payments_enrollment_id_class_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."class_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_override_logs" ADD CONSTRAINT "policy_override_logs_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_override_logs" ADD CONSTRAINT "policy_override_logs_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_override_logs" ADD CONSTRAINT "policy_override_logs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_override_logs" ADD CONSTRAINT "policy_override_logs_enrollment_id_class_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."class_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_courses" ADD CONSTRAINT "student_courses_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_courses" ADD CONSTRAINT "student_courses_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_courses" ADD CONSTRAINT "student_courses_favorite_instructor_id_instructors_id_fk" FOREIGN KEY ("favorite_instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_credits" ADD CONSTRAINT "student_credits_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_credits" ADD CONSTRAINT "student_credits_transaction_id_student_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."student_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notifications" ADD CONSTRAINT "student_notifications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_parents" ADD CONSTRAINT "student_parents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_parents" ADD CONSTRAINT "student_parents_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_payment_methods" ADD CONSTRAINT "student_payment_methods_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_registrations" ADD CONSTRAINT "student_registrations_verification_token_id_email_verification_tokens_id_fk" FOREIGN KEY ("verification_token_id") REFERENCES "public"."email_verification_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_transactions" ADD CONSTRAINT "student_transactions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_favorite_instructor_id_instructors_id_fk" FOREIGN KEY ("favorite_instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_credits" ADD CONSTRAINT "transfer_credits_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoom_attendance" ADD CONSTRAINT "zoom_attendance_zoom_meeting_id_zoom_meetings_id_fk" FOREIGN KEY ("zoom_meeting_id") REFERENCES "public"."zoom_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoom_attendance" ADD CONSTRAINT "zoom_attendance_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoom_attendance" ADD CONSTRAINT "zoom_attendance_adjusted_by_users_id_fk" FOREIGN KEY ("adjusted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoom_meetings" ADD CONSTRAINT "zoom_meetings_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_billing_receipts_transaction" ON "billing_receipts" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_student_status" ON "invoices" USING btree ("student_id","status");--> statement-breakpoint
CREATE INDEX "idx_lesson_packages_course_type_active" ON "lesson_packages" USING btree ("course_type","is_active");--> statement-breakpoint
CREATE INDEX "idx_notification_deliveries_recipient" ON "notification_deliveries" USING btree ("recipient_type","recipient_id");--> statement-breakpoint
CREATE INDEX "idx_notification_deliveries_status" ON "notification_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_notification_prefs_recipient" ON "notification_preferences" USING btree ("recipient_type","recipient_id");--> statement-breakpoint
CREATE INDEX "idx_payer_profile_students_payer" ON "payer_profile_students" USING btree ("payer_profile_id");--> statement-breakpoint
CREATE INDEX "idx_payer_profile_students_student" ON "payer_profile_students" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_intake" ON "payment_allocations" USING btree ("payment_intake_id");--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_transaction" ON "payment_allocations" USING btree ("student_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_payment_intakes_status" ON "payment_intakes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payment_intakes_student" ON "payment_intakes" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_payment_intakes_received_date" ON "payment_intakes" USING btree ("received_date");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_student_credits_student" ON "student_credits" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_student_payment_methods_student" ON "student_payment_methods" USING btree ("student_id");