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
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

vi.mock("../services/notifications", () => ({
  enqueueNotification: vi.fn(async () => 0),
  getStudentRecipients: vi.fn(async (studentId: number) => [{
    type: "student",
    id: String(studentId),
    email: "pairing-test@example.test",
    name: "Pairing test",
  }]),
  getOfficeRecipients: vi.fn(async () => []),
}));

vi.mock("../services/no-show-fee", () => ({
  chargeNoShowFee: vi.fn(async () => undefined),
}));

import { db } from "../db";
import { registerRoutes } from "../routes";
import { generateStudentToken } from "../student-auth";
import { enqueueNotification } from "../services/notifications";
import { SCHOOL_TIMEZONE } from "../services/class-time";
import {
  students,
  classes,
  classEnrollments,
  incarPairingQueue,
  incarPairedSessions,
  incarPairingOffers,
  incarSessionConfirmations,
  incarPairingAudit,
  attendanceAuditLogs,
  evaluations,
  lessonRecords,
  studentTransactions,
  paymentTransactions,
  instructors,
  users,
} from "@shared/schema";
import {
  bookCombinedSlot,
  joinCombinedQueue,
  leaveCombinedQueue,
  respondToOffer,
  processPairingLifecycle,
  hasQualifyingPhase4IncarOffer,
  convertPresentStudentToSolo,
  saveAttendanceWithPairing,
  getPairedSessionLinkAuditReport,
  repairPairedSessionEnrollmentLinks,
  PairingRepairApprovalError,
} from "../services/incar-pairing";

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const createdStudentIds: number[] = [];
const createdClassIds: number[] = [];
let uniq = 0;
let app: express.Express;
let adminCookie: string;
let adminUserId: string | null = null;
let instructorId: number | null = null;
let instructorCookie: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
  const tag = `${Date.now()}_${uniq++}`;
  const [admin] = await db
    .insert(users)
    .values({
      email: `incar-conversion-admin-${tag}@example.test`,
      firstName: "Pairing",
      lastName: "Admin",
      role: "admin",
      password: await bcrypt.hash("pairing-test-password", 10),
    } as any)
    .returning({ id: users.id, email: users.email });
  adminUserId = admin.id;
  const login = await request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-Proto", "https")
    .send({ username: admin.email, password: "pairing-test-password" });
  expect(login.status).toBe(200);
  adminCookie = login.headers["set-cookie"][0].split(";")[0];

  const instructorPassword = "pairing-instructor-password";
  const [instructor] = await db
    .insert(instructors)
    .values({
      firstName: "Pairing",
      lastName: "Instructor",
      email: `incar-pairing-instructor-${tag}@example.test`,
      status: "active",
      accountStatus: "active",
      password: await bcrypt.hash(instructorPassword, 10),
    })
    .returning({ id: instructors.id, email: instructors.email });
  instructorId = instructor.id;
  const instructorLogin = await request(app)
    .post("/api/instructor/login")
    .set("X-Forwarded-Proto", "https")
    .send({ email: instructor.email, password: instructorPassword });
  expect(instructorLogin.status).toBe(200);
  instructorCookie = instructorLogin.headers["set-cookie"][0].split(";")[0];
}, 60_000);

afterAll(async () => {
  if (instructorId) await db.delete(instructors).where(eq(instructors.id, instructorId));
  if (adminUserId) await db.delete(users).where(eq(users.id, adminUserId));
});

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
      accountStatus: "active",
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

async function phaseProgressFor(studentId: number) {
  const response = await request(app)
    .get("/api/student/phase-progress")
    .set("Authorization", `Bearer ${generateStudentToken(studentId)}`);
  expect(response.status).toBe(200);
  const rows = response.body.phases.flatMap((phase: { classes: any[] }) => phase.classes);
  return {
    twelve: rows.find((row: any) => row.classType === "driving" && row.classNumber === 12),
    thirteen: rows.find((row: any) => row.classType === "driving" && row.classNumber === 13),
  };
}

async function adminPhaseProgressFor(studentId: number) {
  const response = await request(app)
    .get(`/api/students/${studentId}/phase-progress`)
    .set("Cookie", adminCookie);
  expect(response.status).toBe(200);
  const rows = response.body.phases.flatMap((phase: { classes: any[] }) => phase.classes);
  return {
    twelve: rows.find((row: any) => row.classType === "driving" && row.classNumber === 12),
    thirteen: rows.find((row: any) => row.classType === "driving" && row.classNumber === 13),
  };
}

