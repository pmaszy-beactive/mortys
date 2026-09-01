import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";

vi.mock("../services/notifications", () => ({
  notifyScheduleChange: vi.fn(async () => {}),
  notifyClassCancelled: vi.fn(async () => {}),
  notifySeriesDayMove: vi.fn(async () => {}),
  notifySeriesDayRemoved: vi.fn(async () => {}),
  notifySeriesDaysActionNeeded: vi.fn(async () => 1),
  notifyScrapeFailure: vi.fn(async () => {}),
  notifyScrapeRecovered: vi.fn(async () => {}),
  notifyAutoEnrollFailed: vi.fn(async () => {}),
  notifyStartDateChange: vi.fn(async () => {}),
}));

import { registerRoutes } from "../routes";
import { db } from "../db";
import {
  classes,
  instructorAvailability,
  instructors,
  users,
} from "@shared/schema";
import { buildMotoCurriculumPlan } from "@shared/curriculumPlanner";

const MARK = `moto-api-${Date.now()}`;
const ADMIN_PASSWORD = "moto-api-test-password";

function formatDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function nextDayOfWeek(dayOfWeek: number, minimumDaysAhead = 10): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + minimumDaysAhead);
  while (date.getDay() !== dayOfWeek) date.setDate(date.getDate() + 1);
  return formatDate(date);
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00`);
  result.setDate(result.getDate() + days);
  return formatDate(result);
}

let app: express.Express;
let adminCookie: string;
let adminId: string;
let instructorId: number;
const classIds: number[] = [];
const seriesIds: string[] = [];
const monday = nextDayOfWeek(1);

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
  await registerRoutes(app);

  const [admin] = await db.insert(users).values({
    email: `${MARK}-admin@example.test`,
    firstName: "Moto",
    lastName: "API Admin",
    role: "admin",
    password: await bcrypt.hash(ADMIN_PASSWORD, 10),
  } as any).returning({ id: users.id, email: users.email });
  adminId = admin.id;

  const login = await request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-Proto", "https")
    .send({ username: admin.email, password: ADMIN_PASSWORD });
  expect(login.status).toBe(200);
  adminCookie = login.headers["set-cookie"][0].split(";")[0];

  const [instructor] = await db.insert(instructors).values({
    firstName: "Moto",
    lastName: "Two Hour",
    email: `${MARK}-instructor@example.test`,
    status: "active",
  }).returning({ id: instructors.id });
  instructorId = instructor.id;

  await db.insert(instructorAvailability).values({
    instructorId,
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "11:00",
    isAvailable: true,
  });
});

afterAll(async () => {
  if (seriesIds.length > 0) {
    await db.delete(classes).where(inArray(classes.seriesId, seriesIds));
  }
  if (classIds.length > 0) {
    await db.delete(classes).where(inArray(classes.id, classIds));
  }
  if (instructorId) {
    await db.delete(instructorAvailability).where(eq(instructorAvailability.instructorId, instructorId));
    await db.delete(instructors).where(eq(instructors.id, instructorId));
  }
  if (adminId) {
    await db.delete(users).where(eq(users.id, adminId));
  }
});

function authenticatedPost(path: string, body: Record<string, unknown>) {
  return request(app)
    .post(path)
    .set("Cookie", adminCookie)
    .set("X-Forwarded-Proto", "https")
    .send(body);
}

function roadFiveBulkBody(overrides: Record<string, unknown> = {}) {
  return {
    courseType: "moto",
    classType: "driving",
    classNumber: 5,
    daysOfWeek: [1],
    time: "09:00",
    duration: 120,
    instructorId,
    maxStudents: 5,
    startDate: monday,
    endDate: monday,
    ...overrides,
  };
}

describe("Moto class API integrity", () => {
  it("allows up to 5 students and rejects practical capacity above that limit", async () => {
    const base = {
      courseType: "moto",
      classType: "driving",
      classNumber: 5,
      date: monday,
      time: "09:00",
      duration: 120,
      maxStudents: 5,
    };

    const badDuration = await authenticatedPost("/api/classes", { ...base, duration: 240 });
    expect(badDuration.status).toBe(400);
    expect(badDuration.body.message).toContain("120 minutes");

    const allowedCapacity = await authenticatedPost("/api/classes", { ...base, maxStudents: 2 });
    expect(allowedCapacity.status).toBe(201);
    classIds.push(allowedCapacity.body.id);

    const badCapacity = await authenticatedPost("/api/classes", {
      ...base,
      time: "10:00",
      maxStudents: 6,
    });
    expect(badCapacity.status).toBe(400);
    expect(badCapacity.body.message).toContain("1–5 students");
  });

  it("requires a matching stage for non-progressive Moto practical bulk requests", async () => {
    const missingStage = await authenticatedPost(
      "/api/admin/classes/bulk",
      roadFiveBulkBody(),
    );
    expect(missingStage.status).toBe(400);
    expect(missingStage.body.message).toContain("Choose Closed-Circuit Training or Road Training");

    const mismatchedStage = await authenticatedPost(
      "/api/admin/classes/bulk",
      roadFiveBulkBody({ motoTrainingStage: "closed-circuit" }),
    );
    expect(mismatchedStage.status).toBe(400);
    expect(mismatchedStage.body.message).toContain("does not belong");
  });

  it("creates Road Session #1 in an exact 120-minute instructor window", async () => {
    const response = await authenticatedPost(
      "/api/admin/classes/bulk",
      roadFiveBulkBody({ motoTrainingStage: "road" }),
    );
    expect(response.status).toBe(201);
    expect(response.body.created).toBe(1);
    seriesIds.push(response.body.seriesId);

    const [created] = await db
      .select()
      .from(classes)
      .where(eq(classes.seriesId, response.body.seriesId));
    expect(created).toMatchObject({
      courseType: "moto",
      classType: "driving",
      classNumber: 5,
      duration: 120,
      maxStudents: 5,
      instructorId,
      date: monday,
      time: "09:00",
    });
  });

  it("rejects invalid Moto changes through change-request approval", async () => {
    const [roadClass] = await db.insert(classes).values({
      courseType: "moto",
      classType: "driving",
      classNumber: 5,
      date: addDays(monday, 7),
      time: "09:00",
      duration: 120,
      maxStudents: 1,
      status: "scheduled",
      lessonType: "regular",
    }).returning();
    classIds.push(roadClass.id);

    const badDuration = await authenticatedPost(
      `/api/change-requests/${roadClass.id}/approve`,
      { duration: 240 },
    );
    expect(badDuration.status).toBe(400);
    expect(badDuration.body.message).toContain("120 minutes");

    const allowedCapacity = await authenticatedPost(
      `/api/change-requests/${roadClass.id}/approve`,
      { maxStudents: 2 },
    );
    expect(allowedCapacity.status).toBe(200);

    const badCapacity = await authenticatedPost(
      `/api/change-requests/${roadClass.id}/approve`,
      { maxStudents: 6 },
    );
    expect(badCapacity.status).toBe(400);
    expect(badCapacity.body.message).toContain("1–5 students");

    const [unchanged] = await db.select().from(classes).where(eq(classes.id, roadClass.id));
    expect(unchanged.duration).toBe(120);
    expect(unchanged.maxStudents).toBe(2);
  });

  it("defaults Motorcycle and Scooter practical creation to 5 students", async () => {
    const moto = await authenticatedPost("/api/classes", {
      courseType: "moto",
      classType: "driving",
      classNumber: 5,
      date: monday,
      time: "11:00",
      duration: 120,
    });
    expect(moto.status).toBe(201);
    expect(moto.body.maxStudents).toBe(5);
    classIds.push(moto.body.id);

    const scooter = await authenticatedPost("/api/classes", {
      courseType: "scooter",
      classType: "driving",
      classNumber: 1,
      date: monday,
      time: "12:00",
      duration: 180,
    });
    expect(scooter.status).toBe(201);
    expect(scooter.body.maxStudents).toBe(5);
    classIds.push(scooter.body.id);

    const tooLarge = await authenticatedPost("/api/classes", {
      courseType: "scooter",
      classType: "driving",
      classNumber: 1,
      date: monday,
      time: "13:00",
      duration: 180,
      maxStudents: 6,
    });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.message).toContain("1–5 students");
  });

  it("refuses to clone one template across a mixed full Moto curriculum series", async () => {
    const seriesId = `${MARK}-full-curriculum`;
    seriesIds.push(seriesId);
    const plan = buildMotoCurriculumPlan(12);
    const inserted = await db.insert(classes).values(plan.map((session, index) => ({
      courseType: "moto",
      classType: session.classType,
      classNumber: session.classNumber,
      date: addDays(monday, 21 + index),
      time: "13:00",
      duration: session.duration,
      maxStudents: session.maxStudents,
      status: "scheduled",
      lessonType: "regular",
      seriesId,
    }))).returning();

    const response = await authenticatedPost(
      `/api/class-series/${seriesId}/change-days`,
      { scope: "all", daysOfWeek: [4] },
    );
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("different class sessions or schedules");
    expect(response.body.message).toContain("No classes were changed");

    const after = await db.select().from(classes).where(eq(classes.seriesId, seriesId));
    expect(after).toHaveLength(plan.length);
    const beforeById = new Map(inserted.map((row) => [row.id, row]));
    for (const row of after) {
      expect(row).toMatchObject({
        classType: beforeById.get(row.id)?.classType,
        classNumber: beforeById.get(row.id)?.classNumber,
        date: beforeById.get(row.id)?.date,
        duration: beforeById.get(row.id)?.duration,
        maxStudents: beforeById.get(row.id)?.maxStudents,
      });
    }
  });
});