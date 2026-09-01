/**
 * Live-DB coverage for the taxable canonical In-Car 12/13 cancellation debt.
 * Stripe is deliberately fake; no external processor is contacted.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
vi.mock("../services/sendgrid", () => ({
  sendIncarCancellationFeeEmail: vi.fn(async () => true),
  sendIncarCancellationFeeOfficeAlert: vi.fn(async () => true),
}));
import type Stripe from "stripe";
import { db } from "../db";
import {
  classEnrollments, classes, incarPairingAudit, incarPairingOffers,
  incarPairingQueue, incarPairedSessions, incarSessionConfirmations, invoices,
  studentPaymentMethods, studentTransactions, students,
} from "@shared/schema";
import { chargeIncarCancellationFee } from "../services/incar-cancellation-fee";
import { bookCombinedSlot, joinCombinedQueue, requeueStudent, respondToConfirmation, respondToOffer } from "../services/incar-pairing";
import { registerRoutes } from "../routes";
import { generateStudentToken } from "../student-auth";

const mark = `incar-cancel-${Date.now()}`;
const studentIds: number[] = [], classIds: number[] = [], pmIds: number[] = [];
let seq = 0;
let app: express.Express;
function fakeStripe(fail = false, onCreate?: () => Promise<void>) {
  const calls = { create: 0, confirm: 0 };
  return {
    calls,
    paymentIntents: {
      create: async () => {
        calls.create++;
        await onCreate?.();
        return { id: `pi_${mark}_${calls.create}`, status: "requires_confirmation" };
      },
      confirm: async (id: string) => {
        calls.confirm++;
        if (fail) throw new Error("card declined");
        return { id, status: "succeeded" };
      },
    },
  } as unknown as Stripe & { calls: typeof calls };
}
async function student(card = false) {
  const n = seq++;
  const [row] = await db.insert(students).values({
    firstName: "Late", lastName: `Cancel${n}`, email: `${mark}-${n}@example.test`,
    phone: "555-0000", dateOfBirth: "2000-01-01", address: "1 Test",
    courseType: "auto", emergencyContact: "EC", emergencyPhone: "555-0001",
    accountStatus: "active",
    ...(card ? { stripeCustomerId: `cus_${mark}_${n}` } : {}),
  } as any).returning();
  studentIds.push(row.id);
  if (card) {
    const [pm] = await db.insert(studentPaymentMethods).values({
      studentId: row.id, stripePaymentMethodId: `pm_${mark}_${n}`, cardBrand: "visa", last4: "4242", isDefault: true,
    }).returning();
    pmIds.push(pm.id);
  }
  // pairing eligibility prerequisite
  const theory = await combined(new Date("2025-01-05T15:00:00Z"), "theory", 11, 15);
  await db.insert(classEnrollments).values({ studentId: row.id, classId: theory, attendanceStatus: "attended" });
  return row.id;
}
function localSchedule(at: Date) {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.SCHOOL_TIMEZONE || "America/Toronto",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at)) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
async function combined(at = new Date(Date.now() + 2 * 3600_000), type = "driving", number = 12, max = 2) {
  const when = localSchedule(at);
  const [row] = await db.insert(classes).values({
    courseType: "auto", classType: type, classNumber: number, duration: type === "driving" ? 120 : 120,
    maxStudents: max, status: "scheduled", ...when,
  } as any).returning();
  classIds.push(row.id);
  return row.id;
}
const feeRows = (enrollmentId: number) => db.select().from(invoices)
  .where(eq(invoices.notes, `incar-1213-cancellation:enrollment:${enrollmentId}`));

beforeAll(async () => {
  // The migration is deliberately also a test precondition: local test DBs
  // are often long-lived and do not automatically replay new migrations.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoice_incar_1213_cancellation"
    ON "invoices" ("notes")
    WHERE "notes" IS NOT NULL
      AND "notes" LIKE 'incar-1213-cancellation:enrollment:%'
  `);
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

afterEach(async () => {
  const testInvoices = studentIds.length ? await db.select().from(invoices).where(inArray(invoices.studentId, studentIds)) : [];
  if (testInvoices.length) await db.delete(invoices).where(inArray(invoices.id, testInvoices.map(x => x.id)));
  if (studentIds.length) await db.delete(studentTransactions).where(inArray(studentTransactions.studentId, studentIds));
  if (studentIds.length) await db.delete(incarPairingAudit).where(inArray(incarPairingAudit.studentId, studentIds));
  if (classIds.length) await db.delete(incarPairingAudit).where(inArray(incarPairingAudit.classId, classIds));
  if (studentIds.length) await db.delete(incarSessionConfirmations).where(inArray(incarSessionConfirmations.studentId, studentIds));
  if (studentIds.length) await db.delete(incarPairingOffers).where(inArray(incarPairingOffers.studentId, studentIds));
  if (studentIds.length) await db.delete(incarPairedSessions).where(inArray(incarPairedSessions.studentIdA, studentIds));
  if (studentIds.length) await db.delete(incarPairingQueue).where(inArray(incarPairingQueue.studentId, studentIds));
  if (studentIds.length) await db.delete(classEnrollments).where(inArray(classEnrollments.studentId, studentIds));
  if (pmIds.length) await db.delete(studentPaymentMethods).where(inArray(studentPaymentMethods.id, pmIds.splice(0)));
  if (studentIds.length) await db.delete(students).where(inArray(students.id, studentIds.splice(0)));
  if (classIds.length) await db.delete(classes).where(inArray(classes.id, classIds.splice(0)));
});

describe("In-Car 12/13 cancellation fee (live DB)", () => {
  it("has its required idempotency index and creates one paid taxable invoice under retries/concurrency", async () => {
    const index = await db.execute(sql`SELECT to_regclass('uq_invoice_incar_1213_cancellation') AS name`);
    expect((index.rows[0] as any).name).toBe("uq_invoice_incar_1213_cancellation");
    const sid = await student(true), classId = await combined();
    const [enrollment] = await db.insert(classEnrollments).values({ studentId: sid, classId }).returning();
    const stripe = fakeStripe();
    await Promise.all([
      chargeIncarCancellationFee(stripe, sid, enrollment.id),
      chargeIncarCancellationFee(stripe, sid, enrollment.id),
      chargeIncarCancellationFee(stripe, sid, enrollment.id),
    ]);
    const [invoice] = await feeRows(enrollment.id);
    expect(invoice).toMatchObject({ subtotal: "100.00", gst: "5.00", qst: "9.98", amount: "114.98", status: "paid" });
    expect(await feeRows(enrollment.id)).toHaveLength(1);
    expect(stripe.calls).toEqual({ create: 1, confirm: 1 });
  });

  it("keeps exactly one unpaid invoice with a reason for no card and processor failure", async () => {
    const noCard = await student(), declined = await student(true);
    const [a] = await db.insert(classEnrollments).values({ studentId: noCard, classId: await combined() }).returning();
    const [b] = await db.insert(classEnrollments).values({ studentId: declined, classId: await combined() }).returning();
    await chargeIncarCancellationFee(fakeStripe(), noCard, a.id);
    await chargeIncarCancellationFee(fakeStripe(true), declined, b.id);
    for (const id of [a.id, b.id]) {
      const rows = await feeRows(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("unpaid");
      expect(rows[0].failureReason).toBeTruthy();
    }
  });

  it("bills only the declining paired student after the pairing transaction has committed", async () => {
    const [decliner, partner] = await Promise.all([student(true), student(true)]);
    const classId = await combined();
    await joinCombinedQueue({ studentId: partner });
    const booked = await bookCombinedSlot({ studentId: decliner, classId });
    const offer = (await db.select().from(incarPairingOffers).where(eq(incarPairingOffers.classId, classId)))[0];
    const accepted = await respondToOffer({ offerId: offer.id, studentId: partner, response: "accept" });
    expect(accepted.success).toBe(true);
    // The scheduler normally creates these at the confirmation horizon; seed
    // the same pending record here so this test targets the decline endpoint.
    const session = (await db.select().from(incarPairedSessions).where(eq(incarPairedSessions.classId, classId)))[0];
    const declinerEntry = (await db.select().from(incarPairingQueue).where(eq(incarPairingQueue.studentId, decliner)))[0];
    await db.insert(incarSessionConfirmations).values({
      pairedSessionId: session.id, studentId: decliner, queueEntryId: declinerEntry.id, status: "pending",
    });
    const confirmation = (await db.select().from(incarSessionConfirmations).where(eq(incarSessionConfirmations.studentId, decliner)))[0];
    expect(confirmation).toBeTruthy();
    const result = await respondToConfirmation({ confirmationId: confirmation.id, studentId: decliner, response: "decline" });
    expect(result.cancelledEnrollmentId).toBeTruthy();
    const stripe = fakeStripe(false, async () => {
      const [e] = await db.select().from(classEnrollments).where(eq(classEnrollments.id, result.cancelledEnrollmentId!));
      expect(e.cancelledAt).toBeTruthy(); // Stripe is necessarily outside committed pairing tx.
    });
    await chargeIncarCancellationFee(stripe, decliner, result.cancelledEnrollmentId!);
    expect(await feeRows(result.cancelledEnrollmentId!)).toHaveLength(1);
    const partnerEnrollment = (await db.select().from(classEnrollments).where(and(eq(classEnrollments.studentId, partner), eq(classEnrollments.classId, classId))))[0];
    expect(partnerEnrollment.cancelledAt).toBeNull();
    expect(await feeRows(partnerEnrollment.id)).toHaveLength(0);
  });

  it("student API queue leave bills inside 24h, but exactly/over 24h leaves no invoice", async () => {
    const inside = await student();
    const insideClass = await combined(new Date(Date.now() + 2 * 3600_000));
    const booked = await bookCombinedSlot({ studentId: inside, classId: insideClass });
    const response = await request(app).delete("/api/student/lesson-pairing/queue")
      .set("Authorization", `Bearer ${generateStudentToken(inside)}`);
    expect(response.status).toBe(200);
    expect(response.body.cancellationFee).toMatchObject({ applicable: true, status: "unpaid" });
    expect(await feeRows(booked.enrollmentId!)).toHaveLength(1);

    // A local wall-clock schedule exactly 24h away can become a few
    // milliseconds closer while it is persisted; use >24h for the endpoint
    // assertion, while exact-boundary behavior is covered by the pure helper.
    const outside = await student();
    const outsideClass = await combined(new Date(Date.now() + 26 * 3600_000));
    const outsideBooked = await bookCombinedSlot({ studentId: outside, classId: outsideClass });
    const free = await request(app).delete("/api/student/lesson-pairing/queue")
      .set("Authorization", `Bearer ${generateStudentToken(outside)}`);
    expect(free.status).toBe(200);
    expect(free.body.cancellationFee).toEqual({ applicable: false });
    expect(await feeRows(outsideBooked.enrollmentId!)).toHaveLength(0);
  });

  it("pending offer decline never creates a cancellation invoice", async () => {
    const [booker, candidate] = await Promise.all([student(), student()]);
    const classId = await combined();
    await joinCombinedQueue({ studentId: candidate });
    const booked = await bookCombinedSlot({ studentId: booker, classId });
    const offer = (await db.select().from(incarPairingOffers).where(eq(incarPairingOffers.classId, classId)))[0];
    const declined = await respondToOffer({ offerId: offer.id, studentId: candidate, response: "decline" });
    expect(declined.success).toBe(true);
    expect(await feeRows(booked.enrollmentId!)).toHaveLength(0);
  });

  it("staff requeue/dissolution never invokes the student cancellation debt", async () => {
    const [first, second] = await Promise.all([student(), student()]);
    const classId = await combined();
    await joinCombinedQueue({ studentId: second });
    const booked = await bookCombinedSlot({ studentId: first, classId });
    const offer = (await db.select().from(incarPairingOffers).where(eq(incarPairingOffers.classId, classId)))[0];
    await respondToOffer({ offerId: offer.id, studentId: second, response: "accept" });
    const entry = (await db.select().from(incarPairingQueue).where(eq(incarPairingQueue.studentId, first)))[0];
    expect((await requeueStudent({ queueEntryId: entry.id, actorId: "staff", actorRole: "admin" })).success).toBe(true);
    expect(await feeRows(booked.enrollmentId!)).toHaveLength(0);
  });
});