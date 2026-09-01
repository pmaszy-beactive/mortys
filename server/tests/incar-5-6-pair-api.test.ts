import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { registerRoutes } from "../routes";
import { db } from "../db";
import { classes, classEnrollments, studentPaymentMethods, students } from "@shared/schema";
import { generateStudentToken } from "../student-auth";

const MARK = `incar56-${Date.now()}`;
const DAY = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
let app: express.Express;
const studentIds: number[] = [];
const classIds: number[] = [];

async function student(suffix: string) {
  const [row] = await db.insert(students).values({
    firstName: "Pair", lastName: suffix, email: `${MARK}-${suffix}@example.test`,
    phone: "555-000-0000", dateOfBirth: "2005-01-01", address: "1 Test St",
    courseType: "auto", emergencyContact: "EC", emergencyPhone: "555-000-0001",
    accountStatus: "active", learnerPermitNumber: `${MARK}-${suffix}`,
    learnerPermitExpiryDate: "2030-01-01",
  } as any).returning({ id: students.id });
  studentIds.push(row.id);
  await db.insert(studentPaymentMethods).values({
    studentId: row.id, stripePaymentMethodId: `${MARK}-pm-${suffix}`, cardBrand: "visa", last4: "4242",
  });
  // Phase 3 opens only once Theory #8 has actually been attended.
  const theory = await lesson("theory", 8, "08:00", 4, "2025-01-01");
  await db.insert(classEnrollments).values({ studentId: row.id, classId: theory, attendanceStatus: "attended" } as any);
  return { id: row.id, token: generateStudentToken(row.id) };
}

async function lesson(classType: "theory" | "driving", classNumber: number, time: string, maxStudents = 4, date = DAY) {
  const [row] = await db.insert(classes).values({
    courseType: "auto", classType, classNumber, date, time, duration: classType === "driving" ? 60 : 120,
    maxStudents, status: "scheduled", topic: MARK,
  } as any).returning({ id: classes.id });
  classIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
}, 60000);

afterAll(async () => {
  if (classIds.length) await db.delete(classEnrollments).where(inArray(classEnrollments.classId, classIds));
  if (studentIds.length) {
    await db.delete(studentPaymentMethods).where(inArray(studentPaymentMethods.studentId, studentIds));
    await db.delete(students).where(inArray(students.id, studentIds));
  }
  if (classIds.length) await db.delete(classes).where(inArray(classes.id, classIds));
});

describe("atomic In-Car #5/#6 pair booking API", () => {
  it("creates two distinct enrollments for valid adjacent rows", async () => {
    const s = await student("valid");
    const five = await lesson("driving", 5, "09:00");
    const six = await lesson("driving", 6, "10:00");
    const response = await request(app).post("/api/student/classes/book-incar-5-6-pair")
      .set("Authorization", `Bearer ${s.token}`).send({ inCar5ClassId: five, inCar6ClassId: six });
    expect(response.status).toBe(200);
    expect(response.body.enrollments).toHaveLength(2);
    const enrolled = await db.select().from(classEnrollments).where(and(eq(classEnrollments.studentId, s.id), inArray(classEnrollments.classId, [five, six])));
    expect(enrolled).toHaveLength(2);
    expect(new Set(enrolled.map(e => e.classId))).toEqual(new Set([five, six]));
  });

  it("rejects a non-adjacent pair without creating either enrollment", async () => {
    const s = await student("nonadjacent");
    const five = await lesson("driving", 5, "11:00");
    const six = await lesson("driving", 6, "12:30");
    const response = await request(app).post("/api/student/classes/book-incar-5-6-pair")
      .set("Authorization", `Bearer ${s.token}`).send({ inCar5ClassId: five, inCar6ClassId: six });
    expect(response.status).toBe(400);
    expect(response.body.policyViolation).toBe("invalid_incar_5_6_pair");
    const enrolled = await db.select().from(classEnrollments).where(and(eq(classEnrollments.studentId, s.id), inArray(classEnrollments.classId, [five, six])));
    expect(enrolled).toHaveLength(0);
  });

  it("rolls back #5 when #6 becomes full", async () => {
    const s = await student("rollback");
    const filler = await student("filler");
    const five = await lesson("driving", 5, "14:00");
    const six = await lesson("driving", 6, "15:00", 1);
    await db.insert(classEnrollments).values({ studentId: filler.id, classId: six, attendanceStatus: "registered" } as any);
    const response = await request(app).post("/api/student/classes/book-incar-5-6-pair")
      .set("Authorization", `Bearer ${s.token}`).send({ inCar5ClassId: five, inCar6ClassId: six });
    expect(response.status).toBe(400);
    const enrolled = await db.select().from(classEnrollments).where(and(eq(classEnrollments.studentId, s.id), inArray(classEnrollments.classId, [five, six])));
    expect(enrolled).toHaveLength(0);
  });
});