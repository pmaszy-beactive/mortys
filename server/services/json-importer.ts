/**
 * json-importer.ts
 *
 * Walks the page-level JSON produced by the legacy-site scraper
 * (scripts/migrate-site/spider.js) and idempotently upserts the data into the
 * application database.
 *
 * Source dir: IMPORT_DATA_DIR (defaults to scripts/migrate-site/migrate in dev).
 * The scraper writes one <name>_<urlHash>.json per page into nested folders that
 * mirror the legacy URL path (e.g. admin/studentfile/, QuebecAuto/CourseTransfer/).
 *
 * Idempotency:
 *   - Every page is tracked in the imported_pages table by its url_hash. A
 *     content hash lets re-imports skip files whose content has not changed.
 *   - Child records carry deterministic legacy keys (legacyContractId,
 *     legacyEvaluationId, legacyLessonId, referenceNumber) so re-running never
 *     duplicates rows.
 *
 * Safe to re-run at any time.
 */

import { db } from "../db";
import {
  students,
  contracts,
  studentTransactions,
  evaluations,
  lessonRecords,
  studentNotes,
  importedPages,
} from "@shared/schema";
import { eq, isNotNull } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getImportDataDir(): string {
  return (
    process.env.IMPORT_DATA_DIR ||
    path.join(process.cwd(), "scripts/migrate-site/migrate")
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScrapedField {
  tag: string;
  name: string;
  type: string;
  id: string;
  value: string;
  checked?: boolean;
  disabled?: boolean;
}

interface ScrapedForm {
  fields?: ScrapedField[];
  field_data?: Record<string, string>;
}

interface ScrapedTable {
  headers?: string[];
  records?: Record<string, any>[];
}

interface ScrapedPage {
  url?: string;
  final_url?: string;
  url_hash?: string;
  scraped_at?: string;
  headings?: { level: number; text: string }[];
  text_content?: string;
  forms?: ScrapedForm[];
  tables?: ScrapedTable[];
  images?: { src: string; alt?: string }[];
  label_values?: Record<string, string>;
}

export type EntityCounts = {
  created: number;
  updated: number;
  skipped: number;
};

export interface ImportSummary {
  students: EntityCounts;
  contracts: EntityCounts;
  transactions: EntityCounts;
  evaluations: EntityCounts;
  lessons: EntityCounts;
  notes: EntityCounts;
  pages: { processed: number; skipped: number; errors: number };
}

export interface ImportState {
  status: "idle" | "running" | "completed" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  currentFile: string | null;
  logs: string[];
  summary: ImportSummary;
  error: string | null;
}

function emptyCounts(): EntityCounts {
  return { created: 0, updated: 0, skipped: 0 };
}

function emptySummary(): ImportSummary {
  return {
    students: emptyCounts(),
    contracts: emptyCounts(),
    transactions: emptyCounts(),
    evaluations: emptyCounts(),
    lessons: emptyCounts(),
    notes: emptyCounts(),
    pages: { processed: 0, skipped: 0, errors: 0 },
  };
}

// ---------------------------------------------------------------------------
// Singleton run state
// ---------------------------------------------------------------------------

const MAX_LOGS = 500;

const state: ImportState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  total: 0,
  processed: 0,
  currentFile: null,
  logs: [],
  summary: emptySummary(),
  error: null,
};

export function getImportState(): ImportState {
  return state;
}

export function isImportRunning(): boolean {
  return state.status === "running";
}

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  state.logs.push(line);
  if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
  console.log(`[import] ${msg}`);
}

// ---------------------------------------------------------------------------
// File discovery + classification
// ---------------------------------------------------------------------------

export type PageType =
  | "studentfile"
  | "printcontracts"
  | "registrations"
  | "coursetransfer"
  | "onlinetest"
  | "practicalsignatures"
  | "practicaleval"
  | "zoomscreenshot"
  | "attestation"
  | "other";

function classify(relPath: string, page?: ScrapedPage): PageType {
  const u = (page?.final_url || page?.url || relPath).toLowerCase();
  if (u.includes("/admin/studentfile") || relPath.toLowerCase().includes("admin/studentfile"))
    return "studentfile";
  if (u.includes("printcontracts")) return "printcontracts";
  if (u.includes("/reports/registrations")) return "registrations";
  if (u.includes("coursetransfer")) return "coursetransfer";
  if (u.includes("onlinetest")) return "onlinetest";
  if (u.includes("practicalsignatures")) return "practicalsignatures";
  if (u.includes("practicaleval") || u.includes("closedcircuit")) return "practicaleval";
  if (u.includes("zoomscreenshot")) return "zoomscreenshot";
  if (u.includes("attestation")) return "attestation";
  return "other";
}

