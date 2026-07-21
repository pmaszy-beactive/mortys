/**
 * import-gap-analysis.ts
 *
 * READ-ONLY gap analysis over the legacy scrape files that the JSON importer
 * (server/services/json-importer.ts) consumes. It answers the question:
 * "what is in the scraped files that the importer is NOT putting into the DB?"
 *
 * It NEVER writes to the database and NEVER mutates the import files. It only
 * reads the files (streaming one at a time — zoomscreenshot alone is thousands
 * of files) and produces a single structured result object covering the five
 * gap dimensions below:
 *
 *   1. Page-type coverage     — counts per classified type; `other` (no parser)
 *                               grouped by normalized URL path.
 *   2. Field-level coverage   — observed keys (label_values / field_data /
 *                               field names / table headers) per recognized type
 *                               minus the keys the parser actually reads.
 *   3. Referential gaps       — child pages whose studentUserId has no matching
 *                               studentfile page (orphans), plus reverse spot
 *                               checks (students with no contract source page).
 *   4. Parse-success / empty  — per type, count files the parser would extract
 *                               zero records from (parser brittleness).
 *   5. Value/enum mismatches  — distinct raw values for keyword-mapped fields
 *                               (course type, lesson type, reservation status)
 *                               and which would silently fall to a default.
 *
 * The engine is intentionally DB-free so it runs even without a database.
 */

import * as fs from "fs";
import * as path from "path";
import {
  classify,
  enumerateImportEntries,
  getImportDataDir,
  PARSER_CONSUMED_KEYS,
  type PageType,
  type ParserConsumedKeys,
} from "./json-importer";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface KeyCoverage {
  /** Observed keys present in the files but never read by the parser. */
  unconsumed: { key: string; fileCount: number }[];
  /** Keys the parser reads that were never seen in any file (possible drift). */
  consumedButUnseen: string[];
}

export interface FieldCoverageForType {
  filesScanned: number;
  label_values: KeyCoverage;
  field_data: KeyCoverage;
  field_names: KeyCoverage;
  table_headers: KeyCoverage;
  parserNotes?: string;
}

export interface OtherGroup {
  /** Normalized URL path (query + hash stripped, ids collapsed). */
  pathPattern: string;
  fileCount: number;
  sampleUrls: string[];
}

export interface OrphanReport {
  pageType: string;
  /** studentUserIds on this type with no matching studentfile page. */
  orphanStudentIds: number;
  totalWithStudentId: number;
  sampleOrphanIds: string[];
}

export interface EmptyExtractionReport {
  pageType: string;
  filesScanned: number;
  /** Files this type's parser would extract zero records from. */
  emptyFiles: number;
  /** Files with no studentUserId at all (the parser returns immediately). */
  missingStudentId: number;
  reason: string;
  sampleFiles: string[];
}

export interface ValueDistribution {
  field: string;
  description: string;
  values: { value: string; count: number; matched: boolean }[];
  /** Count of occurrences that silently fell to the default. */
  fellToDefault: number;
  defaultValue: string;
}

export interface GapAnalysisResult {
  generatedAt: string;
  dataDir: string;
  source: "manifest" | "scan";
  totalFiles: number;
  /** Dimension 1 */
  pageTypeCoverage: {
    byType: Record<string, number>;
    recognizedTotal: number;
    otherTotal: number;
    otherGroups: OtherGroup[];
  };
  /** Dimension 2 */
  fieldCoverage: Record<string, FieldCoverageForType>;
  /** Dimension 3 */
  referentialGaps: {
    studentFilePages: number;
    distinctStudentFileIds: number;
    orphansByType: OrphanReport[];
    studentsWithoutContractSource: {
      total: number;
      sampleIds: string[];
    };
  };
  /** Dimension 4 */
  emptyExtraction: EmptyExtractionReport[];
  /** Dimension 5 */
  valueMismatches: ValueDistribution[];
}

// ---------------------------------------------------------------------------
// Minimal page shape we read (mirrors the importer's ScrapedPage)
// ---------------------------------------------------------------------------

