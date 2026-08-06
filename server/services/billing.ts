/**
 * In-house billing service.
 *
 * All pricing lives in the app's own tables (pricing_items + tax-rate
 * settings) — nothing is priced in Stripe. Stripe is used purely as the card
 * processor (off-session PaymentIntents against saved payment methods).
 *
 * Heavy work (customer sync, invoice submission, report generation) runs
 * through the job queue as billing-category jobs, so it is subject to the
 * 4-hour startup hold and visible in Job Control.
 */
import Stripe from "stripe";
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  billingCustomers,
  invoices,
  pricingItems,
  pricingChangeLogs,
  students,
  studentPaymentMethods,
  studentTransactions,
  type InvoiceLineItem,
  type Invoice,
} from "@shared/schema";
import { storage } from "../storage";
import { registerJobHandler, enqueueJob, type JobLogger } from "../job-queue";
import { sendEmail } from "./sendgrid";

function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing)");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

// ---------------- Tax rates (Quebec defaults) ----------------

export const DEFAULT_GST_RATE = 5;
export const DEFAULT_QST_RATE = 9.975;

export async function getTaxRates(): Promise<{ gstRate: number; qstRate: number }> {
  const [gst, qst] = await Promise.all([
    storage.getSetting("billingGstRate"),
    storage.getSetting("billingQstRate"),
  ]);
  const gstRate = gst !== undefined && gst !== "" && isFinite(parseFloat(gst)) ? parseFloat(gst) : DEFAULT_GST_RATE;
  const qstRate = qst !== undefined && qst !== "" && isFinite(parseFloat(qst)) ? parseFloat(qst) : DEFAULT_QST_RATE;
  return { gstRate, qstRate };
}

// ---------------- Totals & invoice numbers ----------------

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeInvoiceTotals(lineItems: InvoiceLineItem[], rates: { gstRate: number; qstRate: number }) {
  let subtotal = 0, gstBase = 0, qstBase = 0;
  for (const li of lineItems) {
    const amount = round2((Number(li.quantity) || 0) * (parseFloat(li.unitAmount) || 0));
    li.amount = amount.toFixed(2);
    subtotal += amount;
    if (li.gstApplicable !== false) gstBase += amount;
    if (li.qstApplicable !== false) qstBase += amount;
  }
  const gst = round2(gstBase * rates.gstRate / 100);
  const qst = round2(qstBase * rates.qstRate / 100);
  const total = round2(subtotal + gst + qst);
  return {
    subtotal: round2(subtotal).toFixed(2),
    gst: gst.toFixed(2),
    qst: qst.toFixed(2),
    total: total.toFixed(2),
  };
}

const INVOICE_NUMBER_LOCK = 812_237; // advisory-lock key for invoice numbering

/**
 * Create an invoice with a race-safe INV-YYYY-NNNN number: the number is
 * allocated and the row inserted under a transaction-scoped advisory lock so
 * concurrent creations cannot collide.
 */
