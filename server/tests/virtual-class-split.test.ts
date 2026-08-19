import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";

vi.mock("../services/notifications", () => ({
  notifyVirtualClassSplit: vi.fn(async () => {}),
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

import * as notifications from "../services/notifications";
import { registerRoutes } from "../routes";
import { db } from "../db";
import { classes, classEnrollments, instructors, students, users } from "@shared/schema";
import { generateStudentToken } from "../student-auth";

const MARK = `virtual-split-${Date.now()}`;
const ADMIN_PASSWORD = "virtual-split-test-password";
const DAY = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 25);
  return date.toISOString().slice(0, 10);
})();

let app: express.Express;
let adminCookie: string;
let adminId: string;
let sourceClassId: number;
let conflictClassId: number;
let fullClassId: number;
let studentIds: number[] = [];
let instructorIds: number[] = [];

const parts = () => instructorIds.slice(0, 3).map((instructorId, index) => ({
  instructorId,
  zoomLink: `https://zoom.us/j/90000000${index + 1}`,
}));

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "10mb" }));
  await registerRoutes(app);

  const [admin] = await db.insert(users).values({
    email: `${MARK}-admin@example.test`,
    firstName: "Virtual",
    lastName: "Split Admin",
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

  const instructorRows = await db.insert(instructors).values(
    Array.from({ length: 3 }, (_, index) => ({
      firstName: "Virtual",
      lastName: `Instructor ${index + 1}`,
      email: `${MARK}-instructor-${index + 1}@example.test`,
      status: "active",
    }))
  ).returning({ id: instructors.id });
  instructorIds = instructorRows.map(row => row.id);

  const studentRows = await db.insert(students).values(
    Array.from({ length: 66 }, (_, index) => ({
      firstName: "Virtual",
      lastName: `Student ${String(index + 1).padStart(2, "0")}`,
      email: `${MARK}-student-${index + 1}@example.test`,
      phone: `555-100-${String(index + 1).padStart(4, "0")}`,
      dateOfBirth: "2005-01-01",
      address: "1 Virtual Test St",
      courseType: "auto",
      emergencyContact: "Test Contact",
      emergencyPhone: "555-200-0000",
      accountStatus: "active",
    } as any))
  ).returning({ id: students.id });
  studentIds = studentRows.map(row => row.id);

  const [source] = await db.insert(classes).values({
    courseType: "auto",
    classType: "theory",
    classNumber: 1,
    date: DAY,
    time: "19:00",
    duration: 120,
    maxStudents: 65,
    status: "scheduled",
    lessonType: "regular",
    zoomLink: "https://zoom.us/j/899999999",
    topic: MARK,
    seriesId: `${MARK}-series`,
  } as any).returning({ id: classes.id });
  sourceClassId = source.id;
  await db.insert(classEnrollments).values(
    studentIds.slice(0, 65).map(studentId => ({
      classId: sourceClassId,
      studentId,
      attendanceStatus: "registered",
    }))
  );

  const [conflict] = await db.insert(classes).values({
    courseType: "auto",
    classType: "theory",
    classNumber: 2,
    date: DAY,
    time: "20:00",
    duration: 60,
    instructorId: instructorIds[0],
    maxStudents: 15,
    status: "scheduled",
    topic: MARK,
  } as any).returning({ id: classes.id });
  conflictClassId = conflict.id;

  const [fullClass] = await db.insert(classes).values({
    courseType: "auto",
    classType: "theory",
    classNumber: 1,
    date: DAY,
    time: "14:00",
    duration: 120,
    maxStudents: 50,
    status: "scheduled",
    zoomLink: "https://zoom.us/j/877777777",
    topic: MARK,
  } as any).returning({ id: classes.id });
  fullClassId = fullClass.id;
  await db.insert(classEnrollments).values(
    studentIds.slice(0, 30).map(studentId => ({
      classId: fullClassId,
      studentId,
      attendanceStatus: "registered",
    }))
  );
}, 60000);

