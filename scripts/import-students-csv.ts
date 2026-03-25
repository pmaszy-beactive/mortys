import { db } from "../server/db";
import { students, locations } from "../shared/schema";
import { eq, or } from "drizzle-orm";
import * as fs from "fs";
import * as readline from "readline";

const CSV_FILE = "attached_assets/student_detailed_results_LastOne_5-01_afterClearingCheckpoint_1767966163297.csv";

function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === "" || dateStr === "Date of Birth") return null;
  
  // Handle DD/MM/YYYY format
  const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Handle "Mon DD, YYYY" format (e.g., "Jun 11, 2023")
  const monthNames: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  const namedDate = dateStr.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (namedDate) {
    const [, mon, day, year] = namedDate;
    const month = monthNames[mon];
    if (month) {
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }
  
  return null;
}

function mapCourseType(courseId: string): string {
  switch (courseId) {
    case "1": return "auto";
    case "2": return "moto";
    case "3": return "scooter";
    default: return "auto";
  }
}

function cleanPhone(phone: string): string | null {
  if (!phone || phone.trim() === "") return null;
  return phone.trim();
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  
  return result;
}

async function getLocationMap(): Promise<Map<string, number>> {
  const locs = await db.select().from(locations);
  const map = new Map<string, number>();
  
  for (const loc of locs) {
    map.set(loc.name.toLowerCase(), loc.id);
    // Add common variations
    if (loc.name.toLowerCase().includes("montreal")) {
      map.set("montreal", loc.id);
    }
    if (loc.name.toLowerCase().includes("dollard")) {
      map.set("dollard-des-ormeaux", loc.id);
      map.set("ddo", loc.id);
    }
    if (loc.name.toLowerCase().includes("vaudreuil")) {
      map.set("vaudreuil-dorion", loc.id);
      map.set("vaudreuil", loc.id);
    }
    if (loc.name.toLowerCase().includes("laval")) {
      map.set("laval", loc.id);
    }
  }
  
  return map;
}

