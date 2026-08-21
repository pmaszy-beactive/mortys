/**
 * Full-curriculum planner for the auto course.
 *
 * Lays out the entire 4-phase program (Theory 1–12, In-Car 1–15) in the
 * school's recommended order on the selected weekdays, spacing classes so the
 * phase minimums hold: T5 ≥ 28 days after T1, In-Car #4 ≥ 28 days after T6,
 * Phase 3 ends (In-Car #10) ≥ 56 days after T8, In-Car #15 ≥ 56 days after
 * T11. One class per date.
 */

export type PlanItem = {
  classType: "theory" | "driving";
  classNumber: number;
  duration: number;
  maxStudents: number;
  hasTest?: boolean;
  /** Constraint: this class must be >= `days` after the anchor class. */
  minDaysAfter?: { classType: "theory" | "driving"; classNumber: number; days: number };
};

export type ScheduledPlanItem = PlanItem & { date: string };

export const AUTO_CURRICULUM_THEORY_DURATION = 120;
export const VIRTUAL_CLASS_MAX_STUDENTS = 30;

export type MotoClassRequirements = {
  duration: number;
  maxStudents?: number;
  stage: "yard-preparation" | "closed-circuit" | "road-preparation" | "road";
};

/**
 * Canonical configuration for every class in the motorcycle program.
 * Returns null for an invalid class type/number pair.
 */
export function getMotoClassRequirements(
  classType: string | null | undefined,
  classNumber: number | null | undefined,
): MotoClassRequirements | null {
  if (!Number.isInteger(classNumber)) return null;
  if (classType === "theory") {
    if (classNumber === 1) {
      return { duration: 180, stage: "yard-preparation" };
    }
    if (classNumber === 2) {
      return { duration: 180, stage: "road-preparation" };
    }
    return null;
  }
  if (classType === "driving") {
    if (classNumber! >= 1 && classNumber! <= 4) {
      return { duration: 240, maxStudents: 1, stage: "closed-circuit" };
    }
    if (classNumber === 5) {
      return { duration: 120, maxStudents: 1, stage: "road" };
    }
    if (classNumber! >= 6 && classNumber! <= 7) {
      return { duration: 240, maxStudents: 1, stage: "road" };
    }
  }
  return null;
}

/**
 * Validates server-bound class data against the official motorcycle program.
 * UI defaults are not an integrity boundary: every create/update path calls
 * this before writing.
 */
export function validateMotoClassConfiguration(input: {
  courseType?: string | null;
  classType?: string | null;
  classNumber?: number | null;
  duration?: number | null;
  maxStudents?: number | null;
}): string | null {
  if ((input.courseType || "").toLowerCase() !== "moto") return null;
  const requirements = getMotoClassRequirements(input.classType, input.classNumber);
  if (!requirements) {
    return "Invalid motorcycle session. Use Theory #1–2, Closed-Circuit #1–4, or Road Training #5–7.";
  }
  if (input.duration !== requirements.duration) {
    return `This motorcycle session must be ${requirements.duration} minutes.`;
  }
  if (
    requirements.maxStudents !== undefined &&
    input.maxStudents !== requirements.maxStudents
  ) {
    return "Motorcycle practical sessions must have exactly 1 student.";
  }
  return null;
}

/**
 * Returns the minimum number of virtual classes and an even distribution of
 * students across them. Counts always differ by at most one.
 */
export function splitVirtualEnrollment(studentCount: number, cap = VIRTUAL_CLASS_MAX_STUDENTS): {
  classCount: number;
  studentCounts: number[];
} {
  if (!Number.isInteger(studentCount) || studentCount < 0 || !Number.isInteger(cap) || cap < 1) {
    throw new Error("Student count and capacity must be positive integers");
  }
  const classCount = Math.max(1, Math.ceil(studentCount / cap));
  const base = Math.floor(studentCount / classCount);
  const remainder = studentCount % classCount;
  return {
    classCount,
    studentCounts: Array.from({ length: classCount }, (_, index) => base + (index < remainder ? 1 : 0)),
  };
}