// Order in which page types are processed: identity/enrichment first so child
// records can attach to fully-populated students.
const TYPE_PRIORITY: Record<PageType, number> = {
  studentfile: 0,
  printcontracts: 1,
  registrations: 2,
  coursetransfer: 3,
  onlinetest: 4,
  practicalsignatures: 5,
  practicaleval: 5,
  zoomscreenshot: 5,
  attestation: 8,
  other: 9,
};

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".json") && !entry.name.startsWith("_")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Enumerate the page JSON files to import. The scraper writes a `_manifest.json`
 * index ({ pages: [{ file, url, ... }] }); we use it as the source of truth when
 * present. If it is missing or unreadable, we fall back to a recursive scan so
 * the importer still works on partial/manual data dumps.
 */
function enumerateImportFiles(dir: string): {
  files: string[];
  source: "manifest" | "scan";
} {
  if (!fs.existsSync(dir)) return { files: [], source: "scan" };
  const manifestPath = path.join(dir, "_manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const pages: any[] = Array.isArray(manifest?.pages) ? manifest.pages : [];
      const files: string[] = [];
      for (const p of pages) {
        const rel = typeof p === "string" ? p : p?.file;
        if (!rel || typeof rel !== "string") continue;
        const full = path.join(dir, rel);
        if (full.endsWith(".json") && fs.existsSync(full)) files.push(full);
      }
      if (files.length > 0) return { files, source: "manifest" };
    } catch {
      // Fall through to recursive scan on a malformed manifest.
    }
  }
  return { files: listJsonFiles(dir), source: "scan" };
}

export interface ManifestResult {
  dataDir: string;
  exists: boolean;
  total: number;
  byType: Record<string, number>;
  alreadyImported: number;
}

export async function getManifest(): Promise<ManifestResult> {
  const dataDir = getImportDataDir();
  const { files } = enumerateImportFiles(dataDir);
  const byType: Record<string, number> = {};
  for (const f of files) {
    const rel = path.relative(dataDir, f);
    const t = classify(rel);
    byType[t] = (byType[t] || 0) + 1;
  }
  let alreadyImported = 0;
  try {
    const rows = await db.select({ id: importedPages.id }).from(importedPages);
    alreadyImported = rows.length;
  } catch {
    alreadyImported = 0;
  }
  return {
    dataDir,
    exists: fs.existsSync(dataDir),
    total: files.length,
    byType,
    alreadyImported,
  };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function sha256(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parse the many legacy date formats into ISO yyyy-mm-dd. Returns null if unparseable. */
function toISODate(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // "May 10, 2021" / "Jun 29, 2021 3:00pm"
  const m1 = s.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (m1) {
    const mo = MONTHS[m1[1].toLowerCase()];
    if (mo) return `${m1[3]}-${mo}-${m1[2].padStart(2, "0")}`;
  }
  // ISO already
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // dd/mm/yyyy (Quebec convention) — also handles d/m/yyyy
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const day = slash[1].padStart(2, "0");
    const mon = slash[2].padStart(2, "0");
    return `${slash[3]}-${mon}-${day}`;
  }
  return null;
}

/** "$1,077.32" -> 1077.32 ; "($100.00)" -> -100.00 ; "" -> null */
function parseMoney(raw?: string | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.includes("-")) negative = true;
  s = s.replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return negative ? -Math.abs(n) : n;
}

function money(n: number | null | undefined): string | null {
  if (n === null || n === undefined || isNaN(n)) return null;
  return n.toFixed(2);
}

/** Split a legacy name string into first/last. Handles "Last, First" and "First Last". */
function parseName(raw?: string): { firstName: string; lastName: string } {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s) return { firstName: "Unknown", lastName: "Student" };
  if (s.includes(",")) {
    const [last, first] = s.split(",");
    return {
      firstName: (first || "").trim() || "Unknown",
      lastName: (last || "").trim() || "Student",
    };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function courseTypeFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("quebecmoto") || u.includes("/moto")) return "moto";
  if (u.includes("quebecscooter") || u.includes("scooter")) return "scooter";
  return "auto";
}

function courseTypeFromLabel(label?: string): string | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes("moto")) return "moto";
  if (l.includes("scooter") || l.includes("cyclomoteur")) return "scooter";
  if (l.includes("auto")) return "auto";
  return null;
}

/** Pull a query param (case-insensitive) from a URL. */
function queryParam(url: string | undefined, name: string): string | null {
  if (!url) return null;
  const q = url.split("?")[1];
  if (!q) return null;
  const target = name.toLowerCase();
  for (const pair of q.split("&")) {
    const [k, v] = pair.split("=");
    if (k && k.toLowerCase() === target) return decodeURIComponent(v || "");
  }
  return null;
}

