import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { getClassStartTime } from "./class-time";
import { formatClassSchedule } from "./class-time";
import {
  computeInvoiceTotals,
  createInvoiceWithNumber,
  getTaxRates,
  recordInvoicePayment,
} from "./billing";
import {
  invoices,
  studentPaymentMethods,
  type Invoice,
  type InvoiceLineItem,
} from "@shared/schema";
import { isCombined1213Class } from "@shared/bookingRules";

export const INCAR_1213_CANCELLATION_FEE = 100;
export const INCAR_1213_CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type IncarCancellationPolicy = {
  canonical: boolean;
  feeRequired: boolean;
  feeAmount: number;
  taxApplicable: boolean;
  classStart: string | null;
  millisecondsUntilClass: number | null;
};

export type IncarCancellationFeeOutcome = {
  applicable: boolean;
  invoiceId?: number;
  invoiceNumber?: string;
  status?: string;
  subtotal?: string;
  gst?: string;
  qst?: string;
  total?: string;
  alreadyProcessed?: boolean;
};

/** Pure boundary helper: a fee applies only while start-now is strictly under 24h. */
export function isWithinIncarCancellationFeeWindow(classStart: Date, now: Date): boolean {
  const remaining = classStart.getTime() - now.getTime();
  return remaining >= 0 && remaining < INCAR_1213_CANCELLATION_WINDOW_MS;
}

export function getIncarCancellationPolicy(
  classData: {
    classType: string | null;
    classNumber: number | null;
    duration: number | null;
    maxStudents?: number | null;
    courseType?: string | null;
    date: string;
    time: string;
  },
  now = new Date(),
): IncarCancellationPolicy {
  const canonical = isCombined1213Class(classData);
  const start = getClassStartTime(classData);
  const feeRequired = canonical && !!start && isWithinIncarCancellationFeeWindow(start, now);
  return {
    canonical,
    feeRequired,
    feeAmount: feeRequired ? INCAR_1213_CANCELLATION_FEE : 0,
    taxApplicable: feeRequired,
    classStart: start?.toISOString() ?? null,
    millisecondsUntilClass: start ? start.getTime() - now.getTime() : null,
  };
}

const noteForEnrollment = (enrollmentId: number) =>
  `incar-1213-cancellation:enrollment:${enrollmentId}`;

/**
 * Creates the debt first, then attempts an off-session charge. The unique
 * invoice-notes guard makes the entire operation idempotent per enrollment.
 * Missing payment details and processor failures never erase the debt.
 */
