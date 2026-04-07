/**
 * seed-legacy-data.ts
 *
 * Batch-imports legacy data into PostgreSQL.
 * Reads from:
 *   1. CSV file (if > 500 bytes / has real data)
 *   2. XLSX file (fallback — already present in Docker image)
 *
 * Creates students that don't exist, then attaches contracts,
 * transactions, and notes. Safe to re-run — deduplicates via legacy IDs.
 *
 * Usage:
 *   npx tsx server/scripts/seed-legacy-data.ts
 *   node dist/seed-legacy.js
 */

import { db } from "../db";
import { students, contracts, paymentTransactions, studentNotes } from "../../shared/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR  = path.join(process.cwd(), "server/scripts/data");
const CSV_FILE  = path.join(DATA_DIR, "student_detailed_results_LastOne_5-01_updated_addresses_1768229143510.csv");
const XLSX_FILE = path.join(DATA_DIR, "student_detailed_results_LastOne_5-01_afterClearingCheckpoint_1767965204407.xlsx");

const BATCH = 200;

// ---------------------------------------------------------------------------
// Row source — yields string[] rows from CSV or XLSX
// Column indices are identical in both:
//  [0]  Student ID (legacy)      [1]  Course ID
//  [2]  First Name               [3]  Last Name
//  [4]  Date of Birth            [5]  Personal Name
//  [6]  Personal Address         [8]  Personal Language
//  [9]  Personal Email           [10] Personal Cell Phone
//  [11] Personal Home Phone      [13] Course
//  [14] Course Location          [15] Course Start Date
//  [16] Contract No              [17] Attestation No
//  [18] Attestation Date         [19] Class 5/6R Learner's Licence
//  [28] Transactions             [29] Balance
//  [30] Notes
// ---------------------------------------------------------------------------
async function* sourceRows(): AsyncGenerator<string[]> {
  const csvStat = fs.existsSync(CSV_FILE) ? fs.statSync(CSV_FILE) : null;
  const useXlsx = !csvStat || csvStat.size < 500;

  if (useXlsx) {
    console.log(`  Source: XLSX (${path.basename(XLSX_FILE)})`);
    if (!fs.existsSync(XLSX_FILE)) throw new Error(`XLSX file not found: ${XLSX_FILE}`);
    // Dynamic import so esbuild bundles xlsx only when available
    const xlsx = (await import("xlsx")).default;
    const wb   = xlsx.readFile(XLSX_FILE, { cellDates: false, dense: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
    console.log(`  Rows in file: ${rows.length.toLocaleString()}`);
    let first = true;
    for (const row of rows) {
      if (first) { first = false; continue; } // skip header
      if (row.length > 1) yield row.map(String);
    }
  } else {
    console.log(`  Source: CSV (${path.basename(CSV_FILE)}, ${(csvStat!.size/1024).toFixed(0)} KB)`);
    // Streaming CSV parser (handles quoted newlines)
    const stream = fs.createReadStream(CSV_FILE, { encoding: "utf8", highWaterMark: 128 * 1024 });
    let inQuote = false, field = "", row: string[] = [], headerSkipped = false;
    for await (const chunk of stream as AsyncIterable<string>) {
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i], next = chunk[i + 1];
        if (inQuote) {
          if (c === '"' && next === '"') { field += '"'; i++; }
          else if (c === '"') inQuote = false;
          else field += c;
        } else {
          if (c === '"') inQuote = true;
          else if (c === ',') { row.push(field); field = ""; }
          else if (c === '\n') {
            row.push(field); field = "";
            if (row.length > 1) {
              if (!headerSkipped) { headerSkipped = true; }
              else yield row;
            }
            row = [];
          } else if (c !== '\r') field += c;
        }
      }
    }
    if (row.length > 1) yield [...row, field];
  }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------
const MONTHS: Record<string, string> = {
  Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
  Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"
};

function toDate(raw: string): string | null {
  const d = (raw || "").trim();
  if (!d) return null;
  const dmy = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
  const mdy = d.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,"0")}-${mdy[2].padStart(2,"0")}`;
  const mon = d.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mon && MONTHS[mon[1]]) return `${mon[3]}-${MONTHS[mon[1]]}-${mon[2].padStart(2,"0")}`;
  return null;
}

function isContractNo(s: string) { return /^\d{5,10}$/.test((s||"").trim()); }
function isAttestNo(s: string)   { return /^[A-Z0-9]{6,12}$/.test((s||"").trim()); }

function money(raw: string): string | null {
  const neg = (raw||"").trim().startsWith("(");
  const n = parseFloat((raw||"").replace(/[\$,\(\)\s]/g, ""));
  return isNaN(n) ? null : (neg ? -n : n).toFixed(2);
}

interface Tx { desc: string; date: string; amount: string; }
function parseTx(raw: string): Tx[] {
  return (raw || "").split("\n")
    .map(l => l.trim()).filter(l => l.startsWith("Desc:"))
    .map(l => ({
      desc:   ((l.match(/Desc:\s*([^|]*)/) || [])[1] || "").trim(),
      date:   ((l.match(/Date:\s*([^|]*)/) || [])[1] || "").trim(),
      amount: ((l.match(/Amt:\s*([^|]*)/) || [])[1] || "").trim(),
    })).filter(t => t.date && t.amount && t.amount !== "Amt");
}

function parseNotes(raw: string): string[] {
  return (raw || "").split("\n").map(l => l.trim())
    .filter(l => l && l !== "Office Use Only - Notes" && l !== "edit" && l.length > 3);
}

function parseAddr(raw: string): { address: string; city: string; postalCode: string } | null {
  if (!raw) return null;
  let street = "", city = "", pc = "";
  for (const line of raw.split("\n").map(l => l.trim()).filter(Boolean)) {
    const pm = line.match(/^([A-Z]\d[A-Z]\s?\d[A-Z]\d)/i);
    if (pm) { pc = pm[1].replace(/\s/, ""); continue; }
    if (/^\d/.test(line) || / rue | st | ave | blvd | dr | rd /i.test(line)) {
      const parts = line.split(",").map(p => p.trim());
      street = parts[0]; city = parts[1] || "";
    }
  }
  return street ? { address: street, city, postalCode: pc } : null;
}

function deriveCourseType(row: string[]): "auto" | "moto" | "scooter" {
  const combined = [row[1], row[13], row[19]].join(" ").toLowerCase();
  if (/6r|moto|motorcycle/.test(combined)) return "moto";
  if (/scooter/.test(combined)) return "scooter";
  return "auto";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();
  console.log("=== Legacy Data Seeder ===");
  console.log("Loading existing data from DB...");

  // Load existing students (for matching / dedup)
  const allStudents = await db.select({
    id: students.id, legacyId: students.legacyId,
    email: students.email, phone: students.phone, address: students.address
  }).from(students);

  const byLegacy = new Map<string, typeof allStudents[0]>();
  const byEmail  = new Map<string, typeof allStudents[0]>();
  for (const s of allStudents) {
    if (s.legacyId) byLegacy.set(s.legacyId, s);
    if (s.email)    byEmail.set(s.email.toLowerCase(), s);
  }
  console.log(`  ${allStudents.length.toLocaleString()} existing students`);

  const existingC = await db.select({
    id: contracts.id, legacyContractId: contracts.legacyContractId, studentId: contracts.studentId
  }).from(contracts);
  const cByLegacy  = new Map<string, number>();
  const cByStudent = new Map<number, number>();
  for (const c of existingC) {
    if (c.legacyContractId) cByLegacy.set(c.legacyContractId, c.id);
    if (c.studentId)        cByStudent.set(c.studentId, c.id);
  }
  console.log(`  ${existingC.length.toLocaleString()} existing contracts`);

  const existingTx = await db.select({ legacyTransactionId: paymentTransactions.legacyTransactionId }).from(paymentTransactions);
  const txDone = new Set<string>(existingTx.map(t => t.legacyTransactionId).filter(Boolean) as string[]);
  console.log(`  ${txDone.size.toLocaleString()} existing transactions`);

  const existingN = await db.select({ studentId: studentNotes.studentId, content: studentNotes.content }).from(studentNotes);
  const noteDone  = new Set<string>(existingN.map(n => `${n.studentId}::${n.content}`));
  console.log(`  ${noteDone.size.toLocaleString()} existing notes`);

  // Batch accumulators
  const contractBatch:  any[] = [];
  const txBatch:        any[] = [];
  const noteBatch:      any[] = [];
  const studentUpdates: { id: number; upd: Record<string, any> }[] = [];

  const fromRow = parseInt(process.argv.find(a => a.startsWith("--from-row="))?.split("=")[1] ?? "0");
  if (fromRow > 0) console.log(`Skipping to row ${fromRow.toLocaleString()}...`);

  let processed = 0, created = 0, notFound = 0;
  let contractsCreated = 0, txCreated = 0, notesCreated = 0, studentsUpdated = 0;

  async function flushContracts() {
    if (contractBatch.length === 0) return;
    const inserted = await db.insert(contracts).values(contractBatch as any).returning({
      id: contracts.id, legacyContractId: contracts.legacyContractId, studentId: contracts.studentId
    });
    for (const c of inserted) {
      if (c.legacyContractId) cByLegacy.set(c.legacyContractId, c.id);
      if (c.studentId)        cByStudent.set(c.studentId, c.id);
    }
    contractsCreated += contractBatch.length;
    contractBatch.length = 0;
  }

  async function flushTx() {
    if (txBatch.length === 0) return;
    await db.insert(paymentTransactions).values(txBatch as any);
    txCreated += txBatch.length;
    txBatch.length = 0;
  }

  async function flushNotes() {
    if (noteBatch.length === 0) return;
    await db.insert(studentNotes).values(noteBatch as any);
    notesCreated += noteBatch.length;
    noteBatch.length = 0;
  }

  async function flushStudentUpdates() {
    for (const { id, upd } of studentUpdates) {
      await db.update(students).set(upd).where(eq(students.id, id));
    }
    studentsUpdated += studentUpdates.length;
    studentUpdates.length = 0;
  }

  async function flush() {
    await flushStudentUpdates();
    await flushContracts();
    await flushTx();
    await flushNotes();
  }

  for await (const row of sourceRows()) {
    processed++;

    if (processed <= fromRow) {
      if (processed % 10000 === 0) process.stdout.write(`\r  Skipping: ${processed.toLocaleString()}/${fromRow.toLocaleString()}...   `);
      continue;
    }

    if ((processed - fromRow) % 5000 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`\r  ${processed.toLocaleString()} rows | +s:${created} +c:${contractsCreated} +tx:${txCreated} +n:${notesCreated} | ${elapsed}s   `);
    }

    if ((processed - fromRow) % BATCH === 0) await flush();

    const legacyStudentId = row[0]?.trim();
    const email           = row[9]?.trim().toLowerCase();
    const cellPhone       = row[10]?.trim();
    const homePhone       = row[11]?.trim();
    const courseLocation  = row[14]?.trim();
    const startDateRaw    = row[15]?.trim();
    const contractNoRaw   = row[16]?.trim();
    const attestNoRaw     = row[17]?.trim();
    const attestDateRaw   = row[18]?.trim();
    const txRaw           = row[28]?.trim();
    const balanceRaw      = row[29]?.trim();
    const notesRaw        = row[30]?.trim();
    const addressRaw      = row[6]?.trim();

    if (!legacyStudentId || legacyStudentId === "Student ID") continue;

    // Try to find existing student
    let student = byLegacy.get(legacyStudentId);
    if (!student && email && !email.includes("@placeholder")) student = byEmail.get(email);

    // CREATE student if not found
    if (!student) {
      const firstName = (row[2]?.trim() || "Unknown");
      const lastName  = (row[3]?.trim() || "Unknown");
      const dob       = toDate(row[4]?.trim() || "") || "01/01/2000";
      const phone     = cellPhone || homePhone || "000-000-0000";
      const lang      = row[8]?.trim() || "English";
      const courseType = deriveCourseType(row);

      // Build address
      let address = "N/A", city = "", postalCode = "";
      const parsedAddr = parseAddr(addressRaw || "");
      if (parsedAddr) { address = parsedAddr.address; city = parsedAddr.city; postalCode = parsedAddr.postalCode; }
      else if (courseLocation) city = courseLocation;

      // Generate unique placeholder email if no real email
      const studentEmail = (email && email.includes("@") && !email.includes("@placeholder"))
        ? email
        : `legacy-${legacyStudentId}@placeholder.mortys.com`;

      // Skip if email already taken (race condition in batch)
      if (byEmail.has(studentEmail)) {
        student = byEmail.get(studentEmail)!;
      } else {
        try {
          const [newStudent] = await db.insert(students).values({
            firstName,
            lastName,
            dateOfBirth: dob,
            email: studentEmail,
            phone,
            address,
            city: city || courseLocation || "",
            postalCode,
            province: "QC",
            country: "Canada",
            courseType,
            status: "active",
            progress: 0,
            primaryLanguage: lang,
            legacyId: legacyStudentId,
          } as any).returning();

          if (newStudent) {
            student = { id: newStudent.id, legacyId: legacyStudentId, email: studentEmail, phone, address };
            byLegacy.set(legacyStudentId, student);
            byEmail.set(studentEmail, student);
            created++;
          }
        } catch (e: any) {
          // Likely unique constraint on email — skip
          notFound++;
          continue;
        }
      }
    }

    if (!student) { notFound++; continue; }

    const sid = student.id;

    // ---- Student field updates (phone, address, attestation) ----
    const upd: Record<string, any> = {};
    if (email && !email.includes("@placeholder") && (!student.email || student.email.includes("@placeholder"))) upd.email = email;
    if (cellPhone && (!student.phone || student.phone === "000-000-0000")) upd.phone = cellPhone;
    else if (homePhone && (!student.phone || student.phone === "000-000-0000")) upd.phone = homePhone;
    if (addressRaw && (!student.address || student.address === "N/A")) {
      const p = parseAddr(addressRaw);
      if (p) { upd.address = p.address; if (p.city) upd.city = p.city; if (p.postalCode) upd.postalCode = p.postalCode; }
    }
    if (isAttestNo(attestNoRaw || "")) upd.attestationNumber = attestNoRaw!.trim();
    if (Object.keys(upd).length > 0) studentUpdates.push({ id: sid, upd });

    // ---- Contract ----
    const legacyKey = `${legacyStudentId}_${row[1]?.trim()}`;
    let cid: number | undefined;

    if (cByLegacy.has(legacyKey)) {
      const v = cByLegacy.get(legacyKey)!;
      cid = v > 0 ? v : undefined;
    } else {
      const existingCid = cByStudent.get(sid);
      if (existingCid && existingCid > 0) {
        cid = existingCid;
        cByLegacy.set(legacyKey, cid);
      } else {
        const startDate  = toDate(startDateRaw || "");
        const attestDate = toDate(attestDateRaw || "");
        const bal = parseFloat((balanceRaw || "").replace(/[\$,\s]/g, ""));
        const amt = isNaN(bal) ? "0.00" : Math.abs(bal).toFixed(2);
        contractBatch.push({
          studentId:        sid,
          courseType:       deriveCourseType(row),
          contractDate:     startDate ?? new Date().toISOString().slice(0, 10),
          amount:           amt,
          paymentMethod:    "transfer",
          status:           "active",
          legacyContractId: legacyKey,
          contractNumber:   isContractNo(contractNoRaw || "") ? contractNoRaw!.trim() : null,
          signedDate:       attestDate ?? startDate ?? null,
          specialNotes:     courseLocation ? `Course location: ${courseLocation}` : null,
          autoGenerated:    true,
        });
        cByLegacy.set(legacyKey, -1);
      }
    }

    // ---- Transactions ----
    for (let i = 0; i < (parseTx(txRaw || "")).length; i++) {
      const tx = parseTx(txRaw || "")[i];
      const legacyTxId = `${legacyKey}_tx${i}`;
      if (txDone.has(legacyTxId)) continue;
      const amt = money(tx.amount);
      const dt  = toDate(tx.date);
      if (!amt || !dt) continue;
      const n = parseFloat(amt);
      const desc = tx.desc.toLowerCase();
      const method = desc.includes("cash") ? "cash"
        : desc.includes("cheque") || desc.includes("check") ? "cheque"
        : desc.includes("credit") ? "credit"
        : desc.includes("debit")  ? "debit" : "etransfer";
      txBatch.push({
        studentId:          sid,
        contractId:         null,
        transactionDate:    dt,
        amount:             Math.abs(n).toFixed(2),
        paymentMethod:      method,
        transactionType:    n < 0 ? "refund" : "payment",
        notes:              tx.desc || null,
        legacyTransactionId: legacyTxId,
        processedBy:        "Legacy import",
      });
      txDone.add(legacyTxId);
    }

    // ---- Notes ----
    for (const line of parseNotes(notesRaw || "")) {
      const key = `${sid}::${line}`;
      if (noteDone.has(key)) continue;
      noteBatch.push({
        studentId:  sid,
        authorId:   "legacy-import",
        authorName: "Legacy System",
        authorRole: "admin",
        noteType:   "internal",
        content:    line,
      });
      noteDone.add(key);
    }
  }

  await flush();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n\n=== Done in ${elapsed}s ===`);
  console.log(`Rows processed:       ${processed.toLocaleString()}`);
  console.log(`Students created:     ${created.toLocaleString()}`);
  console.log(`Students updated:     ${studentsUpdated.toLocaleString()}`);
  console.log(`Contracts created:    ${contractsCreated.toLocaleString()}`);
  console.log(`Transactions created: ${txCreated.toLocaleString()}`);
  console.log(`Notes created:        ${notesCreated.toLocaleString()}`);
  console.log(`Skipped (no match):   ${notFound.toLocaleString()}`);

  if (created > 0 || contractsCreated > 0) {
    console.log("\nAll legacy data is in the database.");
  } else {
    console.log("\nNothing new to import — database is already up to date.");
  }
}

main().then(() => process.exit(0)).catch(err => { console.error("\nFATAL:", err); process.exit(1); });