function legacyIdFromPage(page: ScrapedPage): string | null {
  const url = page.final_url || page.url || "";
  return (
    queryParam(url, "studentUserId") ||
    queryParam(url, "studentuserid") ||
    page.forms?.[0]?.field_data?.studentUserId ||
    null
  );
}

// ---------------------------------------------------------------------------
// Import context: in-memory caches loaded once per run for idempotency.
// ---------------------------------------------------------------------------

interface ImportContext {
  studentByLegacy: Map<string, number>;
  studentMeta: Map<number, { hasRealEmail: boolean }>;
  contractByLegacy: Map<string, number>;
  txRefs: Set<string>;
  evalKeys: Set<string>;
  lessonKeys: Set<string>;
  noteSigs: Set<string>;
}

async function buildContext(): Promise<ImportContext> {
  const ctx: ImportContext = {
    studentByLegacy: new Map(),
    studentMeta: new Map(),
    contractByLegacy: new Map(),
    txRefs: new Set(),
    evalKeys: new Set(),
    lessonKeys: new Set(),
    noteSigs: new Set(),
  };

  const sRows = await db
    .select({ id: students.id, legacyId: students.legacyId, email: students.email })
    .from(students)
    .where(isNotNull(students.legacyId));
  for (const r of sRows) {
    if (r.legacyId) ctx.studentByLegacy.set(r.legacyId, r.id);
    ctx.studentMeta.set(r.id, {
      hasRealEmail: !!r.email && !r.email.includes("@import.mortys.local"),
    });
  }

  const cRows = await db
    .select({ id: contracts.id, legacy: contracts.legacyContractId })
    .from(contracts)
    .where(isNotNull(contracts.legacyContractId));
  for (const r of cRows) if (r.legacy) ctx.contractByLegacy.set(r.legacy, r.id);

  const txRows = await db
    .select({ ref: studentTransactions.referenceNumber })
    .from(studentTransactions)
    .where(isNotNull(studentTransactions.referenceNumber));
  for (const r of txRows) if (r.ref) ctx.txRefs.add(r.ref);

  const eRows = await db
    .select({ k: evaluations.legacyEvaluationId })
    .from(evaluations)
    .where(isNotNull(evaluations.legacyEvaluationId));
  for (const r of eRows) if (r.k) ctx.evalKeys.add(r.k);

  const lRows = await db
    .select({ k: lessonRecords.legacyLessonId })
    .from(lessonRecords)
    .where(isNotNull(lessonRecords.legacyLessonId));
  for (const r of lRows) if (r.k) ctx.lessonKeys.add(r.k);

  return ctx;
}

// ---------------------------------------------------------------------------
// Student get-or-create + enrich
// ---------------------------------------------------------------------------

async function getOrCreateStudent(
  ctx: ImportContext,
  legacyId: string,
  hints: { name?: string; courseType?: string },
  summary: ImportSummary,
): Promise<number> {
  const existing = ctx.studentByLegacy.get(legacyId);
  if (existing) return existing;

  const { firstName, lastName } = parseName(hints.name);
  const [row] = await db
    .insert(students)
    .values({
      firstName,
      lastName,
      email: `legacy-${legacyId}@import.mortys.local`,
      phone: "",
      dateOfBirth: "",
      address: "",
      courseType: hints.courseType || "auto",
      emergencyContact: "",
      emergencyPhone: "",
      status: "active",
      legacyId,
    })
    .returning({ id: students.id });

  ctx.studentByLegacy.set(legacyId, row.id);
  ctx.studentMeta.set(row.id, { hasRealEmail: false });
  summary.students.created++;
  return row.id;
}

/** Update only the columns we actually have values for; counts an update once. */
async function enrichStudent(
  studentId: number,
  patch: Record<string, any>,
  summary: ImportSummary,
) {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && v !== undefined && v !== "") clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return;
  await db.update(students).set(clean).where(eq(students.id, studentId));
  summary.students.updated++;
}

// ---------------------------------------------------------------------------
// Per-page parsers. Each returns the studentLegacyId it touched (for tracking).
// ---------------------------------------------------------------------------

