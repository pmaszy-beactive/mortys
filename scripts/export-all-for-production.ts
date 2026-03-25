import { db } from "../server/db";
import { students, instructors, locations } from "../shared/schema";
import * as fs from "fs";

const BATCH_SIZE = 5000;
const OUTPUT_DIR = "db-export";

function escapeSQL(value: any): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function exportLocations(): Promise<number> {
  console.log("\n--- Exporting Locations ---");
  const allLocations = await db.select().from(locations);
  console.log(`Found ${allLocations.length} locations`);
  
  if (allLocations.length === 0) return 0;
  
  let sql = `-- Locations Export\n`;
  sql += `-- Generated: ${new Date().toISOString()}\n\n`;
  sql += `INSERT INTO locations (id, name, address, city, province, postal_code, phone, email, is_active) VALUES\n`;
  
  const valueRows: string[] = [];
  for (const loc of allLocations) {
    valueRows.push(`(${loc.id}, ${escapeSQL(loc.name)}, ${escapeSQL(loc.address)}, ${escapeSQL(loc.city)}, ${escapeSQL(loc.province)}, ${escapeSQL(loc.postalCode)}, ${escapeSQL(loc.phone)}, ${escapeSQL(loc.email)}, ${loc.isActive === false ? 'FALSE' : 'TRUE'})`);
  }
  
  sql += valueRows.join(",\n");
  sql += `\nON CONFLICT (id) DO NOTHING;\n`;
  sql += `\n-- Reset sequence\nSELECT setval('locations_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM locations), false);\n`;
  
  fs.writeFileSync(`${OUTPUT_DIR}/01-locations.sql`, sql);
  console.log(`Created 01-locations.sql`);
  return allLocations.length;
}

async function exportInstructors(): Promise<number> {
  console.log("\n--- Exporting Instructors ---");
  const allInstructors = await db.select().from(instructors);
  console.log(`Found ${allInstructors.length} instructors`);
  
  if (allInstructors.length === 0) return 0;
  
  let sql = `-- Instructors Export\n`;
  sql += `-- Generated: ${new Date().toISOString()}\n`;
  sql += `-- Columns matched to production schema\n\n`;
  sql += `INSERT INTO instructors (id, user_id, first_name, last_name, email, phone, license_number, specializations, status, hire_date, account_status) VALUES\n`;
  
  const valueRows: string[] = [];
  for (const inst of allInstructors) {
    valueRows.push(`(${inst.id}, ${inst.userId || 'NULL'}, ${escapeSQL(inst.firstName)}, ${escapeSQL(inst.lastName)}, ${escapeSQL(inst.email)}, ${escapeSQL(inst.phone)}, ${escapeSQL(inst.licenseNumber)}, ${escapeSQL(inst.specializations)}, ${escapeSQL(inst.status || 'active')}, ${escapeSQL(inst.hireDate)}, 'pending_invite')`);
  }
  
  sql += valueRows.join(",\n");
  sql += `\nON CONFLICT (email) DO NOTHING;\n`;
  sql += `\n-- Reset sequence\nSELECT setval('instructors_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM instructors), false);\n`;
  
  fs.writeFileSync(`${OUTPUT_DIR}/02-instructors.sql`, sql);
  console.log(`Created 02-instructors.sql`);
  return allInstructors.length;
}

