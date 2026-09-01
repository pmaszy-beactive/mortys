import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";

vi.mock("../services/sendgrid", () => ({
  sendEmail: vi.fn(async () => true),
}));

import { sendEmail } from "../services/sendgrid";
import { registerRoutes } from "../routes";
import { db } from "../db";
import { emailVerificationTokens, studentRegistrations, students } from "@shared/schema";

const mark = `registration-auth-${Date.now()}`;
const emails: string[] = [];
let sequence = 0;
let app: express.Express;

const capability = (suffix: string) => `${mark}-${suffix}-a-high-entropy-registration-capability`;
const emailFor = (suffix: string) => {
  const email = `${mark}-${suffix}-${sequence++}@example.test`;
  emails.push(email);
  return email;
};

function completeData(suffix: string) {
  return {
    firstName: "Secure",
    lastName: "Registrant",
    phone: "514-555-0100",
    dateOfBirth: "2000-01-01",
    address: "1 Secure Street",
    city: "Montreal",
    postalCode: "H1A 1A1",
    emergencyContact: "Emergency Contact",
    emergencyPhone: "514-555-0101",
    permitNumber: `${mark}-${suffix}-permit`,
    referenceNumber: `${mark}-${suffix}-reference`,
    courseType: "moto",
  };
}

async function registration(options: {
  suffix: string;
  verified?: boolean;
  passwordSet?: boolean;
  data?: Record<string, unknown>;
  tokenExpiresAt?: Date;
}) {
  const email = emailFor(options.suffix);
  const cap = capability(options.suffix);
  const [verification] = await db.insert(emailVerificationTokens).values({
    email,
    code: "123456",
    expiresAt: options.tokenExpiresAt || new Date(Date.now() + 60_000),
  }).returning();
  const [row] = await db.insert(studentRegistrations).values({
    email,
    passwordHash: await bcrypt.hash("placeholder-password", 10),
    passwordSet: options.passwordSet ?? false,
    emailVerified: options.verified ?? false,
    verificationTokenId: verification.id,
    onboardingData: { ...(options.data || {}), cardCaptureToken: cap } as any,
  }).returning();
  return { row, cap, verification };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
}, 60_000);

afterAll(async () => {
  if (!emails.length) return;
  await db.delete(studentRegistrations).where(inArray(studentRegistrations.email, emails));
  await db.delete(emailVerificationTokens).where(inArray(emailVerificationTokens.email, emails));
  await db.delete(students).where(inArray(students.email, emails));
});

