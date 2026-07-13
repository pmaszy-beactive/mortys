-- Refund tracking columns on student_transactions were added to
-- shared/schema.ts via db:push in dev but never got a migration, so
-- production is missing them. Guarded so this is a no-op where they exist.
ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refund_status text DEFAULT 'none';--> statement-breakpoint
ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refund_amount numeric(10, 2);--> statement-breakpoint
ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refund_request_note text;--> statement-breakpoint
ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refund_admin_note text;--> statement-breakpoint
ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS stripe_refund_id text;--> statement-breakpoint
ALTER TABLE student_transactions ADD COLUMN IF NOT EXISTS refunded_at timestamp;
