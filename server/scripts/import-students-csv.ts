import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db';
import { students } from '@shared/schema';
import { eq } from 'drizzle-orm';

interface ImportResult {
  updated: number;
  created: number;
  skipped: number;
  errors: string[];
}

function vehicleToCourseType(vehicle: string): string {
  switch (vehicle.trim()) {
    case '1': return 'auto';
    case '2': return 'moto';
    case '3': return 'scooter';
    default: return 'auto';
  }
}

function convertDate(dateStr: string): string {
  if (!dateStr || dateStr.trim() === '') return '';
  const parts = dateStr.trim().split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    let fullYear = year;
    if (year.length === 2) {
      const yearNum = parseInt(year);
      fullYear = yearNum > 50 ? `19${year}` : `20${year}`;
    }
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return dateStr;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function importStudentsFromCSV(csvFilePath: string): Promise<ImportResult> {
  const results: ImportResult = {
    updated: 0,
    created: 0,
    skipped: 0,
    errors: [],
  };

  console.log(`Reading CSV file: ${csvFilePath}`);
  const csvData = fs.readFileSync(csvFilePath, 'utf-8');
  const lines = csvData.trim().split('\n');
  const dataLines = lines.slice(1);

  console.log(`Found ${dataLines.length} student records to process`);

  const existingStudents = await db.select().from(students);
  const legacyIdMap = new Map(existingStudents.map(s => [s.legacyId, s]));

  const batchSize = 100;
  let processed = 0;

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    if (!line.trim()) continue;

    const fields = parseCSVLine(line);
    
    if (fields.length < 5) {
      results.errors.push(`Line ${i + 2}: Not enough fields`);
      results.skipped++;
      continue;
    }

    const [legacyId, firstName, lastName, dateOfBirth, vehicle] = fields;

    if (!legacyId || !firstName.trim() || !lastName.trim()) {
      results.skipped++;
      continue;
    }

    try {
      const existingStudent = legacyIdMap.get(legacyId.trim());

      if (existingStudent) {
        await db.update(students)
          .set({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            dateOfBirth: convertDate(dateOfBirth) || existingStudent.dateOfBirth,
            courseType: vehicleToCourseType(vehicle),
          })
          .where(eq(students.id, existingStudent.id));
        results.updated++;
      } else {
        await db.insert(students).values({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: `import_${legacyId.trim()}@placeholder.local`,
          phone: '0000000000',
          dateOfBirth: convertDate(dateOfBirth) || '1990-01-01',
          address: 'To be updated',
          courseType: vehicleToCourseType(vehicle),
          emergencyContact: 'To be updated',
          emergencyPhone: '0000000000',
          legacyId: legacyId.trim(),
          status: 'active',
          progress: 0,
        });
        results.created++;
      }
    } catch (err) {
      const error = err as Error;
      results.errors.push(`Line ${i + 2} (ID ${legacyId}): ${error.message}`);
      results.skipped++;
    }

    processed++;
    if (processed % batchSize === 0) {
      console.log(`Processed ${processed}/${dataLines.length} records...`);
    }
  }

  console.log(`\nImport completed:`);
  console.log(`  Created: ${results.created}`);
  console.log(`  Updated: ${results.updated}`);
  console.log(`  Skipped: ${results.skipped}`);
  if (results.errors.length > 0) {
    console.log(`  Errors (first 10):`);
    results.errors.slice(0, 10).forEach(e => console.log(`    - ${e}`));
  }

  return results;
}

const csvPath = path.join(process.cwd(), 'attached_assets/student_search_results12_1765479780885.csv');

importStudentsFromCSV(csvPath)
  .then(results => {
    console.log('\nImport finished successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
  });
