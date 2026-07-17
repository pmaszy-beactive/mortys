import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";

// Mock the notifications module so tests never send real emails/in-app
// notifications, and so we can assert on escalations.
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

import * as notifications from "../services/notifications";
import { registerRoutes } from "../routes";
import { db } from "../db";
import { classes, classEnrollments, students, users } from "@shared/schema";
import { eq, and, isNull, inArray, like } from "drizzle-orm";

const TEST_TAG = `cdtest-${Date.now()}`;
const ADMIN_EMAIL = `${TEST_TAG}-admin@example.test`;
const ADMIN_PASSWORD = "test-password-123";
const TIME = "21:30";

let app: express.Express;
let cookie: string;
let adminId: string;
const studentIds: number[] = [];
const extraClassIds: number[] = [];
const seriesIds: string[] = [];

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Next date (strictly after today + offsetWeeks*7) that falls on the given day of week. */
function nextDow(dow: number, afterDays = 1): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + afterDays);
  while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
  return d;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

const dayOf = (dateStr: string) => new Date(dateStr + "T00:00:00").getDay();

async function createStudent(n: number): Promise<number> {
  const [row] = await db
    .insert(students)
    .values({
      firstName: "Test",
      lastName: `Student${n}-${TEST_TAG}`,
      email: `${TEST_TAG}-student${n}@example.test`,
      phone: "514-555-0000",
      dateOfBirth: "2005-01-01",
      address: "1 Test St",
      courseType: "auto",
      emergencyContact: "Test Parent",
      emergencyPhone: "514-555-0001",
    })
    .returning();
  studentIds.push(row.id);
  return row.id;
}

interface SeriesOpts {
  maxStudents?: number;
  weeks?: number;
  days?: number[]; // days of week, default Mon+Wed
}

/** Creates a future series on the given days of week over N weeks. Returns { seriesId, room, classes } sorted by date. */
async function createSeries(opts: SeriesOpts = {}) {
  const seriesId = `test-series-${randomUUID()}`;
  seriesIds.push(seriesId);
  const room = `CDTEST-ROOM-${randomUUID().slice(0, 8)}`;
  const days = opts.days ?? [1, 3];
  const weeks = opts.weeks ?? 2;
  // Anchor: first occurrence of the earliest configured day at least 3 days out
  // (keeps everything safely in the future).
  const dates: string[] = [];
  for (const dow of days) {
    let d = nextDow(dow, 3);
    for (let w = 0; w < weeks; w++) {
      dates.push(fmt(addDays(d, w * 7)));
    }
  }
  dates.sort();
  const created = [];
  for (const date of dates) {
    const [row] = await db
      .insert(classes)
      .values({
        courseType: "auto",
        classType: "theory",
        classNumber: 2,
        date,
        time: TIME,
        duration: 60,
        instructorId: null,
        room,
        maxStudents: opts.maxStudents ?? 15,
        status: "scheduled",
        lessonType: "regular",
        seriesId,
      })
      .returning();
    created.push(row);
  }
  return { seriesId, room, classes: created };
}

async function enroll(studentId: number, classId: number) {
  await db.insert(classEnrollments).values({ classId, studentId, attendanceStatus: "registered" });
}

