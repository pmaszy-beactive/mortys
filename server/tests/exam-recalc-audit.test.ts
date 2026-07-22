import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// Never send real emails/in-app notifications from tests.
vi.mock("../services/notifications", () => ({
  notifyScheduleChange: vi.fn(async () => {}),
  notifyClassCancelled: vi.fn(async () => {}),
  notifySeriesDayMove: vi.fn(async () => {}),
  notifySeriesDayRemoved: vi.fn(async () => {}),
  notifySeriesDaysActionNeeded: vi.fn(async () => 123),
  notifyScrapeFailure: vi.fn(async () => {}),
  notifyScrapeRecovered: vi.fn(async () => {}),
  notifyAutoEnrollFailed: vi.fn(async () => {}),
  notifyStartDateChange: vi.fn(async () => {}),
}));

import { registerRoutes } from "../routes";
import { db } from "../db";
import { storage } from "../storage";
import { students, users, examAttempts, examRecalcLogs } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { FIRST_ATTEMPT_CODE, EXAM_TESTS } from "@shared/examData";

const TEST_TAG = `examrecalc-${Date.now()}`;
const STUDENT_EMAIL = `${TEST_TAG}-student@example.test`;
const ADMIN_EMAIL = `${TEST_TAG}-admin@example.test`;
const PASSWORD = "test-password-123";

let app: express.Express;
let adminCookie: string;
let studentId: number;
let adminUserId: string;
const attemptIds: number[] = [];
const logIds: number[] = [];

const TOTAL = EXAM_TESTS[FIRST_ATTEMPT_CODE].questionCount;

/** Answers with exactly `n` correct on the first-attempt test. */
function answersWithCorrect(n: number): Record<string, string> {
  const key = EXAM_TESTS[FIRST_ATTEMPT_CODE].answerKey;
  const answers: Record<string, string> = {};
  for (let q = 1; q <= TOTAL; q++) {
    const correct = key[q];
    answers[String(q)] = q <= n ? correct : correct === "A" ? "B" : "A";
  }
  return answers;
}

async function createStaleAttempt() {
  const [row] = await db
    .insert(examAttempts)
    .values({
      studentId,
      classId: null,
      testCode: FIRST_ATTEMPT_CODE,
      attemptNumber: 1,
      status: "submitted",
      answers: answersWithCorrect(TOTAL),
      flaggedQuestions: [],
      integrityAgreed: true,
      integrityName: "Test Student",
      integrityDeclaredAt: new Date(),
      startedAt: new Date(),
      submittedAt: new Date(),
      resultsVisibleAt: new Date(Date.now() - 60 * 60 * 1000),
      score: 0,
      passed: false,
      correctCount: 0,
      totalQuestions: TOTAL,
    } as any)
    .returning();
  attemptIds.push(row.id);
  return row;
}

const asAdmin = (req: request.Test) =>
  req.set("Cookie", adminCookie).set("X-Forwarded-Proto", "https");

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
  await registerRoutes(app);

  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash(PASSWORD, 10);

  const [student] = await db
    .insert(students)
    .values({
      firstName: "Exam",
      lastName: `Recalc-${TEST_TAG}`,
      email: STUDENT_EMAIL,
      phone: "514-555-0100",
      dateOfBirth: "2005-01-01",
      address: "1 Test St",
      courseType: "auto",
      emergencyContact: "Test Parent",
      emergencyPhone: "514-555-0101",
      password: hash,
      accountStatus: "active",
    } as any)
    .returning();
  studentId = student.id;

  const [admin] = await db
    .insert(users)
    .values({
      email: ADMIN_EMAIL,
      firstName: "Audit",
      lastName: `Admin-${TEST_TAG}`,
      role: "admin",
      password: hash,
    } as any)
    .returning();
  adminUserId = admin.id;

  const adminLogin = await request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-Proto", "https")
    .send({ username: ADMIN_EMAIL, password: PASSWORD });
  expect(adminLogin.status).toBe(200);
  adminCookie = adminLogin.headers["set-cookie"]!.map((c: string) => c.split(";")[0]).join("; ");
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (attemptIds.length) {
    await db.delete(examAttempts).where(inArray(examAttempts.id, attemptIds));
  }
  if (logIds.length) {
    await db.delete(examRecalcLogs).where(inArray(examRecalcLogs.id, logIds));
  }
  await db.delete(examRecalcLogs).where(eq(examRecalcLogs.adminId, adminUserId));
  await db.delete(students).where(eq(students.email, STUDENT_EMAIL));
  await db.delete(users).where(eq(users.id, adminUserId));
});

describe("Exam recalculation audit trail", () => {
  it("a successful recalculation run persists exactly one audit log entry with admin identity and changes", async () => {
    const attempt = await createStaleAttempt();

    const res = await asAdmin(request(app).post("/api/admin/exam-attempts/recalculate"));
    expect(res.status).toBe(200);
    expect(res.body.corrected).toBeGreaterThanOrEqual(1);

    const logs = await db.select().from(examRecalcLogs).where(eq(examRecalcLogs.adminId, adminUserId));
    expect(logs.length).toBe(1);
    logIds.push(...logs.map((l) => l.id));
    const log = logs[0];
    expect(log.adminEmail).toBe(ADMIN_EMAIL);
    expect(log.adminName).toContain("Audit");
    expect(log.checkedCount).toBeGreaterThanOrEqual(1);
    expect(log.correctedCount).toBe(res.body.corrected);
    const changes = JSON.parse(log.changes || "[]");
    const mine = changes.find((c: any) => c.attemptId === attempt.id);
    expect(mine).toBeTruthy();
    expect(mine.before.score).toBe(0);
    expect(mine.after.score).toBe(100);

    // The attempt itself was actually corrected.
    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.score).toBe(100);
    expect(row.passed).toBe(true);

    // The admin history endpoint returns this run with parsed changes.
    const history = await asAdmin(request(app).get("/api/admin/exam-recalc-logs"));
    expect(history.status).toBe(200);
    const entry = history.body.find((l: any) => l.id === log.id);
    expect(entry).toBeTruthy();
    expect(Array.isArray(entry.changes)).toBe(true);
  });

  it("a failed audit write fails the whole run — no unaudited score corrections", async () => {
    const attempt = await createStaleAttempt();

    const spy = vi
      .spyOn(storage, "applyExamRecalcWithAudit")
      .mockRejectedValueOnce(new Error("simulated audit write failure"));

    const res = await asAdmin(request(app).post("/api/admin/exam-attempts/recalculate"));
    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(500);

    // Score must NOT have been corrected without an audit record.
    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.score).toBe(0);
    expect(row.passed).toBe(false);
  });

  it("history endpoint requires admin auth", async () => {
    const res = await request(app)
      .get("/api/admin/exam-recalc-logs")
      .set("X-Forwarded-Proto", "https");
    expect(res.status).toBe(401);
  });
});