afterAll(async () => {
  if (studentIds.length) {
    await db.delete(classEnrollments).where(inArray(classEnrollments.studentId, studentIds));
  }
  await db.delete(classes).where(eq(classes.topic, MARK));
  if (studentIds.length) await db.delete(students).where(inArray(students.id, studentIds));
  if (instructorIds.length) await db.delete(instructors).where(inArray(instructors.id, instructorIds));
  if (adminId) await db.delete(users).where(eq(users.id, adminId));
});

describe("virtual class cap and split API", () => {
  it("rejects duplicate instructor assignments without changing the class", async () => {
    const invalidParts = parts();
    invalidParts[1].instructorId = invalidParts[0].instructorId;
    const response = await request(app)
      .post(`/api/admin/classes/${sourceClassId}/split-virtual`)
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", adminCookie)
      .send({ parts: invalidParts });
    expect(response.status).toBe(400);
    const [source] = await db.select().from(classes).where(eq(classes.id, sourceClassId));
    expect(source.sessionGroupId).toBeNull();
  });

  it("rejects an instructor schedule conflict and rolls back the split", async () => {
    const response = await request(app)
      .post(`/api/admin/classes/${sourceClassId}/split-virtual`)
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", adminCookie)
      .send({ parts: parts() });
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/already booked/i);
    const groupRows = await db.select().from(classes).where(eq(classes.topic, MARK));
    expect(groupRows.filter(row => row.sessionGroupId)).toHaveLength(0);
    const sourceEnrollments = await db.select().from(classEnrollments)
      .where(eq(classEnrollments.classId, sourceClassId));
    expect(sourceEnrollments).toHaveLength(65);
  });

  it("splits 65 students into linked 22/22/21 classes with independent assignments", async () => {
    await db.delete(classes).where(eq(classes.id, conflictClassId));
    const response = await request(app)
      .post(`/api/admin/classes/${sourceClassId}/split-virtual`)
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", adminCookie)
      .send({ parts: parts() });
    expect(response.status).toBe(201);
    expect(response.body.distribution).toEqual([22, 22, 21]);

    const splitRows = await db.select().from(classes)
      .where(eq(classes.sessionGroupId, response.body.sessionGroupId));
    expect(splitRows).toHaveLength(3);
    expect(new Set(splitRows.map(row => row.instructorId)).size).toBe(3);
    expect(new Set(splitRows.map(row => row.zoomLink)).size).toBe(3);
    expect(splitRows.every(row => row.maxStudents === 30)).toBe(true);
    expect(splitRows.every(row => row.detachedFromSeries)).toBe(true);
    expect(splitRows.every(row => row.date === DAY && row.time === "19:00" && row.duration === 120)).toBe(true);

    const counts = await Promise.all(splitRows.sort((a, b) => a.id - b.id).map(async row =>
      (await db.select().from(classEnrollments).where(eq(classEnrollments.classId, row.id))).length
    ));
    expect(counts).toEqual([22, 22, 21]);
    expect(vi.mocked(notifications.notifyVirtualClassSplit)).toHaveBeenCalledTimes(3);
  });

  it("shows a moved student only their assigned split class and Zoom link", async () => {
    const token = generateStudentToken(studentIds[64]);
    const response = await request(app)
      .get("/api/student/classes")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    const assigned = response.body.filter((row: any) => row.sessionGroupId);
    expect(assigned).toHaveLength(1);
    expect(assigned[0].zoomLink).toMatch(/^https:\/\/zoom\.us\/j\/90000000[1-3]$/);
  });

  it("rejects the 31st booking even when a legacy virtual class says it holds 50", async () => {
    const token = generateStudentToken(studentIds[65]);
    const response = await request(app)
      .post(`/api/student/classes/${fullClassId}/book`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/full/i);
    const rows = await db.select().from(classEnrollments).where(and(
      eq(classEnrollments.classId, fullClassId),
      eq(classEnrollments.studentId, studentIds[65]),
    ));
    expect(rows).toHaveLength(0);
  });
});