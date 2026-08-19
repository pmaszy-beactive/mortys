/**
 * In-Car 12/13 pairing — LIVE DATABASE integration tests.
 *
 * Unlike server/tests/incar-pairing.test.ts (pure/DB-free), these tests run
 * the real service functions against the dev Postgres schema, exercising the
 * guarantees that only exist at the database level:
 *   - pg_advisory_xact_lock serialization of per-student mutations
 *   - FOR UPDATE class-row locking on booking/accept paths
 *   - unique partial index: one ACTIVE queue entry per student
 *   - unique partial index: one PENDING offer per class
 *   - conditional offer-transition claims (exactly-one-winner semantics)
 *
 * Covered flows: bookCombinedSlot, respondToOffer (accept + decline),
 * leaveCombinedQueue, processPairingLifecycle — including two concurrent
 * bookings of the same slot, simultaneous accepts of the same offer, and
 * a concurrent leave-vs-accept race.
 *
 * Notifications are mocked out (they are fire-and-forget in production and
 * would otherwise write notification rows / attempt email sends).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";

vi.mock("../services/notifications", () => ({
  enqueueNotification: vi.fn(async () => 0),
  getStudentRecipients: vi.fn(async () => []),
  getOfficeRecipients: vi.fn(async () => []),
}));

import { db } from "../db";
import {
  students,
  classes,
  classEnrollments,
  incarPairingQueue,
  incarPairedSessions,
  incarPairingOffers,
  incarSessionConfirmations,
  incarPairingAudit,
} from "@shared/schema";
import {
  bookCombinedSlot,
  joinCombinedQueue,
  leaveCombinedQueue,
  respondToOffer,
  processPairingLifecycle,
} from "../services/incar-pairing";

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const createdStudentIds: number[] = [];
const createdClassIds: number[] = [];
let uniq = 0;

/** Create an eligible auto student (Theory #11 attended). */
async function createStudent(opts: { eligible?: boolean } = {}): Promise<number> {
  const { eligible = true } = opts;
  const tag = `${Date.now()}_${uniq++}`;
  const [s] = await db
    .insert(students)
    .values({
      firstName: "PairTest",
      lastName: `Student${tag}`,
      email: `incar-pairing-db-test-${tag}@example.test`,
      phone: "514-555-0000",
      dateOfBirth: "2007-01-01",
      address: "1 Test St",
      courseType: "auto",
      emergencyContact: "Test Contact",
      emergencyPhone: "514-555-0001",
    })
    .returning({ id: students.id });
  createdStudentIds.push(s.id);

  if (eligible) {
    // Theory #11 attended (eligibility prerequisite).
    const [t11] = await db
      .insert(classes)
      .values({
        courseType: "auto",
        classType: "theory",
        classNumber: 11,
        date: "2026-01-05",
        time: "18:00",
        duration: 120,
        maxStudents: 15,
        status: "completed",
      })
      .returning({ id: classes.id });
    createdClassIds.push(t11.id);
    await db.insert(classEnrollments).values({
      classId: t11.id,
      studentId: s.id,
      attendanceStatus: "attended",
    });
  }
  return s.id;
}

/** Create a canonical combined 12/13 slot (auto/driving/#12/120min/max 2). */
async function createCombinedClass(
  overrides: Partial<typeof classes.$inferInsert> = {},
): Promise<number> {
  const [c] = await db
    .insert(classes)
    .values({
      courseType: "auto",
      classType: "driving",
      classNumber: 12,
      date: "2030-06-10",
      time: "10:00",
      duration: 120,
      maxStudents: 2,
      status: "scheduled",
      ...overrides,
    })
    .returning({ id: classes.id });
  createdClassIds.push(c.id);
  return c.id;
}

async function queueEntryFor(studentId: number) {
  const rows = await db
    .select()
    .from(incarPairingQueue)
    .where(eq(incarPairingQueue.studentId, studentId));
  return rows;
}

async function activeEnrollments(classId: number) {
  return db
    .select()
    .from(classEnrollments)
    .where(
      and(eq(classEnrollments.classId, classId), isNull(classEnrollments.cancelledAt)),
    );
}

async function pendingOffersFor(classId: number) {
  return db
    .select()
    .from(incarPairingOffers)
    .where(
      and(
        eq(incarPairingOffers.classId, classId),
        eq(incarPairingOffers.status, "pending"),
      ),
    );
}

