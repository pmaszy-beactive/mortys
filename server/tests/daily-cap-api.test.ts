/**
 * End-to-end tests for the 3-hour daily cap (max_hours_per_day) through the
 * real HTTP routes. Task: confirm the four entry points that assemble
 * sameDayAlreadyBookedMinutes / sameDayAlreadyBookedHasDriving in
 * server/routes.ts wire the rule correctly:
 *
 *   1. student booking      POST /api/student/classes/:classId/book
 *   2. student reschedule   POST /api/student/classes/:enrollmentId/reschedule
 *   3. available-classes    GET  /api/student/classes/available (flags)
 *   4. admin enrollment     POST /api/class-enrollments
 *
 * Also verifies cancelled enrollments do NOT consume daily minutes.
 *
 * Runs against the real dev database; all rows are created with unique
 * markers and removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { registerRoutes } from "../routes";
import { db } from "../db";
import { students, classes, classEnrollments, users } from "@shared/schema";
import { generateStudentToken } from "../student-auth";

const MARK = `dailycap-${Date.now()}`;

// Near-future dates: far enough out that nothing has "started" and no
// reschedule fee applies, but inside the 13-month available-classes window.
function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
const DAY = isoDaysFromNow(45);
const OTHER_DAY = isoDaysFromNow(46);

let app: express.Express;
let studentA: { id: number; token: string };
let studentB: { id: number; token: string };
let adminCookie: string;

let drivingClassA: number; // 2h in-car on DAY (student A enrolled)
let drivingClassB: number; // 2h in-car on DAY (student B enrolled)
let theoryClassSameDay: number; // theory #1 on DAY
let theoryClassOtherDay: number; // theory #1 on OTHER_DAY (student B enrolled, to be moved)
let drivingEnrollmentA: number;
const createdClassIds: number[] = [];
const createdStudentIds: number[] = [];
const createdEnrollmentIds: number[] = [];
let adminUserId: string | null = null;

async function makeStudent(suffix: string) {
  const [row] = await db
    .insert(students)
    .values({
      firstName: "DailyCap",
      lastName: suffix,
      email: `${MARK}-${suffix}@example.test`,
      phone: "555-000-0000",
      dateOfBirth: "2005-01-01",
      address: "1 Test St",
      courseType: "auto",
      emergencyContact: "EC",
      emergencyPhone: "555-000-0001",
      accountStatus: "active",
    } as any)
    .returning({ id: students.id });
  createdStudentIds.push(row.id);
  return { id: row.id, token: generateStudentToken(row.id) };
}

async function makeClass(v: {
  classType: "theory" | "driving";
  classNumber: number;
  date: string;
  time: string;
  duration: number;
}) {
  const [row] = await db
    .insert(classes)
    .values({
      courseType: "auto",
      classType: v.classType,
      classNumber: v.classNumber,
      date: v.date,
      time: v.time,
      duration: v.duration,
      maxStudents: 10,
      status: "scheduled",
      topic: MARK,
    } as any)
    .returning({ id: classes.id });
  createdClassIds.push(row.id);
  return row.id;
}

async function enroll(studentId: number, classId: number) {
  const [row] = await db
    .insert(classEnrollments)
    .values({ studentId, classId, attendanceStatus: "registered" } as any)
    .returning({ id: classEnrollments.id });
  createdEnrollmentIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "10mb" }));
  await registerRoutes(app);

  studentA = await makeStudent("alpha");
  studentB = await makeStudent("beta");

  // Each student holds a scheduled 2-hour in-car lesson on DAY.
  drivingClassA = await makeClass({ classType: "driving", classNumber: 5, date: DAY, time: "09:00", duration: 120 });
  drivingClassB = await makeClass({ classType: "driving", classNumber: 5, date: DAY, time: "10:00", duration: 120 });
  theoryClassSameDay = await makeClass({ classType: "theory", classNumber: 1, date: DAY, time: "14:00", duration: 120 });
  theoryClassOtherDay = await makeClass({ classType: "theory", classNumber: 1, date: OTHER_DAY, time: "14:00", duration: 120 });

  drivingEnrollmentA = await enroll(studentA.id, drivingClassA);
  await enroll(studentB.id, drivingClassB);
  // Student B also holds theory #1 on OTHER_DAY — the enrollment we try to move.
  await enroll(studentB.id, theoryClassOtherDay);

  // Admin user (session-based traditional auth in dev).
  const [admin] = await db
    .insert(users)
    .values({
      email: `${MARK}-admin@example.test`,
      firstName: "DailyCap",
      lastName: "Admin",
      role: "admin",
      password: await bcrypt.hash("dailycap-pw", 10),
    } as any)
    .returning({ id: users.id, email: users.email });
  adminUserId = admin.id;

  const login = await request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-Proto", "https")
    .send({ username: admin.email, password: "dailycap-pw" });
  expect(login.status).toBe(200);
  const setCookie = login.headers["set-cookie"];
  expect(setCookie?.length).toBeGreaterThan(0);
  // Cookie is flagged Secure in the Replit workspace; extract and resend manually.
  adminCookie = setCookie![0].split(";")[0];
}, 60000);

afterAll(async () => {
  if (createdEnrollmentIds.length)
    await db.delete(classEnrollments).where(inArray(classEnrollments.id, createdEnrollmentIds));
  if (createdClassIds.length) {
    // Any enrollments the tests created through the API
    await db.delete(classEnrollments).where(inArray(classEnrollments.classId, createdClassIds));
    await db.delete(classes).where(inArray(classes.id, createdClassIds));
  }
  if (createdStudentIds.length)
    await db.delete(students).where(inArray(students.id, createdStudentIds));
  if (adminUserId) await db.delete(users).where(eq(users.id, adminUserId));
});

describe("3-hour daily cap through the real API", () => {
  it("student booking route rejects a same-day theory class after a 2h in-car lesson", async () => {
    const res = await request(app)
      .post(`/api/student/classes/${theoryClassSameDay}/book`)
      .set("Authorization", `Bearer ${studentA.token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.policyViolation).toBe("max_hours_per_day");
    expect(res.body.message).toMatch(/3 hours/i);
  });

  it("available-classes flags the same-day theory class as blocked by the hours cap", async () => {
    const res = await request(app)
      .get("/api/student/classes/available")
      .set("Authorization", `Bearer ${studentA.token}`);
    expect(res.status).toBe(200);
    const sameDay = res.body.classes.find((c: any) => c.id === theoryClassSameDay);
    expect(sameDay).toBeTruthy();
    expect(sameDay.bookingAllowed).toBe(false);
    expect(sameDay.blockingRule).toBe("max_hours_per_day");

    // Sanity: the other-day theory class is NOT blocked by the hours cap.
    const otherDay = res.body.classes.find((c: any) => c.id === theoryClassOtherDay);
    expect(otherDay).toBeTruthy();
    expect(otherDay.blockingRule).not.toBe("max_hours_per_day");
  });

  it("admin enrollment route rejects a same-day theory enrollment", async () => {
    const res = await request(app)
      .post("/api/class-enrollments")
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", adminCookie)
      .send({ studentId: studentA.id, classId: theoryClassSameDay });
    expect(res.status).toBe(400);
    expect(res.body.policyViolation).toBe("max_hours_per_day");
  });

  it("reschedule route rejects moving a theory class onto the in-car day", async () => {
    const enrollment = await db
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.classId, theoryClassOtherDay));
    const enrollmentId = enrollment.find((e) => e.studentId === studentB.id)!.id;

    const res = await request(app)
      .post(`/api/student/classes/${enrollmentId}/reschedule`)
      .set("Authorization", `Bearer ${studentB.token}`)
      .send({ newClassId: theoryClassSameDay });
    expect(res.status).toBe(400);
    expect(res.body.policyViolation).toBe("max_hours_per_day");
  });

  it("cancelled in-car enrollments do not consume daily minutes", async () => {
    // Cancel student A's 2h in-car lesson…
    await db
      .update(classEnrollments)
      .set({ cancelledAt: new Date() } as any)
      .where(eq(classEnrollments.id, drivingEnrollmentA));

    // …the available-classes flag clears…
    const avail = await request(app)
      .get("/api/student/classes/available")
      .set("Authorization", `Bearer ${studentA.token}`);
    expect(avail.status).toBe(200);
    const sameDay = avail.body.classes.find((c: any) => c.id === theoryClassSameDay);
    expect(sameDay?.blockingRule).not.toBe("max_hours_per_day");

    // …and the same-day theory booking now succeeds end-to-end.
    const res = await request(app)
      .post(`/api/student/classes/${theoryClassSameDay}/book`)
      .set("Authorization", `Bearer ${studentA.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.enrollment?.id).toBeTruthy();
    if (res.body.enrollment?.id) createdEnrollmentIds.push(res.body.enrollment.id);
  });
});