export async function createInvoiceWithNumber(values: Omit<typeof invoices.$inferInsert, "invoiceNumber">): Promise<Invoice> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${INVOICE_NUMBER_LOCK})`);
    const invoiceNumber = await generateInvoiceNumber(tx);
    const [invoice] = await tx.insert(invoices).values({ ...values, invoiceNumber }).returning();
    return invoice;
  });
}

export async function generateInvoiceNumber(executor: { execute: typeof db.execute } = db): Promise<string> {
  // INV-YYYY-NNNN, monotonically increasing per year based on existing rows.
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  // Note: SUBSTRING(str FROM <text param>) is the regex form, so the start
  // position must be inlined as an integer literal, not bound as a parameter.
  const from = sql.raw(String(prefix.length + 1));
  const result = await executor.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM ${from}) AS integer)), 0) AS max_n
    FROM invoices WHERE invoice_number LIKE ${prefix + "%"} AND SUBSTRING(invoice_number FROM ${from}) ~ '^[0-9]+$'
  `);
  const next = Number((result.rows as any[])[0]?.max_n ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

// ---------------- Pricing lookups ----------------

function isEffectiveNow(item: { effectiveFrom: string | null; effectiveTo: string | null }): boolean {
  const today = new Date().toISOString().split("T")[0];
  if (item.effectiveFrom && item.effectiveFrom > today) return false;
  if (item.effectiveTo && item.effectiveTo < today) return false;
  return true;
}

/**
 * If a pricing item is linked to a lesson package and currently effective,
 * its amount overrides the package's own price at checkout. Returns null when
 * no override applies (caller falls back to the legacy package price).
 */
export async function getEffectivePackagePrice(lessonPackageId: number): Promise<{ amount: number; pricingItemId: number; gstApplicable: boolean; qstApplicable: boolean } | null> {
  const rows = await db.select().from(pricingItems)
    .where(and(eq(pricingItems.lessonPackageId, lessonPackageId), eq(pricingItems.isActive, true)))
    .orderBy(desc(pricingItems.updatedAt));
  const effective = rows.find(isEffectiveNow);
  if (!effective) return null;
  return { amount: parseFloat(effective.amount), pricingItemId: effective.id, gstApplicable: effective.gstApplicable, qstApplicable: effective.qstApplicable };
}

export async function logPricingChange(entry: {
  pricingItemId?: number | null;
  settingKey?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  changedBy?: string | null;
}) {
  await db.insert(pricingChangeLogs).values({
    pricingItemId: entry.pricingItemId ?? null,
    settingKey: entry.settingKey ?? null,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
    changedBy: entry.changedBy ?? null,
  });
}

// ---------------- Billing customers ----------------

export async function ensureBillingCustomer(studentId: number): Promise<typeof billingCustomers.$inferSelect> {
  const [existing] = await db.select().from(billingCustomers).where(eq(billingCustomers.studentId, studentId));
  if (existing) return existing;
  const student = await storage.getStudent(studentId);
  if (!student) throw new Error(`Student ${studentId} not found`);
  const [created] = await db.insert(billingCustomers).values({
    studentId,
    stripeCustomerId: student.stripeCustomerId ?? null,
    billingName: `${student.firstName} ${student.lastName}`.trim(),
    billingEmail: student.email,
    billingPhone: student.phone,
    syncStatus: "pending",
  }).onConflictDoNothing({ target: billingCustomers.studentId }).returning();
  if (created) return created;
  const [row] = await db.select().from(billingCustomers).where(eq(billingCustomers.studentId, studentId));
  return row;
}

/** Sync one billing customer with Stripe (create/update the Stripe customer). */
async function syncCustomerWithStripe(studentId: number, log: JobLogger): Promise<void> {
  const stripe = getStripe();
  const student = await storage.getStudent(studentId);
  if (!student) throw new Error(`Student ${studentId} not found`);
  const customer = await ensureBillingCustomer(studentId);
  try {
    const name = customer.billingName || `${student.firstName} ${student.lastName}`.trim();
    const email = customer.billingEmail || student.email;
    const phone = customer.billingPhone || student.phone || undefined;
    let stripeCustomerId = customer.stripeCustomerId || student.stripeCustomerId;
    if (stripeCustomerId) {
      await stripe.customers.update(stripeCustomerId, {
        name, email, phone,
        metadata: { studentId: String(studentId) },
      });
      await log(`Updated Stripe customer ${stripeCustomerId} for student #${studentId} (${name})`);
    } else {
      const created = await stripe.customers.create({
        name, email, phone,
        metadata: { studentId: String(studentId) },
      });
      stripeCustomerId = created.id;
      await storage.updateStudent(studentId, { stripeCustomerId } as any);
      await log(`Created Stripe customer ${stripeCustomerId} for student #${studentId} (${name})`);
    }
    await db.update(billingCustomers).set({
      stripeCustomerId,
      syncStatus: "synced",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      updatedAt: new Date(),
    }).where(eq(billingCustomers.id, customer.id));
  } catch (error: any) {
    await db.update(billingCustomers).set({
      syncStatus: "error",
      lastSyncError: error?.message || String(error),
      updatedAt: new Date(),
    }).where(eq(billingCustomers.id, customer.id));
    throw error;
  }
}

// ---------------- Invoice submission ----------------

function invoiceEmailHtml(invoice: Invoice, studentName: string, appUrl: string): string {
  const items = (invoice.lineItems || []).map((li) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${li.description}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${li.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">$${parseFloat(li.unitAmount).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">$${parseFloat(li.amount).toFixed(2)}</td>
    </tr>`).join("");
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">
    <div style="background:#111111;padding:24px;text-align:center;">
      <h1 style="color:#ECC462;margin:0;font-size:22px;">Morty's Driving School</h1>
      <p style="color:#ffffff;margin:6px 0 0;font-size:13px;">Invoice ${invoice.invoiceNumber}</p>
    </div>
    <div style="padding:24px;">
      <p style="color:#333;">Hi ${studentName},</p>
      <p style="color:#333;">Here is your invoice from Morty's Driving School.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;color:#333;">
        <thead><tr style="background:#f7f7f7;">
          <th style="padding:8px 12px;text-align:left;">Description</th>
          <th style="padding:8px 12px;text-align:center;">Qty</th>
          <th style="padding:8px 12px;text-align:right;">Unit</th>
          <th style="padding:8px 12px;text-align:right;">Amount</th>
        </tr></thead>
        <tbody>${items || `<tr><td colspan="4" style="padding:8px 12px;">${invoice.description}</td></tr>`}</tbody>
      </table>
      <table style="width:100%;font-size:14px;color:#333;">
        <tr><td style="text-align:right;padding:2px 12px;">Subtotal:</td><td style="text-align:right;width:110px;padding:2px 12px;">$${invoice.subtotal ?? invoice.amount}</td></tr>
        <tr><td style="text-align:right;padding:2px 12px;">GST:</td><td style="text-align:right;padding:2px 12px;">$${invoice.gst ?? "0.00"}</td></tr>
        <tr><td style="text-align:right;padding:2px 12px;">QST:</td><td style="text-align:right;padding:2px 12px;">$${invoice.qst ?? "0.00"}</td></tr>
        <tr><td style="text-align:right;padding:6px 12px;font-weight:bold;border-top:2px solid #111;">Total:</td><td style="text-align:right;padding:6px 12px;font-weight:bold;border-top:2px solid #111;">$${invoice.amount}</td></tr>
      </table>
      ${invoice.dueDate ? `<p style="color:#666;font-size:13px;">Due date: ${invoice.dueDate}</p>` : ""}
      <div style="text-align:center;margin:24px 0;">
        <a href="${appUrl}/student/billing" style="background:#ECC462;color:#111111;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;display:inline-block;">
          Pay Invoice Online
        </a>
      </div>
      <p style="color:#999;font-size:12px;">Log in to your student account to pay this invoice securely with your saved card.</p>
    </div>
    <div style="background:#f7f7f7;padding:16px;text-align:center;color:#999;font-size:11px;">
      This is an automated message from Morty's Driving School. Please do not reply to this email.
    </div>
  </div>`;
}

function appUrl(): string {
  return process.env.APP_URL
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:5000");
}

/**
 * Record a paid invoice: create the ledger transaction and mark the invoice
 * paid, idempotently keyed on the PaymentIntent id (reference number).
 */
export async function recordInvoicePayment(invoice: Invoice, paymentIntentId: string, cardBrand: string | null): Promise<"paid" | "voided"> {
  return db.transaction(async (tx) => {
    // Lock the invoice row so concurrent completion paths serialize.
    const lockRes = await tx.execute(sql`SELECT id, status FROM invoices WHERE id = ${invoice.id} FOR UPDATE`);
    const current = (lockRes.rows as any[])[0];
    if (!current) throw new Error(`Invoice ${invoice.id} disappeared`);
    if (current.status === "paid") return "paid"; // already recorded by another path
    if (current.status === "void" || current.status === "cancelled") {
      // Never resurrect a voided invoice: the caller must refund the charge.
      return "voided";
    }

    // One ledger row per PaymentIntent — enforced by a unique partial index
    // on student_transactions.reference_number.
    const [existingTx] = await tx.select().from(studentTransactions)
      .where(eq(studentTransactions.referenceNumber, paymentIntentId)).limit(1);
    let txId = existingTx?.id;
    if (!existingTx) {
      const [created] = await tx.insert(studentTransactions).values({
        studentId: invoice.studentId,
        date: new Date().toISOString().split("T")[0],
        description: `Invoice ${invoice.invoiceNumber}: ${invoice.description}`,
        amount: invoice.subtotal ?? invoice.amount,
        gst: invoice.gst ?? "0.00",
        pst: invoice.qst ?? "0.00",
        total: invoice.amount,
        transactionType: "payment",
        paymentMethod: cardBrand || "card",
        referenceNumber: paymentIntentId,
      }).returning();
      txId = created.id;
    }
    await tx.update(invoices).set({
      status: "paid",
      paidAt: new Date(),
      stripePaymentIntentId: paymentIntentId,
      transactionId: txId ?? null,
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoice.id));
    return "paid";
  });
}

/**
 * A charge succeeded against an invoice that was voided in the meantime
 * (e.g. void raced a pending 3DS authorization). Issue an idempotent full
 * refund and persist the outcome on the invoice so the office can see it.
 */
export async function refundVoidedInvoiceCharge(invoice: Invoice, paymentIntentId: string): Promise<void> {
  const stripe = getStripe();
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `invoice-void-refund-${paymentIntentId}` },
    );
    await db.update(invoices).set({
      failureReason: `Charge ${paymentIntentId} succeeded after void — automatically refunded (${refund.id})`,
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoice.id));
    console.log(`[billing] Refunded post-void charge ${paymentIntentId} on invoice ${invoice.invoiceNumber} (${refund.id})`);
  } catch (error: any) {
    if (error?.code === "charge_already_refunded") return; // idempotent replay
    await db.update(invoices).set({
      failureReason: `Charge ${paymentIntentId} succeeded after void — AUTO-REFUND FAILED, refund manually in Stripe: ${error?.message}`,
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoice.id));
    console.error(`[billing] FAILED to refund post-void charge ${paymentIntentId} on invoice ${invoice.invoiceNumber}:`, error?.message);
    throw error;
  }
}

