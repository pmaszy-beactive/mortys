/**
 * Automatic no-show fee charging (contract clause T01731).
 *
 * Extracted from server/routes.ts so the fee computation and the
 * idempotency/charge flow can be unit- and integration-tested.
 */
import type Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { formatClassSchedule } from "./class-time";
import {
  getTaxRates,
  computeInvoiceTotals,
  createInvoiceWithNumber,
  recordInvoicePayment,
} from "./billing";
import {
  studentPaymentMethods as spmTable,
  invoices as invoicesTable,
  type Invoice,
  type InvoiceLineItem,
} from "@shared/schema";

/**
 * Compute the no-show fee for a class per contract clause T01731:
 *   - Theory class: $50
 *   - Single driving session (< 90 min): $50
 *   - Double driving session (≥ 90 min): $100
 */
export function computeNoShowFee(classData: { classType?: string | null; duration?: number | null }): {
  feeAmount: number;
  description: string;
} {
  if (classData.classType === 'driving') {
    const isDouble = (classData.duration ?? 60) >= 90;
    return isDouble
      ? { feeAmount: 100, description: "Missed-class fee — double driving session (contract clause T01731)" }
      : { feeAmount: 50, description: "Missed-class fee — single driving session (contract clause T01731)" };
  }
  return { feeAmount: 50, description: "Missed-class fee — theory class (contract clause T01731)" };
}

/**
 * Automatically charge the no-show fee to the student's card on file when
 * an instructor marks them absent. Creates an invoice regardless; charges
 * it immediately off-session if the student has a saved card. If the
 * student has no card, the invoice is left in "unpaid" status for the
 * office to collect manually.
 *
 * Emails the student about the outcome (charged vs unpaid) and alerts the
 * office when a charge fails — notification failures never affect the
 * charge itself.
 *
 * This is intentionally fire-and-forget (call with .catch()) so a Stripe
 * failure never prevents attendance from being recorded.
 */
