import { db } from "../server/db";
import { students } from "../shared/schema";
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
  // String - escape single quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function exportStudents() {
  console.log("Starting student export for production...");
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Get all students
  const allStudents = await db.select().from(students);
  console.log(`Found ${allStudents.length} students to export`);
  
  const totalBatches = Math.ceil(allStudents.length / BATCH_SIZE);
  console.log(`Will create ${totalBatches} batch files`);
  
  // Column list for INSERT statement
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
    
    const fileName = `${OUTPUT_DIR}/students-batch-${batch + 1}.sql`;
    
    let sql = `-- Student Export Batch ${batch + 1} of ${totalBatches}\n`;
    sql += `-- Records ${start + 1} to ${end} of ${allStudents.length}\n`;
    sql += `-- Generated: ${new Date().toISOString()}\n`;
    sql += `-- SAFE IMPORT: account_status='pending_invite', all tokens/passwords NULL\n\n`;
    
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
        student.progress || 0,
        escapeSQL(student.phase),
        student.instructorId || "NULL",
        student.favoriteInstructorId || "NULL",
        student.locationId || "NULL",
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
        "'pending_invite'", // FORCE pending_invite - no password reset emails
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
  
  // Create a combined instruction file
  const instructionsFile = `${OUTPUT_DIR}/IMPORT_INSTRUCTIONS.md`;
  const instructions = `# Production Import Instructions

## Files Generated
${Array.from({ length: totalBatches }, (_, i) => `- students-batch-${i + 1}.sql`).join("\n")}

## Total Records: ${allStudents.length}

## Safety Features
- All records have \`account_status = 'pending_invite'\`
- No password reset tokens are set
- No passwords are set
- No invite tokens are set
- Students will need to be formally invited to access the system

## Import Steps

### Option 1: Replace All Data
\`\`\`sql
-- First, truncate existing data (WARNING: This deletes all students!)
TRUNCATE TABLE students CASCADE;

-- Then run each batch file in order
\\i students-batch-1.sql
\\i students-batch-2.sql
-- ... continue for all batch files
\`\`\`

### Option 2: Merge with Existing Data
The SQL files use \`ON CONFLICT (email) DO NOTHING\` so duplicates will be skipped.
Simply run each batch file:
\`\`\`sql
\\i students-batch-1.sql
\\i students-batch-2.sql
-- ... continue for all batch files
\`\`\`

### Option 3: Using psql from command line
\`\`\`bash
psql $DATABASE_URL -f students-batch-1.sql
psql $DATABASE_URL -f students-batch-2.sql
# ... continue for all batch files
\`\`\`

## After Import
1. Verify record count: \`SELECT COUNT(*) FROM students;\`
2. Verify no active accounts: \`SELECT COUNT(*) FROM students WHERE account_status != 'pending_invite';\` (should be 0)
3. Use the admin portal to send invitations to students when ready

## Note
Students imported with \`pending_invite\` status cannot log in until they:
1. Receive an invitation email through the system
2. Complete the account setup process
`;

  fs.writeFileSync(instructionsFile, instructions);
  console.log(`\nCreated ${instructionsFile}`);
  
  console.log("\n=== Export Complete ===");
  console.log(`Total students exported: ${allStudents.length}`);
  console.log(`Batch files created: ${totalBatches}`);
  console.log(`Output directory: ${OUTPUT_DIR}/`);
}

exportStudents()
  .then(() => {
    console.log("Export finished successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  });