/**
 * Submit an invoice: charge the saved card off-session, or email it.
 *
 * Concurrency: the admin route atomically moves the invoice to "submitted"
 * before enqueueing this job. The charge path additionally claims the invoice
 * ("submitted" → "charging") with a conditional update, so a void, a student
 * in-app payment, or a duplicate job cannot interleave with the charge. A
 * retry after a crash may reclaim from "charging"; any PaymentIntent already
 * persisted on the invoice is reconciled before a new one is created.
 */
async function submitInvoice(payload: any, log: JobLogger): Promise<void> {
  const invoiceId = Number(payload?.invoiceId);
  const method = payload?.method === "email" ? "email" : "charge_card";
  if (!invoiceId) throw new Error("payload.invoiceId is required");

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.status === "paid") { await log(`Invoice ${invoice.invoiceNumber} already paid — nothing to do`); return; }
  if (invoice.status === "void" || invoice.status === "cancelled") { await log(`Invoice ${invoice.invoiceNumber} is void — skipping`); return; }

  const student = await storage.getStudent(invoice.studentId);
  if (!student) throw new Error(`Student ${invoice.studentId} not found`);
  await log(`Submitting invoice ${invoice.invoiceNumber} ($${invoice.amount}) for ${student.firstName} ${student.lastName} via ${method}`);

  if (method === "email") {
    const ok = await sendEmail({
      to: [student.email],
      from: process.env.SENDGRID_FROM_EMAIL || "billing@mortys.ca",
      subject: `Invoice ${invoice.invoiceNumber} from Morty's Driving School — $${invoice.amount}`,
      html: invoiceEmailHtml({ ...invoice, status: "submitted" }, student.firstName, appUrl()),
    });
    if (!ok) {
      await db.update(invoices).set({ status: "failed", failureReason: "Invoice email could not be sent", updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "submitted")));
      throw new Error("Invoice email could not be sent (blocked or SendGrid error)");
    }
    await db.update(invoices).set({ emailSentAt: new Date(), updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
    await log(`Branded invoice email sent to ${student.email} with pay-in-app link`);
    return;
  }

  // charge_card: claim the invoice so nothing else can act on it mid-charge.
  const [claimed] = await db.update(invoices)
    .set({ status: "charging", submissionMethod: method, updatedAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), inArray(invoices.status, ["submitted", "charging"])))
    .returning();
  if (!claimed) { await log(`Invoice ${invoice.invoiceNumber} was handled elsewhere (status changed) — skipping charge`); return; }

  const stripe = getStripe();
  try {
    // Reconcile a pre-existing PaymentIntent (crashed attempt, or a student's
    // pending 3DS flow) BEFORE ever creating a new one. A replacement intent
    // is only allowed once the prior one is in a terminal, unchargeable state.
    let confirmableIntentId: string | null = null;
    if (claimed.stripePaymentIntentId) {
      const prior = await stripe.paymentIntents.retrieve(claimed.stripePaymentIntentId);
      if (prior.status === "succeeded") {
        const outcome = await recordInvoicePayment(claimed, prior.id, null);
        if (outcome === "voided") await refundVoidedInvoiceCharge(claimed, prior.id);
        await log(`Reconciled prior PaymentIntent ${prior.id} (${outcome === "voided" ? "invoice voided — refunded" : "invoice marked paid"})`);
        return;
      }
      if (prior.status === "processing" || prior.status === "requires_action" || prior.status === "requires_capture") {
        // Still potentially chargeable elsewhere — never create a second intent.
        await log(`Prior PaymentIntent ${prior.id} is ${prior.status} — leaving invoice in "charging"; will reconcile on retry`);
        throw Object.assign(new Error(`Prior PaymentIntent ${prior.id} still ${prior.status}`), { keepCharging: true });
      }
      if (prior.status === "requires_confirmation") {
        // Our own two-step create crashed before confirm — confirm it, don't replace it.
        confirmableIntentId = prior.id;
      }
      // canceled / requires_payment_method (declined): terminal-safe, a fresh intent is allowed.
    }

    const methods = await db.select().from(studentPaymentMethods).where(eq(studentPaymentMethods.studentId, invoice.studentId));
    const card = methods.find((m) => m.isDefault) || methods[0];
    if (!card) throw new Error(`Student has no saved payment method — submit by email instead`);
    const customer = await ensureBillingCustomer(invoice.studentId);
    const stripeCustomerId = customer.stripeCustomerId || student.stripeCustomerId;
    if (!stripeCustomerId) throw new Error("Student has no Stripe customer — run a customer sync job first");

    // Two-step create-then-confirm: the intent id is persisted before the
    // charge is confirmed so a crash can never lose track of a charge.
    let intentId = confirmableIntentId;
    if (!intentId) {
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(parseFloat(invoice.amount) * 100),
        currency: "cad",
        customer: stripeCustomerId,
        payment_method: card.stripePaymentMethodId,
        description: `Invoice ${invoice.invoiceNumber}: ${invoice.description}`,
        metadata: { invoiceId: String(invoiceId), studentId: String(invoice.studentId), purpose: "invoice" },
      }, { idempotencyKey: `invoice-${invoiceId}-charge-${claimed.updatedAt?.getTime() ?? Date.now()}` });
      await db.update(invoices).set({ stripePaymentIntentId: intent.id, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
      intentId = intent.id;
    }

    const confirmed = await stripe.paymentIntents.confirm(intentId, { off_session: true });
    if (confirmed.status !== "succeeded") {
      throw new Error(`PaymentIntent status ${confirmed.status}`);
    }
    const outcome = await recordInvoicePayment(claimed, confirmed.id, card.cardBrand);
    if (outcome === "voided") {
      await refundVoidedInvoiceCharge(claimed, confirmed.id);
      await log(`Invoice ${invoice.invoiceNumber} was voided during the charge — payment ${confirmed.id} refunded`);
      return;
    }
    await log(`Charged $${invoice.amount} to ${card.cardBrand || "card"} ****${card.last4} (${confirmed.id}) — invoice paid`);
  } catch (error: any) {
    const message = error?.message || String(error);
    if (!error?.keepCharging) {
      await db.update(invoices).set({ status: "failed", failureReason: message, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "charging")));
    }
    await log(`Charge failed: ${message}`);
    throw error;
  }
}