export async function chargeNoShowFee(
  stripe: Stripe | null,
  studentId: number,
  classData: { classType?: string | null; duration?: number | null; id?: number; classNumber?: number | null; date?: string | null; time?: string | null },
  enrollmentId?: number,
): Promise<void> {
  if (!stripe) {
    console.warn("[no-show fee] Stripe not configured — skipping charge");
    return;
  }
  const { feeAmount, description } = computeNoShowFee(classData);
  const { sendNoShowFeeChargedEmail, sendNoShowFeeUnpaidEmail, sendNoShowFeeFailureOfficeAlert } = await import("./sendgrid");

  const appBaseUrl = process.env.APP_URL
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:5000");
  const classLabel = classData.classType === 'driving'
    ? `In-car session${classData.classNumber ? ` #${classData.classNumber}` : ""}`
    : `Theory class${classData.classNumber ? ` #${classData.classNumber}` : ""}`;
  const classSchedule = classData.date && classData.time
    ? formatClassSchedule({ date: classData.date, time: classData.time })
    : "(schedule unavailable)";

  const student = await storage.getStudent(studentId);

  // Notify the student (and the office on failure) about the fee outcome.
  // Fire-and-forget: notification problems must never affect the charge.
  const notifyOutcome = async (invoiceNumber: string, charged: boolean, failureReason?: string) => {
    if (!student?.email) {
      console.warn(`[no-show fee] Student ${studentId} has no email — cannot send fee notification for invoice ${invoiceNumber}`);
    }
    const details = {
      studentEmail: student?.email || "",
      studentFirstName: student?.firstName || "Student",
      invoiceNumber,
      amount: feeAmount.toFixed(2),
      classLabel,
      classSchedule,
    };
    try {
      if (charged) {
        if (student?.email) await sendNoShowFeeChargedEmail(details, appBaseUrl);
      } else {
        if (student?.email) await sendNoShowFeeUnpaidEmail(details, appBaseUrl);
        await sendNoShowFeeFailureOfficeAlert({
          ...details,
          studentName: student ? `${student.firstName} ${student.lastName}`.trim() : `Student #${studentId}`,
          failureReason: failureReason || "Unknown error",
        });
      }
    } catch (emailErr: any) {
      console.error(`[no-show fee] Failed to send fee notification email for invoice ${invoiceNumber}:`, emailErr?.message);
    }
  };

  const rates = await getTaxRates();
  // The contract clause T01731 states flat fees ($50/$100). These amounts
  // are charged as-is — no tax added — so the card charge exactly matches
  // the contractual and student-facing amounts.
  const lineItems: InvoiceLineItem[] = [{
    description,
    quantity: 1,
    unitAmount: feeAmount.toFixed(2),
    amount: feeAmount.toFixed(2),
    gstApplicable: false,
    qstApplicable: false,
  }];
  const totals = computeInvoiceTotals(lineItems, rates);

  // Atomically create the invoice. The unique partial index
  // uq_invoice_enrollment_notes on invoices(notes) WHERE notes LIKE
  // 'enrollment:%' ensures that concurrent or retried calls for the same
  // enrollment both attempt the INSERT and exactly one wins; the loser
  // gets a unique_violation (code 23505) which we catch and treat as
  // "already charged — skip".
  let invoice: Invoice;
  try {
    invoice = await createInvoiceWithNumber({
      studentId,
      description,
      lineItems,
      subtotal: totals.subtotal,
      gst: totals.gst,
      qst: totals.qst,
      amount: totals.total,
      status: "unpaid",
      dueDate: new Date().toISOString().split("T")[0],
      notes: enrollmentId ? `enrollment:${enrollmentId}` : undefined,
    });
  } catch (insertErr: any) {
    if (insertErr?.code === "23505") {
      // Duplicate enrollment guard fired — another concurrent call already
      // created (and is charging) the invoice for this enrollment.
      console.log(`[no-show fee] Duplicate insert blocked by DB constraint for enrollment ${enrollmentId ?? "?"} — skipping`);
      return;
    }
    throw insertErr;
  }

  const methods = await db.select().from(spmTable).where(eq(spmTable.studentId, studentId));
  const card = methods.find((m) => m.isDefault) || methods[0];

  if (!card) {
    console.warn(`[no-show fee] Student ${studentId} has no saved card — invoice ${invoice.invoiceNumber} created as unpaid`);
    await notifyOutcome(invoice.invoiceNumber, false, "No card on file");
    return;
  }

  const stripeCustomerId = student?.stripeCustomerId;
  if (!stripeCustomerId) {
    console.warn(`[no-show fee] Student ${studentId} has no Stripe customer — invoice ${invoice.invoiceNumber} left unpaid`);
    await notifyOutcome(invoice.invoiceNumber, false, "Student has no Stripe customer record");
    return;
  }

  // Atomically claim the invoice for charging
  const [claimed] = await db.update(invoicesTable)
    .set({ status: "charging", submissionMethod: "charge_card", updatedAt: new Date() })
    .where(and(eq(invoicesTable.id, invoice.id), eq(invoicesTable.status, "unpaid")))
    .returning();
  if (!claimed) {
    console.warn(`[no-show fee] Invoice ${invoice.invoiceNumber} already claimed — skipping`);
    return;
  }

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: Math.round(parseFloat(claimed.amount) * 100),
        currency: "cad",
        customer: stripeCustomerId,
        payment_method: card.stripePaymentMethodId,
        description: `${claimed.invoiceNumber}: ${description}`,
        metadata: { invoiceId: String(claimed.id), studentId: String(studentId), purpose: "no_show_fee" },
      },
      { idempotencyKey: `no-show-fee-${claimed.id}` },
    );
    await db.update(invoicesTable)
      .set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
      .where(eq(invoicesTable.id, claimed.id));

    const confirmed = await stripe.paymentIntents.confirm(intent.id, { off_session: true });
    if (confirmed.status === "succeeded") {
      await recordInvoicePayment(claimed, confirmed.id, card.cardBrand);
      console.log(`[no-show fee] Charged $${claimed.amount} (${confirmed.id}) to student ${studentId} for enrollment ${enrollmentId ?? "?"}`);
      await notifyOutcome(claimed.invoiceNumber, true);
    } else {
      await db.update(invoicesTable)
        .set({ status: "failed", failureReason: `PaymentIntent status: ${confirmed.status}`, updatedAt: new Date() })
        .where(eq(invoicesTable.id, claimed.id));
      console.warn(`[no-show fee] Charge incomplete for student ${studentId}: ${confirmed.status} — invoice ${invoice.invoiceNumber} marked failed`);
      await notifyOutcome(claimed.invoiceNumber, false, `Payment not completed (status: ${confirmed.status})`);
    }
  } catch (err: any) {
    await db.update(invoicesTable)
      .set({ status: "failed", failureReason: err?.message || String(err), updatedAt: new Date() })
      .where(eq(invoicesTable.id, claimed.id));
    console.error(`[no-show fee] Charge failed for student ${studentId} (invoice ${invoice.invoiceNumber}):`, err?.message);
    await notifyOutcome(claimed.invoiceNumber, false, err?.message || String(err));
  }
}
