import { db } from "../server/db";
import { students, locations } from "../shared/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";

const CSV_FILE = "server/scripts/data/student_detailed_results_LastOne_5-01_updated_addresses_1768229143510.csv";

function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === "" || dateStr === "Date of Birth") return null;
  
  const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  const monthNames: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  const namedDate = dateStr.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (namedDate) {
    const [, mon, day, year] = namedDate;
    const month = monthNames[mon];
    if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
  }
  
  return null;
}

function cleanPhone(phone: string): string | null {
  if (!phone || phone.trim() === "") return null;
  return phone.trim();
}

function parseAddressBlock(addressBlock: string): {
  streetAddress: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  language: string | null;
} {
  const result = {
    streetAddress: null as string | null,
    city: null as string | null,
    province: null as string | null,
    postalCode: null as string | null,
    language: null as string | null,
  };
  
  if (!addressBlock || addressBlock.trim() === "") return result;
  
  const lines = addressBlock.split('\n').map(l => l.trim()).filter(l => l);
  
  if (lines.length < 2) return result;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    
    const dateLanguageMatch = line.match(/^([A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s+(.+)$/);
    if (dateLanguageMatch) {
      result.language = dateLanguageMatch[2].trim();
      continue;
    }
    
    const postalMatch = line.match(/^([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)$/i);
    if (postalMatch) {
      result.postalCode = postalMatch[1].toUpperCase().replace(/\s/g, ' ');
      continue;
    }
    
    if (!result.streetAddress && i === 1) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 3) {
        result.streetAddress = parts.slice(0, -2).join(', ');
        result.city = parts[parts.length - 2];
        result.province = parts[parts.length - 1];
      } else if (parts.length === 2) {
        result.streetAddress = parts[0];
        if (/^[A-Z]{2}$/i.test(parts[1])) {
          result.province = parts[1].toUpperCase();
        } else {
          result.city = parts[1];
        }
      } else {
        result.streetAddress = line;
      }
    }
  }
  
  return result;
}

// Parse CSV with proper multiline field handling
function* parseCSV(content: string): Generator<string[]> {
  let i = 0;
  const len = content.length;
  
  // Skip BOM if present
  if (content.charCodeAt(0) === 0xFEFF) i = 1;
  
  while (i < len) {
    const row: string[] = [];
    
    while (i < len) {
      let field = "";
      
      // Skip leading whitespace (but not in quoted fields)
      while (i < len && content[i] === ' ') i++;
      
      if (i < len && content[i] === '"') {
        // Quoted field
        i++; // Skip opening quote
        while (i < len) {
          if (content[i] === '"') {
            if (i + 1 < len && content[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++; // Skip closing quote
              break;
            }
          } else {
            field += content[i];
            i++;
          }
        }
      } else {
        // Unquoted field
        while (i < len && content[i] !== ',' && content[i] !== '\n' && content[i] !== '\r') {
          field += content[i];
          i++;
        }
      }
      
      row.push(field);
      
      if (i < len && content[i] === ',') {
        i++; // Skip comma
      } else {
        // End of row
        if (i < len && content[i] === '\r') i++;
        if (i < len && content[i] === '\n') i++;
        break;
      }
    }
    
    if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) {
      yield row;
    }
  }
}

async function getLocationMap(): Promise<Map<string, number>> {
  const locs = await db.select().from(locations);
  const map = new Map<string, number>();
  
  for (const loc of locs) {
    map.set(loc.name.toLowerCase(), loc.id);
    if (loc.name.toLowerCase().includes("montreal")) map.set("montreal", loc.id);
    if (loc.name.toLowerCase().includes("dollard")) {
      map.set("dollard-des-ormeaux", loc.id);
      map.set("ddo", loc.id);
    }
    if (loc.name.toLowerCase().includes("vaudreuil")) {
      map.set("vaudreuil-dorion", loc.id);
      map.set("vaudreuil", loc.id);
    }
    if (loc.name.toLowerCase().includes("laval")) map.set("laval", loc.id);
  }
  
  return map;
}

