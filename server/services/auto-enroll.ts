import { db } from "../db";
import { classes, students, classEnrollments } from "@shared/schema";
import { and, eq, gte, isNull, sql, isNotNull, inArray } from "drizzle-orm";
import { storage } from "../storage";
import { notifyAutoEnrollFailure } from "./notifications";

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
async function findMatchingTheory1Class(startDate: {
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
