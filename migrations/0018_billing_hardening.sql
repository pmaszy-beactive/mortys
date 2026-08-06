-- Payment hardening: one ledger row per Stripe reference
CREATE UNIQUE INDEX IF NOT EXISTS "uq_student_transactions_reference" ON "student_transactions" ("reference_number") WHERE "reference_number" IS NOT NULL;