interface RawField {
  tag?: string;
  name?: string;
  type?: string;
  value?: string;
  checked?: boolean;
}
interface RawForm {
  fields?: RawField[];
  field_data?: Record<string, any>;
}
interface RawTable {
  headers?: string[];
  records?: Record<string, any>[];
}
interface RawPage {
  url?: string;
  final_url?: string;
  headings?: { level?: number; text?: string }[];
  forms?: RawForm[];
  tables?: RawTable[];
  images?: { src?: string }[];
  links?: { href?: string; text?: string }[];
  label_values?: Record<string, any>;
  text_content?: string;
}

const RECOGNIZED_TYPES = Object.keys(PARSER_CONSUMED_KEYS) as Exclude<
  PageType,
  "other"
>[];

// ---------------------------------------------------------------------------
// Small helpers (kept local so the engine never touches import behavior)
// ---------------------------------------------------------------------------

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

function legacyIdFromPage(page: RawPage): string | null {
  const url = page.final_url || page.url || "";
  return (
    queryParam(url, "studentUserId") ||
    queryParam(url, "studentuserid") ||
    page.forms?.[0]?.field_data?.studentUserId ||
    null
  );
}

/** Normalize a URL into a path pattern: drop query/hash, collapse numeric and
 *  hex id segments so e.g. /admin/studentfile/123 groups with /admin/studentfile/456. */
function normalizeUrlPath(rawUrl: string): string {
  let p = rawUrl;
  try {
    p = new URL(rawUrl).pathname;
  } catch {
    p = rawUrl.split("?")[0].split("#")[0];
  }
  const segs = p
    .split("/")
    .filter(Boolean)
    .map((s) => {
      if (/^\d+$/.test(s)) return "{id}";
      if (/^[0-9a-f]{8,}$/i.test(s)) return "{hash}";
      return s.toLowerCase();
    });
  return "/" + segs.join("/");
}

