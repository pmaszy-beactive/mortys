import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

vi.mock("../services/notifications", () => ({
  notifyContractSigned: vi.fn(async () => 123),
}));

import * as notificationService from "../services/notifications";
import { registerRoutes } from "../routes";
import { db } from "../db";
import { contracts, students } from "@shared/schema";

const MARK = `contract-signed-${Date.now()}`;
const createdContractIds: number[] = [];
let studentId: number;
let app: express.Express;

const clauseInitials = {
  missed_theory_classes: {
    initials: "data:image/png;base64,test-theory",
    initialedAt: "2026-08-24T12:00:00.000Z",
  },
  missed_in_car_sessions: {
    initials: "data:image/png;base64,test-driving",
    initialedAt: "2026-08-24T12:00:00.000Z",
  },
  course_duration_extension: {
    initials: "data:image/png;base64,test-duration",
    initialedAt: "2026-08-24T12:00:00.000Z",
  },
};

async function createPendingContract() {
  const [contract] = await db
    .insert(contracts)
    .values({
      studentId,
      courseType: "auto",
      contractDate: "2026-08-24",
      amount: "1130.00",
      paymentMethod: "full",
      status: "pending",
      contractNumber: MARK,
    })
    .returning();
  createdContractIds.push(contract.id);
  return contract;
}

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "10mb" }));
  await registerRoutes(app);

  const [student] = await db
    .insert(students)
    .values({
      firstName: "Contract",
      lastName: "Signer",
      email: `${MARK}@example.test`,
      phone: "514-555-0199",
      dateOfBirth: "2005-01-01",
      address: "1 Test St",
      courseType: "auto",
      emergencyContact: "Test Contact",
      emergencyPhone: "514-555-0188",
    })
    .returning({ id: students.id });
  studentId = student.id;
});

beforeEach(() => {
  vi.mocked(notificationService.notifyContractSigned).mockReset();
  vi.mocked(notificationService.notifyContractSigned).mockResolvedValue(123);
});

afterAll(async () => {
  if (createdContractIds.length > 0) {
    await db.delete(contracts).where(inArray(contracts.id, createdContractIds));
  }
  if (studentId) {
    await db.delete(students).where(inArray(students.id, [studentId]));
  }
});

describe("contract signed office notification", () => {
  it("notifies once when a fully initialed contract first becomes active", async () => {
    const pending = await createPendingContract();

    const activation = await request(app)
      .put(`/api/contracts/${pending.id}`)
      .send({ status: "active", clauseInitials });

    expect(activation.status).toBe(200);
    expect(activation.body.status).toBe("active");
    expect(activation.body.signedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(notificationService.notifyContractSigned).toHaveBeenCalledWith({
      contractId: pending.id,
      contractNumber: MARK,
      studentId,
      studentName: "Contract Signer",
      studentEmail: `${MARK}@example.test`,
      courseType: "auto",
      signedDate: activation.body.signedDate,
    });

    const ordinaryEdit = await request(app)
      .put(`/api/contracts/${pending.id}`)
      .send({ status: "active", specialNotes: "Already signed" });

    expect(ordinaryEdit.status).toBe(200);
    expect(notificationService.notifyContractSigned).toHaveBeenCalledTimes(1);
  });

  it("keeps the contract active when office notification delivery fails", async () => {
    const pending = await createPendingContract();
    vi.mocked(notificationService.notifyContractSigned).mockRejectedValueOnce(
      new Error("simulated notification failure"),
    );

    const activation = await request(app)
      .put(`/api/contracts/${pending.id}`)
      .send({ status: "active", clauseInitials });

    expect(activation.status).toBe(200);
    expect(activation.body.status).toBe("active");
  });
});