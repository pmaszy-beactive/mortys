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
    // Migration order: dependencies first
    const tablesToMigrate = [
      { name: "users", table: users, prodTable: users },
      { name: "locations", table: locations, prodTable: locations },
      { name: "instructors", table: instructors, prodTable: instructors },
      { name: "students", table: students, prodTable: students },
      { name: "classes", table: classes, prodTable: classes },
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

    for (const { name, table, prodTable } of tablesToMigrate) {
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
    for (const { name, table } of tablesToMigrate) {
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