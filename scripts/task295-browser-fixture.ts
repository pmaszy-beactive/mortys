/**
 * Isolated browser-journey fixture for paired 12/13 attendance.
 *
 * Setup:
 *   npx tsx scripts/task295-browser-fixture.ts setup
 *
 * Cleanup (use the credentials file path printed by setup):
 *   npx tsx scripts/task295-browser-fixture.ts cleanup /tmp/task295-browser-fixture-....json
 *
 * This script only writes fake @example.test identities. Passwords are random
 * and are written to a mode-0600 temporary file, never printed. A fake saved
 * card satisfies the booking gate, but no Stripe customer is created. Void
 * zero-dollar fee guards prevent the attendance journey from creating or
 * charging no-show invoices. Conversion email delivery is disabled for both
 * fixture students; in-app feedback remains available.
 */
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, pool } from "../server/db";
import { getSchoolLocalDate, SCHOOL_TIMEZONE } from "../server/services/class-time";
import {
  attendanceAuditLogs,
  classes,
  classEnrollments,
  incarPairedSessions,
  incarPairingAudit,
  incarPairingOffers,
  incarPairingQueue,
  incarSessionConfirmations,
  instructors,
  invoices,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  studentPaymentMethods,
  students,
} from "../shared/schema";

type FixtureManifest = {
  fixture: "task295";
  tag: string;
  instructor: { id: number; email: string; password: string };
  students: Array<{ id: number; email: string; password: string }>;
  classIds: { current: number; future: number; seeded: number[] };
  enrollmentIds: number[];
  routes: {
    instructorLogin: string;
    roster: string;
    singleAttendance: string;
    studentLogin: string;
  };
};

function password(): string {
  return `T295-${randomBytes(18).toString("base64url")}`;
}

