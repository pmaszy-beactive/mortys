/**
 * nightly-scrape-log.ts
 *
 * Read-only access to the nightly registration scrape log so an operator can
 * confirm scrapes are running (and spot failures) from the admin app without
 * needing SSH access to the server.
 *
 * The cron wrapper (scripts/nightly-scrape.sh) appends each run to
 * /data/logs/nightly-scrape.log. Each run is wrapped in a recognizable header
 * block, e.g.:
 *
 *   ############################################################
 *   # Nightly registration scrape
 *   # Started:   <date>
 *   # Start date: <date> (DD/MM/YYYY), days back: 7
 *   # Output:    <dir>
 *   ############################################################
 *   ...scraper output...
 *   # Finished:  <date> (exit <code>)
 *   ############################################################
 *
 * We parse the "Started"/"Finished" markers to surface last-run time and
 * success/failure. This module never writes to or deletes the log.
 */

import * as fs from "fs";

export function getNightlyScrapeLogPath(): string {
  return process.env.NIGHTLY_SCRAPE_LOG || "/data/logs/nightly-scrape.log";
}

// Cap how much of the (append-only, unbounded) log we read into memory.
const MAX_READ_BYTES = 512 * 1024; // 512 KB tail

export interface NightlyRunInfo {
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  success: boolean | null;
}

export interface NightlyScrapeLog {
  exists: boolean;
  logPath: string;
  size: number;
  truncated: boolean;
  lines: string[];
  lastRun: NightlyRunInfo | null;
}

/**
 * Read the tail of the nightly scrape log and parse the most recent run.
 * @param maxLines Maximum number of trailing log lines to return.
 */
export async function getNightlyScrapeLog(
  maxLines = 300,
): Promise<NightlyScrapeLog> {
  const logPath = getNightlyScrapeLogPath();

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(logPath);
  } catch {
    return {
      exists: false,
      logPath,
      size: 0,
      truncated: false,
      lines: [],
      lastRun: null,
    };
  }

  const size = stat.size;
  const start = Math.max(0, size - MAX_READ_BYTES);
  const truncatedBytes = start > 0;

  let content = "";
  const handle = await fs.promises.open(logPath, "r");
  try {
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    content = buffer.toString("utf8");
  } finally {
    await handle.close();
  }

  // If we started mid-file, drop the first (likely partial) line.
  let allLines = content.split(/\r?\n/);
  if (truncatedBytes && allLines.length > 1) {
    allLines = allLines.slice(1);
  }
  // Trim a trailing empty line caused by a final newline.
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }

  const truncatedLines = allLines.length > maxLines;
  const lines = truncatedLines ? allLines.slice(-maxLines) : allLines;

  return {
    exists: true,
    logPath,
    size,
    truncated: truncatedBytes || truncatedLines,
    lines,
    lastRun: parseLastRun(allLines),
  };
}

/**
 * Walk the full set of lines we read and extract the most recent run's
 * start/finish timestamps and exit status.
 */
function parseLastRun(lines: string[]): NightlyRunInfo | null {
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  let exitCode: number | null = null;

  for (const line of lines) {
    const startMatch = line.match(/^#\s*Started:\s*(.+?)\s*$/);
    if (startMatch) {
      // A new run begins — reset finish/exit so they belong to this run.
      startedAt = startMatch[1];
      finishedAt = null;
      exitCode = null;
      continue;
    }
    const finishMatch = line.match(
      /^#\s*Finished:\s*(.+?)\s*\(exit\s+(-?\d+)\)\s*$/,
    );
    if (finishMatch) {
      finishedAt = finishMatch[1];
      exitCode = Number.parseInt(finishMatch[2], 10);
    }
  }

  if (startedAt === null && finishedAt === null && exitCode === null) {
    return null;
  }

  return {
    startedAt,
    finishedAt,
    exitCode,
    success: exitCode === null ? null : exitCode === 0,
  };
}
