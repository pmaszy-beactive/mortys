/**
 * build-scrape-queue.ts (CLI)
 *
 * Fills the targeted-student priority queue that the nightly scrape drains
 * before its usual last-7-days registration scan. Given one or more search
 * terms (e.g. a partial first name like `pa`), it calls the legacy site's
 * student-search endpoint, turns each matching student into a `studentfile`
 * seed URL, dedupes, skips students already imported into the database, and
 * appends the survivors to a persistent queue file on the import data volume.
 *
 * This script ONLY fills the queue. The existing spider.js does all the
 * crawling (run with `--queue-file`), and the database import step is unchanged.
 *
 * Usage:
 *   tsx server/scripts/build-scrape-queue.ts pa john "smith"
 *   tsx server/scripts/build-scrape-queue.ts --file terms.txt
 *   tsx server/scripts/build-scrape-queue.ts pa --file more-terms.txt
 *
 * Env vars:
 *   MIGRATE_BASE_URL   Origin of the legacy site (default https://mortys.drivetraqr.ca)
 *   MIGRATE_COOKIE_FILE  Auth cookie file (same one the scraper uses)
 *   IMPORT_DATA_DIR / MIGRATE_OUTPUT_DIR  Used to locate the default queue file
 *   SCRAPE_QUEUE_FILE  Override the queue file path (default <output_dir>/scrape-queue.txt)
 *
 * Fails loudly (non-zero exit) if the cookie is missing/expired so it never
 * writes an empty queue silently.
 */

import * as fs from "fs";
import * as path from "path";
import { db } from "../db";
import { students } from "@shared/schema";

const BASE_URL = (process.env.MIGRATE_BASE_URL || "https://mortys.drivetraqr.ca").replace(/\/+$/, "");

function resolveCookieFile(): string {
  if (process.env.MIGRATE_COOKIE_FILE) return path.resolve(process.env.MIGRATE_COOKIE_FILE);
  if (process.env.IMPORT_DATA_DIR)
    return path.join(path.resolve(process.env.IMPORT_DATA_DIR), "cookie.txt");
  return path.join(process.cwd(), "scripts/cookie.txt");
}

// Mirrors spider.js' OUTPUT_DIR + QUEUE_FILE resolution so both agree on the
// queue file location across dev and the production container.
function resolveOutputDir(): string {
  if (process.env.MIGRATE_OUTPUT_DIR) return path.resolve(process.env.MIGRATE_OUTPUT_DIR);
  if (process.env.IMPORT_DATA_DIR)
    return path.join(path.resolve(process.env.IMPORT_DATA_DIR), "migrate");
  return path.join(process.cwd(), "scripts/migrate-site/migrate");
}

function resolveQueueFile(): string {
  if (process.env.SCRAPE_QUEUE_FILE) return path.resolve(process.env.SCRAPE_QUEUE_FILE);
  return path.join(resolveOutputDir(), "scrape-queue.txt");
}

function ts(): string {
  return new Date().toISOString();
}
const logInfo = (m: string) => console.log(`${ts()} [INFO] [queue] ${m}`);
const logWarn = (m: string) => console.error(`${ts()} [WARN] [queue] ${m}`);
const logError = (m: string) => console.error(`${ts()} [ERROR] [queue] ${m}`);

interface CliArgs {
  terms: string[];
  files: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const terms: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) {
      files.push(argv[i + 1]);
      i++;
    } else if (!a.startsWith("--")) {
      terms.push(a);
    }
  }
  return { terms, files };
}

function collectTerms(args: CliArgs): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const t of args.terms) add(t);
  for (const file of args.files) {
    const full = path.resolve(file);
    if (!fs.existsSync(full)) {
      logWarn(`Terms file not found: ${full} — skipping`);
      continue;
    }
    for (const line of fs.readFileSync(full, "utf8").split("\n")) add(line);
  }
  return out;
}

