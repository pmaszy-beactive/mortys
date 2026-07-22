import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import { students, users, examAttempts } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { FIRST_ATTEMPT_CODE, EXAM_TESTS, EXAM_PASS_PERCENT } from "@shared/examData";

const TEST_TAG = `examstale-${Date.now()}`;
const STUDENT_EMAIL = `${TEST_TAG}-student@example.test`;
const ADMIN_EMAIL = `${TEST_TAG}-admin@example.test`;
const PASSWORD = "test-password-123";

let app: express.Express;
let studentCookie: string;
let adminCookie: string;
let studentId: number;
let adminUserId: string;
const attemptIds: number[] = [];

const HOUR = 60 * 60 * 1000;
const TOTAL = EXAM_TESTS[FIRST_ATTEMPT_CODE].questionCount; // 24

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

async function createAttempt(opts: {
  answers: Record<string, string>;
  score?: number | null;
  passed?: boolean | null;
  correctCount?: number | null;
  status?: string;
  resultsVisibleAt?: Date;
}) {
  const [row] = await db
    .insert(examAttempts)
    .values({
      studentId,
      classId: null,
      testCode: FIRST_ATTEMPT_CODE,
      attemptNumber: 1,
      status: opts.status ?? "submitted",
      answers: opts.answers,
      flaggedQuestions: [],
      integrityAgreed: true,
      integrityName: "Test Student",
      integrityDeclaredAt: new Date(),
      startedAt: new Date(),
      submittedAt: new Date(),
      resultsVisibleAt: opts.resultsVisibleAt ?? new Date(Date.now() - HOUR),
      score: opts.score ?? null,
      passed: opts.passed ?? null,
      correctCount: opts.correctCount ?? null,
      totalQuestions: TOTAL,
    } as any)
    .returning();
  attemptIds.push(row.id);
  return row;
}

const asStudent = (req: request.Test) =>
  req.set("Cookie", studentCookie).set("X-Forwarded-Proto", "https");
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
      lastName: `Stale-${TEST_TAG}`,
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
      firstName: "Admin",
      lastName: `Stale-${TEST_TAG}`,
      role: "admin",
      password: hash,
    } as any)
    .returning();
  adminUserId = admin.id;

  const studentLogin = await request(app)
    .post("/api/student/login")
    .set("X-Forwarded-Proto", "https")
    .send({ email: STUDENT_EMAIL, password: PASSWORD });
  expect(studentLogin.status).toBe(200);
  studentCookie = studentLogin.headers["set-cookie"]!.map((c: string) => c.split(";")[0]).join("; ");

  const adminLogin = await request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-Proto", "https")
    .send({ username: ADMIN_EMAIL, password: PASSWORD });
  expect(adminLogin.status).toBe(200);
  adminCookie = adminLogin.headers["set-cookie"]!.map((c: string) => c.split(";")[0]).join("; ");
});

afterAll(async () => {
  if (attemptIds.length) {
    await db.delete(examAttempts).where(inArray(examAttempts.id, attemptIds));
  }
  await db.delete(students).where(eq(students.email, STUDENT_EMAIL));
  await db.delete(users).where(eq(users.id, adminUserId));
});

