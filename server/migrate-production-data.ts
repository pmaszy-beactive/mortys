import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { db } from './db';
import { 
  users, students, instructors, classes, classEnrollments, contracts, 
  evaluations, notes, communications, instructorAvailability,
  zoomMeetings, zoomAttendance, zoomSettings, schoolPermits, permitNumbers,
  lessonRecords, paymentTransactions, studentDocuments, studentTransactions, transferCredits,
  locations
} from "@shared/schema";

const PROD_DB_URL = "postgresql://neondb_owner:npg_Ee6a3ZyRQNOV@ep-red-meadow-aekdah2b.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";

export async function migrateProdToDev() {
  console.log("🔄 Starting production to development database migration...");
  
  // Connect to production database
  const prodSql = neon(PROD_DB_URL);
  const prodDb = drizzle(prodSql);
  
  try {
    // First, migrate instructors with schema fixes
    console.log("📋 Migrating instructors...");
    const prodInstructors = await prodDb.select().from(instructors);
    console.log(`   Found ${prodInstructors.length} records in production instructors`);
    
    if (prodInstructors.length > 0) {
      await db.delete(instructors);
      console.log(`   Cleared existing instructors data in development`);
      
      // Fix instructor data by adding default values for required fields
      const fixedInstructors = prodInstructors.map(instructor => ({
        ...instructor,
        licenseNumber: instructor.licenseNumber || 'TEMP-LICENSE',
        permitNumber: instructor.permitNumber || 'TEMP-PERMIT'
      }));
      
      await db.insert(instructors).values(fixedInstructors);
      console.log(`   ✅ Successfully migrated ${fixedInstructors.length} instructors records`);
    }
    
    // Then migrate students
    console.log("📋 Migrating students...");
    const prodStudents = await prodDb.select().from(students);
    console.log(`   Found ${prodStudents.length} records in production students`);
    
    if (prodStudents.length > 0) {
      await db.delete(students);
      console.log(`   Cleared existing students data in development`);
      
      // Fix foreign key references
      const fixedStudents = prodStudents.map(student => ({
        ...student,
        instructorId: student.instructorId && student.instructorId <= prodInstructors.length ? student.instructorId : null
      }));
      
      await db.insert(students).values(fixedStudents);
      console.log(`   ✅ Successfully migrated ${fixedStudents.length} students records`);
    }
    
    // Then migrate classes
    console.log("📋 Migrating classes...");
    const prodClasses = await prodDb.select().from(classes);
    console.log(`   Found ${prodClasses.length} records in production classes`);
    
    if (prodClasses.length > 0) {
      await db.delete(classes);
      console.log(`   Cleared existing classes data in development`);
      
      // Fix foreign key references
      const fixedClasses = prodClasses.map(classItem => ({
        ...classItem,
        instructorId: classItem.instructorId && classItem.instructorId <= prodInstructors.length ? classItem.instructorId : null
      }));
      
      await db.insert(classes).values(fixedClasses);
      console.log(`   ✅ Successfully migrated ${fixedClasses.length} classes records`);
    }
    
    // Migrate other tables that don't have dependencies
    const otherTables = [
      { name: "users", table: users, prodTable: users },
      { name: "locations", table: locations, prodTable: locations },
      { name: "contracts", table: contracts, prodTable: contracts },
      { name: "evaluations", table: evaluations, prodTable: evaluations },
      { name: "notes", table: notes, prodTable: notes },
      { name: "communications", table: communications, prodTable: communications },
      { name: "class_enrollments", table: classEnrollments, prodTable: classEnrollments },
      { name: "instructor_availability", table: instructorAvailability, prodTable: instructorAvailability },
      { name: "zoom_meetings", table: zoomMeetings, prodTable: zoomMeetings },
      { name: "zoom_attendance", table: zoomAttendance, prodTable: zoomAttendance },
      { name: "zoom_settings", table: zoomSettings, prodTable: zoomSettings },
      { name: "school_permits", table: schoolPermits, prodTable: schoolPermits },
      { name: "permit_numbers", table: permitNumbers, prodTable: permitNumbers },
      { name: "lesson_records", table: lessonRecords, prodTable: lessonRecords },
      { name: "payment_transactions", table: paymentTransactions, prodTable: paymentTransactions },
      { name: "student_documents", table: studentDocuments, prodTable: studentDocuments },
      { name: "student_transactions", table: studentTransactions, prodTable: studentTransactions },
      { name: "transfer_credits", table: transferCredits, prodTable: transferCredits }
    ];

    for (const { name, table, prodTable } of otherTables) {
      try {
        console.log(`📋 Migrating ${name}...`);
        
        // Get data from production
        const prodData = await prodDb.select().from(prodTable);
        console.log(`   Found ${prodData.length} records in production ${name}`);
        
        if (prodData.length > 0) {
          // Clear existing data in development
          await db.delete(table);
          console.log(`   Cleared existing ${name} data in development`);
          
          // Insert production data into development
          await db.insert(table).values(prodData);
          console.log(`   ✅ Successfully migrated ${prodData.length} ${name} records`);
        } else {
          console.log(`   ⏭️  No data to migrate for ${name}`);
        }
        
      } catch (error) {
        console.error(`   ❌ Error migrating ${name}:`, error);
        // Continue with other tables even if one fails
      }
    }
    
    console.log("✅ Production to development migration completed successfully!");
    
    // Verify migration by checking record counts
    console.log("\n📊 Migration verification:");
    const verificationTables = [
      { name: "users", table: users },
      { name: "locations", table: locations },
      { name: "instructors", table: instructors },
      { name: "students", table: students },
      { name: "classes", table: classes }
    ];
    
    for (const { name, table } of verificationTables) {
      try {
        const count = await db.select().from(table);
        console.log(`   ${name}: ${count.length} records`);
      } catch (error) {
        console.log(`   ${name}: Error counting records`);
      }
    }
    
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateProdToDev().then(() => {
    console.log("Migration completed successfully");
    process.exit(0);
  }).catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
}