function readCookie(): string {
  const cookieFile = resolveCookieFile();
  if (!fs.existsSync(cookieFile)) {
    logError(
      `No cookie file found at ${cookieFile}. The legacy student search needs an authenticated session. ` +
        `Copy a fresh browser cookie there (or set MIGRATE_COOKIE_FILE) and re-run.`,
    );
    process.exit(1);
  }
  const cookie = fs.readFileSync(cookieFile, "utf8").trim();
  if (!cookie) {
    logError(`Cookie file ${cookieFile} is empty. Add a valid session cookie and re-run.`);
    process.exit(1);
  }
  logInfo(`Using cookie from ${cookieFile} (contents not logged).`);
  return cookie;
}

function looksLikeLoginPage(body: string): boolean {
  const b = body.toLowerCase();
  // Heuristic: a login form / password field where we expected JSON or a
  // result grid. Keep it conservative to avoid false positives.
  return (
    (b.includes("requestpasswordreset") || b.includes("name=\"password\"") || b.includes("id=\"password\"")) &&
    b.includes("login")
  );
}

interface StudentCoursePair {
  studentUserId: string;
  courseId: string;
}

/**
 * Parse the legacy student-search response into (studentUserId, courseId) pairs.
 * The endpoint's exact shape is treated defensively: we try JSON first, then
 * always also scan the raw body for `studentfile` links. A student row can
 * carry more than one course id, so every course produces its own pair.
 */