async function updateStudents() {
  console.log("Starting student update from CSV...");
  console.log("Reading CSV file...");
  
  const content = fs.readFileSync(CSV_FILE, 'utf8');
  console.log(`File size: ${(content.length / 1024 / 1024).toFixed(2)} MB`);
  
  const locationMap = await getLocationMap();
  console.log("Loaded locations:", Array.from(locationMap.keys()));
  
  const existingStudents = await db.select({
    id: students.id,
    email: students.email,
    address: students.address,
    city: students.city,
    province: students.province,
    postalCode: students.postalCode,
    primaryLanguage: students.primaryLanguage,
    homePhone: students.homePhone,
    enrollmentDate: students.enrollmentDate,
    contractNumber: students.contractNumber,
    attestationNumber: students.attestationNumber,
    learnerPermitNumber: students.learnerPermitNumber,
    locationId: students.locationId,
    legacyId: students.legacyId,
    specialNeeds: students.specialNeeds,
  }).from(students);
  
  const studentsByEmail = new Map<string, typeof existingStudents[0]>();
  for (const s of existingStudents) {
    studentsByEmail.set(s.email.toLowerCase(), s);
  }
  console.log(`Found ${studentsByEmail.size} existing students in database`);
  
  let rowNumber = 0;
  let updated = 0;
  let notFound = 0;
  let noUpdatesNeeded = 0;
  let errors = 0;
  
  console.log("Processing records...");
  
  for (const fields of parseCSV(content)) {
    rowNumber++;
    
    // Skip header
    if (rowNumber === 1) continue;
    
    const legacyId = fields[0]?.trim();
    const addressBlock = fields[6]?.trim() || "";
    const email = fields[9]?.trim()?.toLowerCase();
    const cellPhone = cleanPhone(fields[10] || "");
    const homePhone = cleanPhone(fields[11] || "");
    const courseLocation = fields[14]?.trim()?.toLowerCase();
    const enrollmentDateStr = fields[15]?.trim();
    const contractNumber = fields[16]?.trim();
    const attestationNumber = fields[17]?.trim();
    const learnerPermit = fields[19]?.trim();
    const notesRaw = fields[30]?.trim();
    
    if (!email) continue;
    
    const existingStudent = studentsByEmail.get(email);
    if (!existingStudent) {
      notFound++;
      continue;
    }
    
    const parsedAddress = parseAddressBlock(addressBlock);
    const updates: Record<string, any> = {};
    
    if ((!existingStudent.address || existingStudent.address === "Not provided") && parsedAddress.streetAddress) {
      updates.address = parsedAddress.streetAddress;
    }
    
    if (!existingStudent.city && parsedAddress.city) {
      updates.city = parsedAddress.city;
    }
    
    if (!existingStudent.province && parsedAddress.province) {
      updates.province = parsedAddress.province;
    }
    
    if (!existingStudent.postalCode && parsedAddress.postalCode) {
      updates.postalCode = parsedAddress.postalCode;
    }
    
    if ((!existingStudent.primaryLanguage || existingStudent.primaryLanguage === "English") && parsedAddress.language) {
      updates.primaryLanguage = parsedAddress.language;
    }
    
    if (!existingStudent.homePhone && homePhone) {
      updates.homePhone = homePhone;
    }
    
    const enrollmentDate = parseDate(enrollmentDateStr || "");
    if (!existingStudent.enrollmentDate && enrollmentDate) {
      updates.enrollmentDate = enrollmentDate;
    }
    
    if (!existingStudent.contractNumber && contractNumber && contractNumber !== "edit" && contractNumber !== "Contract No") {
      updates.contractNumber = contractNumber;
    }
    
    if (!existingStudent.attestationNumber && attestationNumber && attestationNumber !== "Attestation Date") {
      updates.attestationNumber = attestationNumber;
    }
    
    if (!existingStudent.learnerPermitNumber && learnerPermit && !learnerPermit.includes("Learner's")) {
      updates.learnerPermitNumber = learnerPermit;
    }
    
    if (!existingStudent.specialNeeds && notesRaw && notesRaw !== "edit") {
      const cleanedNotes = notesRaw.replace(/^Office Use Only - Notes\n?/, "").trim();
      if (cleanedNotes && cleanedNotes !== "edit") {
        updates.specialNeeds = cleanedNotes;
      }
    }
    
    if (!existingStudent.locationId && courseLocation) {
      const locId = locationMap.get(courseLocation);
      if (locId) updates.locationId = locId;
    }
    
    if (!existingStudent.legacyId && legacyId) {
      updates.legacyId = legacyId;
    }
    
    if (Object.keys(updates).length === 0) {
      noUpdatesNeeded++;
      continue;
    }
    
    try {
      await db.update(students).set(updates).where(eq(students.id, existingStudent.id));
      updated++;
      
      if (updated % 1000 === 0) {
        console.log(`Progress: ${updated} updated, ${errors} errors, ${notFound} not found (row ${rowNumber})`);
      }
    } catch (err: any) {
      errors++;
      if (errors <= 10) {
        console.error(`Error updating student ${existingStudent.id}:`, err.message);
      }
    }
  }
  
  console.log("\n=== Update Complete ===");
  console.log(`Total rows processed: ${rowNumber}`);
  console.log(`Students updated: ${updated}`);
  console.log(`Students not found in database: ${notFound}`);
  console.log(`Students with no updates needed: ${noUpdatesNeeded}`);
  console.log(`Errors: ${errors}`);
}

updateStudents()
  .then(() => {
    console.log("Update finished successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Update failed:", err);
    process.exit(1);
  });
