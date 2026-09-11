import { db } from "../db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  meetingBotMeetings,
  jobs,
  classEnrollments,
  students,
  classes,
  type MeetingBotMeeting,
  type ReconcileEntry,
  type ReconcileReport,
} from "@shared/schema";
import {
  dispatchMeetingBot,
  getMeetingBotTranscript,
  MeetingBotApiError,
  parseZoomMeeting,
  type MeetingBotTranscriptSegment,
} from "./meeting-bot-client";
import {
  enqueueJob,
  registerJobHandler,
  type JobLogger,
} from "../job-queue";
import { getClassStartTime } from "./class-time";

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] =
        a[i - 1] === b[j - 1]
          ? diagonal
          : 1 + Math.min(previous[j - 1], above, diagonal);
      diagonal = above;
    }
  }
  return previous[b.length];
}

export function similarityRatio(a: string, b: string): number {
  if (a === b) return 1;
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - levenshtein(a, b) / maxLength;
}

export interface NameCandidate {
  studentId: number;
  enrollmentId: number;
  firstName: string;
  lastName: string;
  normalizedName: string;
}

/**
 * Conservative one-to-one matching: exact/reversed names, unique first names,
 * first + last initial, then a high-confidence fuzzy full-name comparison.
 */
export function matchSpeakersToStudents(
  speakers: string[],
  candidates: NameCandidate[],
): Map<string, NameCandidate> {
  const matches = new Map<string, NameCandidate>();
  const usedStudentIds = new Set<number>();

  for (const speaker of speakers) {
    const normalizedSpeaker = normalizeName(speaker);
    if (!normalizedSpeaker || /^speaker\s*\d+$/i.test(normalizedSpeaker)) continue;
    const eligible = candidates.filter((c) => !usedStudentIds.has(c.studentId));

    const exact = eligible.filter((candidate) => {
      const reversed = normalizeName(`${candidate.lastName} ${candidate.firstName}`);
      return (
        candidate.normalizedName === normalizedSpeaker ||
        reversed === normalizedSpeaker
      );
    });

    let selected = exact.length === 1 ? exact[0] : undefined;
    if (!selected) {
      const firstNameMatches = eligible.filter(
        (candidate) => normalizeName(candidate.firstName) === normalizedSpeaker,
      );
      if (firstNameMatches.length === 1) selected = firstNameMatches[0];
    }

    if (!selected) {
      const initialMatches = eligible.filter((candidate) => {
        const first = normalizeName(candidate.firstName);
        const last = normalizeName(candidate.lastName);
        return normalizedSpeaker === `${first} ${last[0] ?? ""}`;
      });
      if (initialMatches.length === 1) selected = initialMatches[0];
    }

    if (!selected && normalizedSpeaker.includes(" ")) {
      const scored = eligible
        .map((candidate) => ({
          candidate,
          score: similarityRatio(normalizedSpeaker, candidate.normalizedName),
        }))
        .sort((a, b) => b.score - a.score);
      if (
        scored[0]?.score >= 0.82 &&
        (!scored[1] || scored[0].score - scored[1].score >= 0.08)
      ) {
        selected = scored[0].candidate;
      }
    }

    if (selected) {
      matches.set(speaker, selected);
      usedStudentIds.add(selected.studentId);
    }
  }
  return matches;
}

export async function getMeetingBotMeeting(
  id: number,
): Promise<MeetingBotMeeting | null> {
  const [row] = await db
    .select()
    .from(meetingBotMeetings)
    .where(eq(meetingBotMeetings.id, id));
  return row ?? null;
}

export async function getMeetingBotMeetingByClass(
  classId: number,
): Promise<MeetingBotMeeting | null> {
  const [row] = await db
    .select()
    .from(meetingBotMeetings)
    .where(eq(meetingBotMeetings.classId, classId));
  return row ?? null;
}