export function parseSearchResults(body: string): StudentCoursePair[] {
  const pairs: StudentCoursePair[] = [];
  const seen = new Set<string>();
  const push = (studentUserId: unknown, courseId: unknown) => {
    const sid = String(studentUserId ?? "").trim();
    const cid = String(courseId ?? "").trim();
    if (!/^\d+$/.test(sid) || !/^\d+$/.test(cid)) return;
    const key = `${sid}:${cid}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ studentUserId: sid, courseId: cid });
  };

  // 1) Structured JSON, if the endpoint returns it.
  try {
    const parsed = JSON.parse(body);
    const rows: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.results)
          ? parsed.results
          : Array.isArray(parsed?.rows)
            ? parsed.rows
            : Array.isArray(parsed?.students)
              ? parsed.students
              : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const sid =
        row.studentUserId ?? row.StudentUserId ?? row.studentId ?? row.userId ?? row.id ?? row.ID;
      // Course ids can be a single value, an array, or nested objects.
      const courseIds: unknown[] = [];
      if (row.courseId != null) courseIds.push(row.courseId);
      if (row.CourseId != null) courseIds.push(row.CourseId);
      if (Array.isArray(row.courseIds)) courseIds.push(...row.courseIds);
      if (Array.isArray(row.courses)) {
        for (const c of row.courses) {
          if (c == null) continue;
          if (typeof c === "object") courseIds.push(c.courseId ?? c.CourseId ?? c.id ?? c.ID);
          else courseIds.push(c);
        }
      }
      for (const cid of courseIds) push(sid, cid);
    }
  } catch {
    // Not JSON — fall through to the link scan.
  }

  // 2) Always scan the raw body for studentfile links (handles HTML responses
  // and any links embedded in a JSON payload). Matches both query-param orders
  // and `&amp;` HTML entities.
  const decoded = body.replace(/&amp;/gi, "&");
  const linkRe = /studentfile\/?\?[^"'<>\s]*/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(decoded)) !== null) {
    const sid = /studentUserId=(\d+)/i.exec(m[0])?.[1];
    const cid = /courseId=(\d+)/i.exec(m[0])?.[1];
    if (sid && cid) push(sid, cid);
  }

  return pairs;
}

function studentFileUrl(pair: StudentCoursePair): string {
  return `${BASE_URL}/admin/studentfile/?studentUserId=${pair.studentUserId}&courseId=${pair.courseId}`;
}

async function searchTerm(term: string, cookie: string): Promise<StudentCoursePair[]> {
  const url = `${BASE_URL}/search/studentSearch/?query=${encodeURIComponent(term)}`;
  const res = await fetch(url, {
    headers: {
      Cookie: cookie,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      Accept: "application/json, text/javascript, text/html, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "manual",
  });

  // A redirect to the login/signin page means the session cookie is expired.
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    if (/login|signin|requestpasswordreset/i.test(location)) {
      logError(
        `Search for "${term}" was redirected to login (${location}). The session cookie has expired — ` +
          `refresh it and re-run. No queue was written.`,
      );
      process.exit(1);
    }
    logError(`Search for "${term}" returned an unexpected redirect to ${location}. Aborting.`);
    process.exit(1);
  }

  if (res.status === 401 || res.status === 403) {
    logError(
      `Search for "${term}" returned HTTP ${res.status} (unauthorized). The session cookie has expired or ` +
        `lacks permission — refresh it and re-run. No queue was written.`,
    );
    process.exit(1);
  }

  if (!res.ok) {
    logError(`Search for "${term}" returned HTTP ${res.status}. Aborting (no queue written).`);
    process.exit(1);
  }

  const body = await res.text();
  if (looksLikeLoginPage(body)) {
    logError(
      `Search for "${term}" returned a login page. The session cookie has expired — refresh it and re-run. ` +
        `No queue was written.`,
    );
    process.exit(1);
  }

  return parseSearchResults(body);
}

function appendToQueueFile(queueFile: string, urls: string[]): void {
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  const payload = urls.join("\n") + "\n";
  // Append so existing pending entries are preserved.
  fs.appendFileSync(queueFile, payload);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const terms = collectTerms(args);

  if (terms.length === 0) {
    logError(
      "No search terms provided. Pass terms as arguments and/or via --file <path> (one term per line).",
    );
    console.log(
      "\nUsage:\n" +
        "  tsx server/scripts/build-scrape-queue.ts <term> [term...] [--file terms.txt]\n",
    );
    process.exit(1);
  }

  const cookie = readCookie();
  const queueFile = resolveQueueFile();
  logInfo(`Base URL: ${BASE_URL}`);
  logInfo(`Queue file: ${queueFile}`);
  logInfo(`Searching ${terms.length} term(s): ${terms.join(", ")}`);

  // Collect unique studentfile URLs across all terms (per student/course).
  const foundUrls = new Map<string, StudentCoursePair>(); // url -> pair
  for (const term of terms) {
    const pairs = await searchTerm(term, cookie);
    logInfo(`  "${term}" → ${pairs.length} student/course result(s)`);
    for (const p of pairs) {
      foundUrls.set(studentFileUrl(p), p);
    }
  }

  const totalFound = foundUrls.size;
  if (totalFound === 0) {
    logInfo("No matching students found across all terms. Queue unchanged.");
    process.exit(0);
  }

  // Skip students already imported (by legacy id == studentUserId), same lookup
  // the CSV/import code uses.
  const existing = await db.select({ legacyId: students.legacyId }).from(students);
  const importedLegacyIds = new Set(
    existing.map((s) => (s.legacyId ? String(s.legacyId).trim() : "")).filter(Boolean),
  );

  // Skip entries already in the queue file.
  const existingQueue = new Set<string>();
  if (fs.existsSync(queueFile)) {
    for (const line of fs.readFileSync(queueFile, "utf8").split("\n")) {
      const t = line.trim();
      if (t) existingQueue.add(t);
    }
  }

  let skippedImported = 0;
  let skippedDuplicate = 0;
  const toAdd: string[] = [];
  for (const [url, pair] of Array.from(foundUrls.entries())) {
    if (importedLegacyIds.has(pair.studentUserId)) {
      skippedImported++;
      continue;
    }
    if (existingQueue.has(url)) {
      skippedDuplicate++;
      continue;
    }
    existingQueue.add(url); // guard against intra-run dupes too
    toAdd.push(url);
  }

  if (toAdd.length > 0) {
    appendToQueueFile(queueFile, toAdd);
  }

  logInfo("Summary:");
  logInfo(`  found (student/course):    ${totalFound}`);
  logInfo(`  skipped (already imported): ${skippedImported}`);
  logInfo(`  skipped (duplicate):        ${skippedDuplicate}`);
  logInfo(`  added to queue:             ${toAdd.length}`);
  logInfo(`Queue file now: ${queueFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logError(`Failed: ${err?.message || err}`);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  });