function schoolLocalSchedule(minutesFromNow: number): { date: string; time: string } {
  const instant = new Date(Date.now() + minutesFromNow * 60_000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`,
  };
}

afterEach(async () => {
  const sids = createdStudentIds.splice(0);
  const cids = createdClassIds.splice(0);
  if (sids.length > 0) {
    await db.delete(paymentTransactions).where(inArray(paymentTransactions.studentId, sids));
    await db.delete(studentTransactions).where(inArray(studentTransactions.studentId, sids));
    await db.delete(lessonRecords).where(inArray(lessonRecords.studentId, sids));
    await db.delete(attendanceAuditLogs).where(inArray(attendanceAuditLogs.studentId, sids));
    await db
      .delete(incarPairingAudit)
      .where(inArray(incarPairingAudit.studentId, sids));
  }
  if (cids.length > 0) {
    await db.delete(attendanceAuditLogs).where(inArray(attendanceAuditLogs.classId, cids));
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
    await db.delete(evaluations).where(inArray(evaluations.classId, cids));
    await db.delete(classEnrollments).where(inArray(classEnrollments.classId, cids));
    await db.delete(classes).where(inArray(classes.id, cids)); 
  }
  if (sids.length > 0) {
    await db.delete(students).where(inArray(students.id, sids));
  }
});

// ─── bookCombinedSlot ─────────────────────────────────────────────────────────

describe("bookCombinedSlot (live DB)", () => {
  it("rejects a stale eligibility result after concurrent attendance completion", async () => {
    const studentId = await createStudent();
    const partnerId = await createStudent();
    const targetClassId = await createCombinedClass();
    const completedClassId = await createCombinedClass({
      ...schoolLocalSchedule(-90),
      status: "completed",
    });
    const completedEnrollments = await db.insert(classEnrollments).values([
      { classId: completedClassId, studentId, attendanceStatus: "registered" },
      { classId: completedClassId, studentId: partnerId, attendanceStatus: "registered" },
    ]).returning({ id: classEnrollments.id });
    const completedQueueEntries = await db.insert(incarPairingQueue).values([
      {
        studentId,
        sessionNumber: 12,
        status: "completed",
        bookedClassId: completedClassId,
        enrollmentId: completedEnrollments[0].id,
      },
      {
        studentId: partnerId,
        sessionNumber: 12,
        status: "completed",
        bookedClassId: completedClassId,
        enrollmentId: completedEnrollments[1].id,
      },
    ]).returning({ id: incarPairingQueue.id });
    const [completingSession] = await db.insert(incarPairedSessions).values({
      queueEntryIdA: completedQueueEntries[0].id,
      queueEntryIdB: completedQueueEntries[1].id,
      studentIdA: studentId,
      studentIdB: partnerId,
      classId: completedClassId,
      enrollmentIdA: completedEnrollments[0].id,
      enrollmentIdB: completedEnrollments[1].id,
      status: "paired",
    }).returning({ id: incarPairedSessions.id });

    let bookingPromise: ReturnType<typeof bookCombinedSlot> | undefined;
    await db.transaction(async (tx) => {
      // Hold the exact lock pair used by bookCombinedSlot. Once its backend is
      // visibly waiting on 823001, its cheap outer eligibility read is known
      // to be complete and therefore stale.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(823001, ${studentId})`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(823002, ${studentId})`);
      bookingPromise = bookCombinedSlot({ studentId, classId: targetClassId });

      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await db.execute<{ count: number }>(sql`
          SELECT count(*)::int AS count
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND granted = false
            AND classid = 823001
            AND objid = ${studentId}
        `);
        if ((result.rows[0]?.count ?? 0) > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);

      await tx.update(classEnrollments)
        .set({ attendanceStatus: "attended" })
        .where(inArray(
          classEnrollments.id,
          completedEnrollments.map((enrollment) => enrollment.id),
        ));
      await tx.update(incarPairedSessions)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(incarPairedSessions.id, completingSession.id));
    });

    const booked = await bookingPromise!;
    expect(booked.success).toBe(false);
    expect(booked.reason).toMatch(/completed|not eligible|12|13/i);
    expect(await queueEntryFor(studentId)).toEqual([
      expect.objectContaining({
        status: "completed",
        bookedClassId: completedClassId,
      }),
    ]);
    expect(await activeEnrollments(targetClassId)).toHaveLength(0);
  });

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

describe("hasQualifyingPhase4IncarOffer (live DB)", () => {
  async function seedOffer(
    studentId: number,
    classId: number,
    status: string,
  ) {
    const [entry] = await db
      .insert(incarPairingQueue)
      .values({ studentId, status: "cancelled" })
      .returning({ id: incarPairingQueue.id });
    await db.insert(incarPairingOffers).values({
      queueEntryId: entry.id,
      studentId,
      classId,
      status,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  it.each(["pending", "accepted"])(
    "returns true for a %s offer tied to a canonical class",
    async (status) => {
      const studentId = await createStudent();
      const classId = await createCombinedClass();
      await seedOffer(studentId, classId, status);
      expect(await hasQualifyingPhase4IncarOffer(studentId)).toBe(true);
    },
  );

  it.each(["declined", "expired", "withdrawn"])(
    "returns false for terminal status %s",
    async (status) => {
      const studentId = await createStudent();
      const classId = await createCombinedClass();
      await seedOffer(studentId, classId, status);
      expect(await hasQualifyingPhase4IncarOffer(studentId)).toBe(false);
    },
  );

  it.each([
    { duration: 60 },
    { maxStudents: 1 },
    { classNumber: 13 },
    { classType: "theory" },
    { courseType: "moto" },
  ])("returns false for a pending offer on noncanonical class %o", async (shape) => {
    const studentId = await createStudent();
    const classId = await createCombinedClass(shape);
    await seedOffer(studentId, classId, "pending");
    expect(await hasQualifyingPhase4IncarOffer(studentId)).toBe(false);
  });

  it("does not let another student's qualifying offer unlock the student", async () => {
    const [studentId, otherId] = await Promise.all([createStudent(), createStudent()]);
    const classId = await createCombinedClass();
    await seedOffer(otherId, classId, "accepted");
    expect(await hasQualifyingPhase4IncarOffer(studentId)).toBe(false);
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
  it("marks both curriculum rows booked for both students only after acceptance", async () => {
    const { waiting, booker, offer } = await seedBookedWithOffer();

    for (const studentId of [booker, waiting]) {
      const before = await phaseProgressFor(studentId);
      expect(before.twelve.isBooked).toBe(false);
      expect(before.thirteen.isBooked).toBe(false);
    }

    const accepted = await respondToOffer({
      offerId: offer.id,
      studentId: waiting,
      response: "accept",
    });
    expect(accepted.success).toBe(true);

    for (const studentId of [booker, waiting]) {
      const after = await phaseProgressFor(studentId);
      expect(after.twelve).toMatchObject({ isBooked: true, isCompleted: false });
      expect(after.thirteen).toMatchObject({
        isBooked: true,
        isCompleted: false,
        classId: after.twelve.classId,
        enrollmentId: after.twelve.enrollmentId,
      });
    }
  });

  it("does not mark rows booked after the pairing is dissolved, cancelled, or malformed", async () => {
    const { waiting, booker, classId, offer } = await seedBookedWithOffer();
    const accepted = await respondToOffer({
      offerId: offer.id,
      studentId: waiting,
      response: "accept",
    });
    expect(accepted.success).toBe(true);

    await db
      .update(incarPairedSessions)
      .set({ status: "dissolved", dissolvedAt: new Date() })
      .where(eq(incarPairedSessions.id, accepted.pairedSessionId!));

    for (const studentId of [booker, waiting]) {
      const dissolved = await phaseProgressFor(studentId);
      expect(dissolved.twelve.isBooked).toBe(false);
      expect(dissolved.thirteen.isBooked).toBe(false);
    }

    await db
      .update(incarPairedSessions)
      .set({ status: "paired", dissolvedAt: null })
      .where(eq(incarPairedSessions.id, accepted.pairedSessionId!));
    await db
      .update(classEnrollments)
      .set({ cancelledAt: new Date() })
      .where(
        and(
          eq(classEnrollments.studentId, waiting),
          eq(classEnrollments.classId, classId),
        ),
      );

    const cancelled = await phaseProgressFor(waiting);
    expect(cancelled.twelve.isBooked).toBe(false);
    expect(cancelled.thirteen.isBooked).toBe(false);

    await db
      .update(classes)
      .set({ duration: 60 })
      .where(eq(classes.id, classId));
    const malformed = await phaseProgressFor(booker);
    expect(malformed.twelve.isBooked).toBe(false);
    expect(malformed.thirteen.isBooked).toBe(false);
  });

  it("transitions both included rows from booked to completed after both students attend", async () => {
    const { waiting, booker, classId, offer } = await seedBookedWithOffer();
    const accepted = await respondToOffer({
      offerId: offer.id,
      studentId: waiting,
      response: "accept",
    });
    expect(accepted.success).toBe(true);

    await db
      .update(classEnrollments)
      .set({ attendanceStatus: "attended" })
      .where(eq(classEnrollments.classId, classId));
    await db
      .update(incarPairedSessions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(incarPairedSessions.id, accepted.pairedSessionId!));
    await db.update(classes).set(schoolLocalSchedule(-5)).where(eq(classes.id, classId));

    for (const studentId of [booker, waiting]) {
      const completed = await phaseProgressFor(studentId);
      expect(completed.twelve).toMatchObject({ isBooked: false, isCompleted: true });
      expect(completed.thirteen).toMatchObject({ isBooked: false, isCompleted: true });
    }
  });

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

  it("makes duplicate same-student accepts idempotent and produces exactly one pairing", async () => {
    const { waiting, classId, offer } = await seedBookedWithOffer();

    const [r1, r2] = await Promise.all([
      respondToOffer({ offerId: offer.id, studentId: waiting, response: "accept" }),
      respondToOffer({ offerId: offer.id, studentId: waiting, response: "accept" }),
    ]);

    expect([r1, r2].filter((r) => r.success)).toHaveLength(2);
    expect(r1.pairedSessionId).toBe(r2.pairedSessionId);

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

  it("rejects a new acceptance at or after the school-local class start", async () => {
    const { waiting, classId, offer } = await seedBookedWithOffer();
    const started = schoolLocalSchedule(-5);
    await db.update(classes).set(started).where(eq(classes.id, classId));

    const res = await respondToOffer({
      offerId: offer.id,
      studentId: waiting,
      response: "accept",
    });

    expect(res.success).toBe(false);
    expect(res.reason).toMatch(/already started/i);
    expect(await activeEnrollments(classId)).toHaveLength(1);
  });
});

// ─── leaveCombinedQueue ───────────────────────────────────────────────────────

async function seedStartedPairedSession() {
  const waiting = await createStudent();
  const booker = await createStudent();
  const classId = await createCombinedClass({
    date: "2030-01-10",
    time: "10:00",
    status: "scheduled",
  });
  await joinCombinedQueue({ studentId: waiting });
  await bookCombinedSlot({ studentId: booker, classId });
  const [offer] = await pendingOffersFor(classId);
  const accepted = await respondToOffer({
    offerId: offer.id,
    studentId: waiting,
    response: "accept",
  });
  const [session] = await db
    .select()
    .from(incarPairedSessions)
    .where(eq(incarPairedSessions.id, accepted.pairedSessionId!));
  await db.update(classes)
    .set({ date: schoolLocalSchedule(-24 * 60).date })
    .where(eq(classes.id, classId));
  await db
    .update(classEnrollments)
    .set({ attendanceStatus: "attended" })
    .where(eq(classEnrollments.id, session.enrollmentIdA!));
  await db
    .update(classEnrollments)
    .set({ attendanceStatus: "no-show" })
    .where(eq(classEnrollments.id, session.enrollmentIdB!));
  return { waiting, booker, classId, session };
}

async function seedPairedSessionForAttendance(opts: { started?: boolean } = {}) {
  const waiting = await createStudent();
  const booker = await createStudent();
  const classId = await createCombinedClass({
    instructorId,
    status: "scheduled",
  });
  await joinCombinedQueue({ studentId: waiting });
  await bookCombinedSlot({ studentId: booker, classId });
  const [offer] = await pendingOffersFor(classId);
  const accepted = await respondToOffer({
    offerId: offer.id,
    studentId: waiting,
    response: "accept",
  });
  expect(accepted.success).toBe(true);
  const [session] = await db
    .select()
    .from(incarPairedSessions)
    .where(eq(incarPairedSessions.id, accepted.pairedSessionId!));
  const schedule = schoolLocalSchedule(opts.started === false ? 90 : -90);
  await db.update(classes).set(schedule).where(eq(classes.id, classId));
  return { waiting, booker, classId, session };
}

function pairedAttendanceUpdates(
  session: typeof incarPairedSessions.$inferSelect,
  a: "registered" | "attended" | "absent" | "no-show",
  b: "registered" | "attended" | "absent" | "no-show",
) {
  return [
    { enrollmentId: session.enrollmentIdA!, attendanceStatus: a },
    { enrollmentId: session.enrollmentIdB!, attendanceStatus: b },
  ];
}

async function attendanceRows(session: typeof incarPairedSessions.$inferSelect) {
  return db
    .select()
    .from(classEnrollments)
    .where(inArray(classEnrollments.id, [session.enrollmentIdA!, session.enrollmentIdB!]));
}

async function convertedLessons(studentId: number) {
  return db
    .select({
      classId: classes.id,
      classNumber: classes.classNumber,
      enrollmentId: classEnrollments.id,
      attendanceStatus: classEnrollments.attendanceStatus,
      cancelledAt: classEnrollments.cancelledAt,
    })
    .from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(
      and(
        eq(classEnrollments.studentId, studentId),
        eq(classes.classType, "driving"),
        inArray(classes.classNumber, [11, 14]),
      ),
    );
}

describe("historical paired-session enrollment-link audit and repair", () => {
  it("reports wrong-student and cross-class links without mutating any rows", async () => {
    const { session } = await seedPairedSessionForAttendance();
    const unrelatedStudent = await createStudent();
    const unrelatedClass = await createCombinedClass();
    const [unrelatedEnrollment] = await db
      .insert(classEnrollments)
      .values({
        classId: unrelatedClass,
        studentId: unrelatedStudent,
        attendanceStatus: "attended",
        paymentStatus: "paid",
        paidAmount: 12345,
        lastPaymentIntentId: "pi_historical_link_audit",
      })
      .returning();
    await db
      .update(incarPairedSessions)
      .set({ enrollmentIdB: unrelatedEnrollment.id })
      .where(eq(incarPairedSessions.id, session.id));

    const beforeAuditCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(incarPairingAudit)
      .where(eq(incarPairingAudit.pairedSessionId, session.id));
    const report = await getPairedSessionLinkAuditReport();
    const record = report.records.find((row) => row.pairedSessionId === session.id);

    expect(record).toMatchObject({
      issues: expect.arrayContaining(["cross_class", "wrong_student"]),
      repairable: true,
      proposedRepair: {
        enrollmentIdA: session.enrollmentIdA,
        enrollmentIdB: session.enrollmentIdB,
      },
    });
    expect(record?.students[1]).toMatchObject({
      queueStatus: "paired",
      linkedEnrollmentId: unrelatedEnrollment.id,
      linkedEnrollment: {
        attendanceStatus: "attended",
        paymentStatus: "paid",
        paidAmount: 12345,
      },
      proposedEnrollment: {
        id: session.enrollmentIdB,
        attendanceStatus: "registered",
        paymentStatus: "not_required",
      },
    });
    const [unchangedSession] = await db
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, session.id));
    expect(unchangedSession.enrollmentIdB).toBe(unrelatedEnrollment.id);
    const afterAuditCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(incarPairingAudit)
      .where(eq(incarPairingAudit.pairedSessionId, session.id));
    expect(afterAuditCount).toEqual(beforeAuditCount);
  });

  it("requires approval and a current reviewed fingerprint", async () => {
    const { session } = await seedPairedSessionForAttendance();
    await db
      .update(incarPairedSessions)
      .set({ enrollmentIdA: null })
      .where(eq(incarPairedSessions.id, session.id));
    const report = await getPairedSessionLinkAuditReport();

    await expect(
      repairPairedSessionEnrollmentLinks({
        fingerprint: report.fingerprint,
        pairedSessionIds: [session.id],
        approved: false,
        actorId: String(adminUserId),
        actorRole: "admin",
      }),
    ).rejects.toBeInstanceOf(PairingRepairApprovalError);

    await db
      .update(incarPairedSessions)
      .set({ enrollmentIdB: null })
      .where(eq(incarPairedSessions.id, session.id));
    await expect(
      repairPairedSessionEnrollmentLinks({
        fingerprint: report.fingerprint,
        pairedSessionIds: [session.id],
        approved: true,
        actorId: String(adminUserId),
        actorRole: "admin",
      }),
    ).rejects.toThrow(/report changed/i);
  });

  it("repairs only unambiguous links, records approval, and preserves attendance and billing", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    await db
      .update(classEnrollments)
      .set({
        attendanceStatus: "checked_in",
        paymentStatus: "paid",
        paidAmount: 9876,
        lastPaymentIntentId: "pi_preserve_during_link_repair",
      })
      .where(eq(classEnrollments.id, session.enrollmentIdA!));
    await db
      .update(incarPairedSessions)
      .set({ enrollmentIdA: null, enrollmentIdB: session.enrollmentIdA })
      .where(eq(incarPairedSessions.id, session.id));
    const [lessonRecord] = await db
      .insert(lessonRecords)
      .values({
        studentId: booker,
        lessonDate: "2030-06-10",
        lessonType: "practical",
        duration: 120,
        status: "completed",
        notes: "must remain unchanged",
      })
      .returning();
    const [studentTransaction] = await db
      .insert(studentTransactions)
      .values({
        studentId: booker,
        date: "2030-06-10",
        description: "Protected billing row",
        amount: "100.00",
        total: "100.00",
        transactionType: "charge",
      })
      .returning();
    const [paymentTransaction] = await db
      .insert(paymentTransactions)
      .values({
        studentId: booker,
        transactionDate: "2030-06-10",
        amount: "50.00",
        paymentMethod: "cash",
        transactionType: "payment",
        notes: "must remain unchanged",
      })
      .returning();

    const report = await getPairedSessionLinkAuditReport();
    const record = report.records.find((row) => row.pairedSessionId === session.id);
    expect(record).toMatchObject({
      issues: expect.arrayContaining(["missing", "wrong_student"]),
      repairable: true,
    });
    const before = await db
      .select()
      .from(classEnrollments)
      .where(inArray(classEnrollments.id, [session.enrollmentIdA!, session.enrollmentIdB!]));
    const [classBefore] = await db
      .select()
      .from(classes)
      .where(eq(classes.id, session.classId));

    const result = await repairPairedSessionEnrollmentLinks({
      fingerprint: report.fingerprint,
      pairedSessionIds: [session.id],
      approved: true,
      actorId: String(adminUserId),
      actorRole: "admin",
    });

    expect(result.repairedSessionIds).toEqual([session.id]);
    expect(result.report.records.some((row) => row.pairedSessionId === session.id)).toBe(false);
    const [repaired] = await db
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, session.id));
    expect(repaired).toMatchObject({
      enrollmentIdA: session.enrollmentIdA,
      enrollmentIdB: session.enrollmentIdB,
    });
    const after = await db
      .select()
      .from(classEnrollments)
      .where(inArray(classEnrollments.id, [session.enrollmentIdA!, session.enrollmentIdB!]));
    expect(after).toEqual(before);
    expect(
      await db.select().from(classes).where(eq(classes.id, session.classId)),
    ).toEqual([classBefore]);
    expect(
      await db.select().from(lessonRecords).where(eq(lessonRecords.id, lessonRecord.id)),
    ).toEqual([lessonRecord]);
    expect(
      await db
        .select()
        .from(studentTransactions)
        .where(eq(studentTransactions.id, studentTransaction.id)),
    ).toEqual([studentTransaction]);
    expect(
      await db
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.id, paymentTransaction.id)),
    ).toEqual([paymentTransaction]);
    const [auditRow] = await db
      .select()
      .from(incarPairingAudit)
      .where(
        and(
          eq(incarPairingAudit.pairedSessionId, session.id),
          eq(incarPairingAudit.eventType, "historical_enrollment_links_repaired"),
        ),
      );
    expect(auditRow).toMatchObject({
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    expect(auditRow.details).toMatchObject({
      approvedFingerprint: report.fingerprint,
      attendanceAndBillingChanged: false,
    });
  });

  it("keeps duplicate active enrollments read-only because the repair is ambiguous", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    await db.insert(classEnrollments).values({
      classId: session.classId,
      studentId: booker,
      attendanceStatus: "registered",
    });
    await db
      .update(incarPairedSessions)
      .set({ enrollmentIdA: null })
      .where(eq(incarPairedSessions.id, session.id));

    const report = await getPairedSessionLinkAuditReport();
    const record = report.records.find((row) => row.pairedSessionId === session.id);
    expect(record).toMatchObject({
      issues: expect.arrayContaining(["missing", "duplicate"]),
      repairable: false,
      proposedRepair: null,
    });
    await expect(
      repairPairedSessionEnrollmentLinks({
        fingerprint: report.fingerprint,
        pairedSessionIds: [session.id],
        approved: true,
        actorId: String(adminUserId),
        actorRole: "admin",
      }),
    ).rejects.toBeInstanceOf(PairingRepairApprovalError);
  });

  it("rejects queue-provenance mismatches and terminal historical sessions", async () => {
    const { session } = await seedPairedSessionForAttendance();
    await db
      .update(incarPairedSessions)
      .set({ enrollmentIdA: null })
      .where(eq(incarPairedSessions.id, session.id));
    await db
      .update(incarPairingQueue)
      .set({ enrollmentId: null })
      .where(eq(incarPairingQueue.id, session.queueEntryIdA));

    let report = await getPairedSessionLinkAuditReport();
    expect(report.records.find((row) => row.pairedSessionId === session.id)).toMatchObject({
      repairable: false,
      proposedRepair: null,
    });

    await db
      .update(incarPairingQueue)
      .set({ enrollmentId: session.enrollmentIdA })
      .where(eq(incarPairingQueue.id, session.queueEntryIdA));
    await db
      .update(incarPairedSessions)
      .set({ status: "dissolved" })
      .where(eq(incarPairedSessions.id, session.id));
    report = await getPairedSessionLinkAuditReport();
    expect(report.records.find((row) => row.pairedSessionId === session.id)).toMatchObject({
      status: "dissolved",
      repairable: false,
      proposedRepair: null,
    });
  });

  it("rejects a concurrent queue change made after office review", async () => {
    const { session } = await seedPairedSessionForAttendance();
    await db
      .update(incarPairedSessions)
      .set({ enrollmentIdA: null })
      .where(eq(incarPairedSessions.id, session.id));
    const report = await getPairedSessionLinkAuditReport();

    let repairPromise:
      | ReturnType<typeof repairPairedSessionEnrollmentLinks>
      | undefined;
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(incarPairingQueue)
        .where(eq(incarPairingQueue.id, session.queueEntryIdA))
        .for("update");
      repairPromise = repairPairedSessionEnrollmentLinks({
        fingerprint: report.fingerprint,
        pairedSessionIds: [session.id],
        approved: true,
        actorId: String(adminUserId),
        actorRole: "admin",
      });
      await new Promise((resolve) => setTimeout(resolve, 75));
      await tx
        .update(incarPairingQueue)
        .set({ enrollmentId: null })
        .where(eq(incarPairingQueue.id, session.queueEntryIdA));
    });

    await expect(repairPromise!).rejects.toBeInstanceOf(PairingRepairApprovalError);
    const [unchanged] = await db
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, session.id));
    expect(unchanged.enrollmentIdA).toBeNull();
  });

  it("reserves both review and repair approval for office admins", async () => {
    const instructorReview = await request(app)
      .get("/api/lesson-pairing/admin/enrollment-link-audit")
      .set("Cookie", instructorCookie);
    expect([401, 403]).toContain(instructorReview.status);

    const review = await request(app)
      .get("/api/lesson-pairing/admin/enrollment-link-audit")
      .set("Cookie", adminCookie);
    expect(review.status).toBe(200);
    expect(review.body).toHaveProperty("fingerprint");

    const repair = await request(app)
      .post("/api/lesson-pairing/admin/enrollment-link-audit/repair")
      .set("Cookie", instructorCookie)
      .send({
        fingerprint: review.body.fingerprint,
        pairedSessionIds: [1],
        approved: true,
      });
    expect([401, 403]).toContain(repair.status);
  });
});

describe("saveAttendanceWithPairing (live DB)", () => {
  it.each([
    ["first roster position present", true, false, "A"],
    ["second roster position present", false, true, "B"],
  ] as const)("finalizes the authenticated instructor bulk payload with %s", async (_label, a, b, present) => {
    const { booker, waiting, classId, session } = await seedPairedSessionForAttendance();
    const response = await request(app)
      .post(`/api/instructor/classes/${classId}/attendance`)
      .set("Cookie", instructorCookie)
      .send({
        signature: "data:image/png;base64,pairing-test-signature",
        attendance: [
          { enrollmentId: session.enrollmentIdA, attended: a },
          { enrollmentId: session.enrollmentIdB, attended: b },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      attendedCount: 1,
      absentCount: 1,
    });

    const presentStudent = present === "A" ? booker : waiting;
    const lessons = await convertedLessons(presentStudent);
    expect(lessons.map((row) => row.classNumber).sort()).toEqual([11, 14]);
    createdClassIds.push(...lessons.map((row) => row.classId));
    const [sessionAfter] = await db.select().from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, session.id));
    expect(sessionAfter.status).toBe("dissolved");
  });

  it("finalizes through the authenticated generic attendance update endpoint", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    const missed = await request(app)
      .put(`/api/class-enrollments/${session.enrollmentIdB}`)
      .set("Cookie", adminCookie)
      .send({ attendanceStatus: "absent" });
    expect(missed.status).toBe(200);
    expect(missed.body.pairedFinalizations).toMatchObject([{ status: "pending" }]);

    const present = await request(app)
      .put(`/api/class-enrollments/${session.enrollmentIdA}`)
      .set("Cookie", adminCookie)
      .send({ attendanceStatus: "attended" });
    expect(present.status).toBe(200);
    expect(present.body.pairedFinalizations).toMatchObject([{ status: "converted" }]);
    const lessons = await convertedLessons(booker);
    createdClassIds.push(...lessons.map((row) => row.classId));
    expect(lessons.map((row) => row.classNumber).sort()).toEqual([11, 14]);
  });

  it("finalizes through the authenticated no-show endpoint", async () => {
    const { waiting, classId, session } = await seedPairedSessionForAttendance();
    await db.insert(evaluations).values({
      studentId: waiting,
      instructorId,
      classId,
      evaluationDate: schoolLocalSchedule(0).date,
      sessionType: "in-car",
      signedOff: true,
    });
    const present = await request(app)
      .put(`/api/class-enrollments/${session.enrollmentIdA}`)
      .set("Cookie", adminCookie)
      .send({ attendanceStatus: "attended" });
    expect(present.status).toBe(200);

    const missed = await request(app)
      .post(`/api/class-enrollments/${session.enrollmentIdB}/no-show`)
      .set("Cookie", adminCookie);
    expect(missed.status).toBe(200);
    expect(missed.body).toMatchObject({
      attendanceStatus: "no-show",
      pairedFinalizations: [{ status: "converted" }],
    });
    createdClassIds.push(...(missed.body.pairedFinalizations[0].newClassIds ?? []));
  });

  it("finalizes through checkout and persists checkout evidence atomically", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    const missed = await request(app)
      .put(`/api/class-enrollments/${session.enrollmentIdB}`)
      .set("Cookie", adminCookie)
      .send({ attendanceStatus: "absent" });
    expect(missed.status).toBe(200);

    const checkedOut = await request(app)
      .post(`/api/class-enrollments/${session.enrollmentIdA}/check-out`)
      .set("Cookie", adminCookie)
      .send({ signature: "present-student-checkout" });
    expect(checkedOut.status).toBe(200);
    expect(checkedOut.body).toMatchObject({
      pairedFinalizations: [{ status: "converted" }],
    });
    expect(checkedOut.body.checkOutSignature).toBe("present-student-checkout");
    expect(checkedOut.body.checkOutAt).toBeTruthy();
    const lessons = await convertedLessons(booker);
    createdClassIds.push(...lessons.map((row) => row.classId));
  });

  it("rejects an instructor generic update for a class they do not own", async () => {
    const { session } = await seedPairedSessionForAttendance();
    await db.update(classes).set({ instructorId: null }).where(eq(classes.id, session.classId));
    const response = await request(app)
      .put(`/api/class-enrollments/${session.enrollmentIdA}`)
      .set("Cookie", instructorCookie)
      .send({ attendanceStatus: "attended" });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ATTENDANCE_PAIRING_FINALIZATION_FAILED");
    const [row] = await db.select().from(classEnrollments)
      .where(eq(classEnrollments.id, session.enrollmentIdA!));
    expect(row.attendanceStatus).toBe("registered");
  });

  it.each([
    ["A present/B absent", "attended", "absent", "A"],
    ["A absent/B present", "no-show", "attended", "B"],
  ] as const)("reproduces instructor bulk attendance exactly for %s", async (_name, a, b, present) => {
    const { booker, waiting, session } = await seedPairedSessionForAttendance();
    const result = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, a, b),
      actorId: String(instructorId),
      actorRole: "instructor",
      expectedClassId: session.classId,
    });
    expect(result.pairedFinalizations).toMatchObject([{
      pairedSessionId: session.id,
      status: "converted",
      presentEnrollmentId: present === "A" ? session.enrollmentIdA : session.enrollmentIdB,
    }]);
    createdClassIds.push(...(result.pairedFinalizations[0].newClassIds ?? []));

    const rows = await attendanceRows(session);
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Conversion intentionally changes only the present original to absent and
    // cancels it; the instructor's absent/no-show value must remain exact.
    const missedId = present === "A" ? session.enrollmentIdB! : session.enrollmentIdA!;
    expect(byId.get(missedId)?.attendanceStatus).toBe(present === "A" ? b : a);
    const presentStudent = present === "A" ? booker : waiting;
    expect((await convertedLessons(presentStudent)).map((row) => row.classNumber).sort())
      .toEqual([11, 14]);
  });

  it("leaves both absent/no-show positions pending without inventing solo credit", async () => {
    const { booker, waiting, session } = await seedPairedSessionForAttendance();
    const result = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "absent", "no-show"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    expect(result.pairedFinalizations).toMatchObject([{ status: "pending" }]);
    expect((await attendanceRows(session)).map((row) => row.attendanceStatus).sort())
      .toEqual(["absent", "no-show"]);
    expect(await convertedLessons(booker)).toHaveLength(0);
    expect(await convertedLessons(waiting)).toHaveLength(0);
  });

  it("keeps incomplete and pre-start attendance pending, then completes both-attended", async () => {
    const prestart = await seedPairedSessionForAttendance({ started: false });
    const early = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(prestart.session, "attended", "attended"),
      actorId: String(instructorId),
      actorRole: "instructor",
    });
    expect(early.pairedFinalizations).toMatchObject([{ status: "pending" }]);
    let [sessionAfter] = await db.select().from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, prestart.session.id));
    expect(sessionAfter.status).toBe("paired");

    await db.update(classes).set(schoolLocalSchedule(-5))
      .where(eq(classes.id, prestart.classId));
    const completed = await saveAttendanceWithPairing({
      updates: [{ enrollmentId: prestart.session.enrollmentIdA!, attendanceStatus: "attended" }],
      actorId: String(instructorId),
      actorRole: "instructor",
    });
    expect(completed.pairedFinalizations).toMatchObject([{ status: "completed" }]);
    [sessionAfter] = await db.select().from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, prestart.session.id));
    expect(sessionAfter.status).toBe("completed");
  });

  it("serializes concurrent/retried finalization without duplicate 11/14 credit", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    const params = {
      updates: pairedAttendanceUpdates(session, "attended", "absent"),
      actorId: String(adminUserId),
      actorRole: "admin",
    };
    const [first, retry] = await Promise.all([
      saveAttendanceWithPairing(params),
      saveAttendanceWithPairing(params),
    ]);
    const generated = [...first.pairedFinalizations, ...retry.pairedFinalizations]
      .flatMap((row) => row.newClassIds ?? []);
    createdClassIds.push(...generated);
    expect(await convertedLessons(booker)).toHaveLength(2);
    expect([first, retry].flatMap((row) => row.pairedFinalizations)
      .filter((row) => row.status === "converted")).toHaveLength(1);
  });

  it("preserves completed 11/14 credit and creates only the missing lesson", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    const existing11 = await createCombinedClass({
      classNumber: 11,
      duration: 60,
      maxStudents: 1,
    });
    await db.insert(classEnrollments).values({
      classId: existing11,
      studentId: booker,
      attendanceStatus: "attended",
    });
    const result = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "no-show"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    expect(result.pairedFinalizations).toMatchObject([{
      status: "converted",
      preservedClassNumbers: [11],
    }]);
    createdClassIds.push(...(result.pairedFinalizations[0].newClassIds ?? []));
    expect((await convertedLessons(booker)).map((row) => row.classNumber).sort())
      .toEqual([11, 14]);
  });

  it("preserves both preexisting attended 11/14 credits without requiring a generated class", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    for (const classNumber of [11, 14]) {
      const existingClass = await createCombinedClass({
        classNumber,
        duration: 60,
        maxStudents: 1,
      });
      await db.insert(classEnrollments).values({
        classId: existingClass,
        studentId: booker,
        attendanceStatus: "attended",
      });
    }

    const result = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "no-show"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    expect(result.pairedFinalizations).toMatchObject([{
      status: "converted",
      newClassIds: [],
      newEnrollmentIds: [],
    }]);
    expect(result.pairedFinalizations[0].preservedClassNumbers?.sort()).toEqual([11, 14]);
    const [sessionAfter] = await db.select().from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, session.id));
    expect(sessionAfter.status).toBe("dissolved");
  });

  it("serializes simultaneous single-row A/B saves without deadlock or partial finalization", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    const [a, b] = await Promise.all([
      saveAttendanceWithPairing({
        updates: [{ enrollmentId: session.enrollmentIdA!, changes: { attendanceStatus: "attended" } }],
        actorId: String(adminUserId),
        actorRole: "admin",
      }),
      saveAttendanceWithPairing({
        updates: [{ enrollmentId: session.enrollmentIdB!, changes: { attendanceStatus: "absent" } }],
        actorId: String(adminUserId),
        actorRole: "admin",
      }),
    ]);
    createdClassIds.push(
      ...[a, b].flatMap((result) =>
        result.pairedFinalizations.flatMap((outcome) => outcome.newClassIds ?? []),
      ),
    );
    expect([a, b].flatMap((result) => result.pairedFinalizations)
      .filter((outcome) => outcome.status === "converted")).toHaveLength(1);
    expect((await convertedLessons(booker)).filter((row) => row.cancelledAt == null))
      .toHaveLength(2);
    const [sessionAfter] = await db.select().from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, session.id));
    expect(sessionAfter.status).toBe("dissolved");
  });

  it("rolls all attendance back when an active 11/14 booking conflicts", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    const existing14 = await createCombinedClass({
      classNumber: 14,
      duration: 60,
      maxStudents: 1,
    });
    await db.insert(classEnrollments).values({
      classId: existing14,
      studentId: booker,
      attendanceStatus: "registered",
    });
    await expect(saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "absent"),
      actorId: String(adminUserId),
      actorRole: "admin",
      classUpdate: {
        classId: session.classId,
        changes: {
          status: "completed",
          attendanceSignature: "must-roll-back",
        },
      },
    })).rejects.toThrow(/unrelated active booking/i);
    expect((await attendanceRows(session)).map((row) => row.attendanceStatus))
      .toEqual(["registered", "registered"]);
    const [pairedClass] = await db.select().from(classes)
      .where(eq(classes.id, session.classId));
    expect(pairedClass).toMatchObject({
      status: "scheduled",
      attendanceSignature: null,
    });
  });

  it("safely reverses a conversion on correction and fixes admin/student progress", async () => {
    const { booker, waiting, session } = await seedPairedSessionForAttendance();
    const converted = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "absent"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    createdClassIds.push(...(converted.pairedFinalizations[0].newClassIds ?? []));

    const corrected = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "attended"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    expect(corrected.pairedFinalizations).toMatchObject([{ status: "completed" }]);
    for (const studentId of [booker, waiting]) {
      expect(await phaseProgressFor(studentId)).toMatchObject({
        twelve: { isCompleted: true },
        thirteen: { isCompleted: true },
      });
      expect(await adminPhaseProgressFor(studentId)).toMatchObject({
        twelve: { isCompleted: true },
        thirteen: { isCompleted: true },
      });
    }
    expect((await convertedLessons(booker)).every((row) => row.cancelledAt != null)).toBe(true);
  });

  it("moves solo credit to the newly attending student across repeated swapped corrections", async () => {
    const { booker, waiting, session } = await seedPairedSessionForAttendance();
    const first = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "absent"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    createdClassIds.push(...(first.pairedFinalizations[0].newClassIds ?? []));

    const swapped = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "absent", "attended"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    createdClassIds.push(...(swapped.pairedFinalizations[0].newClassIds ?? []));
    expect(swapped.pairedFinalizations).toMatchObject([{
      status: "converted",
      presentEnrollmentId: session.enrollmentIdB,
    }]);
    expect((await convertedLessons(booker)).filter((row) => row.cancelledAt == null))
      .toHaveLength(0);
    expect((await convertedLessons(waiting)).filter((row) => row.cancelledAt == null))
      .toHaveLength(2);

    const swappedBack = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "no-show"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    createdClassIds.push(...(swappedBack.pairedFinalizations[0].newClassIds ?? []));
    expect(swappedBack.pairedFinalizations).toMatchObject([{
      status: "converted",
      presentEnrollmentId: session.enrollmentIdA,
    }]);
    expect((await convertedLessons(waiting)).filter((row) => row.cancelledAt == null))
      .toHaveLength(0);
    expect((await convertedLessons(booker)).filter((row) => row.cancelledAt == null))
      .toHaveLength(2);
  });

  it("rejects an old-pair correction after its absent student has paired in a new slot", async () => {
    const { waiting, session } = await seedPairedSessionForAttendance();
    const converted = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "absent"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    createdClassIds.push(...(converted.pairedFinalizations[0].newClassIds ?? []));

    const nextBooker = await createStudent();
    const laterClass = await createCombinedClass();
    expect((await bookCombinedSlot({ studentId: nextBooker, classId: laterClass })).success)
      .toBe(true);
    const [nextOffer] = await pendingOffersFor(laterClass);
    expect(nextOffer.studentId).toBe(waiting);
    const nextPair = await respondToOffer({
      offerId: nextOffer.id,
      studentId: waiting,
      response: "accept",
    });
    expect(nextPair.success).toBe(true);

    await expect(saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "attended"),
      actorId: String(adminUserId),
      actorRole: "admin",
    })).rejects.toThrow(/queue entry|paired|reconcile/i);

    const oldRows = new Map((await attendanceRows(session)).map((row) => [row.id, row]));
    // Conversion preserves the exact submitted attendance value and uses
    // cancelledAt (not a fabricated absence) to suppress paired 12/13 credit.
    expect(oldRows.get(session.enrollmentIdA!)?.attendanceStatus).toBe("attended");
    expect(oldRows.get(session.enrollmentIdA!)?.cancelledAt).not.toBeNull();
    expect(oldRows.get(session.enrollmentIdB!)?.attendanceStatus).toBe("absent");
    const [newSession] = await db.select().from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, nextPair.pairedSessionId!));
    expect(newSession.status).toBe("paired");
    expect((await queueEntryFor(waiting)).at(-1)?.status).toBe("paired");
  });

  it("rejects malformed enrollment linkage and rolls the requested write back", async () => {
    const { session } = await seedPairedSessionForAttendance();
    const unrelatedStudent = await createStudent();
    const unrelatedClass = await createCombinedClass();
    const [unrelatedEnrollment] = await db.insert(classEnrollments).values({
      classId: unrelatedClass,
      studentId: unrelatedStudent,
      attendanceStatus: "registered",
    }).returning();
    await db.update(incarPairedSessions)
      .set({ enrollmentIdB: unrelatedEnrollment.id })
      .where(eq(incarPairedSessions.id, session.id));

    await expect(saveAttendanceWithPairing({
      updates: [
        { enrollmentId: session.enrollmentIdA!, attendanceStatus: "attended" },
        { enrollmentId: unrelatedEnrollment.id, attendanceStatus: "attended" },
      ],
      actorId: String(adminUserId),
      actorRole: "admin",
    })).rejects.toThrow(/link|enrollment|paired session/i);
    const [original] = await db.select().from(classEnrollments)
      .where(eq(classEnrollments.id, session.enrollmentIdA!));
    const [unrelated] = await db.select().from(classEnrollments)
      .where(eq(classEnrollments.id, unrelatedEnrollment.id));
    expect(original.attendanceStatus).toBe("registered");
    expect(unrelated.attendanceStatus).toBe("registered");
  });

  it("does not complete a pair whose partner enrollment is cancelled", async () => {
    const { session } = await seedPairedSessionForAttendance();
    await db.update(classEnrollments).set({ cancelledAt: new Date() })
      .where(eq(classEnrollments.id, session.enrollmentIdB!));

    await expect(saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "attended"),
      actorId: String(adminUserId),
      actorRole: "admin",
    })).rejects.toThrow(/cancelled|active enrollment|link/i);
    const rows = await attendanceRows(session);
    expect(rows.map((row) => row.attendanceStatus)).toEqual(["registered", "registered"]);
    const [sessionAfter] = await db.select().from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, session.id));
    expect(sessionAfter.status).toBe("paired");
  });

  it("does not let a lifecycle sweep overwrite a concurrent attendance correction", async () => {
    const { booker, waiting, session } = await seedPairedSessionForAttendance();
    await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "attended"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });

    const [corrected] = await Promise.all([
      saveAttendanceWithPairing({
        updates: pairedAttendanceUpdates(session, "attended", "absent"),
        actorId: String(adminUserId),
        actorRole: "admin",
      }),
      processPairingLifecycle(),
    ]);
    createdClassIds.push(...(corrected.pairedFinalizations[0].newClassIds ?? []));
    const [sessionAfter] = await db.select().from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, session.id));
    expect(sessionAfter.status).toBe("dissolved");
    expect((await queueEntryFor(booker)).at(-1)?.status).toBe("converted_solo");
    expect((await queueEntryFor(waiting)).at(-1)?.status).toBe("waiting");
  });

  it("emits no conversion notification when a later session conflict rolls back a multi-session save", async () => {
    const first = await seedPairedSessionForAttendance();
    const second = await seedPairedSessionForAttendance();
    const conflicting11 = await createCombinedClass({
      classNumber: 11,
      duration: 60,
      maxStudents: 1,
    });
    await db.insert(classEnrollments).values({
      classId: conflicting11,
      studentId: second.booker,
      attendanceStatus: "registered",
    });
    vi.mocked(enqueueNotification).mockClear();

    await expect(saveAttendanceWithPairing({
      updates: [
        ...pairedAttendanceUpdates(first.session, "attended", "absent"),
        ...pairedAttendanceUpdates(second.session, "attended", "absent"),
      ],
      actorId: String(adminUserId),
      actorRole: "admin",
    })).rejects.toThrow(/unrelated active booking/i);
    // Notification delivery is asynchronous; let an incorrectly queued
    // post-conversion task reach the mock before asserting.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(vi.mocked(enqueueNotification).mock.calls.filter(
      ([notification]) => notification.type === "incar_lesson_converted",
    )).toHaveLength(0);
    for (const seeded of [first, second]) {
      expect((await attendanceRows(seeded.session)).map((row) => row.attendanceStatus))
        .toEqual(["registered", "registered"]);
      const [sessionAfter] = await db.select().from(incarPairedSessions)
        .where(eq(incarPairedSessions.id, seeded.session.id));
      expect(sessionAfter.status).toBe("paired");
    }
  });

  it("lets the missed student reuse its queue entry in a later bookCombinedSlot", async () => {
    const { waiting, session } = await seedPairedSessionForAttendance();
    const result = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "no-show"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    createdClassIds.push(...(result.pairedFinalizations[0].newClassIds ?? []));
    expect((await queueEntryFor(waiting)).at(-1)?.status).toBe("waiting");

    const laterClass = await createCombinedClass();
    const booked = await bookCombinedSlot({ studentId: waiting, classId: laterClass });
    expect(booked.success).toBe(true);
    const active = (await queueEntryFor(waiting)).filter((row) =>
      ["waiting", "offered", "booked_first", "paired"].includes(row.status));
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ status: "booked_first", bookedClassId: laterClass });
  });

  it("lets the attending converted student make a later exact booking too", async () => {
    const { booker, session } = await seedPairedSessionForAttendance();
    const result = await saveAttendanceWithPairing({
      updates: pairedAttendanceUpdates(session, "attended", "absent"),
      actorId: String(adminUserId),
      actorRole: "admin",
    });
    createdClassIds.push(...(result.pairedFinalizations[0].newClassIds ?? []));
    expect((await queueEntryFor(booker)).at(-1)?.status).toBe("converted_solo");

    const laterClass = await createCombinedClass();
    const booked = await bookCombinedSlot({ studentId: booker, classId: laterClass });
    expect(booked.success).toBe(true);
    const active = (await queueEntryFor(booker)).filter((row) =>
      ["waiting", "offered", "booked_first", "paired"].includes(row.status));
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ status: "booked_first", bookedClassId: laterClass });
  });
});

describe("convertPresentStudentToSolo (live DB)", () => {
  it("exposes the two-lesson conversion through the authenticated API", async () => {
    const { session } = await seedStartedPairedSession();

    const response = await request(app)
      .post(`/api/lesson-pairing/sessions/${session.id}/convert`)
      .set("Cookie", adminCookie)
      .send({
        presentEnrollmentId: session.enrollmentIdA,
        targetLessonNumber: 11,
      });

    expect(response.status).toBe(200);
    expect(response.body.newClassIds).toHaveLength(2);
    expect(response.body.newEnrollmentIds).toHaveLength(2);
  });

  it("atomically records attended In-Car 11 followed by In-Car 14", async () => {
    const { waiting, booker, session } = await seedStartedPairedSession();

    const result = await convertPresentStudentToSolo({
      pairedSessionId: session.id,
      presentEnrollmentId: session.enrollmentIdA!,
    });

    expect(result.success).toBe(true);
    expect(result.newClassIds).toHaveLength(2);
    expect(result.newEnrollmentIds).toHaveLength(2);

    const lessons = await db
      .select({
        classNumber: classes.classNumber,
        time: classes.time,
        duration: classes.duration,
        attendanceStatus: classEnrollments.attendanceStatus,
      })
      .from(classEnrollments)
      .innerJoin(classes, eq(classEnrollments.classId, classes.id))
      .where(
        and(
          eq(classEnrollments.studentId, booker),
          inArray(classes.id, result.newClassIds!),
        ),
      );
    expect(lessons).toEqual([
      { classNumber: 11, time: "10:00", duration: 60, attendanceStatus: "attended" },
      { classNumber: 14, time: "11:00", duration: 60, attendanceStatus: "attended" },
    ]);

    const [original] = await db
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.id, session.enrollmentIdA!));
    expect(original.cancelledAt).not.toBeNull();

    const [absentEntry] = await queueEntryFor(waiting);
    expect(absentEntry.status).toBe("waiting");
    expect(absentEntry.priority).toBe(100);
  });

  it("allows only one winner when two conversion requests run together", async () => {
    const { booker, session } = await seedStartedPairedSession();

    const results = await Promise.all([
      convertPresentStudentToSolo({
        pairedSessionId: session.id,
        presentEnrollmentId: session.enrollmentIdA!,
      }),
      convertPresentStudentToSolo({
        pairedSessionId: session.id,
        presentEnrollmentId: session.enrollmentIdA!,
      }),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    const creditedLessons = await db
      .select({ classNumber: classes.classNumber })
      .from(classEnrollments)
      .innerJoin(classes, eq(classEnrollments.classId, classes.id))
      .where(
        and(
          eq(classEnrollments.studentId, booker),
          inArray(classes.classNumber, [11, 14]),
          eq(classes.classType, "driving"),
          eq(classEnrollments.attendanceStatus, "attended"),
          isNull(classEnrollments.cancelledAt),
        ),
      );
    expect(creditedLessons.map((row) => row.classNumber).sort()).toEqual([11, 14]);
  });

  it("rolls back the cancellation and first lesson if the second lesson fails", async () => {
    const { booker, session } = await seedStartedPairedSession();

    await expect(
      convertPresentStudentToSolo({
        pairedSessionId: session.id,
        presentEnrollmentId: session.enrollmentIdA!,
        testHooks: {
          beforeSecondLesson: async () => {
            throw new Error("forced second lesson failure");
          },
        },
      }),
    ).rejects.toThrow("forced second lesson failure");

    const [original] = await db
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.id, session.enrollmentIdA!));
    expect(original.cancelledAt).toBeNull();
    expect(original.attendanceStatus).toBe("attended");

    const createdLessons = await db
      .select({ id: classes.id })
      .from(classEnrollments)
      .innerJoin(classes, eq(classEnrollments.classId, classes.id))
      .where(
        and(
          eq(classEnrollments.studentId, booker),
          inArray(classes.classNumber, [11, 14]),
          eq(classes.classType, "driving"),
        ),
      );
    expect(createdLessons).toHaveLength(0);

    const [sessionAfter] = await db
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, session.id));
    expect(sessionAfter.status).toBe("paired");
  });
});

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
  it("keeps the notification offer acceptable through a pre-start sweep and HTTP accept", async () => {
    const waiting = await createStudent();
    const booker = await createStudent();
    const classId = await createCombinedClass(schoolLocalSchedule(5));
    await joinCombinedQueue({ studentId: waiting });
    const booked = await bookCombinedSlot({ studentId: booker, classId });
    expect(booked.success).toBe(true);
    const [offer] = await pendingOffersFor(classId);

    await vi.waitFor(() => {
      const notification = vi.mocked(enqueueNotification).mock.calls
        .map(([input]) => input)
        .find((input) =>
          input.type === "incar_pairing_offer" &&
          input.payload?.offerId === offer.id
        );
      expect(notification?.payload?.offerId).toBe(offer.id);
    });

    await processPairingLifecycle();

    const [offerAfterSweep] = await db
      .select()
      .from(incarPairingOffers)
      .where(eq(incarPairingOffers.id, offer.id));
    const [bookerAfterSweep] = await queueEntryFor(booker);
    const [recipientAfterSweep] = await queueEntryFor(waiting);
    expect(offerAfterSweep.status).toBe("pending");
    expect(offerAfterSweep.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(bookerAfterSweep.status).toBe("booked_first");
    expect(recipientAfterSweep.status).toBe("offered");

    const response = await request(app)
      .post(`/api/student/lesson-pairing/offers/${offer.id}/respond`)
      .set("Authorization", `Bearer ${generateStudentToken(waiting)}`)
      .send({ action: "accept" });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const sessions = await db
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.classId, classId));
    expect(sessions).toHaveLength(1);
    expect(await activeEnrollments(classId)).toHaveLength(2);

    const duplicate = await request(app)
      .post(`/api/student/lesson-pairing/offers/${offer.id}/respond`)
      .set("Authorization", `Bearer ${generateStudentToken(waiting)}`)
      .send({ action: "accept" });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.pairedSessionId).toBe(sessions[0].id);
    expect(await activeEnrollments(classId)).toHaveLength(2);
  }, 30_000);

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