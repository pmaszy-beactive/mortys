-- Idempotency guard for auto-charged no-show fee invoices.
-- Each no-show invoice stores `enrollment:<id>` in the notes field;
-- this unique partial index prevents a concurrent or retried request from
-- creating a second invoice for the same enrollment.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoice_enrollment_notes"
  ON "invoices" ("notes")
  WHERE "notes" IS NOT NULL AND "notes" LIKE 'enrollment:%';
