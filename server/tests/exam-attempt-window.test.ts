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
import { students, examAttempts } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { FIRST_ATTEMPT_CODE, EXAM_TESTS, EXAM_PASS_PERCENT } from "@shared/examData";

const TEST_TAG = `examwin-${Date.now()}`;
const STUDENT_EMAIL = `${TEST_TAG}-student@example.test`;
const STUDENT_PASSWORD = "test-password-123";

let app: express.Express;
let cookie: string;
let studentId: number;
const attemptIds: number[] = [];

const HOUR = 60 * 60 * 1000;

/** Insert an exam attempt directly, with the given results-visible time. */
async function createAttempt(opts: { resultsVisibleAt: Date; answers?: Record<string, string>; status?: string }) {
  const [row] = await db
    .insert(examAttempts)
    .values({
      studentId,
      classId: null,
      testCode: FIRST_ATTEMPT_CODE,
      attemptNumber: 1,
      status: opts.status ?? "in_progress",
      answers: opts.answers ?? {},
      flaggedQuestions: [],
      integrityAgreed: true,
      integrityName: "Test Student",
      integrityDeclaredAt: new Date(),
      startedAt: new Date(),
      resultsVisibleAt: opts.resultsVisibleAt,
    })
    .returning();
  attemptIds.push(row.id);
  return row;
}

/** Answers that get every question right on the first-attempt test. */
function allCorrectAnswers(): Record<string, string> {
  const key = EXAM_TESTS[FIRST_ATTEMPT_CODE].answerKey;
  const answers: Record<string, string> = {};
  for (const [qn, opt] of Object.entries(key)) answers[qn] = opt;
  return answers;
}

function api() {
  return {
    saveAnswer: (id: number, body: Record<string, unknown>) =>
      request(app)
        .patch(`/api/student/exam/attempt/${id}/answer`)
        .set("Cookie", cookie)
        .set("X-Forwarded-Proto", "https")
        .send(body),
    submit: (id: number) =>
      request(app)
        .post(`/api/student/exam/attempt/${id}/submit`)
        .set("Cookie", cookie)
        .set("X-Forwarded-Proto", "https")
        .send({}),
    reopen: (id: number) =>
      request(app)
        .post(`/api/student/exam/attempt/${id}/reopen`)
        .set("Cookie", cookie)
        .set("X-Forwarded-Proto", "https")
        .send({}),
  };
}

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
  await registerRoutes(app);

  // Seed an active student with a password and log in for a session cookie.
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash(STUDENT_PASSWORD, 10);
  const [student] = await db
    .insert(students)
    .values({
      firstName: "Exam",
      lastName: `Window-${TEST_TAG}`,
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

  const login = await request(app)
    .post("/api/student/login")
    .set("X-Forwarded-Proto", "https")
    .send({ email: STUDENT_EMAIL, password: STUDENT_PASSWORD });
  expect(login.status).toBe(200);
  const setCookie = login.headers["set-cookie"];
  expect(setCookie?.length).toBeGreaterThan(0);
  cookie = setCookie!.map((c: string) => c.split(";")[0]).join("; ");
});

afterAll(async () => {
  if (attemptIds.length) {
    await db.delete(examAttempts).where(inArray(examAttempts.id, attemptIds));
  }
  await db.delete(students).where(eq(students.email, STUDENT_EMAIL));
});

describe("Module 5 exam attempt window enforcement", () => {
  it("inside the window: answer save, submit, and reopen all work", async () => {
    const attempt = await createAttempt({ resultsVisibleAt: new Date(Date.now() + HOUR) });

    const save = await api().saveAnswer(attempt.id, { questionNumber: 1, option: "A" });
    expect(save.status).toBe(200);
    expect(save.body.answers["1"]).toBe("A");

    const submit = await api().submit(attempt.id);
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe("submitted");
    // Results stay hidden while the window is open.
    expect(submit.body.resultsVisible).toBe(false);
    expect(submit.body.score).toBeNull();
    expect(submit.body.passed).toBeNull();

    const reopen = await api().reopen(attempt.id);
    expect(reopen.status).toBe(200);
    expect(reopen.body.status).toBe("in_progress");

    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.status).toBe("in_progress");
  });

  it("after the window: answer save returns 403 and changes nothing", async () => {
    const attempt = await createAttempt({
      resultsVisibleAt: new Date(Date.now() - HOUR),
      answers: { "1": "A" },
    });

    const save = await api().saveAnswer(attempt.id, { questionNumber: 2, option: "B" });
    expect(save.status).toBe(403);

    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.answers).toEqual({ "1": "A" });
  });

  it("after the window: reopen returns 403 and the attempt stays submitted", async () => {
    const attempt = await createAttempt({
      resultsVisibleAt: new Date(Date.now() - HOUR),
      status: "submitted",
    });

    const reopen = await api().reopen(attempt.id);
    expect(reopen.status).toBe(403);

    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.status).toBe("submitted");
  });

  it("after the window: submit still succeeds and grades the saved answers", async () => {
    const attempt = await createAttempt({
      resultsVisibleAt: new Date(Date.now() - HOUR),
      answers: allCorrectAnswers(),
    });

    const submit = await api().submit(attempt.id);
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe("submitted");
    // Window is closed, so results are already visible in the response.
    expect(submit.body.resultsVisible).toBe(true);
    expect(submit.body.score).toBe(100);
    expect(submit.body.passed).toBe(true);

    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.status).toBe("submitted");
    expect(row.score).toBe(100);
    expect(row.passed).toBe(true);
    expect(row.correctCount).toBe(EXAM_TESTS[FIRST_ATTEMPT_CODE].questionCount);
    expect(row.totalQuestions).toBe(EXAM_TESTS[FIRST_ATTEMPT_CODE].questionCount);
    expect(row.submittedAt).not.toBeNull();
  });

  it("after the window: submit with failing answers grades them as failed (not stranded)", async () => {
    const attempt = await createAttempt({
      resultsVisibleAt: new Date(Date.now() - HOUR),
      answers: { "1": "A" }, // first-attempt Q1 correct answer is D
    });

    const submit = await api().submit(attempt.id);
    expect(submit.status).toBe(200);
    expect(submit.body.resultsVisible).toBe(true);
    expect(submit.body.passed).toBe(false);
    expect(submit.body.score).toBeLessThan(EXAM_PASS_PERCENT);

    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attempt.id));
    expect(row.status).toBe("submitted");
    expect(row.passed).toBe(false);
  });
});
