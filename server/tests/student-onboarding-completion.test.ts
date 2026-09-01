import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { db } from "../db";
import { studentRegistrations, students } from "@shared/schema";

const MARK = `onboarding-permit-${Date.now()}`;
const emails: string[] = [];
let app: express.Express;

function onboardingData(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Permit",
    lastName: "Applicant",
    phone: "514-555-0100",
    dateOfBirth: "2000-01-01",
    address: "1 Test Street",
    emergencyContact: "Test Contact",
    emergencyPhone: "514-555-0101",
    courseType: "moto",
    permitNumber: `${MARK}-permit`,
    ...overrides,
  };
}

async function registration(suffix: string, data: Record<string, unknown>) {
  const email = `${MARK}-${suffix}@example.test`;
  emails.push(email);
  const [row] = await db.insert(studentRegistrations).values({
    email,
    passwordHash: "not-used-by-this-test",
    passwordSet: true,
    emailVerified: true,
    onboardingData: { ...data, cardCaptureToken: `${MARK}-${suffix}-capability-token` } as any,
  }).returning();
  return row;
}

async function savedStudent(email: string) {
  const [student] = await db.select().from(students).where(eq(students.email, email));
  return student;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
}, 60_000);

afterAll(async () => {
  if (emails.length) {
    await db.delete(studentRegistrations).where(inArray(studentRegistrations.email, emails));
    await db.delete(students).where(inArray(students.email, emails));
  }
});

describe("student onboarding permit and optional reference", () => {
  it("completes motorcycle registration without a reference", async () => {
    const reg = await registration("moto-no-reference", onboardingData());

    await request(app).post(`/api/student/complete-onboarding/${reg.id}`)
      .set("X-Registration-Token", (reg.onboardingData as any).cardCaptureToken)
      .expect(200);

    const student = await savedStudent(reg.email);
    expect(student.learnerPermitNumber).toBe(`${MARK}-permit`);
    expect(student.driverLicenseNumber).toBeNull();
    expect(student.governmentId).toBeNull();
  });

  it("rejects completion when the permit is missing", async () => {
    const reg = await registration("missing-permit", onboardingData({ permitNumber: "" }));

    const response = await request(app)
      .post(`/api/student/complete-onboarding/${reg.id}`)
      .set("X-Registration-Token", (reg.onboardingData as any).cardCaptureToken)
      .expect(400);

    expect(response.body.message).toContain("permitNumber");
    expect(await savedStudent(reg.email)).toBeUndefined();
  });

  it("stores a provided reference in the compatibility column only", async () => {
    const reg = await registration(
      "reference",
      onboardingData({
        referenceNumber: `${MARK}-reference`,
        driverLicenseNumber: `${MARK}-stale-legacy-reference`,
      }),
    );

    await request(app).post(`/api/student/complete-onboarding/${reg.id}`)
      .set("X-Registration-Token", (reg.onboardingData as any).cardCaptureToken)
      .expect(200);

    const student = await savedStudent(reg.email);
    expect(student.learnerPermitNumber).toBe(`${MARK}-permit`);
    expect(student.driverLicenseNumber).toBe(`${MARK}-reference`);
    expect(student.governmentId).toBeNull();
  });

  it("accepts legacy onboarding aliases", async () => {
    const data = onboardingData({
      permitNumber: undefined,
      learnerPermitNumber: `${MARK}-legacy-permit`,
      driverLicenseNumber: `${MARK}-legacy-reference`,
    });
    const reg = await registration("legacy", data);

    await request(app).post(`/api/student/complete-onboarding/${reg.id}`)
      .set("X-Registration-Token", (reg.onboardingData as any).cardCaptureToken)
      .expect(200);

    const student = await savedStudent(reg.email);
    expect(student.learnerPermitNumber).toBe(`${MARK}-legacy-permit`);
    expect(student.driverLicenseNumber).toBe(`${MARK}-legacy-reference`);
    expect(student.governmentId).toBeNull();
  });
});