// ---------------- Reporting ----------------

export async function computeBillingReport(startDate?: string, endDate?: string) {
  const today = new Date().toISOString().split("T")[0];
  const start = startDate || "1970-01-01";
  const end = endDate || today;

  const txs = await db.select().from(studentTransactions)
    .where(and(gte(studentTransactions.date, start), lte(studentTransactions.date, end)));
  // Legacy-imported payments are stored with negative totals, app-created
  // payments with positive ones — use absolute values for revenue.
  const revenue = txs.filter((t) => t.transactionType === "payment")
    .reduce((s, t) => s + Math.abs(parseFloat(t.total || "0")), 0);
  const refunds = txs.filter((t) => t.transactionType === "refund")
    .reduce((s, t) => s + Math.abs(parseFloat(t.total || "0")), 0);

  const allInvoices = await db.select().from(invoices);
  const inRange = (inv: Invoice) => {
    const d = (inv.createdAt ? new Date(inv.createdAt).toISOString() : "").split("T")[0];
    return d >= start && d <= end;
  };
  const outstandingStatuses = ["submitted", "charging", "unpaid", "overdue", "failed"];
  const outstanding = allInvoices.filter((i) => outstandingStatuses.includes(i.status));
  const failed = allInvoices.filter((i) => i.status === "failed" && inRange(i));
  const paid = allInvoices.filter((i) => i.status === "paid" && inRange(i));

  const now = Date.now();
  const aging = { current: 0, days31to60: 0, days61to90: 0, over90: 0 };
  const agingAmounts = { current: 0, days31to60: 0, days61to90: 0, over90: 0 };
  for (const inv of outstanding) {
    const ref = inv.dueDate || (inv.createdAt ? new Date(inv.createdAt).toISOString().split("T")[0] : today);
    const days = Math.floor((now - new Date(`${ref}T00:00:00`).getTime()) / 86400000);
    const amt = parseFloat(inv.amount);
    if (days <= 30) { aging.current++; agingAmounts.current += amt; }
    else if (days <= 60) { aging.days31to60++; agingAmounts.days31to60 += amt; }
    else if (days <= 90) { aging.days61to90++; agingAmounts.days61to90 += amt; }
    else { aging.over90++; agingAmounts.over90 += amt; }
  }

  return {
    startDate: start,
    endDate: end,
    revenue: round2(revenue),
    refunds: round2(refunds),
    netRevenue: round2(revenue - refunds),
    paymentCount: txs.filter((t) => t.transactionType === "payment").length,
    invoicesPaid: paid.length,
    invoicesPaidAmount: round2(paid.reduce((s, i) => s + parseFloat(i.amount), 0)),
    outstandingCount: outstanding.length,
    outstandingAmount: round2(outstanding.reduce((s, i) => s + parseFloat(i.amount), 0)),
    failedCount: failed.length,
    failedAmount: round2(failed.reduce((s, i) => s + parseFloat(i.amount), 0)),
    aging,
    agingAmounts: {
      current: round2(agingAmounts.current),
      days31to60: round2(agingAmounts.days31to60),
      days61to90: round2(agingAmounts.days61to90),
      over90: round2(agingAmounts.over90),
    },
  };
}