async function seriesState(seriesId: string) {
  const rows = await db.select().from(classes).where(eq(classes.seriesId, seriesId));
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function activeEnrollments(classId: number) {
  return db
    .select()
    .from(classEnrollments)
    .where(and(eq(classEnrollments.classId, classId), isNull(classEnrollments.cancelledAt)));
}

function changeDays(seriesId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/class-series/${seriesId}/change-days`)
    .set("Cookie", cookie)
    .set("X-Forwarded-Proto", "https")
    .send(body);
}

beforeAll(async () => {
  // Build the real app (dev mode: session-based traditional auth).
  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
  await registerRoutes(app);

  // Seed an admin user and log in to get a session cookie.
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const [admin] = await db
    .insert(users)
    .values({ email: ADMIN_EMAIL, firstName: "Test", lastName: "Admin", role: "admin", password: hash })
    .returning();
  adminId = admin.id;

  const login = await request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-Proto", "https")
    .send({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(login.status).toBe(200);
  const setCookie = login.headers["set-cookie"];
  expect(setCookie?.length).toBeGreaterThan(0);
  cookie = setCookie!.map((c: string) => c.split(";")[0]).join("; ");
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  // Clean up everything the tests created, in FK-safe order.
  const allSeriesClasses = seriesIds.length
    ? await db.select().from(classes).where(inArray(classes.seriesId, seriesIds))
    : [];
  const classIds = [...allSeriesClasses.map((c) => c.id), ...extraClassIds];
  if (classIds.length) {
    await db.delete(classEnrollments).where(inArray(classEnrollments.classId, classIds));
    await db.delete(classes).where(inArray(classes.id, classIds));
  }
  if (studentIds.length) {
    await db.delete(classEnrollments).where(inArray(classEnrollments.studentId, studentIds));
    await db.delete(students).where(inArray(students.id, studentIds));
  }
  await db.delete(users).where(like(users.email, `${TEST_TAG}%`));
});

describe("POST /api/class-series/:seriesId/change-days", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post(`/api/class-series/whatever/change-days`)
      .send({ scope: "all", daysOfWeek: [1] });
    expect(res.status).toBe(401);
  });

  it("validates scope and daysOfWeek", async () => {
    const { seriesId } = await createSeries();
    let res = await changeDays(seriesId, { scope: "bogus", daysOfWeek: [1] });
    expect(res.status).toBe(400);
    res = await changeDays(seriesId, { scope: "all", daysOfWeek: [] });
    expect(res.status).toBe(400);
    res = await changeDays(seriesId, { scope: "all", daysOfWeek: [7] });
    expect(res.status).toBe(400);
    res = await changeDays(seriesId, { scope: "all", daysOfWeek: [1.5] });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown series", async () => {
    const res = await changeDays(`test-series-${randomUUID()}`, { scope: "all", daysOfWeek: [1] });
    expect(res.status).toBe(404);
  });

  it("replaces removed-day classes with new-day classes under the same seriesId", async () => {
    // Mon + Wed series → move to Mon + Thu.
    const { seriesId, room, classes: original } = await createSeries({ days: [1, 3], weeks: 2 });
    const res = await changeDays(seriesId, { scope: "all", daysOfWeek: [1, 4] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2); // both Wednesdays removed
    expect(res.body.kept).toBe(2); // both Mondays kept
    expect(res.body.created).toBeGreaterThanOrEqual(1); // Thursdays inside the range

    const after = await seriesState(seriesId);
    // Every class still belongs to the same series and only sits on Mon/Thu.
    expect(after.length).toBe(res.body.kept + res.body.created);
    for (const cls of after) {
      expect(cls.seriesId).toBe(seriesId);
      expect([1, 4]).toContain(dayOf(cls.date));
      // Replacements copy the template's schedule fields.
      expect(cls.time).toBe(TIME);
      expect(cls.room).toBe(room);
      expect(cls.status).toBe("scheduled");
    }
    // The removed Wednesday classes are really gone.
    const removedIds = original.filter((c) => dayOf(c.date) === 3).map((c) => c.id);
    const stillThere = await db.select().from(classes).where(inArray(classes.id, removedIds));
    expect(stillThere.length).toBe(0);
  });

  it("moves enrolled students to the nearest new-day class and notifies them", async () => {
    const { seriesId, classes: original } = await createSeries({ days: [1, 3], weeks: 2 });
    const studentId = await createStudent(1);
    const firstWed = original.filter((c) => dayOf(c.date) === 3).sort((a, b) => a.date.localeCompare(b.date))[0];
    await enroll(studentId, firstWed.id);

    const res = await changeDays(seriesId, { scope: "all", daysOfWeek: [1, 4] });
    expect(res.status).toBe(200);
    expect(res.body.moved).toHaveLength(1);
    expect(res.body.moved[0].studentId).toBe(studentId);
    expect(res.body.moved[0].fromDate).toBe(firstWed.date);
    expect(res.body.needsAttention).toHaveLength(0);

    // Destination must be the nearest new-schedule class on/after the removed date.
    const after = await seriesState(seriesId);
    const expectedDest = after.filter((c) => c.date >= firstWed.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    expect(res.body.moved[0].toDate).toBe(expectedDest.date);
    const enr = await activeEnrollments(expectedDest.id);
    expect(enr.some((e) => e.studentId === studentId)).toBe(true);

    expect(notifications.notifySeriesDayMove).toHaveBeenCalledTimes(1);
    const call = (notifications.notifySeriesDayMove as any).mock.calls[0][0];
    expect(call.studentIds).toEqual([studentId]);
    expect(call.oldDate).toBe(firstWed.date);
    expect(call.newDate).toBe(expectedDest.date);
    expect(notifications.notifySeriesDaysActionNeeded).not.toHaveBeenCalled();
  });

  it("escalates students who cannot be moved (destination full) to the office", async () => {
    // maxStudents=1 → replacement classes also hold 1. Two students on the
    // removed day: first moves, second is stuck.
    const { seriesId, classes: original } = await createSeries({ days: [3], weeks: 2, maxStudents: 1 });
    const s1 = await createStudent(2);
    const s2 = await createStudent(3);
    const wed = original[0];
    await enroll(s1, wed.id);
    await enroll(s2, wed.id);

    const res = await changeDays(seriesId, { scope: "all", daysOfWeek: [4] });
    expect(res.status).toBe(200);
    expect(res.body.moved).toHaveLength(1);
    expect(res.body.needsAttention).toHaveLength(1);
    expect(res.body.needsAttention[0].note).toContain("could not be moved");
    expect(res.body.officeNotified).toBe(true);

    const movedIds = res.body.moved.map((m: any) => m.studentId);
    const stuckIds = res.body.needsAttention.map((m: any) => m.studentId);
    expect(new Set([...movedIds, ...stuckIds])).toEqual(new Set([s1, s2]));

    // Office escalation and stuck-student notification both fired.
    expect(notifications.notifySeriesDaysActionNeeded).toHaveBeenCalledTimes(1);
    const escalation = (notifications.notifySeriesDaysActionNeeded as any).mock.calls[0][0];
    expect(escalation.students).toHaveLength(1);
    expect(escalation.students[0].studentId).toBe(stuckIds[0]);
    expect(notifications.notifySeriesDayRemoved).toHaveBeenCalledTimes(1);

    // The stuck student has no active enrollment left (class deleted),
    // the moved student is enrolled in the replacement.
    const after = await seriesState(seriesId);
    expect(after).toHaveLength(1);
    const destEnr = await activeEnrollments(after[0].id);
    expect(destEnr.map((e) => e.studentId)).toEqual(movedIds);
  });

  it("returns 409 on room conflicts and changes nothing", async () => {
    const { seriesId, room, classes: original } = await createSeries({ days: [3], weeks: 2 });
    const studentId = await createStudent(4);
    await enroll(studentId, original[0].id);

    // Occupy the same room at an overlapping time on the target Thursday.
    const thuDate = fmt(addDays(new Date(original[0].date + "T00:00:00"), 1));
    const [blocker] = await db
      .insert(classes)
      .values({
        courseType: "auto",
        classType: "theory",
        classNumber: 3,
        date: thuDate,
        time: TIME,
        duration: 60,
        room,
        maxStudents: 15,
        status: "scheduled",
        lessonType: "regular",
      })
      .returning();
    extraClassIds.push(blocker.id);

    const res = await changeDays(seriesId, { scope: "all", daysOfWeek: [4] });
    expect(res.status).toBe(409);
    expect(res.body.conflicts?.length).toBeGreaterThan(0);
    expect(res.body.message).toContain("No classes were changed");

    // Nothing changed: original class still exists with its enrollment,
    // and no replacement class was created.
    const after = await seriesState(seriesId);
    expect(after.map((c) => c.id).sort()).toEqual(original.map((c) => c.id).sort());
    const enr = await activeEnrollments(original[0].id);
    expect(enr.some((e) => e.studentId === studentId)).toBe(true);
    expect(notifications.notifySeriesDayMove).not.toHaveBeenCalled();
    expect(notifications.notifySeriesDayRemoved).not.toHaveBeenCalled();
  });

  it("leaves past, detached, and cancelled classes untouched", async () => {
    const { seriesId, room, classes: original } = await createSeries({ days: [1, 3], weeks: 2 });

    // Add a past class, a detached future class, and a cancelled future class
    // to the same series, all on the soon-to-be-removed Wednesday.
    const pastDate = fmt(addDays(new Date(), -7));
    const firstWedDate = original.filter((c) => dayOf(c.date) === 3)[0].date;
    const base = {
      courseType: "auto",
      classType: "theory",
      classNumber: 2,
      time: TIME,
      duration: 60,
      room,
      maxStudents: 15,
      lessonType: "regular",
      seriesId,
    } as const;
    const [pastCls] = await db.insert(classes).values({ ...base, date: pastDate, status: "scheduled" }).returning();
    const [detachedCls] = await db
      .insert(classes)
      .values({ ...base, date: fmt(addDays(new Date(firstWedDate + "T00:00:00"), 14)), status: "scheduled", detachedFromSeries: true })
      .returning();
    const [cancelledCls] = await db
      .insert(classes)
      .values({ ...base, date: fmt(addDays(new Date(firstWedDate + "T00:00:00"), 21)), status: "cancelled" })
      .returning();

    const res = await changeDays(seriesId, { scope: "all", daysOfWeek: [1] });
    expect(res.status).toBe(200);
    expect(res.body.skippedPast).toBeGreaterThanOrEqual(1);
    expect(res.body.skippedDetached).toBe(1);
    expect(res.body.skippedCancelled).toBe(1);

    // All three survive, unmodified.
    const survivors = await db
      .select()
      .from(classes)
      .where(inArray(classes.id, [pastCls.id, detachedCls.id, cancelledCls.id]));
    expect(survivors).toHaveLength(3);
    const byId = new Map(survivors.map((c) => [c.id, c]));
    expect(byId.get(pastCls.id)?.date).toBe(pastDate);
    expect(byId.get(pastCls.id)?.status).toBe("scheduled");
    expect(byId.get(detachedCls.id)?.detachedFromSeries).toBe(true);
    expect(byId.get(cancelledCls.id)?.status).toBe("cancelled");
    // The regular Wednesday targets were removed as requested.
    const after = await seriesState(seriesId);
    const regular = after.filter((c) => !c.detachedFromSeries && c.status === "scheduled" && c.date >= fmt(new Date()));
    for (const cls of regular) expect(dayOf(cls.date)).toBe(1);
  });

  it("treats already-enrolled-in-destination students as moved (no duplicate enrollment)", async () => {
    const { seriesId, classes: original } = await createSeries({ days: [1, 3], weeks: 1 });
    const studentId = await createStudent(5);
    const mon = original.find((c) => dayOf(c.date) === 1)!;
    const wed = original.find((c) => dayOf(c.date) === 3)!;
    // Student attends both days; when Wed is removed the nearest destination
    // may be the Monday they're already enrolled in.
    await enroll(studentId, mon.id);
    await enroll(studentId, wed.id);

    const res = await changeDays(seriesId, { scope: "all", daysOfWeek: [1] });
    expect(res.status).toBe(200);
    expect(res.body.needsAttention.filter((n: any) => n.studentId === studentId).length +
      res.body.moved.filter((m: any) => m.studentId === studentId).length).toBeGreaterThanOrEqual(1);

    // No duplicate active enrollments anywhere in the series.
    const after = await seriesState(seriesId);
    for (const cls of after) {
      const enr = await activeEnrollments(cls.id);
      const mine = enr.filter((e) => e.studentId === studentId);
      expect(mine.length).toBeLessThanOrEqual(1);
    }
  });
});
