-- In-house billing: billing customers, pricing catalog, pricing audit, invoice lifecycle
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "subtotal" numeric(10, 2);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "gst" numeric(10, 2) DEFAULT '0.00';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "qst" numeric(10, 2) DEFAULT '0.00';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "line_items" json;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "submission_method" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "stripe_payment_intent_id" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "transaction_id" integer;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "failure_reason" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "email_sent_at" timestamp;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_at" timestamp;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "voided_at" timestamp;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "created_by" varchar;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'draft';
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_transaction_id_student_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."student_transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_customers" (
        "id" serial PRIMARY KEY NOT NULL,
        "student_id" integer NOT NULL,
        "stripe_customer_id" text,
        "billing_name" text,
        "billing_email" text,
        "billing_phone" text,
        "billing_address" text,
        "notes" text,
        "sync_status" text DEFAULT 'pending' NOT NULL,
        "last_synced_at" timestamp,
        "last_sync_error" text,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "billing_customers_student_id_unique" UNIQUE("student_id")
);
DO $$ BEGIN
 ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "idx_billing_customers_sync_status" ON "billing_customers" ("sync_status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_items" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "code" text NOT NULL,
        "item_type" text NOT NULL,
        "amount" numeric(10, 2) NOT NULL,
        "gst_applicable" boolean DEFAULT true NOT NULL,
        "qst_applicable" boolean DEFAULT true NOT NULL,
        "lesson_package_id" integer,
        "effective_from" text,
        "effective_to" text,
        "is_active" boolean DEFAULT true NOT NULL,
        "description" text,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "pricing_items_code_unique" UNIQUE("code")
);
DO $$ BEGIN
 ALTER TABLE "pricing_items" ADD CONSTRAINT "pricing_items_lesson_package_id_lesson_packages_id_fk" FOREIGN KEY ("lesson_package_id") REFERENCES "public"."lesson_packages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "idx_pricing_items_type_active" ON "pricing_items" ("item_type","is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_change_logs" (
        "id" serial PRIMARY KEY NOT NULL,
        "pricing_item_id" integer,
        "setting_key" text,
        "action" text NOT NULL,
        "before" json,
        "after" json,
        "changed_by" varchar,
        "created_at" timestamp DEFAULT now()
);
DO $$ BEGIN
 ALTER TABLE "pricing_change_logs" ADD CONSTRAINT "pricing_change_logs_pricing_item_id_pricing_items_id_fk" FOREIGN KEY ("pricing_item_id") REFERENCES "public"."pricing_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
 ALTER TABLE "pricing_change_logs" ADD CONSTRAINT "pricing_change_logs_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "idx_pricing_change_logs_item" ON "pricing_change_logs" ("pricing_item_id");