async function importStudentFile(
  page: ScrapedPage,
  ctx: ImportContext,
  summary: ImportSummary,
): Promise<string | null> {
  const legacyId = legacyIdFromPage(page);
  if (!legacyId) return null;
  const url = page.final_url || page.url || "";
  const courseId = queryParam(url, "courseId") || queryParam(url, "courseid") || "0";
  const lv = page.label_values || {};
  const name = page.headings?.[0]?.text;
  const courseType =
    courseTypeFromLabel(lv["Course"]) || courseTypeFromUrl(url);

  const studentId = await getOrCreateStudent(ctx, legacyId, { name, courseType }, summary);

  // Enrich the student record with the rich admin studentfile metadata.
  await enrichStudent(
    studentId,
    {
      courseType,
      attestationNumber: lv["Attestation No"],
      contractNumber: lv["Contract No"],
      enrollmentDate: toISODate(lv["Start Date"]),
      driverLicenseNumber: lv["Class 5 Learner's License"] || lv["Class 5/6R Learner's Licence"],
      roadTestResult:
        lv["Passed SAAQ Knowledge Test?"] === "yes" ? "passed" : undefined,
    },
    summary,
  );

  // Office-use notes: any textarea field with content on the page.
  for (const form of page.forms || []) {
    for (const f of form.fields || []) {
      if (f.tag === "textarea" && f.value && f.value.trim()) {
        await upsertNote(ctx, studentId, f.value.trim(), "office", summary);
      }
    }
  }

  // Payment / charge ledger + contract from the money table.
  let courseAmount: number | null = null;
  for (const t of page.tables || []) {
    const headers = (t.headers || []).map((h) => h.toLowerCase());
    const isMoney =
      headers.includes("decription") ||
      headers.includes("description") ||
      (headers.includes("amount") && headers.includes("total"));
    if (isMoney) {
      let idx = 0;
      for (const rec of t.records || []) {
        idx++;
        const date = toISODate(rec.date);
        const desc = (rec.decription || rec.description || "").trim();
        const total = parseMoney(rec.total);
        // Skip the Balance summary row (no date) and empty rows.
        if (!date || total === null) continue;
        if (courseAmount === null && desc.toLowerCase().includes("course")) {
          courseAmount = total;
        }
        const ref = `${legacyId}_${courseId}_tx_${rec._row_index ?? idx}`;
        if (ctx.txRefs.has(ref)) {
          summary.transactions.skipped++;
          continue;
        }
        await db.insert(studentTransactions).values({
          studentId,
          date,
          description: desc || "transaction",
          amount: money(parseMoney(rec.amount)) || "0.00",
          gst: money(parseMoney(rec.gst)) || "0.00",
          pst: money(parseMoney(rec.pst)) || "0.00",
          total: money(total) || "0.00",
          transactionType: total < 0 ? "payment" : "charge",
          referenceNumber: ref,
        });
        ctx.txRefs.add(ref);
        summary.transactions.created++;
      }
    }

    // Online knowledge test results embedded as a header like "date: ... / grade: ..."
    const h0 = (t.headers || [])[0] || "";
    if (h0.toLowerCase().startsWith("date:")) {
      const testDate = toISODate(h0);
      const gradeHeader = (t.headers || []).find((h) => h.toLowerCase().includes("grade")) || "";
      const gradeMatch = gradeHeader.match(/([\d.]+)\s*%/);
      if (testDate) {
        await upsertOnlineTest(
          ctx,
          studentId,
          legacyId,
          testDate,
          gradeMatch ? parseFloat(gradeMatch[1]) : null,
          summary,
        );
      }
    }
  }

  await upsertContract(
    ctx,
    studentId,
    `${legacyId}_${courseId}`,
    {
      courseType,
      contractNumber: lv["Contract No"],
      contractDate: toISODate(lv["Start Date"]),
      amount: courseAmount,
      attestation: !!lv["Attestation No"],
    },
    summary,
  );

  return legacyId;
}

async function importPrintContract(
  page: ScrapedPage,
  ctx: ImportContext,
  summary: ImportSummary,
): Promise<string | null> {
  const legacyId = legacyIdFromPage(page);
  if (!legacyId) return null;
  const url = page.final_url || page.url || "";
  const courseId = queryParam(url, "courseId") || queryParam(url, "courseid") || "0";
  const courseType = courseTypeFromUrl(url);
  const studentId = await getOrCreateStudent(ctx, legacyId, { courseType }, summary);

  // Find the cost table ("Coût") and parse the dollar figures.
  let amount: number | null = null;
  let gst: number | null = null;
  let pst: number | null = null;
  let total: number | null = null;
  for (const t of page.tables || []) {
    const headerStr = (t.headers || []).join(" ");
    if (!/co[ûu]t/i.test(headerStr)) continue;
    const m = headerStr.match(/\$[\d,]+\.\d{2}/g);
    if (m && m.length >= 1) {
      const nums = m.map((x) => parseMoney(x)).filter((x): x is number => x !== null);
      if (nums.length >= 4) {
        amount = nums[0];
        gst = nums[1];
        pst = nums[2];
        total = nums[3];
      } else if (nums.length >= 1) {
        amount = nums[0];
        total = nums[nums.length - 1];
      }
      break;
    }
  }
  if (total === null && amount === null) return legacyId; // nothing parseable

  await upsertContract(
    ctx,
    studentId,
    `${legacyId}_${courseId}`,
    {
      courseType,
      amount: total ?? amount,
      originalAmount: amount,
      taxAmount: (gst || 0) + (pst || 0),
    },
    summary,
  );
  return legacyId;
}