export async function listMeetingBotMeetings(): Promise<MeetingBotMeeting[]> {
  return db
    .select()
    .from(meetingBotMeetings)
    .orderBy(sql`${meetingBotMeetings.createdAt} DESC`);
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function enqueueDispatchInTransaction(
  tx: DbTransaction,
  meetingBotMeetingId: number,
  dispatchGeneration: number,
): Promise<number> {
  const [job] = await tx
    .insert(jobs)
    .values({
      type: "meeting-bot:dispatch",
      category: "general",
      payload: { meetingBotMeetingId, dispatchGeneration },
      // Backbone has no documented idempotency key. Never retry POST /bots
      // automatically: a lost response could otherwise send a second paid bot.
      maxAttempts: 1,
    })
    .returning();
  await tx
    .update(meetingBotMeetings)
    .set({ dispatchJobId: job.id, updatedAt: new Date() })
    .where(eq(meetingBotMeetings.id, meetingBotMeetingId));
  return job.id;
}

export async function dispatchBotForClass(
  classId: number,
  zoomLink: string,
): Promise<MeetingBotMeeting> {
  const zoom = parseZoomMeeting(zoomLink);
  if (!zoom) throw new Error("The class does not have a valid Zoom join link");

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(meetingBotMeetings)
        .where(eq(meetingBotMeetings.classId, classId));

      if (existing) {
        if (!["failed", "stopped"].includes(existing.status)) {
          throw new Error(
            `A meeting bot already exists for this class (${existing.status})`,
          );
        }
        if (existing.dispatchUncertain) {
          throw new Error(
            "The previous dispatch result is uncertain. Verify it in Backbone before sending another bot.",
          );
        }

        // Guard the retry claim by the exact terminal state observed above.
        // Concurrent retry requests cannot both transition this row to pending.
        const [claimed] = await tx
          .update(meetingBotMeetings)
          .set({
            zoomNativeMeetingId: zoom.nativeMeetingId,
            zoomPasscode: zoom.passcode ?? null,
            meetingId: null,
            sessionId: null,
            status: "pending",
            dispatchedAt: null,
            endedAt: null,
            transcript: null,
            recordingAvailable: false,
            reconcileReport: null,
            reconciledAt: null,
            dispatchJobId: null,
            reconcileJobId: null,
            dispatchGeneration: sql`${meetingBotMeetings.dispatchGeneration} + 1`,
            dispatchUncertain: false,
            errorMessage: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(meetingBotMeetings.id, existing.id),
              eq(meetingBotMeetings.status, existing.status),
              eq(meetingBotMeetings.dispatchUncertain, false),
            ),
          )
          .returning();
        if (!claimed) {
          throw new Error("Another request already claimed this bot retry");
        }
        const dispatchJobId = await enqueueDispatchInTransaction(
          tx,
          claimed.id,
          claimed.dispatchGeneration,
        );
        return { ...claimed, dispatchJobId };
      }

      const [created] = await tx
        .insert(meetingBotMeetings)
        .values({
          classId,
          zoomNativeMeetingId: zoom.nativeMeetingId,
          zoomPasscode: zoom.passcode ?? null,
          status: "pending",
          dispatchGeneration: 1,
        })
        .returning();
      const dispatchJobId = await enqueueDispatchInTransaction(
        tx,
        created.id,
        created.dispatchGeneration,
      );
      return { ...created, dispatchJobId };
    });
  } catch (error: any) {
    if (error?.code === "23505") {
      throw new Error("A meeting bot already exists for this class");
    }
    throw error;
  }
}

export async function enqueueReconciliation(
  meetingBotMeetingId: number,
  scheduledFor = new Date(),
): Promise<number> {
  const meeting = await getMeetingBotMeeting(meetingBotMeetingId);
  if (!meeting) throw new Error("Meeting bot session not found");
  if (meeting.reconcileJobId) {
    const [existingJob] = await db
      .select({ status: jobs.status, scheduledFor: jobs.scheduledFor })
      .from(jobs)
      .where(eq(jobs.id, meeting.reconcileJobId));
    if (
      existingJob?.status === "queued" &&
      existingJob.scheduledFor > scheduledFor
    ) {
      await db
        .update(jobs)
        .set({ scheduledFor, updatedAt: new Date() })
        .where(eq(jobs.id, meeting.reconcileJobId));
      return meeting.reconcileJobId;
    }
    if (
      existingJob &&
      ["queued", "running", "succeeded"].includes(existingJob.status)
    ) {
      return meeting.reconcileJobId;
    }
  }
  const job = await enqueueJob({
    type: "meeting-bot:reconcile",
    category: "general",
    payload: { meetingBotMeetingId },
    scheduledFor,
    maxAttempts: 10,
  });
  await db
    .update(meetingBotMeetings)
    .set({ reconcileJobId: job.id, updatedAt: new Date() })
    .where(eq(meetingBotMeetings.id, meetingBotMeetingId));
  return job.id;
}

