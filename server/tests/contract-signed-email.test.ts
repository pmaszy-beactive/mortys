import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../services/sendgrid", () => ({
  sendEmail: vi.fn(async () => true),
}));

import { sendEmail } from "../services/sendgrid";
import { notifyContractSigned } from "../services/notifications";
import { db } from "../db";
import { notificationDeliveries, notifications } from "@shared/schema";

const originalOfficeRecipients = process.env.OFFICE_NOTIFICATION_EMAILS;
const TEST_OFFICE_EMAILS = "contracts-one@example.test, contracts-two@example.test";
const createdNotificationIds: number[] = [];

afterEach(async () => {
  vi.mocked(sendEmail).mockClear();
  if (createdNotificationIds.length > 0) {
    const ids = createdNotificationIds.splice(0);
    for (const id of ids) {
      await db
        .delete(notificationDeliveries)
        .where(eq(notificationDeliveries.notificationId, id));
      await db.delete(notifications).where(eq(notifications.id, id));
    }
  }

  if (originalOfficeRecipients === undefined) {
    delete process.env.OFFICE_NOTIFICATION_EMAILS;
  } else {
    process.env.OFFICE_NOTIFICATION_EMAILS = originalOfficeRecipients;
  }
});

describe("signed contract email recipients", () => {
  it("uses the configured comma-separated office recipient list", async () => {
    process.env.OFFICE_NOTIFICATION_EMAILS = TEST_OFFICE_EMAILS;

    const notificationId = await notifyContractSigned({
      contractId: 24680,
      contractNumber: "AUTO-24680",
      studentId: 13579,
      studentName: "Test Student",
      studentEmail: "student@example.test",
      courseType: "auto",
      signedDate: "2026-08-24",
    });

    expect(notificationId).not.toBeNull();
    createdNotificationIds.push(notificationId!);

    const [event] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId!));
    expect(event.notificationType).toBe("contract_signed");
    expect(event.title).toBe("Contract Signed — Test Student");
    expect(event.message).toContain("AUTO-24680");
    expect(event.message).toContain("student@example.test");

    const deliveries = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, notificationId!));

    expect(deliveries).toHaveLength(4);
    expect(
      deliveries
        .filter((delivery) => delivery.channel === "email")
        .map((delivery) => delivery.recipientEmail)
        .sort(),
    ).toEqual(["contracts-one@example.test", "contracts-two@example.test"]);
    expect(
      deliveries
        .filter((delivery) => delivery.channel === "in_app")
        .map((delivery) => delivery.recipientEmail)
        .sort(),
    ).toEqual(["contracts-one@example.test", "contracts-two@example.test"]);

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["contracts-one@example.test"],
        subject: "Contract Signed — Test Student",
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["contracts-two@example.test"],
        subject: "Contract Signed — Test Student",
      }),
    );
    for (const [emailParams] of vi.mocked(sendEmail).mock.calls) {
      expect(emailParams.uatBypass).not.toBe(true);
    }
  });
});