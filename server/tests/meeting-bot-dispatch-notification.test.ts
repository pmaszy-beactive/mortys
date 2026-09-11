import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { notificationDeliveries, notifications } from "@shared/schema";

const sendEmail = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../services/sendgrid", () => ({ sendEmail }));

import { notifyMeetingBotDispatchFailure } from "../services/notifications";

const dedupeKeys: string[] = [];
const originalOfficeEmails = process.env.OFFICE_NOTIFICATION_EMAILS;

afterEach(async () => {
  if (dedupeKeys.length > 0) {
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(inArray(notifications.dedupeKey, dedupeKeys));
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      await db
        .delete(notificationDeliveries)
        .where(inArray(notificationDeliveries.notificationId, ids));
      await db.delete(notifications).where(inArray(notifications.id, ids));
    }
  }
  dedupeKeys.splice(0);
  sendEmail.mockClear();
  if (originalOfficeEmails === undefined) {
    delete process.env.OFFICE_NOTIFICATION_EMAILS;
  } else {
    process.env.OFFICE_NOTIFICATION_EMAILS = originalOfficeEmails;
  }
});

describe("meeting bot dispatch office notifications", () => {
  it.each([
    {
      dispatchUncertain: false,
      expectedTitle: "Meeting Bot Failed",
      expectedAction: "staff may retry it from the class admin panel",
    },
    {
      dispatchUncertain: true,
      expectedTitle: "Meeting Bot Needs Verification",
      expectedAction: "Do not retry yet. Verify in Backbone",
    },
  ])(
    "creates one deduplicated alert when dispatchUncertain=$dispatchUncertain",
    async ({ dispatchUncertain, expectedTitle, expectedAction }) => {
      process.env.OFFICE_NOTIFICATION_EMAILS = "office-alert-test@example.com";
      const meetingBotMeetingId = 900_000 + (dispatchUncertain ? 1 : 0);
      const dispatchGeneration = 7;
      const dedupeKey = `meeting-bot-dispatch:${meetingBotMeetingId}:${dispatchGeneration}`;
      dedupeKeys.push(dedupeKey);
      const details = {
        meetingBotMeetingId,
        dispatchGeneration,
        classId: 123,
        className: "Theory 1 on 2099-01-01 at 09:00 (#123)",
        dispatchUncertain,
        errorMessage: "Backbone test error",
      };

      const results = await Promise.all([
        notifyMeetingBotDispatchFailure(details),
        notifyMeetingBotDispatchFailure(details),
        notifyMeetingBotDispatchFailure(details),
      ]);

      expect(results.filter((result) => result === "sent")).toHaveLength(1);
      expect(results.filter((result) => result === "deduped")).toHaveLength(2);

      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.dedupeKey, dedupeKey));
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toContain(expectedTitle);
      expect(rows[0].message).toContain(details.className);
      expect(rows[0].message).toContain(expectedAction);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    },
  );
});