async function importStudents() {
  console.log("Starting student import...");
  
  const locationMap = await getLocationMap();
  console.log("Loaded locations:", Array.from(locationMap.keys()));
  
  // Get existing emails to skip duplicates
  const existingStudents = await db.select({ email: students.email }).from(students);
  const existingEmails = new Set(existingStudents.map(s => s.email.toLowerCase()));
  console.log(`Found ${existingEmails.size} existing students in database`);
  
  const fileStream = fs.createReadStream(CSV_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let lineNumber = 0;
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let currentRecord: string[] = [];
  let isMultiline = false;
  
  const batchSize = 100;
  let batch: any[] = [];
  
  for await (const line of rl) {
    lineNumber++;
    
    // Skip header
    if (lineNumber === 1) continue;
    
    // Handle multiline records (fields with newlines in quotes)
    if (isMultiline) {
      currentRecord[currentRecord.length - 1] += "\n" + line;
      // Check if this closes the quote
      const quoteCount = (currentRecord[currentRecord.length - 1].match(/"/g) || []).length;
      if (quoteCount % 2 === 0) {
        isMultiline = false;
      } else {
        continue;
      }
    } else {
      currentRecord = parseCSVLine(line);
      // Check if we have an unclosed quote
      const lastField = currentRecord[currentRecord.length - 1];
      const quoteCount = (lastField.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        isMultiline = true;
        continue;
      }
    }
    
    // CSV columns (0-indexed):
    // 0: Student ID, 1: Course ID, 2: First Name, 3: Last Name, 4: Date of Birth
    // 5: Personal Name, 6: Personal Address, 7: Personal Date of Birth, 8: Personal Language
    // 9: Personal Email, 10: Personal Cell Phone, 11: Personal Home Phone, 12: Personal Work Phone
    // 13: Course, 14: Course Location, 15: Course Start Date, 16: Contract No
    // 17: Attestation No, 18: Attestation Date, 19: Class 5 Learner's License, 20: Issue Date of Class 5
    // 21: On-road Instructor, 22: Theory Classes Count, 23: Theory Classes Details
    // 24: Practical Classes Count, 25: Practical Classes Details, 26: Evaluations
    // 27: Statement Transactions Count, 28: Statement Transactions Details, 29: Statement Balance
    // 30: Office Use Only Notes, 31: To Do (Instructor), 32: Up Next
    
    const fields = currentRecord;
    
    const legacyId = fields[0]?.trim();
    const courseId = fields[1]?.trim();
    const firstName = fields[2]?.trim();
    const lastName = fields[3]?.trim();
    const dateOfBirth = parseDate(fields[4]?.trim() || "");
    const email = fields[9]?.trim()?.toLowerCase();
    const cellPhone = cleanPhone(fields[10] || "");
    const homePhone = cleanPhone(fields[11] || "");
    const workPhone = cleanPhone(fields[12] || "");
    const address = fields[6]?.trim() || null;
    const courseLocation = fields[14]?.trim()?.toLowerCase();
    const enrollmentDate = parseDate(fields[15]?.trim() || "");
    const contractNumber = fields[16]?.trim();
    const attestationNumber = fields[17]?.trim();
    const learnerPermit = fields[19]?.trim();
    const notes = fields[30]?.trim();
    
    // Validate required fields
    if (!firstName || !lastName || !email) {
      skipped++;
      continue;
    }
    
    // Skip duplicates
    if (existingEmails.has(email)) {
      skipped++;
      continue;
    }
    
    // Get phone (cell phone primary)
    const phone = cellPhone || homePhone || workPhone || "Not provided";
    
    // Get emergency phone (home phone first, then work phone)
    const emergencyPhone = homePhone || workPhone || cellPhone || "Not provided";
    
    // Map location
    let locationId: number | null = null;
    if (courseLocation) {
      locationId = locationMap.get(courseLocation) || null;
    }
    
    // Prepare student record
    const studentRecord = {
      legacyId: legacyId || null,
      firstName,
      lastName,
      email,
      phone,
      homePhone: homePhone || null,
      dateOfBirth: dateOfBirth || "2000-01-01",
      address: address || "Not provided",
      courseType: mapCourseType(courseId),
      status: "active",
      progress: 0,
      locationId,
      attestationNumber: attestationNumber && attestationNumber !== "Attestation Date" ? attestationNumber : null,
      contractNumber: contractNumber && contractNumber !== "edit" && contractNumber !== "Contract No" ? contractNumber : null,
      enrollmentDate: enrollmentDate || null,
      learnerPermitNumber: learnerPermit && !learnerPermit.includes("Learner's") ? learnerPermit : null,
      emergencyContact: "Not provided",
      emergencyPhone,
      notes: notes && notes !== "edit" ? notes.replace(/^Office Use Only - Notes\n?/, "") : null,
      accountStatus: "pending_invite",
    };
    
    batch.push(studentRecord);
    existingEmails.add(email);
    
    // Insert in batches
    if (batch.length >= batchSize) {
      try {
        await db.insert(students).values(batch);
        imported += batch.length;
        console.log(`Imported ${imported} students... (line ${lineNumber})`);
      } catch (err: any) {
        // Handle individual errors
        for (const record of batch) {
          try {
            await db.insert(students).values(record);
            imported++;
          } catch (e: any) {
            errors++;
            if (errors <= 10) {
              console.error(`Error inserting ${record.email}:`, e.message);
            }
          }
        }
      }
      batch = [];
    }
  }
  
  // Insert remaining batch
  if (batch.length > 0) {
    try {
      await db.insert(students).values(batch);
      imported += batch.length;
    } catch (err) {
      for (const record of batch) {
        try {
          await db.insert(students).values(record);
          imported++;
        } catch (e: any) {
          errors++;
        }
      }
    }
  }
  
  console.log("\n=== Import Complete ===");
  console.log(`Total lines processed: ${lineNumber}`);
  console.log(`Students imported: ${imported}`);
  console.log(`Skipped (duplicates/invalid): ${skipped}`);
  console.log(`Errors: ${errors}`);
}

importStudents()
  .then(() => {
    console.log("Import finished successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