async function exportStudents(): Promise<number> {
  console.log("\n--- Exporting Students ---");
  const allStudents = await db.select().from(students);
  console.log(`Found ${allStudents.length} students`);
  
  const totalBatches = Math.ceil(allStudents.length / BATCH_SIZE);
  console.log(`Will create ${totalBatches} batch files`);
  
  const columns = [
    "first_name", "last_name", "email", "phone", "home_phone",
    "primary_language", "date_of_birth", "address", "city", "postal_code",
    "province", "country", "course_type", "status", "progress", "phase",
    "instructor_id", "favorite_instructor_id", "location_id",
    "attestation_number", "contract_number", "started",
    "emergency_contact", "emergency_phone",
    "legacy_id", "enrollment_date", "completion_date",
    "transferred_from", "transferred_credits",
    "total_hours_completed", "total_hours_required",
    "theory_hours_completed", "practical_hours_completed",
    "total_amount_due", "amount_paid", "payment_plan", "last_payment_date",
    "government_id", "driver_license_number", "license_expiry_date",
    "learner_permit_number", "learner_permit_expiry_date",
    "medical_certificate", "vision_test",
    "profile_photo", "digital_signature", "signature_consent",
    "test_scores", "final_exam_score", "road_test_date", "road_test_result",
    "special_needs", "accommodations", "language_preference",
    "current_theory_class", "current_in_car_session",
    "completed_theory_classes", "completed_in_car_sessions",
    "account_status",
    "email_notifications_enabled", "sms_notifications_enabled",
    "notify_upcoming_classes", "notify_schedule_changes", "notify_payment_receipts"
  ];
  
  for (let batch = 0; batch < totalBatches; batch++) {
    const start = batch * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, allStudents.length);
    const batchStudents = allStudents.slice(start, end);
    
    const batchNum = String(batch + 1).padStart(2, '0');
    const fileName = `${OUTPUT_DIR}/03-students-batch-${batchNum}.sql`;
    
    let sql = `-- Student Export Batch ${batch + 1} of ${totalBatches}\n`;
    sql += `-- Records ${start + 1} to ${end} of ${allStudents.length}\n`;
    sql += `-- Generated: ${new Date().toISOString()}\n`;
    sql += `-- SAFE IMPORT: account_status='pending_invite', no tokens/passwords\n\n`;
    
    sql += `INSERT INTO students (${columns.join(", ")}) VALUES\n`;
    
    const valueRows: string[] = [];
    
    for (const student of batchStudents) {
      const values = [
        escapeSQL(student.firstName),
        escapeSQL(student.lastName),
        escapeSQL(student.email),
        escapeSQL(student.phone || "Not provided"),
        escapeSQL(student.homePhone),
        escapeSQL(student.primaryLanguage || "English"),
        escapeSQL(student.dateOfBirth || "2000-01-01"),
        escapeSQL(student.address || "Not provided"),
        escapeSQL(student.city),
        escapeSQL(student.postalCode),
        escapeSQL(student.province),
        escapeSQL(student.country || "Canada"),
        escapeSQL(student.courseType || "auto"),
        escapeSQL(student.status || "active"),
        student.progress || 1,
        escapeSQL(student.phase),
        "NULL",
        "NULL",
        (student.locationId && student.locationId > 0) ? student.locationId : "NULL",
        escapeSQL(student.attestationNumber),
        escapeSQL(student.contractNumber),
        student.started || "NULL",
        escapeSQL(student.emergencyContact || "Not provided"),
        escapeSQL(student.emergencyPhone || "Not provided"),
        escapeSQL(student.legacyId),
        escapeSQL(student.enrollmentDate),
        escapeSQL(student.completionDate),
        escapeSQL(student.transferredFrom),
        student.transferredCredits || "NULL",
        student.totalHoursCompleted || "NULL",
        student.totalHoursRequired || "NULL",
        student.theoryHoursCompleted || "NULL",
        student.practicalHoursCompleted || "NULL",
        escapeSQL(student.totalAmountDue),
        escapeSQL(student.amountPaid),
        escapeSQL(student.paymentPlan),
        escapeSQL(student.lastPaymentDate),
        escapeSQL(student.governmentId),
        escapeSQL(student.driverLicenseNumber),
        escapeSQL(student.licenseExpiryDate),
        escapeSQL(student.learnerPermitNumber),
        escapeSQL(student.learnerPermitExpiryDate),
        student.medicalCertificate === true ? "TRUE" : student.medicalCertificate === false ? "FALSE" : "NULL",
        student.visionTest === true ? "TRUE" : student.visionTest === false ? "FALSE" : "NULL",
        escapeSQL(student.profilePhoto),
        escapeSQL(student.digitalSignature),
        student.signatureConsent === true ? "TRUE" : student.signatureConsent === false ? "FALSE" : "NULL",
        escapeSQL(student.testScores),
        student.finalExamScore || "NULL",
        escapeSQL(student.roadTestDate),
        escapeSQL(student.roadTestResult),
        escapeSQL(student.specialNeeds),
        escapeSQL(student.accommodations),
        escapeSQL(student.languagePreference),
        student.currentTheoryClass || "NULL",
        student.currentInCarSession || "NULL",
        escapeSQL(student.completedTheoryClasses),
        escapeSQL(student.completedInCarSessions),
        "'pending_invite'",
        student.emailNotificationsEnabled === false ? "FALSE" : "TRUE",
        student.smsNotificationsEnabled === true ? "TRUE" : "FALSE",
        student.notifyUpcomingClasses === false ? "FALSE" : "TRUE",
        student.notifyScheduleChanges === false ? "FALSE" : "TRUE",
        student.notifyPaymentReceipts === false ? "FALSE" : "TRUE",
      ];
      
      valueRows.push(`(${values.join(", ")})`);
    }
    
    sql += valueRows.join(",\n");
    sql += "\nON CONFLICT (email) DO NOTHING;\n";
    
    fs.writeFileSync(fileName, sql);
    console.log(`Created ${fileName} with ${batchStudents.length} records`);
  }
  
  return allStudents.length;
}

