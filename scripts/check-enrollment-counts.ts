/**
 * Guards against phantom-enrollment count regressions in
 * storage.getAvailableClasses (server/storage.ts).
 *
 * Background: the query LEFT JOINs class_enrollments, and a class with zero
 * enrollments emits an all-NULL row. A naive `cancelled_at IS NULL` filter
 * counts that NULL row as one enrollment, so empty classes showed 1 enrolled
 * / max-1 spots. The fix requires `class_enrollments.id IS NOT NULL` too.
 *
 * This script seeds three classes against the dev database:
 *   A: 0 enrollments            -> expect enrolledCount 0, spotsRemaining max
 *   B: 1 active enrollment      -> expect enrolledCount 1, spotsRemaining max-1
 *   C: 1 cancelled enrollment   -> expect enrolledCount 0, spotsRemaining max
 *
 * The enrollments belong to a second (enrollee) student so the viewer student
 * still sees all three classes (the query hides classes the viewer has ever
 * been enrolled in). All seeded rows are removed in a finally block.
 *
 * Run with: npx tsx scripts/check-enrollment-counts.ts
 */
import { db, pool } from "../server/db";
import { storage } from "../server/storage";
import { classes, classEnrollments, instructors, students } from "../shared/schema";
import { eq, inArray, sql } from "drizzle-orm";

const TAG = `phantomcheck-${Date.now()}`;
const MAX_STUDENTS = 15;

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  PASS ${label}: ${actual}`);
  } else {
    console.error(`  FAIL ${label}: expected ${expected}, got ${actual}`);
    failures++;
  }
}

async function main() {
  const cleanup: { classIds: number[]; studentIds: number[]; instructorId?: number } = {
    classIds: [],
    studentIds: [],
  };

  try {
    const [instructor] = await db
      .insert(instructors)
      .values({
        firstName: "Phantom",
        lastName: "Check",
        email: `${TAG}-instructor@example.test`,
        status: "active",
      })
      .returning();
    cleanup.instructorId = instructor.id;

    const studentBase = {
      phone: "555-0100",
      dateOfBirth: "2000-01-01",
      address: "1 Test St",
      courseType: "auto",
      status: "active",
      emergencyContact: "Test Contact",
      emergencyPhone: "555-0101",
    };
    const [viewer] = await db
      .insert(students)
      .values({
        ...studentBase,
        firstName: "Viewer",
        lastName: TAG,
        email: `${TAG}-viewer@example.test`,
      })
      .returning();
    const [enrollee] = await db
      .insert(students)
      .values({
        ...studentBase,
        firstName: "Enrollee",
        lastName: TAG,
        email: `${TAG}-enrollee@example.test`,
      })
      .returning();
    cleanup.studentIds.push(viewer.id, enrollee.id);

    const classBase = {
      courseType: "auto",
      classType: "theory",
      time: "23:45",
      duration: 120,
      instructorId: instructor.id,
      maxStudents: MAX_STUDENTS,
      status: "scheduled",
      room: TAG,
    };
    const [classEmpty] = await db
      .insert(classes)
      .values({ ...classBase, classNumber: 1, date: futureDate(30) })
      .returning();
    const [classActive] = await db
      .insert(classes)
      .values({ ...classBase, classNumber: 2, date: futureDate(31) })
      .returning();
    const [classCancelled] = await db
      .insert(classes)
      .values({ ...classBase, classNumber: 3, date: futureDate(32) })
      .returning();
    cleanup.classIds.push(classEmpty.id, classActive.id, classCancelled.id);

    await db.insert(classEnrollments).values([
      { classId: classActive.id, studentId: enrollee.id, attendanceStatus: "registered" },
      {
        classId: classCancelled.id,
        studentId: enrollee.id,
        attendanceStatus: "registered",
        cancelledAt: new Date(),
      },
    ]);

    const available = await storage.getAvailableClasses(viewer.id, {
      instructorId: instructor.id,
      startDate: futureDate(30),
      endDate: futureDate(32),
    });
    const byId = new Map(available.map((c) => [c.id, c]));

    const empty = byId.get(classEmpty.id);
    const active = byId.get(classActive.id);
    const cancelled = byId.get(classCancelled.id);

    if (!empty || !active || !cancelled) {
      console.error(
        `FAIL: seeded classes missing from getAvailableClasses result (got ids: ${available
          .map((c) => c.id)
          .join(", ")})`
      );
      failures++;
    } else {
      console.log("Class with 0 enrollments:");
      assertEqual("enrolledCount", empty.enrolledCount, 0);
      assertEqual("spotsRemaining", empty.spotsRemaining, MAX_STUDENTS);

      console.log("Class with 1 active enrollment:");
      assertEqual("enrolledCount", active.enrolledCount, 1);
      assertEqual("spotsRemaining", active.spotsRemaining, MAX_STUDENTS - 1);

      console.log("Class with 1 cancelled enrollment:");
      assertEqual("enrolledCount", cancelled.enrolledCount, 0);
      assertEqual("spotsRemaining", cancelled.spotsRemaining, MAX_STUDENTS);
    }
  } finally {
    try {
      if (cleanup.classIds.length) {
        await db
          .delete(classEnrollments)
          .where(inArray(classEnrollments.classId, cleanup.classIds));
        await db.delete(classes).where(inArray(classes.id, cleanup.classIds));
      }
      if (cleanup.studentIds.length) {
        await db.delete(students).where(inArray(students.id, cleanup.studentIds));
      }
      if (cleanup.instructorId) {
        await db.delete(instructors).where(eq(instructors.id, cleanup.instructorId));
      }
    } catch (cleanupErr) {
      console.error("Cleanup failed (manual cleanup may be needed):", cleanupErr);
      failures++;
    }
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed — phantom-enrollment regression?`);
    process.exit(1);
  }
  console.log("\nAll enrollment-count assertions passed.");
}

main().catch(async (err) => {
  console.error("Check crashed:", err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
