import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  classes,
  jobs,
  meetingBotMeetings,
} from "@shared/schema";
import { MeetingBotApiError } from "../services/meeting-bot-client";
import { __testing as jobQueueTesting } from "../job-queue";
const notifyDispatchFailure = vi.hoisted(() => vi.fn(async () => "sent"));
const dispatchMeetingBot = vi.hoisted(() => vi.fn());

vi.mock("../services/notifications", () => ({
  notifyMeetingBotDispatchFailure: notifyDispatchFailure,
}));
vi.mock("../services/meeting-bot-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/meeting-bot-client")>();
  return { ...actual, dispatchMeetingBot };
});

import {
  dispatchBotForClass,
  notifyOfficeOfMeetingBotDispatchFailure,
} from "../services/meeting-bot";

const createdClassIds: number[] = [];
const createdJobIds: number[] = [];

beforeEach(() => {
  notifyDispatchFailure.mockClear();
  dispatchMeetingBot.mockReset();
});

afterEach(async () => {
  if (createdClassIds.length === 0) return;
  const rows = await db
    .select({ dispatchJobId: meetingBotMeetings.dispatchJobId })
    .from(meetingBotMeetings)
    .where(inArray(meetingBotMeetings.classId, createdClassIds));
  for (const row of rows) {
    if (row.dispatchJobId) createdJobIds.push(row.dispatchJobId);
  }
  await db
    .delete(meetingBotMeetings)
    .where(inArray(meetingBotMeetings.classId, createdClassIds));
  if (createdJobIds.length > 0) {
    await db.delete(jobs).where(inArray(jobs.id, createdJobIds));
  }
  await db.delete(classes).where(inArray(classes.id, createdClassIds));
  createdClassIds.splice(0);
  createdJobIds.splice(0);
});

async function createZoomClass() {
  const [classRow] = await db
    .insert(classes)
    .values({
      courseType: "auto",
      classType: "theory",
      classNumber: 1,
      date: "2099-01-01",
      time: "09:00",
      duration: 120,
      maxStudents: 15,
      status: "scheduled",
      zoomLink: "https://zoom.us/j/12345678901?pwd=test-passcode",
    })
    .returning();
  createdClassIds.push(classRow.id);
  return classRow;
}

describe("meeting bot dispatch persistence", () => {
  it("creates one atomically linked dispatch job under simultaneous sends", async () => {
    const classRow = await createZoomClass();
    const results = await Promise.allSettled([
      dispatchBotForClass(classRow.id, classRow.zoomLink!),
      dispatchBotForClass(classRow.id, classRow.zoomLink!),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const [meeting] = await db
      .select()
      .from(meetingBotMeetings)
      .where(eq(meetingBotMeetings.classId, classRow.id));
    expect(meeting.dispatchJobId).not.toBeNull();
    expect(meeting.dispatchGeneration).toBe(1);

    const linkedJobs = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, "meeting-bot:dispatch"),
          eq(jobs.id, meeting.dispatchJobId!),
        ),
      );
    expect(linkedJobs).toHaveLength(1);
  });

  it("allows only one atomic retry claim for a failed dispatch", async () => {
    const classRow = await createZoomClass();
    const initial = await dispatchBotForClass(classRow.id, classRow.zoomLink!);
    createdJobIds.push(initial.dispatchJobId!);
    await db
      .update(meetingBotMeetings)
      .set({ status: "failed", dispatchUncertain: false })
      .where(eq(meetingBotMeetings.id, initial.id));

    const results = await Promise.allSettled([
      dispatchBotForClass(classRow.id, classRow.zoomLink!),
      dispatchBotForClass(classRow.id, classRow.zoomLink!),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const [meeting] = await db
      .select()
      .from(meetingBotMeetings)
      .where(eq(meetingBotMeetings.id, initial.id));
    expect(meeting.status).toBe("pending");
    expect(meeting.dispatchGeneration).toBe(2);
    expect(meeting.dispatchJobId).not.toBe(initial.dispatchJobId);
  });

  it.each([
    {
      dispatchUncertain: false,
      expectedName: "Failed",
    },
    {
      dispatchUncertain: true,
      expectedName: "Uncertain",
    },
  ])(
    "passes $expectedName dispatch details to the office alert",
    async ({ dispatchUncertain }) => {
      const classRow = await createZoomClass();
      const meeting = await dispatchBotForClass(
        classRow.id,
        classRow.zoomLink!,
      );
      await db
        .update(meetingBotMeetings)
        .set({
          status: "failed",
          dispatchUncertain,
          errorMessage: "Dispatch test failure",
        })
        .where(eq(meetingBotMeetings.id, meeting.id));

      const result =
        await notifyOfficeOfMeetingBotDispatchFailure(meeting.id);

      expect(result).toBe("sent");
      expect(notifyDispatchFailure).toHaveBeenCalledTimes(1);
      expect(notifyDispatchFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingBotMeetingId: meeting.id,
          dispatchGeneration: meeting.dispatchGeneration,
          classId: classRow.id,
          dispatchUncertain,
          errorMessage: "Dispatch test failure",
        }),
      );
    },
  );

  it.each([
    {
      label: "definitive validation rejection",
      error: new MeetingBotApiError(422, "Invalid Zoom meeting"),
      expectedUncertain: false,
    },
    {
      label: "request timeout response",
      error: new MeetingBotApiError(408, "Request timeout"),
      expectedUncertain: true,
    },
    {
      label: "Backbone server error",
      error: new MeetingBotApiError(503, "Service unavailable"),
      expectedUncertain: true,
    },
    {
      label: "network failure",
      error: new Error("socket closed"),
      expectedUncertain: true,
    },
  ])(
    "persists safe retry guidance for a $label",
    async ({ error, expectedUncertain }) => {
      const classRow = await createZoomClass();
      const meeting = await dispatchBotForClass(
        classRow.id,
        classRow.zoomLink!,
      );
      const [runningJob] = await db
        .update(jobs)
        .set({
          status: "running",
          attempts: 1,
          lockedBy: jobQueueTesting.workerId(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
        })
        .where(eq(jobs.id, meeting.dispatchJobId!))
        .returning();
      dispatchMeetingBot.mockRejectedValueOnce(error);

      await jobQueueTesting.runJob(runningJob);

      const [failed] = await db
        .select()
        .from(meetingBotMeetings)
        .where(eq(meetingBotMeetings.id, meeting.id));
      expect(failed.status).toBe("failed");
      expect(failed.dispatchUncertain).toBe(expectedUncertain);
      expect(notifyDispatchFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingBotMeetingId: meeting.id,
          dispatchUncertain: expectedUncertain,
        }),
      );
    },
  );
});
