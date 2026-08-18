import { describe, it, expect } from "vitest";
import {
  buildAutoCurriculumPlan,
  buildCandidateDates,
  scheduleAutoCurriculum,
  findCurriculumConflicts,
} from "@shared/curriculumPlanner";

function daysBetween(earlier: string, later: string): number {
  return Math.floor(
    (new Date(later + "T00:00:00").getTime() - new Date(earlier + "T00:00:00").getTime()) /
      (1000 * 60 * 60 * 24),
  );
}

function dateOf(
  scheduled: Array<{ classType: string; classNumber: number; date: string }>,
  classType: string,
  classNumber: number,
): string {
  const item = scheduled.find((s) => s.classType === classType && s.classNumber === classNumber);
  if (!item) throw new Error(`missing ${classType} #${classNumber}`);
  return item.date;
}

describe("buildAutoCurriculumPlan", () => {
  it("contains the full 27-class curriculum (Theory 1-12, In-Car 1-15)", () => {
    const plan = buildAutoCurriculumPlan(24);
    expect(plan).toHaveLength(27);
    const theory = plan.filter((p) => p.classType === "theory").map((p) => p.classNumber);
    const driving = plan.filter((p) => p.classType === "driving").map((p) => p.classNumber);
    expect([...theory].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect([...driving].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it("marks Theory #5 as a test and In-Car #12/#13 as shared 2-student sessions", () => {
    const plan = buildAutoCurriculumPlan(24);
    const t5 = plan.find((p) => p.classType === "theory" && p.classNumber === 5)!;
    expect(t5.hasTest).toBe(true);
    for (const n of [12, 13]) {
      const ic = plan.find((p) => p.classType === "driving" && p.classNumber === n)!;
      expect(ic.maxStudents).toBe(2);
    }
    const ic11 = plan.find((p) => p.classType === "driving" && p.classNumber === 11)!;
    expect(ic11.maxStudents).toBe(1);
  });

  it("uses the given theory class size and 120-minute theory / 60-minute in-car durations", () => {
    const plan = buildAutoCurriculumPlan(18);
    for (const p of plan) {
      if (p.classType === "theory") {
        expect(p.duration).toBe(120);
        expect(p.maxStudents).toBe(18);
      } else {
        expect(p.duration).toBe(60);
      }
    }
  });
});

describe("buildCandidateDates", () => {
  it("returns only the selected weekdays within the horizon, in order", () => {
    // 2026-08-03 is a Monday.
    const dates = buildCandidateDates("2026-08-03", [1, 3], 14); // Mon + Wed
    expect(dates[0]).toBe("2026-08-03");
    expect(dates).toContain("2026-08-05");
    for (const d of dates) {
      const dow = new Date(d + "T00:00:00").getDay();
      expect([1, 3]).toContain(dow);
    }
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("scheduleAutoCurriculum", () => {
  const plan = buildAutoCurriculumPlan(24);
  // Mon/Wed/Fri for a year starting Monday 2026-08-03.
  const candidates = buildCandidateDates("2026-08-03", [1, 3, 5], 365);
  const result = scheduleAutoCurriculum(candidates, plan);

  it("schedules all 27 classes, one per date, in ascending order", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scheduled).toHaveLength(27);
    const dates = result.scheduled.map((s) => s.date);
    expect(new Set(dates).size).toBe(27);
    expect([...dates].sort()).toEqual(dates);
    for (const d of dates) expect(candidates).toContain(d);
  });

  it("places Theory #5 at least 28 days after Theory #1", () => {
    if (!result.ok) throw new Error("plan failed");
    expect(
      daysBetween(dateOf(result.scheduled, "theory", 1), dateOf(result.scheduled, "theory", 5)),
    ).toBeGreaterThanOrEqual(28);
  });

  it("places In-Car #4 at least 28 days after Theory #6", () => {
    if (!result.ok) throw new Error("plan failed");
    expect(
      daysBetween(dateOf(result.scheduled, "theory", 6), dateOf(result.scheduled, "driving", 4)),
    ).toBeGreaterThanOrEqual(28);
  });

  it("places In-Car #10 at least 56 days after Theory #8", () => {
    if (!result.ok) throw new Error("plan failed");
    expect(
      daysBetween(dateOf(result.scheduled, "theory", 8), dateOf(result.scheduled, "driving", 10)),
    ).toBeGreaterThanOrEqual(56);
  });

  it("places In-Car #15 at least 56 days after Theory #11", () => {
    if (!result.ok) throw new Error("plan failed");
    expect(
      daysBetween(dateOf(result.scheduled, "theory", 11), dateOf(result.scheduled, "driving", 15)),
    ).toBeGreaterThanOrEqual(56);
  });

  it("anchor waits skip candidate dates instead of shrinking the gap", () => {
    // With a single weekday there are only weekly slots; every anchor gap must
    // still hold even though it forces skipped weeks.
    const weekly = buildCandidateDates("2026-08-03", [1], 365); // Mondays only
    const r = scheduleAutoCurriculum(weekly, plan);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      daysBetween(dateOf(r.scheduled, "theory", 8), dateOf(r.scheduled, "driving", 10)),
    ).toBeGreaterThanOrEqual(56);
    expect(
      daysBetween(dateOf(r.scheduled, "theory", 11), dateOf(r.scheduled, "driving", 15)),
    ).toBeGreaterThanOrEqual(56);
  });

  it("fails with not_enough_dates when the horizon cannot fit the curriculum", () => {
    // Mondays only over ~180 days ≈ 26 candidates < 27 classes.
    const shortCandidates = buildCandidateDates("2026-08-03", [1], 180);
    expect(shortCandidates.length).toBeLessThan(27);
    const r = scheduleAutoCurriculum(shortCandidates, plan);
    expect(r).toEqual({ ok: false, reason: "not_enough_dates" });
  });

  it("fails with not_enough_dates when anchor spacing pushes past the horizon", () => {
    // Enough raw dates for 27 classes, but the 28/56-day anchors need extra
    // headroom: 27 daily candidates cannot satisfy the spacing constraints.
    const daily = buildCandidateDates("2026-08-03", [0, 1, 2, 3, 4, 5, 6], 26);
    expect(daily.length).toBe(27);
    const r = scheduleAutoCurriculum(daily, plan);
    expect(r).toEqual({ ok: false, reason: "not_enough_dates" });
  });

  it("fails immediately when there are no candidate dates", () => {
    const r = scheduleAutoCurriculum([], plan);
    expect(r).toEqual({ ok: false, reason: "not_enough_dates" });
  });
});

describe("findCurriculumConflicts", () => {
  const scheduled = (() => {
    const plan = buildAutoCurriculumPlan(24);
    const candidates = buildCandidateDates("2026-08-03", [1, 3, 5]); // Mon/Wed/Fri
    const r = scheduleAutoCurriculum(candidates, plan);
    if (!r.ok) throw new Error("plan should fit");
    return r.scheduled;
  })();

  it("returns no conflicts against an empty calendar", () => {
    expect(findCurriculumConflicts(scheduled, "10:00", [])).toEqual([]);
  });

  it("flags an existing class on the same date with an overlapping time range", () => {
    const first = scheduled[0];
    const conflicts = findCurriculumConflicts(scheduled, "10:00", [
      { date: first.date, time: "09:30", duration: 60 }, // 09:30-10:30 overlaps 10:00+
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      date: first.date,
      classType: first.classType,
      classNumber: first.classNumber,
    });
  });

  it("does not flag same-date classes whose times do not overlap", () => {
    const first = scheduled[0]; // theory, 120 min at 10:00 → ends 12:00
    const conflicts = findCurriculumConflicts(scheduled, "10:00", [
      { date: first.date, time: "12:00", duration: 60 }, // starts exactly at end
      { date: first.date, time: "08:00", duration: 120 }, // ends exactly at start
    ]);
    expect(conflicts).toEqual([]);
  });

  it("detects every collision when the generator runs twice with the same inputs", () => {
    const existing = scheduled.map((s) => ({ date: s.date, time: "10:00", duration: s.duration }));
    const conflicts = findCurriculumConflicts(scheduled, "10:00", existing);
    expect(conflicts).toHaveLength(scheduled.length);
  });

  it("treats unparseable times on the same date as conflicts (safe side)", () => {
    const first = scheduled[0];
    const conflicts = findCurriculumConflicts(scheduled, "10:00", [
      { date: first.date, time: "not-a-time", duration: 60 },
    ]);
    expect(conflicts).toHaveLength(1);
  });
});