export async function chargeIncarCancellationFee(
  stripe: Stripe | null,
  studentId: number,
  enrollmentId: number,
): Promise<IncarCancellationFeeOutcome> {
  const description = "Late cancellation fee — In-Car 12/13";
  const rates = await getTaxRates();
  const lineItems: InvoiceLineItem[] = [{
    description,
    quantity: 1,
    unitAmount: INCAR_1213_CANCELLATION_FEE.toFixed(2),
    amount: INCAR_1213_CANCELLATION_FEE.toFixed(2),
    gstApplicable: true,
    qstApplicable: true,
  }];
  const totals = computeInvoiceTotals(lineItems, rates);

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
      notes: noteForEnrollment(enrollmentId),
    });
  } catch (error: any) {
    if (error?.code !== "23505" && !/unique|duplicate/i.test(String(error?.message ?? ""))) throw error;
    const [existing] = await db.select().from(invoices)
      .where(eq(invoices.notes, noteForEnrollment(enrollmentId))).limit(1);
    return existing ? {
      applicable: true,
      invoiceId: existing.id,
      invoiceNumber: existing.invoiceNumber,
      status: existing.status,
      subtotal: existing.subtotal ?? undefined,
      gst: existing.gst ?? undefined,
      qst: existing.qst ?? undefined,
      total: existing.amount,
      alreadyProcessed: true,
    } : { applicable: true, alreadyProcessed: true };
  }

  const outcome = (row: Invoice): IncarCancellationFeeOutcome => ({
    applicable: true,
    invoiceId: row.id,
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    subtotal: row.subtotal ?? undefined,
    gst: row.gst ?? undefined,
    qst: row.qst ?? undefined,
    total: row.amount,
  });

  const student = await storage.getStudent(studentId);
  const enrollment = await storage.getClassEnrollment(enrollmentId);
  const classData = enrollment?.classId ? await storage.getClass(enrollment.classId) : null;
  const appUrl = process.env.APP_URL
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:5000");
  const notify = async (charged: boolean, failureReason?: string) => {
    const { sendIncarCancellationFeeEmail, sendIncarCancellationFeeOfficeAlert } = await import("./sendgrid");
    const details = {
      studentEmail: student?.email || "",
      studentFirstName: student?.firstName || "Student",
      studentName: student ? `${student.firstName} ${student.lastName}`.trim() : `Student #${studentId}`,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      classLabel: "In-Car 12/13",
      classSchedule: classData ? formatClassSchedule(classData) : "(schedule unavailable)",
    };
    try {
      if (student?.email) await sendIncarCancellationFeeEmail(details, appUrl, charged);
      if (!charged) await sendIncarCancellationFeeOfficeAlert({
        ...details,
        failureReason: failureReason || "Unknown error",
      });
    } catch (error: any) {
      console.error(`[In-Car 12/13 cancellation fee] Notification failed for ${invoice.invoiceNumber}:`, error?.message);
    }
  };
  const methods = await db.select().from(studentPaymentMethods)
    .where(eq(studentPaymentMethods.studentId, studentId));
  const card = methods.find((method) => method.isDefault) || methods[0];
  if (!stripe || !card || !student?.stripeCustomerId) {
    const reason = !stripe ? "Stripe is not configured"
      : !card ? "No saved payment method"
      : "No Stripe customer";
    await db.update(invoices).set({ failureReason: reason, updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id));
    console.warn(`[In-Car 12/13 cancellation fee] ${reason}; invoice ${invoice.invoiceNumber} remains unpaid`);
    await notify(false, reason);
    return { ...outcome(invoice), status: "unpaid" };
  }

  const [claimed] = await db.update(invoices)
    .set({ status: "charging", submissionMethod: "charge_card", updatedAt: new Date() })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.status, "unpaid")))
    .returning();
  if (!claimed) return outcome(invoice);

  try {
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(parseFloat(claimed.amount) * 100),
      currency: "cad",
      customer: student.stripeCustomerId,
      payment_method: card.stripePaymentMethodId,
      description: `${claimed.invoiceNumber}: ${description}`,
      metadata: {
        invoiceId: String(claimed.id),
        enrollmentId: String(enrollmentId),
        studentId: String(studentId),
        purpose: "incar_1213_cancellation_fee",
      },
    }, { idempotencyKey: `incar-1213-cancellation-fee-${enrollmentId}` });
    await db.update(invoices).set({
      stripePaymentIntentId: intent.id,
      updatedAt: new Date(),
    }).where(eq(invoices.id, claimed.id));
    const confirmed = await stripe.paymentIntents.confirm(intent.id, { off_session: true });
    if (confirmed.status !== "succeeded") throw new Error(`PaymentIntent status: ${confirmed.status}`);
    await recordInvoicePayment(claimed, confirmed.id, card.cardBrand);
    console.log(`[In-Car 12/13 cancellation fee] Charged $${claimed.amount} for enrollment ${enrollmentId}`);
    await notify(true);
    return { ...outcome(claimed), status: "paid" };
  } catch (error: any) {
    const failureReason = error?.message || String(error);
    await db.update(invoices).set({
      status: "unpaid",
      failureReason,
      updatedAt: new Date(),
    }).where(eq(invoices.id, claimed.id));
    console.error(`[In-Car 12/13 cancellation fee] Charge failed; invoice ${invoice.invoiceNumber} remains unpaid:`, failureReason);
    await notify(false, failureReason);
    return { ...outcome(claimed), status: "unpaid" };
  }
}