async function importCourseTransfer(
  page: ScrapedPage,
  ctx: ImportContext,
  summary: ImportSummary,
): Promise<string | null> {
  const legacyId = legacyIdFromPage(page);
  if (!legacyId) return null;
  const url = page.final_url || page.url || "";
  const courseType = courseTypeFromUrl(url);
  const studentId = await getOrCreateStudent(ctx, legacyId, { courseType }, summary);

  const form = page.forms?.[0];
  if (!form) return legacyId;

  const fieldById = new Map<string, ScrapedField>();
  const checked = new Set<string>();
  let learnersPermit = "";
  let schoolName = "";
  for (const f of form.fields || []) {
    if (f.id) fieldById.set(f.id, f);
    if (f.name === "learnersPermitDate" && f.value) learnersPermit = f.value;
    if (f.name === "schoolName" && f.value) schoolName = f.value;
    if (f.type === "checkbox" && f.checked && f.name?.startsWith("components.")) {
      checked.add(f.name.replace("components.", ""));
    }
  }

  const theory: number[] = [];
  const incar: number[] = [];
  for (const key of Array.from(checked)) {
    const map = COMPONENT_MAP[key];
    if (!map) continue;
    if (map.t === "theory") theory.push(map.n);
    else incar.push(map.n);
  }
  theory.sort((a, b) => a - b);
  incar.sort((a, b) => a - b);

  const phaseNum = form.field_data?.currentPhase || "1";
  const phaseLabel = `${courseType === "auto" ? "Auto" : courseType === "moto" ? "Moto" : "Scooter"} Phase ${phaseNum}`;

  await enrichStudent(
    studentId,
    {
      phase: phaseLabel,
      completedTheoryClasses: theory.length ? theory : undefined,
      completedInCarSessions: incar.length ? incar : undefined,
      currentTheoryClass: theory.length ? theory[theory.length - 1] : undefined,
      currentInCarSession: incar.length ? incar[incar.length - 1] : undefined,
      learnerPermitValidDate: toISODate(learnersPermit),
      transferredFrom: schoolName || undefined,
    },
    summary,
  );
  return legacyId;
}

async function importPracticalSignature(
  page: ScrapedPage,
  ctx: ImportContext,
  summary: ImportSummary,
): Promise<string | null> {
  const legacyId = legacyIdFromPage(page);
  if (!legacyId) return null;
  const url = page.final_url || page.url || "";
  const courseType = courseTypeFromUrl(url);
  const fd = page.forms?.[0]?.field_data || {};
  const componentNo = fd.componentNo || queryParam(url, "courseComponentId") || "0";
  const classDate = toISODate(fd.classDate);
  if (!classDate) return legacyId;
  const studentId = await getOrCreateStudent(ctx, legacyId, { courseType }, summary);

  const key = `${legacyId}_sig_${componentNo}_${classDate}`;
  if (ctx.lessonKeys.has(key)) {
    summary.lessons.skipped++;
    return legacyId;
  }
  await db.insert(lessonRecords).values({
    studentId,
    lessonDate: classDate,
    lessonType: "practical",
    duration: 60,
    status: "completed",
    notes: `Legacy practical sign-in (component ${componentNo})${fd.instructorUserId ? `, instructor #${fd.instructorUserId}` : ""}`,
    legacyLessonId: key,
  });
  ctx.lessonKeys.add(key);
  summary.lessons.created++;
  return legacyId;
}

