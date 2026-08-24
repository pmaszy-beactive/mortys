/**
 * Class schedule time helpers.
 *
 * Class times are stored as school-local wall-clock strings (date + time) and
 * must be interpreted in the school's timezone (SCHOOL_TIMEZONE, default
 * America/Toronto) — never as server-local time, since the server may run in
 * UTC (e.g. inside Docker).
 *
 * Parsing is deliberately tolerant of common formats (12-hour AM/PM times,
 * seconds, slash-separated dates) and — critically — returns `null` for
 * anything it can't interpret instead of silently producing NaN dates.
 * A NaN start time previously made "has the class started?" return false
 * forever, wrongly blocking attendance with a misleading message.
 */

export const SCHOOL_TIMEZONE = process.env.SCHOOL_TIMEZONE || "America/Toronto";

/** Current calendar date in the school's timezone, formatted as YYYY-MM-DD. */
export function getSchoolLocalDate(at = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHOOL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Millisecond offset of `tz` from UTC at the given instant.
function timeZoneOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUtc - at.getTime();
}

/**
 * Parse a class date string into calendar parts.
 * Accepts `YYYY-MM-DD` and `YYYY/MM/DD` (one- or two-digit month/day),
 * optionally followed by a time portion (e.g. an ISO timestamp), which is
 * ignored. Returns null when unparseable or not a real calendar date.
 */
export function parseClassDate(raw: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject impossible dates like Feb 30.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * Parse a class time string into hour/minute (24h).
 * Accepts `HH:MM`, `H:MM`, `HH:MM:SS`, and 12-hour variants with AM/PM
 * (`9:00 AM`, `9:00AM`, `9 pm`, `12:30 a.m.`). Returns null when unparseable.
 */
export function parseClassTime(raw: string | null | undefined): { hour: number; minute: number } | null {
  if (raw === null || raw === undefined || typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([AaPp])?\.?\s*[Mm]?\.?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] !== undefined ? Number(m[2]) : 0;
  const meridiem = m[4] ? m[4].toLowerCase() : null;
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "p" && hour !== 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
  } else {
    if (hour > 23) return null;
  }
  return { hour, minute };
}

/**
 * Parse a class's scheduled start (school-local wall clock) into a real
 * instant. Returns null when the stored date/time can't be interpreted —
 * callers must handle that explicitly rather than treating it as
 * "hasn't started".
 */
export function getClassStartTime(classData: { date: string; time: string }): Date | null {
  const d = parseClassDate(classData.date);
  const t = parseClassTime(classData.time);
  if (!d || !t) return null;
  const utcGuess = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute, 0, 0);
  try {
    const offset = timeZoneOffsetMs(SCHOOL_TIMEZONE, new Date(utcGuess));
    return new Date(utcGuess - offset);
  } catch {
    // Invalid timezone configured — fall back to server-local interpretation.
    return new Date(d.year, d.month - 1, d.day, t.hour, t.minute, 0, 0);
  }
}

export type ClassStartCheck =
  | { status: "started"; start: Date }
  | { status: "not_started"; start: Date }
  | { status: "invalid" };

/**
 * Determine whether a class's scheduled start time has passed (optionally
 * allowing a grace window of minutes before start). Distinguishes an
 * unparseable schedule ("invalid") from a genuinely future class
 * ("not_started") so callers can respond honestly.
 */
export function checkClassStart(
  classData: { date: string; time: string },
  earlyWindowMinutes = 0,
): ClassStartCheck {
  const start = getClassStartTime(classData);
  if (!start) return { status: "invalid" };
  const started = Date.now() >= start.getTime() - earlyWindowMinutes * 60 * 1000;
  return { status: started ? "started" : "not_started", start };
}

/** Human-readable "scheduled for ..." fragment based on the stored values. */
export function formatClassSchedule(classData: { date: string; time: string }): string {
  return `${classData.date} at ${classData.time} (${SCHOOL_TIMEZONE})`;
}
