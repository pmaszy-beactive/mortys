/**
 * Integration tests for the billing invoice lifecycle race guards
 * (server/services/billing.ts + the conditional-update claims used by routes).
 *
 * Runs against the real dev database. Stripe is NOT called — these tests
 * cover the database-level invariants: idempotent payment recording, refusal
 * to resurrect voided invoices, race-safe invoice numbering, and the
 * conditional status claims that prevent double-submit / double-charge.
 */
import { describe, it, expect, afterEach } from "vitest";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db";
import { invoices, studentTransactions, type Invoice } from "@shared/schema";
import { createInvoiceWithNumber, recordInvoicePayment } from "../services/billing";

const createdInvoiceIds: number[] = [];
const createdTxRefs: string[] = [];

async function makeInvoice(overrides: Partial<typeof invoices.$inferInsert> = {}): Promise<Invoice> {
  const invoice = await createInvoiceWithNumber({
    studentId: 1,
    amount: "11.50",
    subtotal: "10.00",
    gst: "0.50",
    qst: "1.00",
    description: "lifecycle-test",
    status: "draft",
    ...overrides,
  } as any);
  createdInvoiceIds.push(invoice.id);
  return invoice;
}

afterEach(async () => {
  // Invoices reference ledger rows via transaction_id, so delete them first.
  if (createdInvoiceIds.length > 0) {
    await db.delete(invoices).where(inArray(invoices.id, createdInvoiceIds.splice(0)));
  }
  if (createdTxRefs.length > 0) {
    await db.delete(studentTransactions).where(inArray(studentTransactions.referenceNumber, createdTxRefs.splice(0)));
  }
});

describe("invoice numbering", () => {
  it("allocates unique numbers under concurrent creation", async () => {
    const results = await Promise.all([makeInvoice(), makeInvoice(), makeInvoice(), makeInvoice(), makeInvoice()]);
    const numbers = results.map((r) => r.invoiceNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(n).toMatch(/^INV-\d{4}-\d{4}$/);
  });
});

describe("recordInvoicePayment", () => {
  it("records the payment once per PaymentIntent even when called concurrently", async () => {
    const invoice = await makeInvoice({ status: "charging" });
    const ref = `pi_test_${Date.now()}_dup`;
    createdTxRefs.push(ref);

    const outcomes = await Promise.all([
      recordInvoicePayment(invoice, ref, "visa"),
      recordInvoicePayment(invoice, ref, "visa"),
      recordInvoicePayment(invoice, ref, "visa"),
    ]);
    expect(outcomes.every((o) => o === "paid")).toBe(true);

    const ledger = await db.select().from(studentTransactions).where(eq(studentTransactions.referenceNumber, ref));
    expect(ledger.length).toBe(1);
    const [after] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(after.status).toBe("paid");
    expect(after.transactionId).toBe(ledger[0].id);
  });

  it("refuses to resurrect a voided invoice and creates no ledger row", async () => {
    const invoice = await makeInvoice({ status: "void" });
    const ref = `pi_test_${Date.now()}_void`;
    createdTxRefs.push(ref);

    const outcome = await recordInvoicePayment(invoice, ref, "visa");
    expect(outcome).toBe("voided");

    const ledger = await db.select().from(studentTransactions).where(eq(studentTransactions.referenceNumber, ref));
    expect(ledger.length).toBe(0);
    const [after] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(after.status).toBe("void");
  });
});

describe("conditional status claims", () => {
  it("lets only one of many concurrent submits claim a draft invoice", async () => {
    const invoice = await makeInvoice();
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        db.update(invoices)
          .set({ status: "submitted", updatedAt: new Date() })
          .where(and(eq(invoices.id, invoice.id), inArray(invoices.status, ["draft", "failed", "unpaid", "overdue"])))
          .returning(),
      ),
    );
    expect(attempts.filter((rows) => rows.length > 0).length).toBe(1);
  });

  it("void cannot claim an invoice that is paid or mid-charge", async () => {
    for (const blocked of ["paid", "charging"] as const) {
      const invoice = await makeInvoice({ status: blocked });
      const rows = await db.update(invoices)
        .set({ status: "void", voidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(invoices.id, invoice.id), notInArray(invoices.status, ["paid", "void", "cancelled", "charging"])))
        .returning();
      expect(rows.length).toBe(0);
    }
  });

  it("student pay claim excludes draft, void, paid and charging invoices", async () => {
    for (const blocked of ["draft", "void", "paid", "charging"] as const) {
      const invoice = await makeInvoice({ status: blocked });
      const rows = await db.update(invoices)
        .set({ status: "charging", updatedAt: new Date() })
        .where(and(eq(invoices.id, invoice.id), inArray(invoices.status, ["submitted", "failed", "unpaid", "overdue"])))
        .returning();
      expect(rows.length).toBe(0);
    }
    const payable = await makeInvoice({ status: "submitted" });
    const rows = await db.update(invoices)
      .set({ status: "charging", updatedAt: new Date() })
      .where(and(eq(invoices.id, payable.id), inArray(invoices.status, ["submitted", "failed", "unpaid", "overdue"])))
      .returning();
    expect(rows.length).toBe(1);
  });
});
