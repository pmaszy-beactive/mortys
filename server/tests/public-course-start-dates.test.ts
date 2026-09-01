import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { db } from "../db";
import { classEnrollments, classes, courseStartDates } from "@shared/schema";
import { SCHOOL_TIMEZONE } from "../services/class-time";

const COURSE_TYPE = `registration-availability-${Date.now()}`;
const classIds: number[] = [];
const startDateIds: number[] = [];
let app: express.Express;

function schoolDate(daysAhead = 0): string {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function addStartDate(startDate: string, startTime: string) {
  const [row] = await db
    .insert(courseStartDates)
    .values({
      courseType: COURSE_TYPE,
      startDate,
      startTime,
      status: "active",
    })
    .returning();
  startDateIds.push(row.id);
  return row;
}

async function addTheory1(
  date: string,
  time: string,
  options: { status?: string; maxStudents?: number } = {},
) {
  const [row] = await db
    .insert(classes)
    .values({
      courseType: COURSE_TYPE,
      classType: "theory",
      classNumber: 1,
      date,
      time,
      duration: 120,
      maxStudents: options.maxStudents ?? 15,
      status: options.status ?? "scheduled",
    })
    .returning();
  classIds.push(row.id);
  return row;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

afterAll(async () => {
  if (classIds.length > 0) {
    await db.delete(classEnrollments).where(inArray(classEnrollments.classId, classIds));
    await db.delete(classes).where(inArray(classes.id, classIds));
  }
  if (startDateIds.length > 0) {
    await db.delete(courseStartDates).where(inArray(courseStartDates.id, startDateIds));
  }
});

describe("public registration course selections", () => {
  it("returns only start dates backed by a future scheduled Theory 1 class with space", async () => {
    const validDate = schoolDate(20);
    const missingDate = schoolDate(21);
    const cancelledDate = schoolDate(22);
    const fullDate = schoolDate(23);
    const startedDate = schoolDate();

    const validStart = await addStartDate(validDate, "10:00");
    await addTheory1(validDate, "10:00");

    await addStartDate(missingDate, "10:00");

    await addStartDate(cancelledDate, "10:00");
    await addTheory1(cancelledDate, "10:00", { status: "cancelled" });

    await addStartDate(fullDate, "10:00");
    const fullClass = await addTheory1(fullDate, "10:00", { maxStudents: 1 });
    await db.insert(classEnrollments).values({
      classId: fullClass.id,
      attendanceStatus: "registered",
    });

    await addStartDate(startedDate, "00:01");
    await addTheory1(startedDate, "00:01");

    const response = await request(app)
      .get(`/api/course-start-dates?courseType=${encodeURIComponent(COURSE_TYPE)}`)
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(response.body.map((date: { id: number }) => date.id)).toEqual([validStart.id]);
  });
});