afterEach(async () => {
  const sids = createdStudentIds.splice(0);
  const cids = createdClassIds.splice(0);
  if (sids.length > 0) {
    await db
      .delete(incarPairingAudit)
      .where(inArray(incarPairingAudit.studentId, sids));
  }
  if (cids.length > 0) {
    await db.delete(incarPairingAudit).where(inArray(incarPairingAudit.classId, cids));
  }
  if (sids.length > 0) {
    await db
      .delete(incarSessionConfirmations)
      .where(inArray(incarSessionConfirmations.studentId, sids));
    await db
      .delete(incarPairingOffers)
      .where(inArray(incarPairingOffers.studentId, sids));
    await db
      .delete(incarPairedSessions)
      .where(inArray(incarPairedSessions.studentIdA, sids));
    await db.delete(incarPairingQueue).where(inArray(incarPairingQueue.studentId, sids));
    await db
      .delete(classEnrollments)
      .where(inArray(classEnrollments.studentId, sids));
  }
  if (cids.length > 0) {
    await db.delete(classEnrollments).where(inArray(classEnrollments.classId, cids));
    await db.delete(classes).where(inArray(classes.id, cids)); 
  }
  if (sids.length > 0) {
    await db.delete(students).where(inArray(students.id, sids));
  }
});

// ─── bookCombinedSlot ─────────────────────────────────────────────────────────

describe("bookCombinedSlot (live DB)", () => {
  it("enrolls the first booker, sets booked_first, and offers the seat to a waiting student", async () => {
    const waiting = await createStudent();
    const booker = await createStudent();
    const classId = await createCombinedClass();

    const joined = await joinCombinedQueue({ studentId: waiting });
    expect(joined.success).toBe(true);

    const res = await bookCombinedSlot({ studentId: booker, classId });
    expect(res.success).toBe(true);
    expect(res.enrollmentId).toBeDefined();

    const [bookerEntry] = await queueEntryFor(booker);
    expect(bookerEntry.status).toBe("booked_first");
    expect(bookerEntry.bookedClassId).toBe(classId);

    const [waitingEntry] = await queueEntryFor(waiting);
    expect(waitingEntry.status).toBe("offered");

    const offers = await pendingOffersFor(classId);
    expect(offers).toHaveLength(1);
    expect(offers[0].studentId).toBe(waiting);

    expect(await activeEnrollments(classId)).toHaveLength(1);
  });

  it("allows exactly one winner when two students book the same slot concurrently", async () => {
    const [a, b] = await Promise.all([createStudent(), createStudent()]);
    const classId = await createCombinedClass();

    const [ra, rb] = await Promise.all([
      bookCombinedSlot({ studentId: a, classId }),
      bookCombinedSlot({ studentId: b, classId }),
    ]);

    const successes = [ra, rb].filter((r) => r.success);
    expect(successes).toHaveLength(1);

    // Exactly one booked_first entry owns the class; exactly one enrollment.
    const owners = await db
      .select()
      .from(incarPairingQueue)
      .where(
        and(
          eq(incarPairingQueue.bookedClassId, classId),
          eq(incarPairingQueue.status, "booked_first"),
        ),
      );
    expect(owners).toHaveLength(1);
    expect(await activeEnrollments(classId)).toHaveLength(1);
  });

  it("enforces one active queue entry per student under concurrent bookings of two different slots", async () => {
    const s = await createStudent();
    const [c1, c2] = await Promise.all([createCombinedClass(), createCombinedClass()]);

    const [r1, r2] = await Promise.all([
      bookCombinedSlot({ studentId: s, classId: c1 }),
      bookCombinedSlot({ studentId: s, classId: c2 }),
    ]);

    expect([r1, r2].filter((r) => r.success)).toHaveLength(1);
    const entries = await queueEntryFor(s);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("booked_first");
  });

  it("enforces one active entry per student under concurrent joinCombinedQueue calls", async () => {
    const s = await createStudent();
    const results = await Promise.all([
      joinCombinedQueue({ studentId: s }),
      joinCombinedQueue({ studentId: s }),
      joinCombinedQueue({ studentId: s }),
    ]);
    // Advisory lock + unique partial index: exactly one row ever exists.
    const entries = await queueEntryFor(s);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("waiting");
    // Idempotent joins report success (existing waiting entry reused).
    expect(results.some((r) => r.success)).toBe(true);
  });

  it("rejects booking a non-canonical class", async () => {
    const s = await createStudent();
    const classId = await createCombinedClass({ maxStudents: 1 });
    const res = await bookCombinedSlot({ studentId: s, classId });
    expect(res.success).toBe(false);
    expect(res.reason).toMatch(/not a valid combined/i);
  });
});

// ─── respondToOffer ───────────────────────────────────────────────────────────