/** dd/mm/yyyy, ISO, or "Mon d, yyyy" → truthy if parseable (mirrors importer). */
const MONTHS = new Set([
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
]);
function looksLikeDate(raw?: string | null): boolean {
  if (!raw) return false;
  const s = String(raw).trim();
  if (!s) return false;
  const m = s.match(/([A-Za-z]{3})[a-z]*\s+\d{1,2},?\s+\d{4}/);
  if (m && MONTHS.has(m[1].toLowerCase())) return true;
  if (/\d{4}-\d{2}-\d{2}/.test(s)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return true;
  return false;
}

// Mirrors courseTypeFromLabel() in json-importer.ts exactly: a label that
// matches none of these returns null and the importer silently defaults to
// "auto" (via courseTypeFromUrl).
function courseTypeMatch(label: string): "auto" | "moto" | "scooter" | null {
  const l = label.toLowerCase();
  if (l.includes("moto")) return "moto";
  if (l.includes("scooter") || l.includes("cyclomoteur")) return "scooter";
  if (l.includes("auto")) return "auto";
  return null;
}

function topN<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

// ---------------------------------------------------------------------------
// Accumulators
// ---------------------------------------------------------------------------

interface KeyTally {
  // key -> number of files the key appeared in
  label_values: Map<string, number>;
  field_data: Map<string, number>;
  field_names: Map<string, number>;
  table_headers: Map<string, number>;
  filesScanned: number;
}

function emptyTally(): KeyTally {
  return {
    label_values: new Map(),
    field_data: new Map(),
    field_names: new Map(),
    table_headers: new Map(),
    filesScanned: 0,
  };
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

// ---------------------------------------------------------------------------
// Per-type "would extract zero records" checks (mirror the parsers, read-only)
// ---------------------------------------------------------------------------

function studentFileHasMoneyTable(page: RawPage): boolean {
  for (const t of page.tables || []) {
    const headers = (t.headers || []).map((h) => String(h).toLowerCase());
    if (
      headers.includes("decription") ||
      headers.includes("description") ||
      (headers.includes("amount") && headers.includes("total"))
    ) {
      for (const rec of t.records || []) {
        const date = looksLikeDate(rec.date);
        const total = rec.total != null && String(rec.total).trim() !== "";
        if (date && total) return true;
      }
    }
  }
  return false;
}

function printContractHasCost(page: RawPage): boolean {
  for (const t of page.tables || []) {
    const headerStr = (t.headers || []).join(" ");
    if (/co[ûu]t/i.test(headerStr) && /\$[\d,]+\.\d{2}/.test(headerStr)) {
      return true;
    }
  }
  return false;
}

function reservationsHasDatedRow(page: RawPage): boolean {
  for (const t of page.tables || []) {
    for (const rec of t.records || []) {
      for (const v of Object.values(rec)) {
        if (looksLikeDate(String(v ?? ""))) return true;
      }
    }
  }
  return false;
}

function courseTransferHasData(page: RawPage): boolean {
  const form = page.forms?.[0];
  if (!form) return false;
  const fd = form.field_data || {};
  if (fd.currentPhase || fd.learnersPermitDate) return true;
  for (const f of form.fields || []) {
    if (f.type === "checkbox" && f.checked && f.name?.startsWith("components.")) {
      return true;
    }
    if ((f.name === "learnersPermitDate" || f.name === "schoolName") && f.value) {
      return true;
    }
  }
  return false;
}

function practicalSignatureHasDate(page: RawPage): boolean {
  const fd = page.forms?.[0]?.field_data || {};
  return looksLikeDate(fd.classDate);
}

function zoomHasDate(page: RawPage): boolean {
  return looksLikeDate(page.headings?.[0]?.text);
}

function onlineTestHasDate(page: RawPage): boolean {
  const headings = page.headings || [];
  const last = headings[headings.length - 1]?.text || "";
  return looksLikeDate(last);
}

function registrationsHasStudentLinks(page: RawPage): boolean {
  for (const link of page.links || []) {
    if (queryParam(link.href, "studentUserId") || queryParam(link.href, "studentuserid")) {
      return true;
    }
  }
  return false;
}

function attestationHasNumber(page: RawPage): boolean {
  const lv = page.label_values || {};
  if (lv["Attestation No"] || lv["Attestation Number"] || lv["No. d'attestation"]) {
    return true;
  }
  // SAAQ attestation pages render as flat text; the attestation number is the
  // first pure-numeric 6–9 digit token near the front, e.g.
  // "03203701 A-106 Denis, ..." or "D200404040106 03304400 L-020 Dissou, ...".
  const tokens = (page.text_content || "").trim().split(/\s+/).slice(0, 3);
  return tokens.some((t) => /^\d{6,9}$/.test(t));
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export interface AnalyzeOptions {
  dataDir?: string;
  /** Cap on how many sample URLs/ids/files to keep per group. */
  sampleLimit?: number;
  /** Optional progress callback (called every `progressEvery` files). */
  onProgress?: (processed: number, total: number) => void;
  progressEvery?: number;
}

export async function analyzeImportGaps(
  opts: AnalyzeOptions = {},
): Promise<GapAnalysisResult> {
  const dataDir = opts.dataDir || getImportDataDir();
  const sampleLimit = opts.sampleLimit ?? 10;
  const progressEvery = opts.progressEvery ?? 1000;

  const { entries, source } = enumerateImportEntries(dataDir);
  const total = entries.length;

  // Dimension 1
  const byType: Record<string, number> = {};
  const otherGroups = new Map<string, { count: number; samples: string[] }>();

  // Dimension 2
  const tallies = new Map<PageType, KeyTally>();

  // Dimension 3
  const studentFileIds = new Set<string>();
  const studentFileWithContractSource = new Set<string>(); // ids with printcontracts OR studentfile money table
  const idsByType = new Map<string, { ids: Set<string>; total: number }>();

  // Dimension 4
  const emptyByType = new Map<
    string,
    { scanned: number; empty: number; missingId: number; samples: string[] }
  >();

  // Dimension 5
  const courseTypeValues = new Map<string, number>(); // raw course label/segment -> count
  const reservationLessonType = { theory: 0, practical: 0 };
  const reservationActivityTokens = new Map<string, number>();
  const reservationStatus = { completed: 0, cancelled: 0, noShow: 0 };

  const ensureTally = (t: PageType) => {
    let v = tallies.get(t);
    if (!v) {
      v = emptyTally();
      tallies.set(t, v);
    }
    return v;
  };
  const ensureEmpty = (t: string) => {
    let v = emptyByType.get(t);
    if (!v) {
      v = { scanned: 0, empty: 0, missingId: 0, samples: [] };
      emptyByType.set(t, v);
    }
    return v;
  };
  const ensureIds = (t: string) => {
    let v = idsByType.get(t);
    if (!v) {
      v = { ids: new Set(), total: 0 };
      idsByType.set(t, v);
    }
    return v;
  };

  let processed = 0;
  for (const entry of entries) {
    processed++;
    if (opts.onProgress && processed % progressEvery === 0) {
      opts.onProgress(processed, total);
    }

    const type = classify(entry.rel, entry.url ? ({ url: entry.url } as any) : undefined);
    byType[type] = (byType[type] || 0) + 1;

    // ----- Dimension 1: group "other" by normalized URL path -----
    if (type === "other") {
      const url = entry.url || entry.rel;
      const pattern = normalizeUrlPath(url);
      let g = otherGroups.get(pattern);
      if (!g) {
        g = { count: 0, samples: [] };
        otherGroups.set(pattern, g);
      }
      g.count++;
      if (g.samples.length < sampleLimit) g.samples.push(url);
      continue; // no parser → nothing more to inspect
    }

    // Recognized types: read + parse the file (streaming, one at a time).
    let page: RawPage;
    try {
      const raw = fs.readFileSync(entry.full, "utf8");
      page = JSON.parse(raw);
    } catch {
      continue; // unreadable/corrupt — not this tool's job to fix
    }

    const legacyId = legacyIdFromPage(page);

    // ----- Dimension 2: observed keys per type -----
    const tally = ensureTally(type);
    tally.filesScanned++;
    for (const k of Object.keys(page.label_values || {})) bump(tally.label_values, k);
    for (const form of page.forms || []) {
      for (const k of Object.keys(form.field_data || {})) bump(tally.field_data, k);
      for (const f of form.fields || []) {
        if (f.name) bump(tally.field_names, f.name);
      }
    }
    for (const t of page.tables || []) {
      const seen = new Set<string>();
      for (const h of t.headers || []) {
        const key = String(h).toLowerCase().trim();
        // Long headers are HTML blobs (addresses etc), not real column keys.
        if (key && key.length <= 40 && !seen.has(key)) {
          seen.add(key);
          bump(tally.table_headers, key);
        }
      }
      // Record keys are the real "columns" the parser reads off rows.
      for (const rec of t.records || []) {
        for (const rk of Object.keys(rec)) {
          if (rk.startsWith("_")) continue;
          const key = rk.toLowerCase().trim();
          if (key && key.length <= 40 && !seen.has(key)) {
            seen.add(key);
            bump(tally.table_headers, key);
          }
        }
      }
    }

    // ----- Dimension 3: id indexes -----
    if (type === "studentfile") {
      if (legacyId) {
        studentFileIds.add(legacyId);
        if (studentFileHasMoneyTable(page)) studentFileWithContractSource.add(legacyId);
      }
    }
    if (type === "printcontracts" && legacyId && printContractHasCost(page)) {
      studentFileWithContractSource.add(legacyId);
    }
    {
      const idx = ensureIds(type);
      if (legacyId) {
        idx.total++;
        idx.ids.add(legacyId);
      }
    }

    // ----- Dimension 4: empty extraction -----
    const emp = ensureEmpty(type);
    emp.scanned++;
    let empty = false;
    if (!legacyId && type !== "registrations") {
      emp.missingId++;
      empty = true;
    } else {
      switch (type) {
        case "studentfile":
          empty = !studentFileHasMoneyTable(page);
          break;
        case "printcontracts":
          empty = !printContractHasCost(page);
          break;
        case "coursetransfer":
          empty = !courseTransferHasData(page);
          break;
        case "practicalsignatures":
          empty = !practicalSignatureHasDate(page);
          break;
        case "practicaleval":
          empty = false; // always inserts when a studentUserId exists
          break;
        case "zoomscreenshot":
          empty = !zoomHasDate(page);
          break;
        case "onlinetest":
          empty = !onlineTestHasDate(page);
          break;
        case "reservations":
          empty = !reservationsHasDatedRow(page);
          break;
        case "registrations":
          empty = !registrationsHasStudentLinks(page);
          break;
        case "attestation":
          empty = !attestationHasNumber(page);
          break;
      }
    }
    if (empty) {
      emp.empty++;
      if (emp.samples.length < sampleLimit) emp.samples.push(entry.rel);
    }

    // ----- Dimension 5: value/enum mismatches -----
    if (type === "studentfile") {
      const course = (page.label_values || {})["Course"];
      if (course && String(course).trim()) {
        bump(courseTypeValues, String(course).trim());
      }
    }
    if (type === "reservations") {
      // The activity (Theory vs Practical) lives in the page heading, e.g.
      // "... - reserve  Theory 3" — not in the table rows. The whole page is one
      // activity type, so classify every dated row in it the same way.
      const headingText = (page.headings || [])
        .map((h) => h.text || "")
        .join(" ")
        .toLowerCase();
      const pageIsTheory = headingText.includes("theor");
      for (const t of page.tables || []) {
        for (const rec of t.records || []) {
          const values = Object.values(rec).map((v) => String(v ?? ""));
          let dated = false;
          for (const v of values) if (looksLikeDate(v)) { dated = true; break; }
          if (!dated) continue;
          const joined = values.join(" ").toLowerCase();
          if (pageIsTheory) reservationLessonType.theory++;
          else reservationLessonType.practical++;
          // Reservation rows are open, bookable slots → scheduled, unless a row
          // is explicitly cancelled / no-show.
          if (joined.includes("cancel")) reservationStatus.cancelled++;
          else if (joined.includes("no-show") || joined.includes("no show"))
            reservationStatus.noShow++;
          else reservationStatus.completed++;
        }
      }
      // Reservation heading activity token, e.g. "... - reserve  Theory 3".
      const heading = page.headings?.[0]?.text || "";
      const m = heading.split(" - ").pop();
      if (m && m.trim()) {
        const token = m.trim().replace(/\s+/g, " ");
        bump(reservationActivityTokens, token.slice(0, 60));
      }
    }
  }

  // ---- Assemble Dimension 1 ----
  const otherGroupsArr: OtherGroup[] = Array.from(otherGroups.entries())
    .map(([pathPattern, v]) => ({
      pathPattern,
      fileCount: v.count,
      sampleUrls: v.samples,
    }))
    .sort((a, b) => b.fileCount - a.fileCount);
  const recognizedTotal = RECOGNIZED_TYPES.reduce(
    (sum, t) => sum + (byType[t] || 0),
    0,
  );

  // ---- Assemble Dimension 2 ----
  const fieldCoverage: Record<string, FieldCoverageForType> = {};
  for (const t of RECOGNIZED_TYPES) {
    const tally = tallies.get(t) || emptyTally();
    const consumed = PARSER_CONSUMED_KEYS[t];
    fieldCoverage[t] = {
      filesScanned: tally.filesScanned,
      label_values: diffCoverage(tally.label_values, consumed.label_values),
      field_data: diffCoverage(tally.field_data, consumed.field_data),
      field_names: diffCoverage(tally.field_names, consumed.field_names, true),
      table_headers: diffCoverage(tally.table_headers, consumed.table_headers),
      parserNotes: consumed.notes,
    };
  }

  // ---- Assemble Dimension 3 ----
  const orphansByType: OrphanReport[] = [];
  for (const t of [
    "reservations",
    "coursetransfer",
    "onlinetest",
    "zoomscreenshot",
    "practicaleval",
    "practicalsignatures",
    "attestation",
    "printcontracts",
  ]) {
    const idx = idsByType.get(t);
    if (!idx) continue;
    const orphanIds: string[] = [];
    for (const id of Array.from(idx.ids)) {
      if (!studentFileIds.has(id)) orphanIds.push(id);
    }
    orphansByType.push({
      pageType: t,
      orphanStudentIds: orphanIds.length,
      totalWithStudentId: idx.ids.size,
      sampleOrphanIds: topN(orphanIds, sampleLimit),
    });
  }
  const studentsWithoutContractSourceIds: string[] = [];
  for (const id of Array.from(studentFileIds)) {
    if (!studentFileWithContractSource.has(id)) {
      studentsWithoutContractSourceIds.push(id);
    }
  }

  // ---- Assemble Dimension 4 ----
  const emptyExtraction: EmptyExtractionReport[] = RECOGNIZED_TYPES.map((t) => {
    const v = emptyByType.get(t) || { scanned: 0, empty: 0, missingId: 0, samples: [] };
    return {
      pageType: t,
      filesScanned: v.scanned,
      emptyFiles: v.empty,
      missingStudentId: v.missingId,
      reason: EMPTY_REASON[t],
      sampleFiles: v.samples,
    };
  });

  // ---- Assemble Dimension 5 ----
  const courseTypeDist: ValueDistribution = {
    field: "courseType (studentfile 'Course' label)",
    description:
      "Mapped via keyword match to auto/moto/scooter; unmatched values silently default to 'auto'.",
    values: Array.from(courseTypeValues.entries())
      .map(([value, count]) => ({
        value,
        count,
        matched: courseTypeMatch(value) !== null,
      }))
      .sort((a, b) => b.count - a.count),
    fellToDefault: Array.from(courseTypeValues.entries())
      .filter(([v]) => courseTypeMatch(v) === null)
      .reduce((s, [, c]) => s + c, 0),
    defaultValue: "auto",
  };
  const lessonTypeDist: ValueDistribution = {
    field: "lessonType (reservation rows)",
    description:
      "Activity is read from the page heading ('reserve Theory N' → theory; otherwise driving/practical) and applied to every dated row on the page.",
    values: [
      { value: "theory (heading says Theory)", count: reservationLessonType.theory, matched: true },
      { value: "practical / driving (heading not Theory)", count: reservationLessonType.practical, matched: true },
    ],
    fellToDefault: 0,
    defaultValue: "practical",
  };
  const statusDist: ValueDistribution = {
    field: "reservation status (reservation rows)",
    description:
      "Reservation rows are open, bookable slots → 'scheduled' (upcoming), unless a row says 'cancel' → cancelled or 'no-show' → no-show.",
    values: [
      { value: "cancelled (matched 'cancel')", count: reservationStatus.cancelled, matched: true },
      { value: "no-show (matched 'no-show')", count: reservationStatus.noShow, matched: true },
      { value: "scheduled (default)", count: reservationStatus.completed, matched: true },
    ],
    fellToDefault: 0,
    defaultValue: "scheduled",
  };
  const activityDist: ValueDistribution = {
    field: "reservation heading activity (context)",
    description:
      "Distinct trailing tokens of reservation headings (e.g. 'reserve Theory 3'). The parser reads Theory vs driving from this heading.",
    values: Array.from(reservationActivityTokens.entries())
      .map(([value, count]) => ({ value, count, matched: true }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    fellToDefault: 0,
    defaultValue: "",
  };

  return {
    generatedAt: new Date().toISOString(),
    dataDir,
    source,
    totalFiles: total,
    pageTypeCoverage: {
      byType,
      recognizedTotal,
      otherTotal: byType["other"] || 0,
      otherGroups: otherGroupsArr,
    },
    fieldCoverage,
    referentialGaps: {
      studentFilePages: byType["studentfile"] || 0,
      distinctStudentFileIds: studentFileIds.size,
      orphansByType,
      studentsWithoutContractSource: {
        total: studentsWithoutContractSourceIds.length,
        sampleIds: topN(studentsWithoutContractSourceIds, sampleLimit),
      },
    },
    emptyExtraction,
    valueMismatches: [courseTypeDist, lessonTypeDist, statusDist, activityDist],
  };
}

/** Filename of the cached report written alongside the import data. */
export const GAP_ANALYSIS_CACHE_FILE = "_gap_analysis.json";

export interface CachedGapAnalysis {
  result: GapAnalysisResult;
  /** True when the result was served from the on-disk cache, false when freshly computed. */
  cached: boolean;
  /** Age of the cached report in ms (based on its file mtime), null when freshly computed. */
  cacheAgeMs: number | null;
}

/**
 * Resolve the gap-analysis report, preferring a fresh on-disk cache over an
 * (expensive) recompute. The cache is `<dataDir>/_gap_analysis.json` — the same
 * file the CLI script writes — so the admin tool and the CLI share one cache.
 *
 * The cache is considered FRESH when its mtime is at least as new as the import
 * data's source-of-truth (`_manifest.json` when present, otherwise the data dir
 * mtime). A newer scrape therefore invalidates the cache automatically. Pass
 * `forceRefresh` to always recompute. Computing always rewrites the cache.
 *
 * NEVER writes to the database and only writes the cache JSON (never the import
 * files themselves).
 */
export async function loadOrAnalyzeImportGaps(
  opts: AnalyzeOptions & { forceRefresh?: boolean } = {},
): Promise<CachedGapAnalysis> {
  const dataDir = opts.dataDir || getImportDataDir();
  const cachePath = path.join(dataDir, GAP_ANALYSIS_CACHE_FILE);

  if (!opts.forceRefresh && fs.existsSync(cachePath)) {
    try {
      const cacheStat = fs.statSync(cachePath);
      const sourceMtime = importDataSourceMtime(dataDir);
      const fresh = sourceMtime === null || cacheStat.mtimeMs >= sourceMtime;
      if (fresh) {
        const result = JSON.parse(
          fs.readFileSync(cachePath, "utf8"),
        ) as GapAnalysisResult;
        return {
          result,
          cached: true,
          cacheAgeMs: Date.now() - cacheStat.mtimeMs,
        };
      }
    } catch {
      // Corrupt/unreadable cache — fall through to a fresh compute.
    }
  }

  const result = await analyzeImportGaps({
    dataDir,
    sampleLimit: opts.sampleLimit,
    onProgress: opts.onProgress,
    progressEvery: opts.progressEvery,
  });
  try {
    fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), "utf8");
  } catch {
    // Read-only data dir is fine — the report is still returned in-memory.
  }
  return { result, cached: false, cacheAgeMs: null };
}

/**
 * Newest modification time (ms) representing the import data's current state:
 * the `_manifest.json` mtime when present (the scraper rewrites it after each
 * run), otherwise the data dir's own mtime. Returns null when neither exists.
 */
function importDataSourceMtime(dataDir: string): number | null {
  const manifestPath = path.join(dataDir, "_manifest.json");
  try {
    if (fs.existsSync(manifestPath)) return fs.statSync(manifestPath).mtimeMs;
    if (fs.existsSync(dataDir)) return fs.statSync(dataDir).mtimeMs;
  } catch {
    return null;
  }
  return null;
}

const EMPTY_REASON: Record<Exclude<PageType, "other">, string> = {
  studentfile: "no money table (decription/description or amount+total) with a dated, totalled row",
  printcontracts: "no 'Coût' cost table with a parseable $ amount",
  registrations: "no links carrying a studentUserId",
  reservations: "no table row with a parseable date",
  coursetransfer: "no form / no phase, permit, or checked components.* checkboxes",
  onlinetest: "no parseable date in the last heading → online-test grade record skipped (question images/student stub may still import)",
  practicalsignatures: "no parseable classDate in field_data",
  practicaleval: "no studentUserId (otherwise always inserts an evaluation)",
  zoomscreenshot: "no parseable date in the first heading",
  attestation: "no attestation number found in label_values or page text → attestation-number enrichment skipped (student stub still created)",
  classes: "no classlist links carrying a scheduledClassId (e.g. a 'No Classes found.' day)",
  classlist: "no scheduledClassId in the URL",
};

/**
 * Diff observed keys against the parser's consumed keys.
 *  - unconsumed: observed but never read (the interesting gap).
 *  - consumedButUnseen: read by the parser but never observed (drift / typo).
 * `wildcard` allows a consumed entry ending in `.*` to match observed prefixes
 * (used for coursetransfer's `components.*` checkboxes).
 */
function diffCoverage(
  observed: Map<string, number>,
  consumed: string[],
  wildcard = false,
): KeyCoverage {
  const consumedLower = consumed.map((c) => c.toLowerCase());
  const isConsumed = (key: string): boolean => {
    const k = key.toLowerCase();
    for (const c of consumedLower) {
      if (c.endsWith(".*")) {
        if (wildcard && k.startsWith(c.slice(0, -1))) return true;
      } else if (c === k) {
        return true;
      }
    }
    return false;
  };
  const unconsumed: { key: string; fileCount: number }[] = [];
  const observedLower = new Set<string>();
  for (const [key, fileCount] of Array.from(observed.entries())) {
    observedLower.add(key.toLowerCase());
    if (!isConsumed(key)) unconsumed.push({ key, fileCount });
  }
  unconsumed.sort((a, b) => b.fileCount - a.fileCount);
  const consumedButUnseen = consumed.filter((c) => {
    if (c.endsWith(".*")) {
      const prefix = c.slice(0, -1).toLowerCase();
      for (const o of Array.from(observedLower)) if (o.startsWith(prefix)) return false;
      return true;
    }
    return !observedLower.has(c.toLowerCase());
  });
  return { unconsumed, consumedButUnseen };
}