async function importPracticalEval(
  page: ScrapedPage,
  ctx: ImportContext,
  summary: ImportSummary,
): Promise<string | null> {
  const legacyId = legacyIdFromPage(page);
  if (!legacyId) return null;
  const url = page.final_url || page.url || "";
  const courseType = courseTypeFromUrl(url);
  const fd = page.forms?.[0]?.field_data || {};
  const componentId = fd.courseComponentId || queryParam(url, "courseComponentId") || "0";
  const studentId = await getOrCreateStudent(ctx, legacyId, { courseType }, summary);

  const key = `${legacyId}_eval_${componentId}`;
  if (ctx.evalKeys.has(key)) {
    summary.evaluations.skipped++;
    return legacyId;
  }

  // Session number from a heading like "Practical Session #15".
  let sessionNumber: number | null = null;
  for (const h of page.headings || []) {
    const m = h.text.match(/#\s*(\d+)/);
    if (m) {
      sessionNumber = parseInt(m[1], 10);
      break;
    }
  }

  await db.insert(evaluations).values({
    studentId,
    evaluationDate: toISODate(page.scraped_at) || new Date().toISOString().slice(0, 10),
    sessionType: "in-car",
    sessionNumber: sessionNumber ?? undefined,
    comments: fd.instructorComments?.trim() || undefined,
    studentSelfAssessment: fd.studentComments?.trim() || undefined,
    vehicleType: courseType,
    signedOff: !!(fd.instructorSignatureId || fd.InstructorSignatureId),
    legacyEvaluationId: key,
  });
  ctx.evalKeys.add(key);
  summary.evaluations.created++;
  return legacyId;
}

async function importZoomScreenshot(
  page: ScrapedPage,
  ctx: ImportContext,
  summary: ImportSummary,
): Promise<string | null> {
  const legacyId = legacyIdFromPage(page);
  if (!legacyId) return null;
  const url = page.final_url || page.url || "";
  const courseType = courseTypeFromUrl(url);
  const componentId = queryParam(url, "courseComponentId") || "0";
  const screenshotNo = queryParam(url, "screenshotNo") || "0";

  // Heading: "Name  -  Upload Zoom Screenshot  - Theory 1    Aug 24, 2025 3:00pm - 5:00pm"
  const heading = page.headings?.[0]?.text || "";
  const name = heading.split(" - ")[0]?.trim();
  const theoryMatch = heading.match(/Theory\s+(\d+)/i);
  const date = toISODate(heading);
  const studentId = await getOrCreateStudent(ctx, legacyId, { name, courseType }, summary);

  const key = `${legacyId}_zoom_${componentId}_${screenshotNo}`;
  if (ctx.lessonKeys.has(key)) {
    summary.lessons.skipped++;
    return legacyId;
  }
  if (!date) {
    summary.lessons.skipped++;
    return legacyId;
  }
  await db.insert(lessonRecords).values({
    studentId,
    lessonDate: date,
    lessonType: "theory",
    duration: 120,
    status: "completed",
    notes: `Zoom screenshot attendance${theoryMatch ? ` — Theory ${theoryMatch[1]}` : ""}`,
    legacyLessonId: key,
  });
  ctx.lessonKeys.add(key);
  summary.lessons.created++;
  return legacyId;
}

async function importOnlineTest(
  page: ScrapedPage,
  ctx: ImportContext,
  summary: ImportSummary,
): Promise<string | null> {
  const legacyId = legacyIdFromPage(page);
  if (!legacyId) return null;
  const url = page.final_url || page.url || "";
  const courseType = courseTypeFromUrl(url);
  // Last heading: "Name  on  Jun 7, 2021 at 8:00pm"
  const headings = page.headings || [];
  const last = headings[headings.length - 1]?.text || "";
  const name = last.split(/\s+on\s+/i)[0]?.trim();
  const date = toISODate(last);
  const studentId = await getOrCreateStudent(ctx, legacyId, { name, courseType }, summary);
  if (!date) {
    summary.evaluations.skipped++;
    return legacyId;
  }
  await upsertOnlineTest(ctx, studentId, legacyId, date, null, summary);
  return legacyId;
}

// ---------------------------------------------------------------------------
// Shared upserts
// ---------------------------------------------------------------------------

const COMPONENT_MAP: Record<string, { t: "theory" | "incar"; n: number }> = {
  "1": { t: "theory", n: 1 }, "2": { t: "theory", n: 2 }, "3": { t: "theory", n: 3 },
  "4": { t: "theory", n: 4 }, "5": { t: "theory", n: 5 }, "6": { t: "theory", n: 6 },
  "7": { t: "theory", n: 7 }, "8": { t: "theory", n: 8 }, "9": { t: "theory", n: 9 },
  "10": { t: "theory", n: 10 }, "11": { t: "theory", n: 11 }, "12": { t: "theory", n: 12 },
  "13": { t: "incar", n: 1 }, "14": { t: "incar", n: 2 }, "15": { t: "incar", n: 3 },
  "16": { t: "incar", n: 4 }, "17": { t: "incar", n: 5 }, "18": { t: "incar", n: 6 },
  "19": { t: "incar", n: 7 }, "20": { t: "incar", n: 8 }, "21": { t: "incar", n: 9 },
  "22": { t: "incar", n: 10 }, "23": { t: "incar", n: 11 }, "24": { t: "incar", n: 12 },
  "25": { t: "incar", n: 13 }, "26": { t: "incar", n: 14 }, "27": { t: "incar", n: 15 },
};

async function upsertContract(
  ctx: ImportContext,
  studentId: number,
  legacyContractId: string,
  data: {
    courseType: string;
    contractNumber?: string;
    contractDate?: string | null;
    amount?: number | null;
    originalAmount?: number | null;
    taxAmount?: number | null;
    attestation?: boolean;
  },
  summary: ImportSummary,
) {
  const existingId = ctx.contractByLegacy.get(legacyContractId);
  if (existingId) {
    const patch: Record<string, any> = {};
    if (data.amount !== null && data.amount !== undefined) patch.amount = money(data.amount);
    if (data.originalAmount !== null && data.originalAmount !== undefined)
      patch.originalAmount = money(data.originalAmount);
    if (data.taxAmount !== null && data.taxAmount !== undefined)
      patch.taxAmount = money(data.taxAmount);
    if (data.contractNumber) patch.contractNumber = data.contractNumber;
    if (Object.keys(patch).length === 0) {
      summary.contracts.skipped++;
      return;
    }
    await db.update(contracts).set(patch).where(eq(contracts.id, existingId));
    summary.contracts.updated++;
    return;
  }
  const [row] = await db
    .insert(contracts)
    .values({
      studentId,
      courseType: data.courseType,
      contractDate: data.contractDate || new Date().toISOString().slice(0, 10),
      amount: money(data.amount ?? 0) || "0.00",
      originalAmount: money(data.originalAmount ?? null),
      taxAmount: money(data.taxAmount ?? 0) || "0.00",
      paymentMethod: "transfer",
      status: "active",
      contractNumber: data.contractNumber,
      legacyContractId,
      attestationGenerated: !!data.attestation,
      autoGenerated: true,
    })
    .returning({ id: contracts.id });
  ctx.contractByLegacy.set(legacyContractId, row.id);
  summary.contracts.created++;
}

async function upsertOnlineTest(
  ctx: ImportContext,
  studentId: number,
  legacyId: string,
  isoDate: string,
  grade: number | null,
  summary: ImportSummary,
) {
  const key = `${legacyId}_test_${isoDate}`;
  if (ctx.evalKeys.has(key)) {
    summary.evaluations.skipped++;
    return;
  }
  await db.insert(evaluations).values({
    studentId,
    evaluationDate: isoDate,
    sessionType: "theory",
    overallRating: grade !== null ? Math.max(1, Math.min(5, Math.round(grade / 20))) : undefined,
    comments:
      grade !== null
        ? `Online knowledge test — grade ${grade}%`
        : "Online knowledge test (legacy)",
    legacyEvaluationId: key,
  });
  ctx.evalKeys.add(key);
  summary.evaluations.created++;
}

async function upsertNote(
  ctx: ImportContext,
  studentId: number,
  content: string,
  noteType: string,
  summary: ImportSummary,
) {
  const sig = `${studentId}:${sha256(content).slice(0, 16)}`;
  if (ctx.noteSigs.has(sig)) {
    summary.notes.skipped++;
    return;
  }
  await db.insert(studentNotes).values({
    studentId,
    authorId: "legacy-import",
    authorName: "Legacy Import",
    authorRole: "office",
    noteType,
    content,
  });
  ctx.noteSigs.add(sig);
  summary.notes.created++;
}

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------

export async function runImport(opts: { reimportAll?: boolean } = {}): Promise<void> {
  if (state.status === "running") throw new Error("Import already running");

  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.processed = 0;
  state.currentFile = null;
  state.logs = [];
  state.error = null;
  state.summary = emptySummary();

  const dataDir = getImportDataDir();
  log(`Import starting. Data dir: ${dataDir}`);

  try {
    const { files, source } = enumerateImportFiles(dataDir);
    state.total = files.length;
    if (files.length === 0) {
      log("No scraped JSON files found. Run the scraper first.");
      state.status = "completed";
      state.finishedAt = new Date().toISOString();
      return;
    }
    log(
      source === "manifest"
        ? `Found ${files.length} JSON files via _manifest.json.`
        : `Found ${files.length} JSON files (no _manifest.json — scanned data dir).`,
    );

    // Sort by processing priority (identity-rich pages first).
    files.sort((a, b) => {
      const ta = classify(path.relative(dataDir, a));
      const tb = classify(path.relative(dataDir, b));
      return TYPE_PRIORITY[ta] - TYPE_PRIORITY[tb];
    });

    const ctx = await buildContext();
    log(
      `Loaded existing keys: ${ctx.studentByLegacy.size} students, ${ctx.contractByLegacy.size} contracts.`,
    );

    // Pre-load imported_pages content hashes for skip-unchanged.
    const seen = new Map<string, string>();
    for (const r of await db
      .select({ h: importedPages.urlHash, c: importedPages.contentHash })
      .from(importedPages)) {
      seen.set(r.h, r.c);
    }

    for (const file of files) {
      state.processed++;
      const rel = path.relative(dataDir, file);
      state.currentFile = rel;

      let raw: Buffer;
      try {
        raw = fs.readFileSync(file);
      } catch (e: any) {
        summaryError(`read ${rel}: ${e.message}`);
        continue;
      }
      const contentHash = sha256(raw);

      let page: ScrapedPage;
      try {
        page = JSON.parse(raw.toString("utf8"));
      } catch (e: any) {
        summaryError(`parse ${rel}: ${e.message}`);
        continue;
      }

      const urlHash = page.url_hash || sha256(rel).slice(0, 16);
      const pageType = classify(rel, page);

      // Skip unchanged unless a full re-import is requested.
      if (!opts.reimportAll && seen.get(urlHash) === contentHash) {
        state.summary.pages.skipped++;
        continue;
      }

      try {
        let legacyId: string | null = null;
        switch (pageType) {
          case "studentfile":
            legacyId = await importStudentFile(page, ctx, state.summary);
            break;
          case "printcontracts":
            legacyId = await importPrintContract(page, ctx, state.summary);
            break;
          case "coursetransfer":
            legacyId = await importCourseTransfer(page, ctx, state.summary);
            break;
          case "practicalsignatures":
            legacyId = await importPracticalSignature(page, ctx, state.summary);
            break;
          case "practicaleval":
            legacyId = await importPracticalEval(page, ctx, state.summary);
            break;
          case "zoomscreenshot":
            legacyId = await importZoomScreenshot(page, ctx, state.summary);
            break;
          case "onlinetest":
            legacyId = await importOnlineTest(page, ctx, state.summary);
            break;
          // attestation / registrations / other: no entity data — track as processed.
          default:
            break;
        }

        await recordPage({
          urlHash,
          contentHash,
          pageType,
          url: page.final_url || page.url || rel,
          studentLegacyId: legacyId,
          status: "imported",
        });
        state.summary.pages.processed++;
      } catch (e: any) {
        summaryError(`${pageType} ${rel}: ${e.message}`);
        await recordPage({
          urlHash,
          contentHash,
          pageType,
          url: page.final_url || page.url || rel,
          studentLegacyId: null,
          status: "error",
          message: e.message?.slice(0, 500),
        }).catch(() => {});
      }

      if (state.processed % 250 === 0) {
        log(
          `Progress ${state.processed}/${state.total} — students +${state.summary.students.created}, tx +${state.summary.transactions.created}, evals +${state.summary.evaluations.created}, lessons +${state.summary.lessons.created}`,
        );
      }
    }

    log(
      `Import complete. Students ${fmt(state.summary.students)}, contracts ${fmt(state.summary.contracts)}, ` +
        `transactions ${fmt(state.summary.transactions)}, evaluations ${fmt(state.summary.evaluations)}, ` +
        `lessons ${fmt(state.summary.lessons)}, notes ${fmt(state.summary.notes)}. ` +
        `Pages: ${state.summary.pages.processed} processed, ${state.summary.pages.skipped} skipped, ${state.summary.pages.errors} errors.`,
    );
    state.status = "completed";
    state.finishedAt = new Date().toISOString();
  } catch (e: any) {
    state.error = e.message;
    state.status = "error";
    state.finishedAt = new Date().toISOString();
    log(`Import failed: ${e.message}`);
  } finally {
    state.currentFile = null;
  }
}

function fmt(c: EntityCounts): string {
  return `+${c.created}/~${c.updated}/skip ${c.skipped}`;
}

function summaryError(msg: string) {
  state.summary.pages.errors++;
  log(`ERROR ${msg}`);
}

async function recordPage(p: {
  urlHash: string;
  contentHash: string;
  pageType: string;
  url: string;
  studentLegacyId: string | null;
  status: string;
  message?: string;
}) {
  await db
    .insert(importedPages)
    .values({
      urlHash: p.urlHash,
      contentHash: p.contentHash,
      pageType: p.pageType,
      url: p.url,
      studentLegacyId: p.studentLegacyId,
      status: p.status,
      message: p.message,
      importedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: importedPages.urlHash,
      set: {
        contentHash: p.contentHash,
        pageType: p.pageType,
        status: p.status,
        studentLegacyId: p.studentLegacyId,
        message: p.message,
        importedAt: new Date(),
      },
    });
}