async function seedBookedWithOffer() {
  const waiting = await createStudent();
  const booker = await createStudent();
  const classId = await createCombinedClass();
  await joinCombinedQueue({ studentId: waiting });
  const booked = await bookCombinedSlot({ studentId: booker, classId });
  expect(booked.success).toBe(true);
  const [offer] = await pendingOffersFor(classId);
  expect(offer).toBeDefined();
  return { waiting, booker, classId, offer };
}

describe("respondToOffer (live DB)", () => {
  it("accept enrolls student 2 and creates a paired session", async () => {
    const { waiting, booker, classId, offer } = await seedBookedWithOffer();

    const res = await respondToOffer({
      offerId: offer.id,
      studentId: waiting,
      response: "accept",
    });
    expect(res.success).toBe(true);
    expect(res.pairedSessionId).toBeDefined();

    expect(await activeEnrollments(classId)).toHaveLength(2);
    const [e1] = await queueEntryFor(booker);
    const [e2] = await queueEntryFor(waiting);
    expect(e1.status).toBe("paired");
    expect(e2.status).toBe("paired");

    const [session] = await db
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.classId, classId));
    expect(session.status).toBe("paired");
    expect(session.studentIdA).toBe(booker);
    expect(session.studentIdB).toBe(waiting);
  });

  it("simultaneous accepts of the same offer produce exactly one pairing", async () => {
    const { waiting, classId, offer } = await seedBookedWithOffer();

    const [r1, r2] = await Promise.all([
      respondToOffer({ offerId: offer.id, studentId: waiting, response: "accept" }),
      respondToOffer({ offerId: offer.id, studentId: waiting, response: "accept" }),
    ]);

    expect([r1, r2].filter((r) => r.success)).toHaveLength(1);

    const sessions = await db
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.classId, classId));
    expect(sessions).toHaveLength(1);
    // No duplicate enrollment for the accepting student.
    expect(await activeEnrollments(classId)).toHaveLength(2);
  });

  it("simultaneous accept + decline resolves to exactly one claimed transition", async () => {
    const { waiting, classId, offer } = await seedBookedWithOffer();

    const [ra, rd] = await Promise.all([
      respondToOffer({ offerId: offer.id, studentId: waiting, response: "accept" }),
      respondToOffer({ offerId: offer.id, studentId: waiting, response: "decline" }),
    ]);

    expect([ra, rd].filter((r) => r.success)).toHaveLength(1);

    const [offerAfter] = await db
      .select()
      .from(incarPairingOffers)
      .where(eq(incarPairingOffers.id, offer.id));
    expect(["accepted", "declined"]).toContain(offerAfter.status);

    const sessions = await db
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.classId, classId));
    if (offerAfter.status === "accepted") {
      expect(ra.success).toBe(true);
      expect(sessions).toHaveLength(1);
      expect(await activeEnrollments(classId)).toHaveLength(2);
    } else {
      expect(rd.success).toBe(true);
      expect(sessions).toHaveLength(0);
      expect(await activeEnrollments(classId)).toHaveLength(1);
      const [entry] = await queueEntryFor(waiting);
      expect(entry.status).toBe("waiting");
    }
  });

  it("decline returns student 2 to waiting and offers the seat to the next candidate", async () => {
    const { waiting, classId, offer } = await seedBookedWithOffer();
    const nextInLine = await createStudent();
    await joinCombinedQueue({ studentId: nextInLine });

    const res = await respondToOffer({
      offerId: offer.id,
      studentId: waiting,
      response: "decline",
      reason: "cannot make it",
    });
    expect(res.success).toBe(true);

    const [declinerEntry] = await queueEntryFor(waiting);
    expect(declinerEntry.status).toBe("waiting");

    const offers = await pendingOffersFor(classId);
    expect(offers).toHaveLength(1);
    expect(offers[0].studentId).toBe(nextInLine);
    const [nextEntry] = await queueEntryFor(nextInLine);
    expect(nextEntry.status).toBe("offered");
  });

  it("rejects an accept from a student who does not own the offer", async () => {
    const { offer } = await seedBookedWithOffer();
    const stranger = await createStudent();
    const res = await respondToOffer({
      offerId: offer.id,
      studentId: stranger,
      response: "accept",
    });
    expect(res.success).toBe(false);
    expect(res.reason).toMatch(/does not belong/i);
  });
});

// ─── leaveCombinedQueue ───────────────────────────────────────────────────────

