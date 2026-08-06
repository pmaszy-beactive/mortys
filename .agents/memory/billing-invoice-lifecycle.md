---
name: In-house billing invoice lifecycle
description: Concurrency and Stripe rules for the in-house billing invoices; ledger sign conventions.
---

- Invoice lifecycle: draft → submitted → charging → paid/failed/void. Every transition uses a conditional UPDATE (`WHERE status IN (...) RETURNING`); no plain status writes. The transient "charging" claim serializes admin charge jobs, student in-app pays, and voids.
- **Why:** an unconditional update let a void overwrite a running charge and let double-submits enqueue duplicate charge jobs. During pending 3DS the "charging" claim must stay held (with the PaymentIntent persisted) or a void can race the authorization and a later confirm resurrects the voided invoice as paid.
- **How to apply:** any new endpoint or job touching invoice status must claim via conditional update; charges persist the PaymentIntent id before confirmation so crashes/voids/retries reconcile against it; payment recording must refuse voided invoices (charge gets refunded instead); void of a pending-3DS invoice must cancel the intent first.
- Ledger: `student_transactions.reference_number` has a unique partial index — one ledger row per PaymentIntent. Legacy imported payments have NEGATIVE totals; app-created payments positive. Reporting must use abs().
- Drizzle gotcha: `SUBSTRING(col FROM ${param})` binds param as text → becomes the regex form. Inline integer positions with `sql.raw(...)`.
- Invoice numbers (INV-YYYY-NNNN) are allocated under `pg_advisory_xact_lock` inside the insert transaction (`createInvoiceWithNumber`), never via a separate MAX()+insert.