// ---------------- Job handlers ----------------

registerJobHandler("billing:sync-customer", async (payload: any, log) => {
  const studentId = Number(payload?.studentId);
  if (!studentId) throw new Error("payload.studentId is required");
  await syncCustomerWithStripe(studentId, log);
});

registerJobHandler("billing:sync-all-customers", async (_payload, log) => {
  // Students with billing activity: transactions, saved cards, or invoices.
  const rows = await db.execute(sql`
    SELECT DISTINCT s.id FROM students s
    WHERE EXISTS (SELECT 1 FROM student_transactions t WHERE t.student_id = s.id)
       OR EXISTS (SELECT 1 FROM student_payment_methods m WHERE m.student_id = s.id)
       OR EXISTS (SELECT 1 FROM invoices i WHERE i.student_id = s.id)
       OR s.stripe_customer_id IS NOT NULL
    ORDER BY s.id
  `);
  const ids = (rows.rows as any[]).map((r) => Number(r.id));
  await log(`Found ${ids.length} student(s) with billing activity; enqueueing per-student sync jobs`);
  for (const studentId of ids) {
    await ensureBillingCustomer(studentId);
    await enqueueJob({ type: "billing:sync-customer", category: "billing", payload: { studentId } });
  }
  await log(`Enqueued ${ids.length} billing:sync-customer job(s)`);
});