export async function syncMeetingStatus(
  id: number,
): Promise<MeetingBotMeeting> {
  const meeting = await getMeetingBotMeeting(id);
  if (!meeting?.meetingId) throw new Error("Bot has not been dispatched yet");
  const transcript = await getMeetingBotTranscript(meeting.meetingId);
  const [updated] = await db
    .update(meetingBotMeetings)
    .set({
      status: transcript.status,
      transcript: transcript.segments,
      endedAt:
        transcript.status === "completed" || transcript.status === "failed"
          ? meeting.endedAt ?? new Date()
          : meeting.endedAt,
      updatedAt: new Date(),
    })
    .where(eq(meetingBotMeetings.id, id))
    .returning();
  if (transcript.status === "completed" && !updated.reconciledAt) {
    await enqueueReconciliation(updated.id);
  }
  return updated;
}

export async function reconcileSession(
  meetingBotMeetingId: number,
  log: JobLogger,
): Promise<ReconcileReport> {
  const meeting = await getMeetingBotMeeting(meetingBotMeetingId);
  if (!meeting?.meetingId) throw new Error("Meeting Bot meeting_id is missing");

  const transcript = await getMeetingBotTranscript(meeting.meetingId);
  await db
    .update(meetingBotMeetings)
    .set({
      status: transcript.status,
      transcript: transcript.segments,
      endedAt:
        transcript.status === "completed" || transcript.status === "failed"
          ? meeting.endedAt ?? new Date()
          : meeting.endedAt,
      updatedAt: new Date(),
    })
    .where(eq(meetingBotMeetings.id, meeting.id));

  if (transcript.status === "failed") {
    throw new Error("Meeting bot failed before attendance reconciliation");
  }
  if (transcript.status !== "completed") {
    throw new Error(
      `Meeting is still ${transcript.status}; attendance will be retried`,
    );
  }

  const finalSegments = (transcript.segments ?? []).filter(
    (segment) => segment.is_final !== false,
  );
  const speakers = Array.from(
    new Set(finalSegments.map((segment) => segment.speaker).filter(Boolean)),
  );
  const enrollmentRows = await db
    .select({
      enrollmentId: classEnrollments.id,
      studentId: classEnrollments.studentId,
      attendanceStatus: classEnrollments.attendanceStatus,
      attendanceManuallyOverridden:
        classEnrollments.attendanceManuallyOverridden,
      firstName: students.firstName,
      lastName: students.lastName,
    })
    .from(classEnrollments)
    .innerJoin(students, eq(classEnrollments.studentId, students.id))
    .where(
      and(
        eq(classEnrollments.classId, meeting.classId),
        isNull(classEnrollments.cancelledAt),
      ),
    );

  const candidates: NameCandidate[] = enrollmentRows.map((row) => ({
    studentId: row.studentId!,
    enrollmentId: row.enrollmentId,
    firstName: row.firstName,
    lastName: row.lastName,
    normalizedName: normalizeName(`${row.firstName} ${row.lastName}`),
  }));
  const speakerMatches = matchSpeakersToStudents(speakers, candidates);
  const matchedIds = new Set(
    Array.from(speakerMatches.values()).map((candidate) => candidate.studentId),
  );
  const report: ReconcileReport = {
    matched: [],
    unmatched: [],
    unknownSpeakers: speakers.filter((speaker) => !speakerMatches.has(speaker)),
  };

  for (const row of enrollmentRows) {
    const matchedSpeaker =
      Array.from(speakerMatches.entries()).find(
        ([, candidate]) => candidate.studentId === row.studentId,
      )?.[0] ?? null;
    const desiredStatus = matchedIds.has(row.studentId!)
      ? "attended"
      : "absent";
    let skippedDueToOverride = row.attendanceManuallyOverridden;
    let attendanceUpdated = false;
    let attendanceStatus = row.attendanceStatus ?? "registered";
    if (!skippedDueToOverride && attendanceStatus !== desiredStatus) {
      const updatedRows = await db
        .update(classEnrollments)
        .set({ attendanceStatus: desiredStatus })
        .where(
          and(
            eq(classEnrollments.id, row.enrollmentId),
            eq(classEnrollments.attendanceManuallyOverridden, false),
          ),
        )
        .returning({ attendanceStatus: classEnrollments.attendanceStatus });
      if (updatedRows.length > 0) {
        attendanceUpdated = true;
        attendanceStatus = updatedRows[0].attendanceStatus ?? desiredStatus;
      } else {
        const [winningRow] = await db
          .select({
            attendanceStatus: classEnrollments.attendanceStatus,
            attendanceManuallyOverridden:
              classEnrollments.attendanceManuallyOverridden,
          })
          .from(classEnrollments)
          .where(eq(classEnrollments.id, row.enrollmentId));
        skippedDueToOverride =
          winningRow?.attendanceManuallyOverridden ?? true;
        attendanceStatus =
          winningRow?.attendanceStatus ?? attendanceStatus;
      }
    }
    const entry: ReconcileEntry = {
      studentId: row.studentId!,
      enrollmentId: row.enrollmentId,
      firstName: row.firstName,
      lastName: row.lastName,
      normalizedName: normalizeName(`${row.firstName} ${row.lastName}`),
      matchedSpeaker,
      attendanceUpdated,
      attendanceStatus,
      skippedDueToOverride,
    };
    (matchedSpeaker ? report.matched : report.unmatched).push(entry);
  }

  await log(
    `Attendance reconciled: ${report.matched.length} attended, ${report.unmatched.length} absent, ${report.unknownSpeakers.length} unmatched speaker(s)`,
  );
  await db
    .update(meetingBotMeetings)
    .set({
      status: "completed",
      reconcileReport: report,
      reconciledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(meetingBotMeetings.id, meeting.id));
  return report;
}

registerJobHandler("meeting-bot:dispatch", async (payload: any, log) => {
  const id = Number(payload?.meetingBotMeetingId);
  const generation = Number(payload?.dispatchGeneration);
  const [meeting] = await db
    .update(meetingBotMeetings)
    .set({
      status: "joining",
      dispatchUncertain: false,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetingBotMeetings.id, id),
        eq(meetingBotMeetings.status, "pending"),
        eq(meetingBotMeetings.dispatchGeneration, generation),
      ),
    )
    .returning();
  if (!meeting) {
    await log(
      `Skipped stale dispatch generation ${generation} for meeting-bot row ${id}`,
    );
    return;
  }
  try {
    const dispatched = await dispatchMeetingBot({
      nativeMeetingId: meeting.zoomNativeMeetingId,
      ...(meeting.zoomPasscode
        ? { passcode: meeting.zoomPasscode }
        : {}),
    });
    const [updated] = await db
      .update(meetingBotMeetings)
      .set({
        meetingId: dispatched.meeting_id,
        sessionId: dispatched.session_id,
        status: dispatched.status,
        dispatchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(meetingBotMeetings.id, id),
          eq(meetingBotMeetings.dispatchGeneration, generation),
        ),
      )
      .returning();
    const classData = await db
      .select()
      .from(classes)
      .where(eq(classes.id, updated.classId))
      .then((rows) => rows[0]);
    const start = classData ? getClassStartTime(classData) : null;
    const scheduledFor = new Date(
      Math.max(
        Date.now() + 60_000,
        (start?.getTime() ?? Date.now()) +
          (classData?.duration ?? 120) * 60_000 +
          60_000,
      ),
    );
    await enqueueReconciliation(id, scheduledFor);
    await log(`Dispatched meeting ${dispatched.meeting_id}`);
  } catch (error: any) {
    const dispatchUncertain = !(error instanceof MeetingBotApiError);
    await db
      .update(meetingBotMeetings)
      .set({
        status: "failed",
        dispatchUncertain,
        errorMessage: error?.message || String(error),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(meetingBotMeetings.id, id),
          eq(meetingBotMeetings.dispatchGeneration, generation),
        ),
      );
    throw error;
  }
});

