import { db } from "./db";
import { instructors, students } from "@shared/schema";

/**
 * Idempotently seed the demo instructor and demo student accounts.
 *
 * Uses atomic INSERT ... ON CONFLICT (email) DO NOTHING so concurrent boots
 * can't race, and lets genuine DB errors (schema drift, connection failures)
 * propagate to the caller — the standalone dist/seed-demo.js exits non-zero on
 * such errors so the Docker entrypoint (set -e) halts the deploy instead of
 * silently starting without the demo logins.
 *
 * Called both from initializeDatabase() (local dev startup) and from the
 * dedicated dist/seed-demo.js script the Docker entrypoint runs on every deploy.
 */
export async function seedDemoAccounts() {
  // Demo records intentionally have no password. Use the authorized password
  // reset flow when interactive access to one of these accounts is required.
  const insertedInstructor = await db
    .insert(instructors)
    .values({
      firstName: "Demo",
      lastName: "Instructor",
      email: "demo.instructor@example.com",
      phone: "(514) 555-1234",
      instructorLicenseNumber: "DEMO-INST-001",
      permitNumber: "L-020-DEMO",
      hireDate: new Date().toISOString(),
      certificationExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      status: "active",
      accountStatus: "active",
      password: null,
      emergencyContact: "Demo Emergency Contact",
      emergencyPhone: "(514) 555-5678",
      specializations: JSON.stringify(["auto", "moto"]),
    })
    .onConflictDoNothing({ target: instructors.email })
    .returning({ id: instructors.id });
  console.log(
    insertedInstructor.length > 0
      ? "[seed-demo] Demo instructor account created"
      : "[seed-demo] Demo instructor account already exists",
  );

  const insertedStudent = await db
    .insert(students)
    .values({
      firstName: "Demo",
      lastName: "Student",
      email: "demo.student@example.com",
      phone: "(514) 555-9999",
      dateOfBirth: "2000-01-01",
      address: "123 Demo Street, Montreal, QC H1H 1H1",
      emergencyContact: "Demo Parent",
      emergencyPhone: "(514) 555-0000",
      courseType: "auto",
      status: "active",
      accountStatus: "active",
      password: null,
      enrollmentDate: new Date().toISOString(),
    })
    .onConflictDoNothing({ target: students.email })
    .returning({ id: students.id });
  console.log(
    insertedStudent.length > 0
      ? "[seed-demo] Demo student account created"
      : "[seed-demo] Demo student account already exists",
  );
}
