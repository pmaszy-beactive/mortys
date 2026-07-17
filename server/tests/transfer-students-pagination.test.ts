import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";

// Mock notifications so tests never send real emails/in-app notifications.
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
import { students, users } from "@shared/schema";
import { inArray, like } from "drizzle-orm";

const TEST_TAG = `xfertest${Date.now()}`;
const ADMIN_EMAIL = `${TEST_TAG}-admin@example.test`;
const ADMIN_PASSWORD = "test-password-123";
const TOTAL_TRANSFERS = 60;
const PAGE_SIZE = 50;
// Unique previous-school name that appears ONLY in transferredFrom (not in
// name/email/phone), so matches prove the search covers that column.
const SCHOOL_A = `Ecole Alpha ${TEST_TAG}`;
const SCHOOL_B = `Ecole Beta ${TEST_TAG}`;

let app: express.Express;
let cookie: string;
const studentIds: number[] = [];

function getStudents(query: Record<string, string | number>) {
  return request(app)
    .get("/api/students")
    .query(query)
    .set("Cookie", cookie)
    .set("X-Forwarded-Proto", "https");
}

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
  await registerRoutes(app);

  // Seed an admin user and log in for a session cookie.
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await db
    .insert(users)
    .values({ email: ADMIN_EMAIL, firstName: "Test", lastName: "Admin", role: "admin", password: hash });

  const login = await request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-Proto", "https")
    .send({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(login.status).toBe(200);
  const setCookie = login.headers["set-cookie"];
  expect(setCookie?.length).toBeGreaterThan(0);
  cookie = setCookie!.map((c: string) => c.split(";")[0]).join("; ");

  // Seed 60 transfer students. First 40 came from School A, last 20 from School B.
  const rows = [];
  for (let n = 0; n < TOTAL_TRANSFERS; n++) {
    rows.push({
      firstName: "Transfer",
      lastName: `${TEST_TAG}-${String(n).padStart(3, "0")}`,
      email: `${TEST_TAG}-xfer${n}@example.test`,
      phone: "514-555-0100",
      dateOfBirth: "2006-02-02",
      address: "2 Test St",
      courseType: "auto",
      emergencyContact: "Test Parent",
      emergencyPhone: "514-555-0101",
      transferredFrom: n < 40 ? SCHOOL_A : SCHOOL_B,
    });
  }
  const inserted = await db.insert(students).values(rows).returning({ id: students.id });
  studentIds.push(...inserted.map((r) => r.id));
});

afterAll(async () => {
  if (studentIds.length) {
    await db.delete(students).where(inArray(students.id, studentIds));
  }
  await db.delete(users).where(like(users.email, `${TEST_TAG}%`));
});

describe("GET /api/students transfer pagination", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/students").query({ isTransfer: "true" });
    expect(res.status).toBe(401);
  });

  it("reports the correct total for transfer students matching the test tag", async () => {
    const res = await getStudents({ isTransfer: "true", searchTerm: TEST_TAG, limit: PAGE_SIZE, offset: 0 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(TOTAL_TRANSFERS);
    expect(res.body.students).toHaveLength(PAGE_SIZE);
  });

  it("returns every seeded transfer student across pages with no duplicates", async () => {
    const seen = new Set<number>();
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const res = await getStudents({ isTransfer: "true", searchTerm: TEST_TAG, limit: PAGE_SIZE, offset });
      expect(res.status).toBe(200);
      total = res.body.total;
      const page = res.body.students as Array<{ id: number; transferredFrom: string | null }>;
      // Page size: full page except possibly the last.
      expect(page.length).toBe(Math.min(PAGE_SIZE, total - offset));
      for (const s of page) {
        expect(seen.has(s.id)).toBe(false);
        seen.add(s.id);
        // isTransfer filter must only return students with a previous school.
        expect(s.transferredFrom && s.transferredFrom.trim() !== "").toBeTruthy();
      }
      offset += PAGE_SIZE;
    }
    expect(total).toBe(TOTAL_TRANSFERS);
    expect(seen.size).toBe(TOTAL_TRANSFERS);
    for (const id of studentIds) {
      expect(seen.has(id)).toBe(true);
    }
  });

  it("second page contains the students beyond the first 50", async () => {
    const res = await getStudents({ isTransfer: "true", searchTerm: TEST_TAG, limit: PAGE_SIZE, offset: PAGE_SIZE });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(TOTAL_TRANSFERS);
    expect(res.body.students).toHaveLength(TOTAL_TRANSFERS - PAGE_SIZE);
  });
});

describe("GET /api/students search by previous school (transferredFrom)", () => {
  it("finds students by a term that only exists in transferredFrom", async () => {
    const res = await getStudents({ isTransfer: "true", searchTerm: SCHOOL_B, limit: PAGE_SIZE, offset: 0 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(20);
    for (const s of res.body.students) {
      expect(s.transferredFrom).toBe(SCHOOL_B);
    }
  });

  it("matches previous school case-insensitively and partially", async () => {
    const res = await getStudents({
      isTransfer: "true",
      searchTerm: `ecole alpha ${TEST_TAG}`.toUpperCase(),
      limit: PAGE_SIZE,
      offset: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(40);
    for (const s of res.body.students) {
      expect(s.transferredFrom).toBe(SCHOOL_A);
    }
  });

  it("returns no seeded students for a school name that does not exist", async () => {
    const res = await getStudents({ isTransfer: "true", searchTerm: `Nonexistent School ${TEST_TAG}`, limit: PAGE_SIZE, offset: 0 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.students).toHaveLength(0);
  });
});
