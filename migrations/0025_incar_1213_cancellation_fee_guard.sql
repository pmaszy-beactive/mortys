-- One taxable late-cancellation invoice per canonical In-Car 12/13 enrollment.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoice_incar_1213_cancellation"
  ON "invoices" ("notes")
  WHERE "notes" IS NOT NULL
    AND "notes" LIKE 'incar-1213-cancellation:enrollment:%';