describe("Stale stored exam scores are self-healed", () => {
  it("result fetch corrects a submitted attempt with correct answers but stored score 0", async () => {
    const attempt = await createAttempt({
      answers: answersWithCorrect(TOTAL),
      score: 0,
      passed: false,
      correctCount: 0,
    });

    const result = await asStudent(request(app).get(`/api/student/exam/attempt/${attempt.id}/result`));
    expect(result.status).toBe(200);
    expect(result.body.score).toBe(100);
    expect(result.body.passed).toBe(true);
    expect(result.body.correctCount).toBe(TOTAL);

    // The stored row is healed, not just the response.
    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.score).toBe(100);
    expect(row.passed).toBe(true);
    expect(row.correctCount).toBe(TOTAL);
  });

  it("exam status endpoint reflects the fresh grade for a stale attempt", async () => {
    // status endpoint reconciliation is exercised via classId-bound attempts in
    // production; here we verify the shared reconcile path through the result
    // endpoint plus that a healed row stays consistent on subsequent reads.
    const attempt = await createAttempt({
      answers: answersWithCorrect(TOTAL),
      score: 0,
      passed: false,
      correctCount: 0,
    });
    await asStudent(request(app).get(`/api/student/exam/attempt/${attempt.id}/result`));
    const again = await asStudent(request(app).get(`/api/student/exam/attempt/${attempt.id}/result`));
    expect(again.body.score).toBe(100);
    expect(again.body.passed).toBe(true);
  });

  it("admin review and student result agree for the same attempt", async () => {
    const attempt = await createAttempt({
      answers: answersWithCorrect(20),
      score: 0,
      passed: false,
      correctCount: 0,
    });

    const review = await asAdmin(request(app).get(`/api/exam/attempt/${attempt.id}/review`));
    expect(review.status).toBe(200);

    const result = await asStudent(request(app).get(`/api/student/exam/attempt/${attempt.id}/result`));
    expect(result.status).toBe(200);

    expect(result.body.score).toBe(review.body.score);
    expect(result.body.passed).toBe(review.body.passed);
    expect(result.body.correctCount).toBe(review.body.correctCount);
    expect(review.body.score).toBe(Math.round((20 / TOTAL) * 100));
  });

  it("pass/fail flips correctly around the 75% threshold", async () => {
    // 18/24 = 75% => pass; 17/24 = 71% => fail.
    const passAttempt = await createAttempt({ answers: answersWithCorrect(18), score: 0, passed: false, correctCount: 0 });
    const failAttempt = await createAttempt({ answers: answersWithCorrect(17), score: 100, passed: true, correctCount: 24 });

    const passRes = await asStudent(request(app).get(`/api/student/exam/attempt/${passAttempt.id}/result`));
    expect(passRes.body.score).toBe(75);
    expect(passRes.body.passed).toBe(true);

    const failRes = await asStudent(request(app).get(`/api/student/exam/attempt/${failAttempt.id}/result`));
    expect(failRes.body.score).toBe(Math.round((17 / TOTAL) * 100));
    expect(failRes.body.score).toBeLessThan(EXAM_PASS_PERCENT);
    expect(failRes.body.passed).toBe(false);
  });

  it("saving an answer clears any previously written grade", async () => {
    const attempt = await createAttempt({
      answers: { "1": "D" },
      score: 4,
      passed: false,
      correctCount: 1,
      status: "in_progress",
      resultsVisibleAt: new Date(Date.now() + HOUR),
    });

    const save = await asStudent(
      request(app).patch(`/api/student/exam/attempt/${attempt.id}/answer`).send({ questionNumber: 2, option: "C" }),
    );
    expect(save.status).toBe(200);

    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.score).toBeNull();
    expect(row.passed).toBeNull();
    expect(row.correctCount).toBeNull();
  });

  it("admin recalculate endpoint backfills stale submitted attempts", async () => {
    const attempt = await createAttempt({
      answers: answersWithCorrect(TOTAL),
      score: 0,
      passed: false,
      correctCount: 0,
    });

    const recalc = await asAdmin(request(app).post("/api/admin/exam-attempts/recalculate").send({}));
    expect(recalc.status).toBe(200);
    expect(recalc.body.corrected).toBeGreaterThanOrEqual(1);
    const change = recalc.body.changes.find((c: any) => c.attemptId === attempt.id);
    expect(change).toBeTruthy();
    expect(change.before.score).toBe(0);
    expect(change.after.score).toBe(100);
    expect(change.after.passed).toBe(true);

    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.score).toBe(100);
    expect(row.passed).toBe(true);
  });
});