/** The 27-class auto curriculum in the school's recommended order. */
export function buildAutoCurriculumPlan(theoryMaxStudents: number): PlanItem[] {
  const theoryDur = AUTO_CURRICULUM_THEORY_DURATION;
  const theoryMax = theoryMaxStudents;
  return [
    // Phase 1
    { classType: "theory", classNumber: 1, duration: theoryDur, maxStudents: theoryMax },
    { classType: "theory", classNumber: 2, duration: theoryDur, maxStudents: theoryMax },
    { classType: "theory", classNumber: 3, duration: theoryDur, maxStudents: theoryMax },
    { classType: "theory", classNumber: 4, duration: theoryDur, maxStudents: theoryMax },
    { classType: "theory", classNumber: 5, duration: theoryDur, maxStudents: theoryMax, hasTest: true,
      minDaysAfter: { classType: "theory", classNumber: 1, days: 28 } },
    // Phase 2 (strict order; in-cars single hours)
    { classType: "theory", classNumber: 6, duration: theoryDur, maxStudents: theoryMax },
    { classType: "theory", classNumber: 7, duration: theoryDur, maxStudents: theoryMax },
    { classType: "driving", classNumber: 1, duration: 60, maxStudents: 1 },
    { classType: "driving", classNumber: 2, duration: 60, maxStudents: 1 },
    { classType: "driving", classNumber: 3, duration: 60, maxStudents: 1 },
    { classType: "driving", classNumber: 4, duration: 60, maxStudents: 1,
      minDaysAfter: { classType: "theory", classNumber: 6, days: 28 } },
    // Phase 3 (recommended order)
    { classType: "theory", classNumber: 8, duration: theoryDur, maxStudents: theoryMax },
    { classType: "theory", classNumber: 9, duration: theoryDur, maxStudents: theoryMax },
    { classType: "driving", classNumber: 5, duration: 60, maxStudents: 1 },
    { classType: "driving", classNumber: 6, duration: 60, maxStudents: 1 },
    { classType: "driving", classNumber: 7, duration: 60, maxStudents: 1 },
    { classType: "driving", classNumber: 8, duration: 60, maxStudents: 1 },
    { classType: "theory", classNumber: 10, duration: theoryDur, maxStudents: theoryMax },
    { classType: "driving", classNumber: 9, duration: 60, maxStudents: 1 },
    { classType: "driving", classNumber: 10, duration: 60, maxStudents: 1,
      minDaysAfter: { classType: "theory", classNumber: 8, days: 56 } },
    // Phase 4
    { classType: "theory", classNumber: 11, duration: theoryDur, maxStudents: theoryMax },
    { classType: "theory", classNumber: 12, duration: theoryDur, maxStudents: theoryMax },
    { classType: "driving", classNumber: 11, duration: 60, maxStudents: 1 },
    { classType: "driving", classNumber: 12, duration: 60, maxStudents: 2 }, // shared session
    { classType: "driving", classNumber: 13, duration: 60, maxStudents: 2 }, // shared session
    { classType: "driving", classNumber: 14, duration: 60, maxStudents: 1 },
    { classType: "driving", classNumber: 15, duration: 60, maxStudents: 1,
      minDaysAfter: { classType: "theory", classNumber: 11, days: 56 } },
  ];
}

/**
 * The 9-class moto (Mortys motorcycle program) curriculum in program order:
 * Theory 1 yard prep (3h) → 4 closed-circuit sessions (4h each) → Theory 2
 * road prep (3h) → road sessions of 2h/4h/4h. No mandated minimum phase
 * durations. Practical sessions are one student per bike/instructor.
 */
export function buildMotoCurriculumPlan(theoryMaxStudents: number): PlanItem[] {
  const theoryMax = theoryMaxStudents;
  return [
    { classType: "theory", classNumber: 1, duration: 180, maxStudents: theoryMax },
    { classType: "driving", classNumber: 1, duration: 240, maxStudents: 1 },
    { classType: "driving", classNumber: 2, duration: 240, maxStudents: 1 },
    { classType: "driving", classNumber: 3, duration: 240, maxStudents: 1 },
    { classType: "driving", classNumber: 4, duration: 240, maxStudents: 1 },
    { classType: "theory", classNumber: 2, duration: 180, maxStudents: theoryMax },
    { classType: "driving", classNumber: 5, duration: 120, maxStudents: 1 },
    { classType: "driving", classNumber: 6, duration: 240, maxStudents: 1 },
    { classType: "driving", classNumber: 7, duration: 240, maxStudents: 1 },
  ];
}