registerJobHandler("meeting-bot:reconcile", async (payload: any, log) => {
  await reconcileSession(Number(payload?.meetingBotMeetingId), log);
});

export async function scanAndDispatchForUpcomingClasses(
  lookAheadMinutes = 1,
): Promise<{ dispatched: number; errors: number }> {
  if (!process.env.MEETING_BOT_API_KEY || !process.env.MEETING_BOT_BASE_URL) {
    return { dispatched: 0, errors: 0 };
  }
  const classRows = await db
    .select()
    .from(classes)
    .where(
      and(
        eq(classes.status, "scheduled"),
        sql`${classes.zoomLink} IS NOT NULL`,
      ),
    );
  const now = Date.now();
  let dispatched = 0;
  let errors = 0;
  for (const classData of classRows) {
    if (!classData.zoomLink) continue;
    const start = getClassStartTime(classData);
    if (!start) continue;
    const end =
      start.getTime() + Math.max(classData.duration ?? 120, 1) * 60_000;
    if (
      start.getTime() > now + lookAheadMinutes * 60_000 ||
      end < now
    ) {
      continue;
    }
    if (await getMeetingBotMeetingByClass(classData.id)) continue;
    try {
      await dispatchBotForClass(classData.id, classData.zoomLink);
      dispatched++;
    } catch (error) {
      errors++;
      console.error(
        `[meeting-bot] Auto-dispatch failed for class ${classData.id}:`,
        error,
      );
    }
  }
  return { dispatched, errors };
}