function schoolTime(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

function schoolDateOffset(days: number): string {
  return getSchoolLocalDate(new Date(Date.now() + days * 86_400_000));
}

async function setup(): Promise<void> {
  const tag = `task295-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const instructorPassword = password();
  const studentPasswords = [password(), password()];

  const manifest = await db.transaction(async (tx): Promise<FixtureManifest> => {
    const [instructor] = await tx.insert(instructors).values({
      firstName: "Task295",
      lastName: "Instructor",
      email: `${tag}-instructor@example.test`,
      phone: "514-555-0295",
      status: "active",
      accountStatus: "active",
      password: await bcrypt.hash(instructorPassword, 10),
      specializations: { auto: { theory: true, practical: true } },
      digitalSignature: "data:image/png;base64,dGFzazI5NQ==",
    }).returning({ id: instructors.id, email: instructors.email });

    const studentRows = [];
    for (let index = 0; index < 2; index++) {
      const [student] = await tx.insert(students).values({
        firstName: `Task295${index === 0 ? "Present" : "Absent"}`,
        lastName: "Student",
        email: `${tag}-student-${index + 1}@example.test`,
        phone: `514-555-029${index + 6}`,
        dateOfBirth: "2000-01-01",
        address: "295 Fixture Street",
        city: "Montreal",
        province: "QC",
        postalCode: "H0H 0H0",
        courseType: "auto",
        status: "active",
        phase: "Auto Phase 4",
        accountStatus: "active",
        password: await bcrypt.hash(studentPasswords[index], 10),
        emergencyContact: "Fixture Contact",
        emergencyPhone: "514-555-0200",
        learnerPermitNumber: `T295-PERMIT-${index + 1}`,
        learnerPermitValidDate: schoolDateOffset(-365),
        learnerPermitExpiryDate: schoolDateOffset(365),
        completedTheoryClasses: Array.from({ length: 11 }, (_, i) => i + 1),
        completedInCarSessions: Array.from({ length: 10 }, (_, i) => i + 1),
        currentTheoryClass: 12,
        currentInCarSession: 11,
        totalAmountDue: "0.00",
        amountPaid: "0.00",
        stripeCustomerId: null,
      }).returning({ id: students.id, email: students.email });
      studentRows.push(student);
    }

    const seededClassIds: number[] = [];
    const historyDate = schoolDateOffset(-120);
    const completedSpecs = [
      ...Array.from({ length: 11 }, (_, i) => ({ classType: "theory", classNumber: i + 1, duration: 120 })),
      ...Array.from({ length: 10 }, (_, i) => ({ classType: "driving", classNumber: i + 1, duration: 60 })),
    ];
    for (const spec of completedSpecs) {
      const [completedClass] = await tx.insert(classes).values({
        courseType: "auto",
        classType: spec.classType,
        classNumber: spec.classNumber,
        date: historyDate,
        time: "09:00",
        duration: spec.duration,
        instructorId: instructor.id,
        maxStudents: 2,
        status: "completed",
        room: tag,
      }).returning({ id: classes.id });
      seededClassIds.push(completedClass.id);
      await tx.insert(classEnrollments).values(studentRows.map(student => ({
        classId: completedClass.id,
        studentId: student.id,
        attendanceStatus: "attended",
      })));
    }

    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000);
    // Keep the class on TODAY across the few minutes after school-local
    // midnight; 00:00 is the closest valid already-started wall time then.
    const today = getSchoolLocalDate(now);
    const startedTime = getSchoolLocalDate(tenMinutesAgo) === today ? schoolTime(tenMinutesAgo) : "00:00";
    const [currentClass] = await tx.insert(classes).values({
      courseType: "auto",
      classType: "driving",
      classNumber: 12,
      date: today,
      time: startedTime,
      duration: 120,
      instructorId: instructor.id,
      maxStudents: 2,
      status: "scheduled",
      room: tag,
    }).returning({ id: classes.id });

    const [futureClass] = await tx.insert(classes).values({
      courseType: "auto",
      classType: "driving",
      classNumber: 12,
      date: schoolDateOffset(7),
      time: schoolTime(new Date()),
      duration: 120,
      instructorId: instructor.id,
      maxStudents: 2,
      status: "scheduled",
      room: tag,
    }).returning({ id: classes.id });
    seededClassIds.push(currentClass.id, futureClass.id);

    const enrollmentRows = await tx.insert(classEnrollments).values(studentRows.map(student => ({
      classId: currentClass.id,
      studentId: student.id,
      attendanceStatus: "registered",
    }))).returning({ id: classEnrollments.id, studentId: classEnrollments.studentId });

    const queueRows = [];
    for (const enrollment of enrollmentRows) {
      const [queue] = await tx.insert(incarPairingQueue).values({
        studentId: enrollment.studentId!,
        sessionNumber: 12,
        status: "paired",
        bookedClassId: currentClass.id,
        enrollmentId: enrollment.id,
      }).returning({ id: incarPairingQueue.id, studentId: incarPairingQueue.studentId });
      queueRows.push(queue);
    }

    await tx.insert(incarPairedSessions).values({
      queueEntryIdA: queueRows[0].id,
      queueEntryIdB: queueRows[1].id,
      studentIdA: studentRows[0].id,
      studentIdB: studentRows[1].id,
      classId: currentClass.id,
      enrollmentIdA: enrollmentRows[0].id,
      enrollmentIdB: enrollmentRows[1].id,
      status: "paired",
      notes: tag,
    });

    // Fake local card rows satisfy the card-on-file gate without any Stripe ID
    // on the student, customer creation, SetupIntent, or external API call.
    await tx.insert(studentPaymentMethods).values(studentRows.map((student, index) => ({
      studentId: student.id,
      stripePaymentMethodId: `pm_fake_${tag}_${index + 1}`,
      cardBrand: "fixture",
      last4: `029${index + 5}`,
      expiryMonth: 12,
      expiryYear: 2099,
      isDefault: true,
    })));

    // Suppress external conversion email while retaining in-app feedback.
    await tx.insert(notificationPreferences).values(studentRows.map(student => ({
      recipientType: "student",
      recipientId: String(student.id),
      notificationType: "incar_lesson_converted",
      emailEnabled: false,
      inAppEnabled: true,
    })));

    // The unique no-show guard makes chargeNoShowFee return before card lookup,
    // Stripe, student email, or office-failure email. These are fixture-only,
    // void, zero-dollar records and are removed by cleanup.
    await tx.insert(invoices).values(enrollmentRows.map((enrollment, index) => ({
      studentId: enrollment.studentId!,
      invoiceNumber: `T295-GUARD-${tag}-${index + 1}`,
      amount: "0.00",
      subtotal: "0.00",
      gst: "0.00",
      qst: "0.00",
      status: "void",
      description: "Task295 browser fixture no-show side-effect guard",
      notes: `enrollment:${enrollment.id}`,
      voidedAt: new Date(),
    })));

    return {
      fixture: "task295",
      tag,
      instructor: { ...instructor, password: instructorPassword },
      students: studentRows.map((student, index) => ({ ...student, password: studentPasswords[index] })),
      classIds: { current: currentClass.id, future: futureClass.id, seeded: seededClassIds },
      enrollmentIds: enrollmentRows.map(row => row.id),
      routes: {
        instructorLogin: "/instructor/login",
        roster: "/instructor/schedule",
        singleAttendance: `/instructor/lesson/${currentClass.id}/check-in`,
        studentLogin: "/student/login",
      },
    };
  });

  const file = `/tmp/task295-browser-fixture-${manifest.tag}.json`;
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`Task295 fixture ready. Credentials and cleanup metadata: ${file}`);
  console.log(`Roster route: ${manifest.routes.roster}`);
  console.log(`Single-attendance route: ${manifest.routes.singleAttendance}`);
  console.log(`Cleanup: npx tsx scripts/task295-browser-fixture.ts cleanup ${file}`);
}

async function cleanup(file: string): Promise<void> {
  if (!file.startsWith("/tmp/task295-browser-fixture-")) {
    throw new Error("Refusing cleanup: expected a /tmp/task295-browser-fixture-*.json path");
  }
  const manifest = JSON.parse(await readFile(file, "utf8")) as FixtureManifest;
  if (manifest.fixture !== "task295" || !manifest.tag.startsWith("task295-")) {
    throw new Error("Refusing cleanup: file is not a task295 fixture manifest");
  }

  const studentIds = manifest.students.map(student => student.id);
  const recipientIds = studentIds.map(String);
  await db.transaction(async (tx) => {
    const deliveries = await tx.select({ id: notificationDeliveries.id, notificationId: notificationDeliveries.notificationId })
      .from(notificationDeliveries)
      .where(and(
        eq(notificationDeliveries.recipientType, "student"),
        inArray(notificationDeliveries.recipientId, recipientIds),
      ));
    if (deliveries.length) {
      await tx.delete(notificationDeliveries).where(inArray(notificationDeliveries.id, deliveries.map(row => row.id)));
      await tx.delete(notifications).where(inArray(notifications.id, deliveries.map(row => row.notificationId)));
    }

    await tx.delete(notificationPreferences).where(and(
      eq(notificationPreferences.recipientType, "student"),
      inArray(notificationPreferences.recipientId, recipientIds),
    ));
    await tx.delete(attendanceAuditLogs).where(or(
      inArray(attendanceAuditLogs.studentId, studentIds),
      eq(attendanceAuditLogs.instructorId, manifest.instructor.id),
    ));
    await tx.delete(incarPairingAudit).where(inArray(incarPairingAudit.studentId, studentIds));
    await tx.delete(incarSessionConfirmations).where(inArray(incarSessionConfirmations.studentId, studentIds));
    await tx.delete(incarPairingOffers).where(inArray(incarPairingOffers.studentId, studentIds));
    await tx.delete(incarPairedSessions).where(or(
      inArray(incarPairedSessions.studentIdA, studentIds),
      inArray(incarPairedSessions.studentIdB, studentIds),
    ));
    await tx.delete(incarPairingQueue).where(inArray(incarPairingQueue.studentId, studentIds));
    await tx.delete(invoices).where(inArray(invoices.studentId, studentIds));
    await tx.delete(studentPaymentMethods).where(inArray(studentPaymentMethods.studentId, studentIds));
    await tx.delete(classEnrollments).where(inArray(classEnrollments.studentId, studentIds));
    await tx.delete(classes).where(eq(classes.instructorId, manifest.instructor.id));
    await tx.delete(students).where(inArray(students.id, studentIds));
    await tx.delete(instructors).where(eq(instructors.id, manifest.instructor.id));
  });

  await rm(file, { force: true });
  console.log(`Removed task295 fixture ${manifest.tag} and deleted its credentials file.`);
}

async function main() {
  const command = process.argv[2] ?? "setup";
  if (command === "setup") {
    await setup();
  } else if (command === "cleanup" && process.argv[3]) {
    await cleanup(process.argv[3]);
  } else {
    throw new Error("Usage: setup | cleanup /tmp/task295-browser-fixture-*.json");
  }
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => pool.end());