describe("leaveCombinedQueue (live DB)", () => {
  it("booked_first leaver cancels enrollment, withdraws the outstanding offer, and returns candidate to waiting", async () => {
    const { waiting, booker, classId, offer } = await seedBookedWithOffer();

    const res = await leaveCombinedQueue({ studentId: booker, reason: "changed plans" });
    expect(res.success).toBe(true);

    const [bookerEntry] = await queueEntryFor(booker);
    expect(bookerEntry.status).toBe("cancelled");
    expect(await activeEnrollments(classId)).toHaveLength(0);

    const [offerAfter] = await db
      .select()
      .from(incarPairingOffers)
      .where(eq(incarPairingOffers.id, offer.id));
    expect(offerAfter.status).toBe("withdrawn");

    const [candidateEntry] = await queueEntryFor(waiting);
    expect(candidateEntry.status).toBe("waiting");
    // Seat is gone — no new offer for this class.
    expect(await pendingOffersFor(classId)).toHaveLength(0);
  });

  it("waiting student can leave; entry becomes cancelled", async () => {
    const s = await createStudent();
    await joinCombinedQueue({ studentId: s });
    const res = await leaveCombinedQueue({ studentId: s });
    expect(res.success).toBe(true);
    const [entry] = await queueEntryFor(s);
    expect(entry.status).toBe("cancelled");
  });

  it("concurrent leave (first booker) vs accept (candidate) never yields a half-paired state", async () => {
    const { waiting, booker, classId, offer } = await seedBookedWithOffer();

    const [leaveRes, acceptRes] = await Promise.all([
      leaveCombinedQueue({ studentId: booker }),
      respondToOffer({ offerId: offer.id, studentId: waiting, response: "accept" }),
    ]);

    const [bookerEntry] = await queueEntryFor(booker);
    const [candidateEntry] = await queueEntryFor(waiting);
    const sessions = await db
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.classId, classId));
    const enrolled = await activeEnrollments(classId);

    if (acceptRes.success) {
      // Accept won: fully paired. Leave either failed with a retry message or
      // was rejected before mutating.
      expect(sessions).toHaveLength(1);
      expect(candidateEntry.status).toBe("paired");
      if (leaveRes.success) {
        // Leave may only have succeeded if it ran BEFORE the pair existed —
        // impossible when accept succeeded, so it must have been serialized
        // after and refused.
        throw new Error("leave and accept both reported success");
      }
      expect(enrolled).toHaveLength(2);
      expect(bookerEntry.status).toBe("paired");
    } else {
      // Leave won: booking dissolved, candidate back to waiting, no session.
      expect(leaveRes.success).toBe(true);
      expect(sessions).toHaveLength(0);
      expect(bookerEntry.status).toBe("cancelled");
      expect(candidateEntry.status).toBe("waiting");
      expect(enrolled).toHaveLength(0);
    }
  });
});

// ─── processPairingLifecycle ──────────────────────────────────────────────────

describe("processPairingLifecycle (live DB)", () => {
  it("expires overdue offers, returns the student to waiting, and offers the next candidate", async () => {
    const { waiting, classId, offer } = await seedBookedWithOffer();
    const nextInLine = await createStudent();
    await joinCombinedQueue({ studentId: nextInLine });

    // Force the offer past its deadline.
    await db
      .update(incarPairingOffers)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(incarPairingOffers.id, offer.id));

    const stats = await processPairingLifecycle();
    expect(stats.expiredOffers).toBeGreaterThanOrEqual(1);

    const [offerAfter] = await db
      .select()
      .from(incarPairingOffers)
      .where(eq(incarPairingOffers.id, offer.id));
    expect(offerAfter.status).toBe("expired");

    const [expiredEntry] = await queueEntryFor(waiting);
    expect(expiredEntry.status).toBe("waiting");

    // Seat re-offered to the next candidate (expired student excluded).
    const offers = await pendingOffersFor(classId);
    expect(offers).toHaveLength(1);
    expect(offers[0].studentId).toBe(nextInLine);
  });

  it("defers a booked_first student with no partner inside the confirmation horizon", async () => {
    const booker = await createStudent();
    // Class starting ~2 hours from now (inside the 24h horizon), school-local.
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(soon).map((p) => [p.type, p.value]),
    );
    const classId = await createCombinedClass({
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`,
    });

    const booked = await bookCombinedSlot({ studentId: booker, classId });
    expect(booked.success).toBe(true);
    const enrollmentId = booked.enrollmentId!;

    const stats = await processPairingLifecycle();
    expect(stats.deferredStudents).toBeGreaterThanOrEqual(1);

    // Deferral is not a dead end: the entry returns to 'waiting' with a
    // boosted priority (≤50), and the class seat/enrollment are released.
    const [entry] = await queueEntryFor(booker);
    expect(entry.status).toBe("waiting");
    expect(entry.bookedClassId).toBeNull();
    expect(entry.priority).toBeLessThanOrEqual(50);

    const [enr] = await db
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.id, enrollmentId));
    expect(enr.cancelledAt).not.toBeNull();
  });
});