describe("student registration password and capability flow", () => {
  it("starts with course only, then keeps the OTP, capability, and password path intact", async () => {
    const email = emailFor("course-only");
    const started = await request(app).post("/api/student/register")
      .send({ email, courseType: "moto" })
      .expect(200);

    expect(started.body).toMatchObject({
      registrationId: expect.any(Number),
      cardToken: expect.any(String),
      step: "verify",
    });

    const [saved] = await db.select().from(studentRegistrations)
      .where(eq(studentRegistrations.id, started.body.registrationId));
    expect(saved.onboardingData).toMatchObject({
      courseType: "moto",
      cardCaptureToken: started.body.cardToken,
    });
    expect(saved.onboardingData).not.toHaveProperty("selectedStartDateId");

    const [verification] = await db.select().from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.id, saved.verificationTokenId!));
    const verified = await request(app).post("/api/student/verify-email")
      .send({ registrationId: saved.id, code: verification.code })
      .expect(200);
    expect(verified.body).toMatchObject({
      registrationToken: started.body.cardToken,
      passwordSet: false,
      step: "password",
    });

    await request(app).post(`/api/student/registration/${saved.id}/password`)
      .set("X-Registration-Token", verified.body.registrationToken)
      .send({ password: "strong-pass", confirmation: "strong-pass" })
      .expect(200);

    const [passwordSaved] = await db.select().from(studentRegistrations)
      .where(eq(studentRegistrations.id, saved.id));
    expect(passwordSaved.emailVerified).toBe(true);
    expect(passwordSaved.passwordSet).toBe(true);
  });

  it("only returns a registration capability after a correct, unexpired OTP", async () => {
    const wrong = await registration({ suffix: "wrong" });
    const wrongResponse = await request(app).post("/api/student/verify-email")
      .send({ registrationId: wrong.row.id, code: "000000" }).expect(400);
    expect(wrongResponse.body.registrationToken).toBeUndefined();

    const expired = await registration({ suffix: "expired", tokenExpiresAt: new Date(Date.now() - 1_000) });
    const expiredResponse = await request(app).post("/api/student/verify-email")
      .send({ registrationId: expired.row.id, code: "123456" }).expect(400);
    expect(expiredResponse.body.registrationToken).toBeUndefined();

    const valid = await registration({ suffix: "valid" });
    const verified = await request(app).post("/api/student/verify-email")
      .send({ registrationId: valid.row.id, code: "123456" }).expect(200);
    expect(verified.body.registrationToken).toBe(valid.cap);
    expect(verified.body.passwordSet).toBe(false);
    expect(verified.body.step).toBe("password");
  });

  it("requires the capability and a strong password, and persists only a bcrypt hash", async () => {
    const fixture = await registration({ suffix: "password", verified: true });
    const endpoint = `/api/student/registration/${fixture.row.id}/password`;
    await request(app).post(endpoint).send({ password: "strong-pass", confirmation: "strong-pass" }).expect(403);
    await request(app).post(endpoint).set("X-Registration-Token", "wrong")
      .send({ password: "strong-pass", confirmation: "strong-pass" }).expect(403);
    await request(app).post(endpoint).set("X-Registration-Token", fixture.cap)
      .send({ password: "short", confirmation: "short" }).expect(400);
    await request(app).post(endpoint).set("X-Registration-Token", fixture.cap)
      .send({ password: "strong-pass", confirmation: "different-pass" }).expect(400);
    await request(app).post(endpoint).set("X-Registration-Token", fixture.cap)
      .send({ password: "strong-pass", confirmation: "strong-pass" }).expect(200);

    const [saved] = await db.select().from(studentRegistrations)
      .where(eq(studentRegistrations.id, fixture.row.id));
    expect(saved.passwordSet).toBe(true);
    expect(saved.passwordHash).not.toBe("strong-pass");
    expect(await bcrypt.compare("strong-pass", saved.passwordHash)).toBe(true);
  });

  it("rejects onboarding reads and mutations without the matching capability", async () => {
    const fixture = await registration({ suffix: "capability", verified: true, passwordSet: true });
    const onboarding = `/api/student/onboarding/${fixture.row.id}`;
    const complete = `/api/student/complete-onboarding/${fixture.row.id}`;
    await request(app).get(onboarding).expect(403);
    await request(app).get(onboarding).set("X-Registration-Token", "wrong").expect(403);
    await request(app).patch(onboarding).send({ step: 1, data: { firstName: "Nope" } }).expect(403);
    await request(app).patch(onboarding).set("X-Registration-Token", "wrong")
      .send({ step: 1, data: { firstName: "Nope" } }).expect(403);
    await request(app).post(complete).send({}).expect(403);
    await request(app).post(complete).set("X-Registration-Token", "wrong").send({}).expect(403);
  });

  it("rejects completion before a password has been set", async () => {
    const fixture = await registration({ suffix: "no-password", verified: true, data: completeData("no-password") });
    await request(app).post(`/api/student/complete-onboarding/${fixture.row.id}`)
      .set("X-Registration-Token", fixture.cap).send({}).expect(400);
  });

  it("completes once, authenticates immediately, maps permit/reference, and sends no activation email", async () => {
    const fixture = await registration({
      suffix: "complete",
      verified: true,
      passwordSet: true,
      data: completeData("complete"),
    });
    vi.mocked(sendEmail).mockClear();
    const endpoint = `/api/student/complete-onboarding/${fixture.row.id}`;
    const completed = await request(app).post(endpoint).set("X-Registration-Token", fixture.cap).send({}).expect(200);
    expect(completed.body.token).toEqual(expect.any(String));
    expect(completed.body.student).toMatchObject({ email: fixture.row.email, status: "active" });
    expect(completed.body.student.password).toBeUndefined();
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();

    const [student] = await db.select().from(students).where(eq(students.email, fixture.row.email));
    expect(student.accountStatus).toBe("active");
    expect(student.learnerPermitNumber).toBe(`${mark}-complete-permit`);
    expect(student.driverLicenseNumber).toBe(`${mark}-complete-reference`);
    // The development harness is HTTP while Replit sessions are Secure-only,
    // so use the returned normal-login bearer token to verify immediate auth.
    const me = await request(app).get("/api/student/me")
      .set("Authorization", `Bearer ${completed.body.token}`).expect(200);
    expect(me.body.id).toBe(student.id);

    await request(app).post(endpoint).set("X-Registration-Token", fixture.cap).send({}).expect(200);
    const matches = await db.select().from(students).where(eq(students.email, fixture.row.email));
    expect(matches).toHaveLength(1);
  });

  it("requires verified incomplete registrations to re-verify and selects password/onboarding after OTP", async () => {
    const legacyStartDateId = 987654;
    const noPassword = await registration({
      suffix: "resume-password",
      verified: true,
      passwordSet: false,
      data: { courseType: "auto", selectedStartDateId: legacyStartDateId },
    });
    const hasPassword = await registration({ suffix: "resume-onboarding", verified: true, passwordSet: true });
    const first = await request(app).post("/api/student/register")
      .send({ email: noPassword.row.email, courseType: "moto" })
      .expect(200);
    const second = await request(app).post("/api/student/register").send({ email: hasPassword.row.email }).expect(200);
    expect(first.body.step).toBe("verify");
    expect(first.body.registrationToken).toBeUndefined();
    expect(second.body.step).toBe("verify");

    const [resumedLegacy] = await db.select().from(studentRegistrations)
      .where(eq(studentRegistrations.id, noPassword.row.id));
    expect(resumedLegacy.onboardingData).toMatchObject({
      courseType: "moto",
      selectedStartDateId: legacyStartDateId,
    });

    for (const [fixture, expectedStep] of [[noPassword, "password"], [hasPassword, "onboarding"]] as const) {
      const [latest] = await db.select().from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.id, (await db.select().from(studentRegistrations)
          .where(eq(studentRegistrations.id, fixture.row.id)))[0].verificationTokenId!));
      const response = await request(app).post("/api/student/verify-email")
        .send({ registrationId: fixture.row.id, code: latest.code }).expect(200);
      expect(response.body.registrationToken).toBe(fixture.cap);
      expect(response.body.step).toBe(expectedStep);
    }
  });
});