import { storage, type DbTx } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";

/** Namespace for student-booking advisory locks (arbitrary but stable). */
const BOOKING_LOCK_NAMESPACE = 823001;

/**
 * Serializes all booking/move mutations for one student. Concurrent requests
 * for the same student queue on a Postgres transaction-scoped advisory lock,
 * so each validate-then-mutate sequence sees the previous one's committed
 * enrollments — closing the race where two parallel bookings both pass the
 * two-in-car cap or theory-sequence checks. The lock is released when the
 * wrapping transaction commits (i.e. when `fn` finishes).
 */
export async function withStudentBookingLock<T>(
  studentId: number,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NAMESPACE}, ${studentId})`,
    );
    return await fn(tx);
  });
}
import {
  validateClassBooking,
  buildCompletedClasses,
  type BookingValidationResult,
} from "@shared/bookingRules";
import { checkClassStart } from "./class-time";

function hasClassStarted(classData: { date: string; time: string }): boolean {
  return checkClassStart(classData, 0).status === "started";
}

/**
 * Authoritative strict-progression check shared by every server path that
 * creates or moves a booking outside the student-facing routes (auto-enroll,
 * start-date migration, …). Builds the student's completed/upcoming context
 * and runs the same booking-rule engine as direct booking: theory sequence,
 * duplicate/completed class numbers, in-car concurrency, phase gates.
 *
 * Capacity, time-conflict, and daily-limit checks are intentionally left to
 * the caller (storage.bookClass / policy checks) — this validates progression.
 */
export async function validateProgressionForStudent(
  studentId: number,
  targetClass: {
    classType: string | null;
    classNumber: number | null;
    date: string | null;
    time: string | null;
    duration: number | null;
    maxStudents: number | null;
    courseType: string | null;
  },
  options: { excludeEnrollmentId?: number; excludeClassId?: number } = {},
): Promise<BookingValidationResult> {
  const student = await storage.getStudent(studentId);
  if (!student) {
    return { allowed: false, reason: "Student not found.", blockingRule: "student_not_found" };
  }
  const enrollments = (await storage.getClassEnrollmentsByStudent(studentId)).filter(
    (e) =>
      e.id !== options.excludeEnrollmentId &&
      (options.excludeClassId === undefined || e.classId !== options.excludeClassId),
  );
  const allClasses = await storage.getClasses();
  const enrollmentDetails = enrollments
    .filter((e) => !e.cancelledAt)
    .map((e) => {
      const cls = allClasses.find((c) => c.id === e.classId);
      return {
        attendanceStatus: e.attendanceStatus,
        classType: cls?.classType ?? null,
        classNumber: cls?.classNumber ?? null,
        date: cls?.date ?? null,
        duration: cls?.duration ?? null,
          maxStudents: cls?.maxStudents ?? null,
        courseType: cls?.courseType ?? null,
        classStatus: cls?.status ?? null,
      };
    });
  const upcomingBookings: { classType: "theory" | "driving"; classNumber: number }[] = [];
  for (const e of enrollments) {
    if (
      e.cancelledAt ||
      e.attendanceStatus === "attended" ||
      e.attendanceStatus === "absent" ||
      e.attendanceStatus === "no-show"
    )
      continue;
    const cls = allClasses.find((c) => c.id === e.classId);
    if (!cls || cls.status !== "scheduled") continue;
    if (cls.isExtra) continue; // extra lessons never count toward numbered progression
    if (!cls.classType || cls.classNumber == null || !cls.date) continue;
    if (hasClassStarted({ date: cls.date, time: cls.time || "00:00" })) continue;
    upcomingBookings.push({
      classType: cls.classType as "theory" | "driving",
      classNumber: cls.classNumber,
    });
  }
  return validateClassBooking(
    {
      classType: targetClass.classType as "theory" | "driving",
      classNumber: targetClass.classNumber ?? 0,
      date: targetClass.date ?? new Date().toISOString().slice(0, 10),
      duration: targetClass.duration ?? undefined,
      maxStudents: targetClass.maxStudents ?? undefined,
      saaq6rKnowledgePassed: !!student.saaqKnowledgeTestDate,
      upcomingBookings,
    },
    buildCompletedClasses(enrollmentDetails),
    (student.courseType || "auto").toLowerCase(),
  );
}