/** Candidate dates (YYYY-MM-DD) on the selected weekdays within the horizon. */
export function buildCandidateDates(
  startDate: string,
  daysOfWeek: number[],
  horizonDays: number = 365,
): string[] {
  const candidates: string[] = [];
  const c = new Date(startDate + "T00:00:00");
  const hardEnd = new Date(startDate + "T00:00:00");
  hardEnd.setDate(hardEnd.getDate() + horizonDays);
  while (c <= hardEnd) {
    if (daysOfWeek.includes(c.getDay())) candidates.push(c.toISOString().slice(0, 10));
    c.setDate(c.getDate() + 1);
  }
  return candidates;
}

export type ExistingClassSlot = {
  date: string;
  time: string;
  duration: number | null;
};
export type CurriculumScheduleResult =
  | { ok: true; scheduled: ScheduledPlanItem[] }
  | { ok: false; reason: "not_enough_dates" };

/**
 * Assign each plan item to the earliest candidate date that respects the
 * one-class-per-date rule and every minimum-days anchor constraint.
 */
export function scheduleAutoCurriculum(
  candidates: string[],
  plan: PlanItem[],
): CurriculumScheduleResult {
  const assignedDate: Record<string, string> = {};
  const scheduled: ScheduledPlanItem[] = [];
  let cursor = 0;
  for (const item of plan) {
    let idx = cursor;
    if (item.minDaysAfter) {
      const anchor = assignedDate[`${item.minDaysAfter.classType}:${item.minDaysAfter.classNumber}`];
      if (anchor) {
        const minDate = new Date(anchor + "T00:00:00");
        minDate.setDate(minDate.getDate() + item.minDaysAfter.days);
        const minStr = minDate.toISOString().slice(0, 10);
        while (idx < candidates.length && candidates[idx] < minStr) idx++;
      }
    }
    if (idx >= candidates.length) {
      return { ok: false, reason: "not_enough_dates" };
    }
    const date = candidates[idx];
    assignedDate[`${item.classType}:${item.classNumber}`] = date;
    scheduled.push({ ...item, date });
    cursor = idx + 1;
  }
  return { ok: true, scheduled };
}

export type CurriculumConflict = {
  date: string;
  classType: "theory" | "driving";
  classNumber: number;
  existing: ExistingClassSlot;
};

function toMinutes(time: string): number | null {
  const [h, m] = time.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/**
 * Detect date/time conflicts between a scheduled curriculum plan (all classes
 * start at `time`) and an instructor's existing classes. Two classes conflict
 * when they are on the same date and their time ranges overlap.
 */
export function findCurriculumConflicts(
  scheduled: ScheduledPlanItem[],
  time: string,
  existing: ExistingClassSlot[],
): CurriculumConflict[] {
  const startMin = toMinutes(time);
  const byDate = new Map<string, ExistingClassSlot[]>();
  for (const ex of existing) {
    const list = byDate.get(ex.date);
    if (list) list.push(ex);
    else byDate.set(ex.date, [ex]);
  }
  const conflicts: CurriculumConflict[] = [];
  for (const s of scheduled) {
    const sameDay = byDate.get(s.date);
    if (!sameDay) continue;
    const sStart = startMin;
    const sEnd = sStart === null ? null : sStart + s.duration;
    for (const ex of sameDay) {
      const exStart = toMinutes(ex.time);
      // If either time is unparseable, treat same-date as a conflict (safe side).
      const overlaps =
        sStart === null || sEnd === null || exStart === null
          ? true
          : sStart < exStart + (ex.duration ?? 120) && exStart < sEnd;
      if (overlaps) {
        conflicts.push({
          date: s.date,
          classType: s.classType,
          classNumber: s.classNumber,
          existing: ex,
        });
      }
    }
  }
  return conflicts;
}