registerJobHandler("billing:submit-invoice", submitInvoice);

registerJobHandler("billing:report", async (payload: any, log) => {
  const report = await computeBillingReport(payload?.startDate, payload?.endDate);
  await log(`Billing report ${report.startDate} → ${report.endDate}`);
  await log(`Revenue: $${report.revenue.toFixed(2)} (${report.paymentCount} payments), refunds $${report.refunds.toFixed(2)}, net $${report.netRevenue.toFixed(2)}`);
  await log(`Invoices paid: ${report.invoicesPaid} ($${report.invoicesPaidAmount.toFixed(2)})`);
  await log(`Outstanding: ${report.outstandingCount} invoice(s), $${report.outstandingAmount.toFixed(2)}`);
  await log(`Failed charges: ${report.failedCount} invoice(s), $${report.failedAmount.toFixed(2)}`);
  await log(`Aging — 0-30d: ${report.aging.current} ($${report.agingAmounts.current.toFixed(2)}), 31-60d: ${report.aging.days31to60} ($${report.agingAmounts.days31to60.toFixed(2)}), 61-90d: ${report.aging.days61to90} ($${report.agingAmounts.days61to90.toFixed(2)}), 90d+: ${report.aging.over90} ($${report.agingAmounts.over90.toFixed(2)})`);
});