async function createImportScript(locCount: number, instCount: number, studCount: number, batchCount: number) {
  const batchFiles = Array.from({ length: batchCount }, (_, i) => 
    `03-students-batch-${String(i + 1).padStart(2, '0')}.sql`
  );
  
  const instructions = `# Production Import Instructions

## Export Summary
- **Locations:** ${locCount}
- **Instructors:** ${instCount}
- **Students:** ${studCount} (in ${batchCount} batch files)
- **Generated:** ${new Date().toISOString()}

## Files to Import (IN ORDER!)

\`\`\`
01-locations.sql      <- Import FIRST (required by instructors and students)
02-instructors.sql    <- Import SECOND (required by students)
${batchFiles.map(f => f + '           <- Import students').join('\n')}
\`\`\`

## Safety Features
- All student records have \`account_status = 'pending_invite'\`
- No passwords, tokens, or invite codes are set
- **Students cannot log in until formally invited through the admin portal**
- No password reset emails will be triggered

## Import Steps

### Step 1: Clear existing data (if replacing)
\`\`\`sql
-- WARNING: This deletes all existing data!
TRUNCATE TABLE students CASCADE;
TRUNCATE TABLE instructors CASCADE;
TRUNCATE TABLE locations CASCADE;
\`\`\`

### Step 2: Import in order
\`\`\`bash
# Import locations first
psql $DATABASE_URL -f 01-locations.sql

# Import instructors second
psql $DATABASE_URL -f 02-instructors.sql

# Import students (all batch files)
${batchFiles.map(f => `psql $DATABASE_URL -f ${f}`).join('\n')}
\`\`\`

### Step 3: Verify import
\`\`\`sql
SELECT 'locations' as table_name, COUNT(*) as count FROM locations
UNION ALL
SELECT 'instructors', COUNT(*) FROM instructors
UNION ALL
SELECT 'students', COUNT(*) FROM students;
\`\`\`

## After Import
1. Students will have \`account_status = 'pending_invite'\`
2. Use the admin portal to send invitations when ready
3. Students will receive an email with a link to set their password
`;

  fs.writeFileSync(`${OUTPUT_DIR}/IMPORT_INSTRUCTIONS.md`, instructions);
  console.log(`\nCreated IMPORT_INSTRUCTIONS.md`);
}

async function main() {
  console.log("Starting complete production export...\n");
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Remove old student batch files
  const files = fs.readdirSync(OUTPUT_DIR);
  for (const file of files) {
    if (file.startsWith('students-batch-') || file.startsWith('03-students-batch-')) {
      fs.unlinkSync(`${OUTPUT_DIR}/${file}`);
    }
  }
  
  const locCount = await exportLocations();
  const instCount = await exportInstructors();
  const studCount = await exportStudents();
  const batchCount = Math.ceil(studCount / BATCH_SIZE);
  
  await createImportScript(locCount, instCount, studCount, batchCount);
  
  console.log("\n=== Export Complete ===");
  console.log(`Locations: ${locCount}`);
  console.log(`Instructors: ${instCount}`);
  console.log(`Students: ${studCount}`);
  console.log(`Output directory: ${OUTPUT_DIR}/`);
}

main()
  .then(() => {
    console.log("\nExport finished successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  });
