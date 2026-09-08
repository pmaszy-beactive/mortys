import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

vi.mock("../services/sendgrid", () => ({ sendEmail: vi.fn(async () => true) }));

import { registerRoutes } from "../routes";
import { db } from "../db";
import {
  classEnrollments,
  classes,
  courseStartDates,
  emailVerificationTokens,
  studentRegistrations,
  students,
} from "@shared/schema";
import { getSchoolLocalDate } from "../services/class-time";

const marker = `auto-quote-${Date.now()}`;
const email = `${marker}@example.test`;
const capability = `${marker}-secure-registration-capability`;
let app: express.Express;
let registrationId: number;
let verificationId: number;
let startDateId: number;
let classId: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const date = getSchoolLocalDate(future);
  const [verification] = await db.insert(emailVerificationTokens).values({
    email,
    code: "123456",
    expiresAt: future,
    verified: true,
  }).returning();
  verificationId = verification.id;
  const [registration] = await db.insert(studentRegistrations).values({
    email,
    passwordHash: await bcrypt.hash("strong-password", 10),
    passwordSet: true,
    emailVerified: true,
    verificationTokenId: verification.id,
    onboardingData: { courseType: "auto", cardCaptureToken: capability } as any,
    createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
  }).returning();
  registrationId = registration.id;
  const [selectedClass] = await db.insert(classes).values({
    courseType: "auto",
    classType: "theory",
    classNumber: 1,
    date,
    time: "09:15",
    duration: 135,
    room: "Kirkland classroom 2",
    maxStudents: 15,
    status: "scheduled",
  }).returning();
  classId = selectedClass.id;
  const [startDate] = await db.insert(courseStartDates).values({
    courseType: "auto",
    startDate: date,
    startTime: "09:15",
    status: "active",
  }).returning();
  startDateId = startDate.id;
});

afterAll(async () => {
  if (classId) await db.delete(classEnrollments).where(eq(classEnrollments.classId, classId));
  await db.delete(students).where(eq(students.email, email));
  if (startDateId) await db.delete(courseStartDates).where(eq(courseStartDates.id, startDateId));
  if (classId) await db.delete(classes).where(eq(classes.id, classId));
  if (registrationId) await db.delete(studentRegistrations).where(eq(studentRegistrations.id, registrationId));
  if (verificationId) await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, verificationId));
});

describe("student automobile course quote", () => {
  it("requires the registration capability", async () => {
    const path = `/api/student/onboarding/${registrationId}/auto-course-quote?startDateId=${startDateId}`;
    await request(app).get(path).expect(403);
    await request(app).get(path).set("X-Registration-Token", "wrong").expect(403);
  });

  it("returns the selected real class schedule, location, totals, and all plans", async () => {
    const response = await request(app)
      .get(`/api/student/onboarding/${registrationId}/auto-course-quote?startDateId=${startDateId}`)
      .set("X-Registration-Token", capability)
      .expect(200);
    expect(response.body).toMatchObject({
      startDateId,
      classId,
      courseName: "Automobile (Licence Class 5) — Theory 1",
      location: "Kirkland classroom 2",
      schedule: { startTime: "09:15", endTime: "11:30", durationMinutes: 135 },
      pricing: {
        courseInclusiveCents: 129922,
        booksInclusiveCents: 9200,
        totalCents: 139122,
      },
    });
    expect(response.body.plans.map((plan: { id: string }) => plan.id)).toEqual(["full", "three", "six"]);
    expect(response.body.plans.map((plan: { installments: unknown[] }) => plan.installments.length)).toEqual([1, 3, 6]);
    expect(response.body.schedule.timeZone).toBeTruthy();
    expect(response.body.registrationDate).toBe(getSchoolLocalDate());
    expect(response.body.plans[1].installments[0].dueDate).toBe(getSchoolLocalDate());
  });

  it("validates and saves only the selected plan value", async () => {
    const path = `/api/student/onboarding/${registrationId}`;
    await request(app).patch(path).set("X-Registration-Token", capability)
      .send({ step: 4, data: { selectedStartDateId: startDateId, autoPaymentPlan: "later" } })
      .expect(400);
    await request(app).patch(path).set("X-Registration-Token", capability)
      .send({ step: 4, data: { selectedStartDateId: startDateId, autoPaymentPlan: "three", cardCaptureToken: "poison" } })
      .expect(200);
    const [saved] = await db.select().from(studentRegistrations).where(eq(studentRegistrations.id, registrationId));
    expect(saved.onboardingData).toMatchObject({ autoPaymentPlan: "three", cardCaptureToken: capability });
  });

  it("persists the chosen plan and a server-derived schedule on completion", async () => {
    await request(app).patch(`/api/student/onboarding/${registrationId}`)
      .set("X-Registration-Token", capability)
      .send({
        step: 4,
        data: {
          firstName: "Auto",
          lastName: "Registrant",
          phone: "514-555-0199",
          dateOfBirth: "2000-01-01",
          address: "1 Test Street",
          city: "Montreal",
          emergencyContact: "Test Contact",
          emergencyPhone: "514-555-0188",
          permitNumber: `${marker}-permit`,
          courseType: "auto",
          selectedStartDateId: startDateId,
          autoPaymentPlan: "three",
        },
      })
      .expect(200);
    await request(app).post(`/api/student/complete-onboarding/${registrationId}`)
      .set("X-Registration-Token", capability)
      .send({})
      .expect(200);

    const [student] = await db.select().from(students).where(eq(students.email, email));
    expect(student.paymentPlan).toBe("three");
    const [saved] = await db.select().from(studentRegistrations).where(eq(studentRegistrations.id, registrationId));
    expect(saved.onboardingData).toMatchObject({
      autoPaymentSummary: {
        plan: "three",
        currency: "CAD",
        totalCents: 139122,
        selectedStartDateId: startDateId,
        classId,
        installments: [
          { amountCents: 46374 },
          { amountCents: 46374 },
          { amountCents: 46374 },
        ],
      },
    });
    expect((saved.onboardingData as any).autoPaymentSummary.installments[0].dueDate)
      .toBe(getSchoolLocalDate());
  });

  it("returns an explicit error instead of a stale quote when the date becomes unavailable", async () => {
    await db.update(courseStartDates).set({ status: "cancelled" }).where(eq(courseStartDates.id, startDateId));
    const response = await request(app)
      .get(`/api/student/onboarding/${registrationId}/auto-course-quote?startDateId=${startDateId}`)
      .set("X-Registration-Token", capability)
      .expect(409);
    expect(response.body.message).toMatch(/no longer available/i);
  });
});