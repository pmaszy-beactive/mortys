import { describe, it, expect } from "vitest";
import {
  parseClassDate,
  parseClassTime,
  getClassStartTime,
  checkClassStart,
  formatClassSchedule,
  SCHOOL_TIMEZONE,
} from "../services/class-time";

function localDateTimeParts(at: Date) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIMEZONE,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** School-local date/time strings for "now + offsetMinutes". */
function schoolLocal(offsetMinutes: number) {
  const at = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const p = localDateTimeParts(at);
  return {
    date: p.date,
    time24: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
    time12: `${p.hour % 12 === 0 ? 12 : p.hour % 12}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "AM" : "PM"}`,
  };
}

describe("parseClassDate", () => {
  it("parses YYYY-MM-DD", () => {
    expect(parseClassDate("2026-07-21")).toEqual({ year: 2026, month: 7, day: 21 });
  });
  it("parses slash-separated dates", () => {
    expect(parseClassDate("2026/7/3")).toEqual({ year: 2026, month: 7, day: 3 });
  });
  it("ignores a trailing time portion", () => {
    expect(parseClassDate("2026-07-21T00:00:00.000Z")).toEqual({ year: 2026, month: 7, day: 21 });
  });
  it("rejects garbage and impossible dates", () => {
    expect(parseClassDate("not-a-date")).toBeNull();
    expect(parseClassDate("")).toBeNull();
    expect(parseClassDate(undefined)).toBeNull();
    expect(parseClassDate("2026-02-30")).toBeNull();
    expect(parseClassDate("07/21/2026")).toBeNull();
  });
});

describe("parseClassTime", () => {
  it("parses 24-hour HH:MM", () => {
    expect(parseClassTime("09:00")).toEqual({ hour: 9, minute: 0 });
    expect(parseClassTime("23:45")).toEqual({ hour: 23, minute: 45 });
  });
  it("parses times with seconds", () => {
    expect(parseClassTime("14:30:00")).toEqual({ hour: 14, minute: 30 });
  });
  it("parses 12-hour AM/PM variants", () => {
    expect(parseClassTime("9:00 AM")).toEqual({ hour: 9, minute: 0 });
    expect(parseClassTime("9:00PM")).toEqual({ hour: 21, minute: 0 });
    expect(parseClassTime("12:00 am")).toEqual({ hour: 0, minute: 0 });
    expect(parseClassTime("12:30 PM")).toEqual({ hour: 12, minute: 30 });
    expect(parseClassTime("9 pm")).toEqual({ hour: 21, minute: 0 });
    expect(parseClassTime("12:30 a.m.")).toEqual({ hour: 0, minute: 30 });
  });
  it("rejects garbage and out-of-range values", () => {
    expect(parseClassTime("noon")).toBeNull();
    expect(parseClassTime("")).toBeNull();
    expect(parseClassTime(undefined)).toBeNull();
    expect(parseClassTime("25:00")).toBeNull();
    expect(parseClassTime("10:75")).toBeNull();
    expect(parseClassTime("13:00 PM")).toBeNull();
  });
});

describe("getClassStartTime", () => {
  it("returns null (never NaN) for unparseable input", () => {
    expect(getClassStartTime({ date: "bad", time: "09:00" })).toBeNull();
    expect(getClassStartTime({ date: "2026-07-21", time: "morning" })).toBeNull();
  });
  it("interprets wall clock in the school timezone", () => {
    const start = getClassStartTime({ date: "2026-07-21", time: "09:00" })!;
    expect(start).not.toBeNull();
    const p = localDateTimeParts(start);
    expect(p.date).toBe("2026-07-21");
    expect(p.hour).toBe(9);
    expect(p.minute).toBe(0);
  });
  it("12-hour and 24-hour forms give the same instant", () => {
    const a = getClassStartTime({ date: "2026-07-21", time: "14:30" })!;
    const b = getClassStartTime({ date: "2026-07-21", time: "2:30 PM" })!;
    const c = getClassStartTime({ date: "2026-07-21", time: "14:30:00" })!;
    expect(a.getTime()).toBe(b.getTime());
    expect(a.getTime()).toBe(c.getTime());
  });
});

describe("checkClassStart", () => {
  it("class in the past is started", () => {
    const past = schoolLocal(-60);
    expect(checkClassStart({ date: past.date, time: past.time24 }).status).toBe("started");
    expect(checkClassStart({ date: past.date, time: past.time12 }).status).toBe("started");
  });
  it("class in the future is not_started and includes the start instant", () => {
    const future = schoolLocal(120);
    const res = checkClassStart({ date: future.date, time: future.time24 });
    expect(res.status).toBe("not_started");
    if (res.status === "not_started") {
      expect(res.start.getTime()).toBeGreaterThan(Date.now());
    }
  });
  it("early check-in window opens before start", () => {
    const soon = schoolLocal(10); // starts in ~10 minutes
    expect(checkClassStart({ date: soon.date, time: soon.time24 }).status).toBe("not_started");
    expect(checkClassStart({ date: soon.date, time: soon.time24 }, 15).status).toBe("started");
  });
  it("unparseable schedule is invalid, not not_started", () => {
    expect(checkClassStart({ date: "2026-07-21", time: "morning" }).status).toBe("invalid");
    expect(checkClassStart({ date: "21/07/2026", time: "09:00" }).status).toBe("invalid");
  });
});

describe("formatClassSchedule", () => {
  it("shows the stored date, time, and timezone", () => {
    const s = formatClassSchedule({ date: "2026-07-21", time: "9:00 AM" });
    expect(s).toContain("2026-07-21");
    expect(s).toContain("9:00 AM");
    expect(s).toContain(SCHOOL_TIMEZONE);
  });
});
