/**
 * Tests for the automatic no-show fee (contract clause T01731) —
 * server/services/no-show-fee.ts.
 *
 * Runs against the real dev database with a fake Stripe client, covering:
 *   - fee computation (theory / single driving / double driving)
 *   - idempotency guard: one invoice per enrollment, even under concurrency
 *     and after an attendance reset + re-mark
 *   - no saved card → invoice left unpaid, Stripe never called
 *   - missing Stripe customer → invoice left unpaid, Stripe never called
 *   - card decline mid-charge → invoice marked failed, exactly one invoice
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

// The charge flow now emails the student/office about fee outcomes
// (task: missed-class fee notifications). Mock the mailer so tests never
// send real email; delivery behavior is covered elsewhere.
vi.mock("../services/sendgrid", () => ({
  sendNoShowFeeChargedEmail: vi.fn(async () => {}),
  sendNoShowFeeUnpaidEmail: vi.fn(async () => {}),
  sendNoShowFeeFailureOfficeAlert: vi.fn(async () => {}),
}));
import { eq, and, like, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../db";
import {
  invoices,
  students,
  studentPaymentMethods,
  studentTransactions,
} from "@shared/schema";
import { computeNoShowFee, chargeNoShowFee } from "../services/no-show-fee";

// ---------------------------------------------------------------------------
// Fake Stripe client
// ---------------------------------------------------------------------------
type FakeMode = "succeed" | "decline" | "requires_action";

function makeFakeStripe(mode: FakeMode) {
  const calls = { create: 0, confirm: 0 };
  const fake = {
    calls,
    paymentIntents: {
      create: async (params: any, _opts?: any) => {
        calls.create++;
        return { id: `pi_fake_${Date.now()}_${calls.create}`, status: "requires_confirmation", ...{ amount: params.amount } };
      },
      confirm: async (id: string, _opts?: any) => {
        calls.confirm++;
        if (mode === "decline") {
          const err: any = new Error("Your card was declined.");
          err.code = "card_declined";
          throw err;
        }
        if (mode === "requires_action") {
          return { id, status: "requires_action" };
        }
        return { id, status: "succeeded" };
      },
    },
  };
  return fake as unknown as Stripe & { calls: typeof calls };
}

// ---------------------------------------------------------------------------
// Test data setup
// ---------------------------------------------------------------------------
const suffix = `noshowtest${Date.now()}`;
let studentWithCard: number;
let studentNoCard: number;
let studentNoCustomer: number;
const createdStudentIds: number[] = [];
const createdPmIds: number[] = [];
// Use large enrollment ids that cannot collide with real rows; unique per run.
let enrollmentSeq = Math.floor(Date.now() / 1000);
const usedEnrollmentIds: number[] = [];
function nextEnrollmentId(): number {
  const id = enrollmentSeq++;
  usedEnrollmentIds.push(id);
  return id;
}

async function makeStudent(overrides: Partial<typeof students.$inferInsert> = {}): Promise<number> {
  const [row] = await db.insert(students).values({
    firstName: "NoShow",
    lastName: "Test",
    email: `${suffix}-${Math.random().toString(36).slice(2)}@example.test`,
    phone: "555-0000",
    dateOfBirth: "2000-01-01",
    address: "1 Test St",
    courseType: "auto",
    emergencyContact: "Nobody",
    emergencyPhone: "555-0001",
    ...overrides,
  } as any).returning({ id: students.id });
  createdStudentIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  studentWithCard = await makeStudent({ stripeCustomerId: `cus_fake_${suffix}` } as any);
  studentNoCard = await makeStudent({ stripeCustomerId: `cus_fake2_${suffix}` } as any);
  studentNoCustomer = await makeStudent();

  const [pm] = await db.insert(studentPaymentMethods).values({
    studentId: studentWithCard,
    stripePaymentMethodId: `pm_fake_${suffix}`,
    cardBrand: "visa",
    last4: "4242",
    isDefault: true,
  }).returning({ id: studentPaymentMethods.id });
  createdPmIds.push(pm.id);
});

afterEach(async () => {
  // Remove invoices (and any ledger rows they created) from this run.
  const testInvoices = await db.select({ id: invoices.id, transactionId: invoices.transactionId })
    .from(invoices)
    .where(inArray(invoices.studentId, createdStudentIds));
  if (testInvoices.length > 0) {
    await db.delete(invoices).where(inArray(invoices.id, testInvoices.map(i => i.id)));
    const txIds = testInvoices.map(i => i.transactionId).filter((t): t is number => t != null);
    if (txIds.length > 0) {
      await db.delete(studentTransactions).where(inArray(studentTransactions.id, txIds));
    }
  }
  await db.delete(studentTransactions).where(inArray(studentTransactions.studentId, createdStudentIds));
});

afterAll(async () => {
  if (createdPmIds.length > 0) {
    await db.delete(studentPaymentMethods).where(inArray(studentPaymentMethods.id, createdPmIds));
  }
  if (createdStudentIds.length > 0) {
    await db.delete(students).where(inArray(students.id, createdStudentIds));
  }
});

async function invoicesForEnrollment(enrollmentId: number) {
  return db.select().from(invoices).where(eq(invoices.notes, `enrollment:${enrollmentId}`));
}

// ---------------------------------------------------------------------------
// computeNoShowFee — fee amounts per contract clause T01731
// ---------------------------------------------------------------------------
describe("computeNoShowFee", () => {
  it("charges $50 for a theory class", () => {
    const fee = computeNoShowFee({ classType: "theory", duration: 120 });
    expect(fee.feeAmount).toBe(50);
    expect(fee.description).toContain("theory");
  });

  it("charges $50 for a single driving session (< 90 min)", () => {
    expect(computeNoShowFee({ classType: "driving", duration: 60 }).feeAmount).toBe(50);
    expect(computeNoShowFee({ classType: "driving", duration: 89 }).feeAmount).toBe(50);
  });

  it("charges $100 for a double driving session (≥ 90 min)", () => {
    expect(computeNoShowFee({ classType: "driving", duration: 90 }).feeAmount).toBe(100);
    expect(computeNoShowFee({ classType: "driving", duration: 120 }).feeAmount).toBe(100);
  });

  it("defaults a driving session with no duration to single (60 min)", () => {
    expect(computeNoShowFee({ classType: "driving", duration: null }).feeAmount).toBe(50);
  });

  it("treats unknown/null class types as theory ($50)", () => {
    expect(computeNoShowFee({ classType: null, duration: null }).feeAmount).toBe(50);
    expect(computeNoShowFee({ classType: "moto_practical", duration: 120 }).feeAmount).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// chargeNoShowFee — idempotency & edge cases (real DB, fake Stripe)
// ---------------------------------------------------------------------------
describe("chargeNoShowFee", () => {
  it("charges the card and marks the invoice paid on success", async () => {
    const stripe = makeFakeStripe("succeed");
    const enrollmentId = nextEnrollmentId();
    await chargeNoShowFee(stripe, studentWithCard, { classType: "driving", duration: 120 }, enrollmentId);

    const rows = await invoicesForEnrollment(enrollmentId);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("paid");
    expect(rows[0].amount).toBe("100.00");
    expect(stripe.calls.create).toBe(1);
    expect(stripe.calls.confirm).toBe(1);
  });

  it("idempotency guard: a second call for the same enrollment creates no second invoice or charge", async () => {
    const stripe = makeFakeStripe("succeed");
    const enrollmentId = nextEnrollmentId();
    await chargeNoShowFee(stripe, studentWithCard, { classType: "theory" }, enrollmentId);
    // Simulates: attendance reset then re-marked absent, or a retried request.
    await chargeNoShowFee(stripe, studentWithCard, { classType: "theory" }, enrollmentId);

    const rows = await invoicesForEnrollment(enrollmentId);
    expect(rows.length).toBe(1);
    expect(stripe.calls.create).toBe(1); // only the first call reached Stripe
  });

  it("idempotency guard holds under concurrent calls for the same enrollment", async () => {
    const stripe = makeFakeStripe("succeed");
    const enrollmentId = nextEnrollmentId();
    await Promise.all([
      chargeNoShowFee(stripe, studentWithCard, { classType: "theory" }, enrollmentId),
      chargeNoShowFee(stripe, studentWithCard, { classType: "theory" }, enrollmentId),
      chargeNoShowFee(stripe, studentWithCard, { classType: "theory" }, enrollmentId),
    ]);

    const rows = await invoicesForEnrollment(enrollmentId);
    expect(rows.length).toBe(1);
    expect(stripe.calls.create).toBe(1);
  });

  it("no saved card: leaves the invoice unpaid and never calls Stripe", async () => {
    const stripe = makeFakeStripe("succeed");
    const enrollmentId = nextEnrollmentId();
    await chargeNoShowFee(stripe, studentNoCard, { classType: "theory" }, enrollmentId);

    const rows = await invoicesForEnrollment(enrollmentId);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("unpaid");
    expect(stripe.calls.create).toBe(0);
  });

  it("missing Stripe customer: leaves the invoice unpaid and never calls Stripe", async () => {
    const stripe = makeFakeStripe("succeed");
    // Give this student a card but no stripeCustomerId.
    const [pm] = await db.insert(studentPaymentMethods).values({
      studentId: studentNoCustomer,
      stripePaymentMethodId: `pm_fake_nocust_${suffix}`,
      cardBrand: "visa",
      last4: "1111",
      isDefault: true,
    }).returning({ id: studentPaymentMethods.id });
    createdPmIds.push(pm.id);

    const enrollmentId = nextEnrollmentId();
    await chargeNoShowFee(stripe, studentNoCustomer, { classType: "theory" }, enrollmentId);

    const rows = await invoicesForEnrollment(enrollmentId);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("unpaid");
    expect(stripe.calls.create).toBe(0);
  });

  it("card decline: marks the invoice failed with a reason, no double invoice on retry", async () => {
    const declineStripe = makeFakeStripe("decline");
    const enrollmentId = nextEnrollmentId();
    await chargeNoShowFee(declineStripe, studentWithCard, { classType: "driving", duration: 60 }, enrollmentId);

    let rows = await invoicesForEnrollment(enrollmentId);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failureReason).toContain("declined");

    // A later re-mark of the same enrollment must not create a second invoice
    // or a second charge attempt.
    const retryStripe = makeFakeStripe("succeed");
    await chargeNoShowFee(retryStripe, studentWithCard, { classType: "driving", duration: 60 }, enrollmentId);
    rows = await invoicesForEnrollment(enrollmentId);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("failed");
    expect(retryStripe.calls.create).toBe(0);
  });

  it("non-succeeded PaymentIntent (requires_action) marks the invoice failed instead of paid", async () => {
    const stripe = makeFakeStripe("requires_action");
    const enrollmentId = nextEnrollmentId();
    await chargeNoShowFee(stripe, studentWithCard, { classType: "theory" }, enrollmentId);

    const rows = await invoicesForEnrollment(enrollmentId);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failureReason).toContain("requires_action");
  });

  it("no Stripe configured: skips entirely without creating an invoice", async () => {
    const enrollmentId = nextEnrollmentId();
    await chargeNoShowFee(null, studentWithCard, { classType: "theory" }, enrollmentId);
    const rows = await invoicesForEnrollment(enrollmentId);
    expect(rows.length).toBe(0);
  });

  it("charges the flat contract fee with no tax added", async () => {
    const stripe = makeFakeStripe("succeed");
    const enrollmentId = nextEnrollmentId();
    await chargeNoShowFee(stripe, studentWithCard, { classType: "theory" }, enrollmentId);
    const [row] = await invoicesForEnrollment(enrollmentId);
    expect(row.amount).toBe("50.00");
    expect(row.gst).toBe("0.00");
    expect(row.qst).toBe("0.00");
  });
});
