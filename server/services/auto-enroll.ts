import { db } from "../db";
import { classes, students, classEnrollments, type CourseStartDate } from "@shared/schema";
import { and, eq, gte, isNull, sql, isNotNull, inArray } from "drizzle-orm";
import { storage } from "../storage";
import {
  notifyAutoEnrollFailure,
  notifyStartDateReschedule,
  notifyStartDateCancelled,
  notifyStartDateActionNeeded,
} from "./notifications";

export interface AutoEnrollResult {
  enrolled: boolean;
  classId?: number;
  reason?: string;
}

// Normalize "HH:MM" vs "HH:MM:SS" style times so an optional start-time on the
// course start date can be compared against the class time.
function timesMatch(startTime: string | null | undefined, classTime: string): boolean {
  if (!startTime) return true;
  return startTime.slice(0, 5) === classTime.slice(0, 5);
}

// Find the scheduled Theory 1 class that corresponds to a course start date.
// Exported so the admin student profile can suggest the right class when a
// student still needs manual enrollment.
export async function findMatchingTheory1Class(startDate: {
  courseType: string;
  startDate: string;
  startTime?: string | null;
}) {
  const candidates = await db
    .select()
    .from(classes)
    .where(
      and(
        eq(classes.courseType, startDate.courseType),
        eq(classes.classType, "theory"),
        eq(classes.classNumber, 1),
        eq(classes.date, startDate.startDate),
        eq(classes.status, "scheduled"),
        sql`COALESCE(${classes.isExtra}, false) = false`,
      ),
    );

  if (candidates.length === 0) return undefined;

  // Prefer an exact time match when the start date specifies a time.
  const exact = candidates.find((c) => timesMatch(startDate.startTime, c.time));
  if (exact) return exact;

  // If a time was set but nothing matches it, fall back to the only class on
  // that date (there is no ambiguity), otherwise give up.
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Enroll a student into the Theory 1 class matching their registration-selected
 * course start date. Uses storage.bookClass so capacity, duplicate, and
 * time-conflict checks all apply. Never throws — returns a result object.
 */
export async function autoEnrollStudentFromStartDate(
  studentId: number,
  selectedStartDateId: number,
  options: { notifyOfficeOnFailure?: boolean } = {},
): Promise<AutoEnrollResult> {
  const notifyOnFailure = options.notifyOfficeOnFailure ?? true;

  const fail = async (reason: string, startDateInfo?: { courseType: string; startDate: string; startTime?: string | null }): Promise<AutoEnrollResult> => {
    console.error(
      `[auto-enroll] Student #${studentId} could not be auto-enrolled (start date #${selectedStartDateId}): ${reason}`,
    );
    if (notifyOnFailure) {
      try {
        const student = await storage.getStudent(studentId);
        await notifyAutoEnrollFailure({
          studentId,
          studentName: student ? `${student.firstName} ${student.lastName}` : `Student #${studentId}`,
          studentEmail: student?.email || "unknown",
          courseType: startDateInfo?.courseType || student?.courseType || "unknown",
          startDate: startDateInfo?.startDate || "unknown",
          startTime: startDateInfo?.startTime ?? null,
          reason,
        });
      } catch (notifyErr) {
        console.error("[auto-enroll] Failed to send office notification:", notifyErr);
      }
    }
    return { enrolled: false, reason };
  };

  try {
    const startDate = await storage.getCourseStartDate(selectedStartDateId);
    if (!startDate) {
      return await fail("The selected course start date no longer exists.");
    }
    if (startDate.status !== "active") {
      return await fail(
        `The selected course start date (${startDate.startDate}) is ${startDate.status}.`,
        startDate,
      );
    }

    const matchingClass = await findMatchingTheory1Class(startDate);
    if (!matchingClass) {
      return await fail(
        `No scheduled Theory 1 class was found for ${startDate.courseType} on ${startDate.startDate}${startDate.startTime ? ` at ${startDate.startTime}` : ""}.`,
        startDate,
      );
    }

    const result = await storage.bookClass(studentId, matchingClass.id);
    if (!result.success) {
      // Already enrolled counts as success for our purposes — the class is on
      // the student's calendar either way.
      if (result.message?.includes("already enrolled")) {
        return { enrolled: true, classId: matchingClass.id };
      }
      return await fail(
        `Booking the Theory 1 class on ${matchingClass.date} at ${matchingClass.time} failed: ${result.message}`,
        startDate,
      );
    }

    console.log(
      `[auto-enroll] Student #${studentId} enrolled in Theory 1 class #${matchingClass.id} (${matchingClass.date} ${matchingClass.time}) from start date #${selectedStartDateId}`,
    );
    return { enrolled: true, classId: matchingClass.id };
  } catch (err: any) {
    return await fail(`Unexpected error during auto-enrollment: ${err?.message || err}`);
  }
}

export interface StartDateChangeReport {
  action: "none" | "rescheduled" | "cancelled";
  affected: number;
  moved: { studentId: number; studentName: string }[];
  needsAttention: { studentId: number; studentName: string; note?: string }[];
  officeNotified: boolean;
}

// Fetch the active (non-cancelled) enrollments of a class along with the
// students' names so we can move/notify/report them.
async function getActiveEnrollmentsWithNames(classId: number) {
  return db
    .select({
      enrollmentId: classEnrollments.id,
      studentId: classEnrollments.studentId,
      firstName: students.firstName,
      lastName: students.lastName,
    })
    .from(classEnrollments)
    .innerJoin(students, eq(classEnrollments.studentId, students.id))
    .where(and(eq(classEnrollments.classId, classId), isNull(classEnrollments.cancelledAt)));
}

function classTitle(cls: { courseType: string; classNumber: number | null }): string {
  return `${cls.courseType} — Theory ${cls.classNumber ?? 1}`;
}

/**
 * Keep students' calendars correct when the office edits or cancels a course
 * start date (Admin → Module 1 Start Dates).
 *
 * - Rescheduled (date/time changed, still active): enrolled students in the
 *   old Theory 1 class are moved to the Theory 1 class matching the new
 *   date/time (using storage.bookClass so capacity/duplicate/conflict checks
 *   apply) and receive a schedule-change notification. Students who cannot be
 *   moved (class full, conflict, no matching class) are reported to the office.
 * - Cancelled or deleted: enrollments are left untouched (the class itself may
 *   still run), but enrolled students are told the start date was cancelled and
 *   the office is prompted to handle them.
 *
 * Never throws — failures are logged and, where possible, escalated to the
 * office via notifications instead of blocking the admin's edit.
 */
export async function handleStartDateChange(
  before: CourseStartDate,
  after: CourseStartDate | null,
  triggeredBy?: string,
): Promise<StartDateChangeReport> {
  const report: StartDateChangeReport = {
    action: "none",
    affected: 0,
    moved: [],
    needsAttention: [],
    officeNotified: false,
  };

  try {
    const wasActive = before.status === "active";
    const isCancelledOrDeleted = !after || after.status !== "active";
    // Normalize "HH:MM" vs "HH:MM:SS" but keep null distinct so null↔value
    // transitions count as a time change.
    const normTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
    const isRescheduled =
      !!after &&
      after.status === "active" &&
      wasActive &&
      (before.startDate !== after.startDate || normTime(before.startTime) !== normTime(after.startTime));

    // Only act when an active start date is cancelled/deleted or its date/time
    // actually changes. Capacity/notes edits and already-cancelled rows are no-ops.
    if (!wasActive || (!isCancelledOrDeleted && !isRescheduled)) {
      return report;
    }

    const oldClass = await findMatchingTheory1Class(before);
    if (!oldClass) return report;

    const enrollments = await getActiveEnrollmentsWithNames(oldClass.id);
    if (enrollments.length === 0) return report;
    report.affected = enrollments.length;

    if (isCancelledOrDeleted) {
      report.action = "cancelled";
      report.needsAttention = enrollments.map((e) => ({
        studentId: e.studentId!,
        studentName: `${e.firstName} ${e.lastName}`,
        note: "Enrolled in the Theory 1 class for the cancelled start date",
      }));

      await notifyStartDateCancelled(
        {
          studentIds: enrollments.map((e) => e.studentId!),
          classTitle: classTitle(oldClass),
          date: before.startDate,
          time: before.startTime,
          classId: oldClass.id,
        },
        triggeredBy,
      );

      const notifId = await notifyStartDateActionNeeded({
        courseType: before.courseType,
        oldDate: before.startDate,
        newDate: null,
        reason: "The course start date was cancelled/removed while students were still enrolled in its Theory 1 class.",
        students: report.needsAttention,
      });
      report.officeNotified = notifId !== null;

      console.log(
        `[start-dates] Start date #${before.id} (${before.courseType} ${before.startDate}) cancelled with ${enrollments.length} enrolled student(s) — students + office notified`,
      );
      return report;
    }

    // Rescheduled: try to move everyone to the class matching the new date/time.
    report.action = "rescheduled";
    let newClass = await findMatchingTheory1Class(after!);

    // Hard guard: never "move" students into the class they are already in.
    // This happens when only the start time changed and the single-class
    // fallback in findMatchingTheory1Class resolves back to the old class —
    // cancelling + rebooking there would silently drop their enrollment.
    // Treat it as "no matching class" so the office handles it manually.
    if (newClass && newClass.id === oldClass.id) {
      newClass = undefined;
    }

    if (!newClass) {
      report.needsAttention = enrollments.map((e) => ({
        studentId: e.studentId!,
        studentName: `${e.firstName} ${e.lastName}`,
        note: "Still enrolled in the old Theory 1 class — no matching class on the new date",
      }));
      const notifId = await notifyStartDateActionNeeded({
        courseType: before.courseType,
        oldDate: before.startDate,
        newDate: after!.startDate,
        reason: `No scheduled Theory 1 class was found for ${after!.courseType} on ${after!.startDate}${after!.startTime ? ` at ${after!.startTime}` : ""}, so students could not be moved automatically.`,
        students: report.needsAttention,
      });
      report.officeNotified = notifId !== null;
      console.log(
        `[start-dates] Start date #${before.id} moved to ${after!.startDate} but no matching Theory 1 class exists — office notified about ${enrollments.length} student(s)`,
      );
      return report;
    }

    for (const e of enrollments) {
      const name = `${e.firstName} ${e.lastName}`;
      try {
        const result = await storage.bookClass(e.studentId!, newClass.id);
        const alreadyEnrolled = !result.success && result.message?.includes("already enrolled");
        if (result.success || alreadyEnrolled) {
          await db
            .update(classEnrollments)
            .set({ cancelledAt: new Date() })
            .where(eq(classEnrollments.id, e.enrollmentId));
          report.moved.push({ studentId: e.studentId!, studentName: name });
        } else {
          report.needsAttention.push({
            studentId: e.studentId!,
            studentName: name,
            note: `Could not be moved to the new class: ${result.message || "unknown error"}`,
          });
        }
      } catch (err: any) {
        report.needsAttention.push({
          studentId: e.studentId!,
          studentName: name,
          note: `Could not be moved to the new class: ${err?.message || err}`,
        });
      }
    }

    if (report.moved.length > 0) {
      await notifyStartDateReschedule(
        {
          studentIds: report.moved.map((m) => m.studentId),
          classTitle: classTitle(newClass),
          oldDate: oldClass.date,
          newDate: newClass.date,
          oldTime: oldClass.time,
          newTime: newClass.time,
          newClassId: newClass.id,
        },
        triggeredBy,
      );
    }

    if (report.needsAttention.length > 0) {
      const notifId = await notifyStartDateActionNeeded({
        courseType: before.courseType,
        oldDate: before.startDate,
        newDate: after!.startDate,
        reason: "Some students could not be moved automatically to the Theory 1 class on the new start date.",
        students: report.needsAttention,
      });
      report.officeNotified = notifId !== null;
    }

    console.log(
      `[start-dates] Start date #${before.id} rescheduled ${before.startDate} → ${after!.startDate}: ${report.moved.length} student(s) moved, ${report.needsAttention.length} need attention`,
    );
    return report;
  } catch (err: any) {
    console.error(
      `[start-dates] Failed to reconcile enrollments after start date #${before.id} change: ${err?.message || err}`,
    );
    return report;
  }
}

export interface BackfillReport {
  scanned: number;
  enrolled: { studentId: number; studentName: string; classId: number }[];
  failed: { studentId: number; studentName: string; reason: string }[];
  skipped: { studentId: number; studentName: string; reason: string }[];
}

/**
 * One-time backfill: find active students who selected a start date during
 * registration but have no class enrollments, and book them into the matching
 * Theory 1 class. Students that cannot be matched are reported (no office
 * notification spam — the report itself is the visibility).
 */
export async function backfillStartDateEnrollments(): Promise<BackfillReport> {
  const report: BackfillReport = { scanned: 0, enrolled: [], failed: [], skipped: [] };

  const candidates = await db
    .select()
    .from(students)
    .where(and(isNotNull(students.selectedStartDateId), eq(students.status, "active")));

  report.scanned = candidates.length;
  if (candidates.length === 0) return report;

  // Students that already have at least one active enrollment are skipped.
  const candidateIds = candidates.map((s) => s.id);
  const existing = await db
    .select({ studentId: classEnrollments.studentId })
    .from(classEnrollments)
    .where(
      and(
        inArray(classEnrollments.studentId, candidateIds),
        isNull(classEnrollments.cancelledAt),
      ),
    );
  const hasEnrollment = new Set(existing.map((e) => e.studentId));

  for (const student of candidates) {
    const name = `${student.firstName} ${student.lastName}`;
    if (hasEnrollment.has(student.id)) {
      report.skipped.push({ studentId: student.id, studentName: name, reason: "Already has enrollments" });
      continue;
    }

    const result = await autoEnrollStudentFromStartDate(student.id, student.selectedStartDateId!, {
      notifyOfficeOnFailure: false,
    });

    if (result.enrolled && result.classId) {
      report.enrolled.push({ studentId: student.id, studentName: name, classId: result.classId });
    } else {
      report.failed.push({ studentId: student.id, studentName: name, reason: result.reason || "Unknown" });
    }
  }

  console.log(
    `[auto-enroll] Backfill complete: ${report.scanned} scanned, ${report.enrolled.length} enrolled, ${report.failed.length} failed, ${report.skipped.length} skipped`,
  );
  return report;
}
