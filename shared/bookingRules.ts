/**
 * Phase-based booking rules engine for Morty's Driving School.
 *
 * Enforces all 4-phase progression requirements for the AUTO course.
 * Call validateClassBooking() before creating any enrollment.
 */

export interface CompletedClassRecord {
  classType: "theory" | "driving";
  classNumber: number;
  date: string; // YYYY-MM-DD — the date the class was attended
  duration?: number; // minutes
}

export interface TargetClassInfo {
  classType: "theory" | "driving";
  classNumber: number;
  date: string; // YYYY-MM-DD — scheduled date of the class being booked
  duration?: number; // minutes
  /** For In-Car 12 & 13 shared-session check: how many students are currently enrolled */
  currentEnrollmentCount?: number;
  /** Is this class configured as a shared (2-student) session? */
  maxStudents?: number;
  /**
   * Phase 3 daily limit: total minutes already booked by this student on the
   * same date (excluding the class being evaluated). Used to enforce the
   * "max 3 hours per day in Phase 3" rule.
   */
  sameDayAlreadyBookedMinutes?: number;
}

export interface BookingValidationResult {
  allowed: boolean;
  /** Human-readable reason if not allowed */
  reason?: string;
  /** Machine-readable violation key */
  blockingRule?: string;
  /** Extra info for the UI */
  detail?: {
    prerequisitesNeeded?: string[];
    daysNeeded?: number;
    daysElapsed?: number;
    phaseLabel?: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(earlier: string, later: string): number {
  const a = new Date(earlier);
  const b = new Date(later);
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function hasCompleted(
  completed: CompletedClassRecord[],
  classType: "theory" | "driving",
  classNumber: number
): boolean {
  return completed.some(
    (c) => c.classType === classType && c.classNumber === classNumber
  );
}

function dateOf(
  completed: CompletedClassRecord[],
  classType: "theory" | "driving",
  classNumber: number
): string | null {
  const record = completed.find(
    (c) => c.classType === classType && c.classNumber === classNumber
  );
  return record?.date ?? null;
}

function totalDrivingHoursInPhase3(completed: CompletedClassRecord[]): number {
  let totalMinutes = 0;
  for (const c of completed) {
    if (c.classType === "driving" && c.classNumber >= 5 && c.classNumber <= 10) {
      totalMinutes += c.duration ?? 60; // assume 60 min if not specified
    }
  }
  return totalMinutes / 60;
}

// ─── Phase completion checks ──────────────────────────────────────────────────

function isPhase1Complete(completed: CompletedClassRecord[]): boolean {
  for (let n = 1; n <= 5; n++) {
    if (!hasCompleted(completed, "theory", n)) return false;
  }
  return true;
}

function isPhase2Complete(completed: CompletedClassRecord[]): boolean {
  if (!hasCompleted(completed, "theory", 6)) return false;
  if (!hasCompleted(completed, "theory", 7)) return false;
  for (let n = 1; n <= 4; n++) {
    if (!hasCompleted(completed, "driving", n)) return false;
  }
  return true;
}

function isPhase3Complete(completed: CompletedClassRecord[]): boolean {
  // Requires T8, T9, T10 + all In-Car 5-10
  for (const n of [8, 9, 10]) {
    if (!hasCompleted(completed, "theory", n)) return false;
  }
  for (let n = 5; n <= 10; n++) {
    if (!hasCompleted(completed, "driving", n)) return false;
  }
  return true;
}

// ─── Duration helpers ─────────────────────────────────────────────────────────

function isDuration60Only(duration?: number): BookingValidationResult | null {
  if (duration != null && duration !== 60) {
    return {
      allowed: false,
      reason: `This in-car session must be booked as a 1-hour (60-minute) session only. You selected ${duration} minutes.`,
      blockingRule: "duration_must_be_60",
    };
  }
  return null;
}

function isDuration60Or120(duration?: number): BookingValidationResult | null {
  if (duration != null && duration !== 60 && duration !== 120) {
    return {
      allowed: false,
      reason: `This in-car session can only be booked as 1 hour (60 min) or 2 hours (120 min). You selected ${duration} minutes.`,
      blockingRule: "duration_must_be_60_or_120",
    };
  }
  return null;
}

// ─── Main validator ───────────────────────────────────────────────────────────

/**
 * Validate whether a student may book a given class.
 *
 * @param target    The class the student wants to book.
 * @param completed Classes the student has already ATTENDED (attendanceStatus = 'attended').
 * @param courseType  'auto' | 'moto' | 'scooter' — detailed rules only for 'auto'.
 */
export function validateClassBooking(
  target: TargetClassInfo,
  completed: CompletedClassRecord[],
  courseType: string = "auto"
): BookingValidationResult {
  // For non-auto courses apply simplified rules
  if (courseType !== "auto") {
    return validateSimplifiedRules(target, completed, courseType);
  }

  return validateAutoRules(target, completed);
}

// ─── Auto-course full rule set ────────────────────────────────────────────────

function validateAutoRules(
  target: TargetClassInfo,
  completed: CompletedClassRecord[]
): BookingValidationResult {
  const { classType, classNumber, date, duration } = target;

  // ── THEORY CLASSES ──────────────────────────────────────────────────────────

  if (classType === "theory") {
    // Theory 1 — can always be booked (Phase 1 start, no prerequisites)
    if (classNumber === 1) {
      return { allowed: true };
    }

    // Theory 2, 3, 4 — Theory 1 must be completed first
    if (classNumber >= 2 && classNumber <= 4) {
      if (!hasCompleted(completed, "theory", 1)) {
        return {
          allowed: false,
          reason: `Theory #${classNumber} requires Theory #1 to be completed first. Theory #1 must be your very first class.`,
          blockingRule: "phase1_theory1_required",
          detail: { prerequisitesNeeded: ["Theory #1"], phaseLabel: "Phase 1" },
        };
      }
      return { allowed: true };
    }

    // Theory 5 — T1, T2, T3, T4 all completed + 28 days since T1
    if (classNumber === 5) {
      const missing: string[] = [];
      for (let n = 1; n <= 4; n++) {
        if (!hasCompleted(completed, "theory", n)) missing.push(`Theory #${n}`);
      }
      if (missing.length > 0) {
        return {
          allowed: false,
          reason: `Theory #5 (final test) requires completing Theory #1 through #4 first. Still needed: ${missing.join(", ")}.`,
          blockingRule: "phase1_theory5_prerequisites",
          detail: { prerequisitesNeeded: missing, phaseLabel: "Phase 1" },
        };
      }
      // 28-day check from Theory 1
      const t1Date = dateOf(completed, "theory", 1);
      if (t1Date) {
        const elapsed = daysBetween(t1Date, date);
        if (elapsed < 28) {
          return {
            allowed: false,
            reason: `Theory #5 cannot be attended until at least 28 days after Theory #1. Only ${elapsed} day(s) have passed since Theory #1 (completed ${t1Date}).`,
            blockingRule: "phase1_min_28_days",
            detail: { daysNeeded: 28, daysElapsed: elapsed, phaseLabel: "Phase 1" },
          };
        }
      }
      return { allowed: true };
    }

    // Theory 6 — Phase 1 must be complete (T1–T5 all attended)
    if (classNumber === 6) {
      if (!isPhase1Complete(completed)) {
        const missing: string[] = [];
        for (let n = 1; n <= 5; n++) {
          if (!hasCompleted(completed, "theory", n)) missing.push(`Theory #${n}`);
        }
        return {
          allowed: false,
          reason: `Theory #6 starts Phase 2. You must complete all of Phase 1 (Theory #1–#5) first. Still needed: ${missing.join(", ")}.`,
          blockingRule: "phase2_requires_phase1_complete",
          detail: { prerequisitesNeeded: missing, phaseLabel: "Phase 2" },
        };
      }
      return { allowed: true };
    }

    // Theory 7 — Theory 6 must be completed (T7 immediately follows T6)
    if (classNumber === 7) {
      if (!hasCompleted(completed, "theory", 6)) {
        return {
          allowed: false,
          reason: "Theory #7 must immediately follow Theory #6. Complete Theory #6 first.",
          blockingRule: "phase2_theory7_requires_theory6",
          detail: { prerequisitesNeeded: ["Theory #6"], phaseLabel: "Phase 2" },
        };
      }
      return { allowed: true };
    }

    // Theory 8 — Phase 2 must be complete
    if (classNumber === 8) {
      if (!isPhase2Complete(completed)) {
        const missing: string[] = [];
        if (!hasCompleted(completed, "theory", 6)) missing.push("Theory #6");
        if (!hasCompleted(completed, "theory", 7)) missing.push("Theory #7");
        for (let n = 1; n <= 4; n++) {
          if (!hasCompleted(completed, "driving", n)) missing.push(`In-Car #${n}`);
        }
        return {
          allowed: false,
          reason: `Theory #8 starts Phase 3. You must complete all of Phase 2 first. Still needed: ${missing.join(", ")}.`,
          blockingRule: "phase3_requires_phase2_complete",
          detail: { prerequisitesNeeded: missing, phaseLabel: "Phase 3" },
        };
      }
      // Phase 3 daily 3-hour limit
      const sameDayT8 = target.sameDayAlreadyBookedMinutes ?? 0;
      const durationT8 = target.duration ?? 120;
      if (sameDayT8 + durationT8 > 180) {
        return {
          allowed: false,
          reason: `Phase 3 allows a maximum of 3 hours (180 minutes) of classes per day. You already have ${sameDayT8} minutes booked on this day. Adding this ${durationT8}-minute theory class would bring the total to ${sameDayT8 + durationT8} minutes.`,
          blockingRule: "phase3_max_3_hours_per_day",
          detail: { phaseLabel: "Phase 3" },
        };
      }
      return { allowed: true };
    }

    // Theory 9, 10 — Theory 8 must be completed
    if (classNumber === 9 || classNumber === 10) {
      if (!hasCompleted(completed, "theory", 8)) {
        return {
          allowed: false,
          reason: `Theory #${classNumber} requires Theory #8 to be completed first. Theory #8 is the start of Phase 3.`,
          blockingRule: "phase3_theory8_required",
          detail: { prerequisitesNeeded: ["Theory #8"], phaseLabel: "Phase 3" },
        };
      }
      // Phase 3 daily 3-hour limit
      const sameDayT = target.sameDayAlreadyBookedMinutes ?? 0;
      const durationT = target.duration ?? 120;
      if (sameDayT + durationT > 180) {
        return {
          allowed: false,
          reason: `Phase 3 allows a maximum of 3 hours (180 minutes) of classes per day. You already have ${sameDayT} minutes booked on this day. Adding this ${durationT}-minute theory class would bring the total to ${sameDayT + durationT} minutes.`,
          blockingRule: "phase3_max_3_hours_per_day",
          detail: { phaseLabel: "Phase 3" },
        };
      }
      return { allowed: true };
    }

    // Theory 11 — Phase 3 must be complete + 56 days since Theory 8
    if (classNumber === 11) {
      if (!isPhase3Complete(completed)) {
        const missing: string[] = [];
        for (const n of [8, 9, 10]) {
          if (!hasCompleted(completed, "theory", n)) missing.push(`Theory #${n}`);
        }
        for (let n = 5; n <= 10; n++) {
          if (!hasCompleted(completed, "driving", n)) missing.push(`In-Car #${n}`);
        }
        return {
          allowed: false,
          reason: `Theory #11 starts Phase 4. You must complete all of Phase 3 first (Theory #8–#10 + In-Car #5–#10). Still needed: ${missing.join(", ")}.`,
          blockingRule: "phase4_requires_phase3_complete",
          detail: { prerequisitesNeeded: missing, phaseLabel: "Phase 4" },
        };
      }
      // 56-day check from Theory 8
      const t8Date = dateOf(completed, "theory", 8);
      if (t8Date) {
        const elapsed = daysBetween(t8Date, date);
        if (elapsed < 56) {
          return {
            allowed: false,
            reason: `Phase 3 requires a minimum of 56 days. Only ${elapsed} day(s) have passed since Theory #8 (completed ${t8Date}). ${56 - elapsed} more day(s) needed before you can start Phase 4.`,
            blockingRule: "phase3_min_56_days",
            detail: { daysNeeded: 56, daysElapsed: elapsed, phaseLabel: "Phase 3" },
          };
        }
      }
      return { allowed: true };
    }

    // Theory 12 — Theory 11 must be completed
    if (classNumber === 12) {
      if (!hasCompleted(completed, "theory", 11)) {
        return {
          allowed: false,
          reason: "Theory #12 requires Theory #11 to be completed first. Theory #11 is the start of Phase 4.",
          blockingRule: "phase4_theory12_requires_theory11",
          detail: { prerequisitesNeeded: ["Theory #11"], phaseLabel: "Phase 4" },
        };
      }
      return { allowed: true };
    }
  }

  // ── DRIVING / IN-CAR CLASSES ──────────────────────────────────────────────

  if (classType === "driving") {
    // ── Phase 2: In-Car #1–#4 (60-minute only) ───────────────────────────────

    if (classNumber >= 1 && classNumber <= 4) {
      // Duration must be 60 min
      const durationCheck = isDuration60Only(duration);
      if (durationCheck) return durationCheck;

      // In-Car 1: Theory 6 AND Theory 7 must be completed first
      if (classNumber === 1) {
        const missing: string[] = [];
        if (!hasCompleted(completed, "theory", 6)) missing.push("Theory #6");
        if (!hasCompleted(completed, "theory", 7)) missing.push("Theory #7");
        if (missing.length > 0) {
          return {
            allowed: false,
            reason: `In-Car #1 requires Theory #6 and Theory #7 to be completed first (Phase 2 starts with Theory #6, immediately followed by Theory #7). Still needed: ${missing.join(", ")}.`,
            blockingRule: "phase2_incar1_prerequisites",
            detail: { prerequisitesNeeded: missing, phaseLabel: "Phase 2" },
          };
        }
        return { allowed: true };
      }

      // In-Car 2: In-Car 1 completed
      if (classNumber === 2) {
        if (!hasCompleted(completed, "driving", 1)) {
          return {
            allowed: false,
            reason: "In-Car #2 requires In-Car #1 to be completed first. Phase 2 in-car sessions must be done in order.",
            blockingRule: "phase2_incar_sequential",
            detail: { prerequisitesNeeded: ["In-Car #1"], phaseLabel: "Phase 2" },
          };
        }
        return { allowed: true };
      }

      // In-Car 3: In-Car 2 completed
      if (classNumber === 3) {
        if (!hasCompleted(completed, "driving", 2)) {
          return {
            allowed: false,
            reason: "In-Car #3 requires In-Car #2 to be completed first. Phase 2 in-car sessions must be done in order.",
            blockingRule: "phase2_incar_sequential",
            detail: { prerequisitesNeeded: ["In-Car #2"], phaseLabel: "Phase 2" },
          };
        }
        return { allowed: true };
      }

      // In-Car 4: In-Car 3 completed + 28 days since Theory 6
      if (classNumber === 4) {
        if (!hasCompleted(completed, "driving", 3)) {
          return {
            allowed: false,
            reason: "In-Car #4 requires In-Car #3 to be completed first. Phase 2 in-car sessions must be done in order.",
            blockingRule: "phase2_incar_sequential",
            detail: { prerequisitesNeeded: ["In-Car #3"], phaseLabel: "Phase 2" },
          };
        }
        const t6Date = dateOf(completed, "theory", 6);
        if (t6Date) {
          const elapsed = daysBetween(t6Date, date);
          if (elapsed < 28) {
            return {
              allowed: false,
              reason: `In-Car #4 cannot be completed until at least 28 days after Theory #6. Only ${elapsed} day(s) have passed since Theory #6 (completed ${t6Date}). ${28 - elapsed} more day(s) needed.`,
              blockingRule: "phase2_min_28_days",
              detail: { daysNeeded: 28, daysElapsed: elapsed, phaseLabel: "Phase 2" },
            };
          }
        }
        return { allowed: true };
      }
    }

    // ── Phase 3: In-Car #5–#10 (60 or 120 min) ───────────────────────────────

    if (classNumber >= 5 && classNumber <= 10) {
      const durationCheck = isDuration60Or120(duration);
      if (durationCheck) return durationCheck;

      // Theory 8 must be completed
      if (!hasCompleted(completed, "theory", 8)) {
        return {
          allowed: false,
          reason: `In-Car #${classNumber} is a Phase 3 session. Theory #8 must be completed first to begin Phase 3.`,
          blockingRule: "phase3_theory8_required",
          detail: { prerequisitesNeeded: ["Theory #8"], phaseLabel: "Phase 3" },
        };
      }

      // Phase 3 daily 3-hour limit (max 180 minutes per day)
      const sameDayIC = target.sameDayAlreadyBookedMinutes ?? 0;
      const durationIC = duration ?? 60;
      if (sameDayIC + durationIC > 180) {
        return {
          allowed: false,
          reason: `Phase 3 allows a maximum of 3 hours (180 minutes) of classes per day. You already have ${sameDayIC} minutes booked on this day. Adding this ${durationIC}-minute in-car session would bring the total to ${sameDayIC + durationIC} minutes.`,
          blockingRule: "phase3_max_3_hours_per_day",
          detail: { phaseLabel: "Phase 3" },
        };
      }

      return { allowed: true };
    }

    // ── Phase 4: In-Car #11–#14 (60 or 120 min) ─────────────────────────────

    if (classNumber >= 11 && classNumber <= 14) {
      const durationCheck = isDuration60Or120(duration);
      if (durationCheck) return durationCheck;

      // Theory 11 must be completed
      if (!hasCompleted(completed, "theory", 11)) {
        return {
          allowed: false,
          reason: `In-Car #${classNumber} is a Phase 4 session. Theory #11 must be completed first to begin Phase 4.`,
          blockingRule: "phase4_theory11_required",
          detail: { prerequisitesNeeded: ["Theory #11"], phaseLabel: "Phase 4" },
        };
      }

      // In-Car 12 and 13: must be shared (2-student) sessions.
      // In-Cars 11–14 can be done in any order — only T11 is required.
      if (classNumber === 12 || classNumber === 13) {
        const label = `In-Car #${classNumber}`;
        if (
          target.maxStudents != null &&
          target.maxStudents !== 2
        ) {
          return {
            allowed: false,
            reason: `${label} must be a shared session with exactly 2 students and 1 instructor. This class is not configured as a 2-student session. Please contact the school to book the correct session.`,
            blockingRule: "phase4_shared_session_required",
            detail: { phaseLabel: "Phase 4" },
          };
        }
        return { allowed: true };
      }

      return { allowed: true };
    }

    // ── Phase 4: In-Car #15 (final, 60 min only, after everything else) ──────

    if (classNumber === 15) {
      // Duration must be 60 min
      const durationCheck = isDuration60Only(duration);
      if (durationCheck) return durationCheck;

      // All prerequisites: Theory 11, Theory 12, In-Car 11–14
      const missing: string[] = [];
      if (!hasCompleted(completed, "theory", 11)) missing.push("Theory #11");
      if (!hasCompleted(completed, "theory", 12)) missing.push("Theory #12");
      for (let n = 11; n <= 14; n++) {
        if (!hasCompleted(completed, "driving", n)) missing.push(`In-Car #${n}`);
      }
      if (missing.length > 0) {
        return {
          allowed: false,
          reason: `In-Car #15 is the final session and requires Theory #11, Theory #12, and In-Car #11–#14 all to be completed first. Still needed: ${missing.join(", ")}.`,
          blockingRule: "phase4_incar15_prerequisites",
          detail: { prerequisitesNeeded: missing, phaseLabel: "Phase 4" },
        };
      }

      // 56-day check from Theory 11
      const t11Date = dateOf(completed, "theory", 11);
      if (t11Date) {
        const elapsed = daysBetween(t11Date, date);
        if (elapsed < 56) {
          return {
            allowed: false,
            reason: `Phase 4 requires a minimum of 56 days. Only ${elapsed} day(s) have passed since Theory #11 (completed ${t11Date}). ${56 - elapsed} more day(s) needed before In-Car #15 can be scheduled.`,
            blockingRule: "phase4_min_56_days",
            detail: { daysNeeded: 56, daysElapsed: elapsed, phaseLabel: "Phase 4" },
          };
        }
      }

      return { allowed: true };
    }
  }

  // Unknown class — allow with a warning (shouldn't happen)
  return { allowed: true };
}

// ─── Simplified rules for Moto / Scooter ─────────────────────────────────────

function validateSimplifiedRules(
  target: TargetClassInfo,
  completed: CompletedClassRecord[],
  courseType: string
): BookingValidationResult {
  const { classType, classNumber } = target;

  // Config per course
  const config: Record<string, { theoryCount: number; drivingCount: number }> = {
    moto: { theoryCount: 8, drivingCount: 10 },
    scooter: { theoryCount: 6, drivingCount: 8 },
  };
  const c = config[courseType] ?? { theoryCount: 5, drivingCount: 10 };

  const completedTheory = completed.filter((x) => x.classType === "theory").length;
  const completedDriving = completed.filter((x) => x.classType === "driving").length;

  // First theory class — always allowed
  if (classType === "theory" && classNumber === 1) return { allowed: true };

  // Theory classes after first — first theory must be done
  if (classType === "theory" && classNumber > 1) {
    if (!hasCompleted(completed, "theory", 1)) {
      return {
        allowed: false,
        reason: "You must complete Theory #1 before attending other theory classes.",
        blockingRule: "theory_first_required",
      };
    }
    return { allowed: true };
  }

  // Driving classes — all theory must be completed first
  if (classType === "driving") {
    if (completedTheory < c.theoryCount) {
      return {
        allowed: false,
        reason: `You must complete all ${c.theoryCount} theory classes before booking in-car sessions. You have completed ${completedTheory}.`,
        blockingRule: "theory_required_before_driving",
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

// ─── Utility: build CompletedClassRecord[] from enrollment data ───────────────

export interface EnrollmentWithClass {
  attendanceStatus: string | null;
  classType: string | null;
  classNumber: number | null;
  date: string | null;
  duration: number | null;
}

export function buildCompletedClasses(
  enrollments: EnrollmentWithClass[]
): CompletedClassRecord[] {
  return enrollments
    .filter(
      (e) =>
        e.attendanceStatus === "attended" &&
        e.classType != null &&
        e.classNumber != null &&
        e.date != null
    )
    .map((e) => ({
      classType: e.classType as "theory" | "driving",
      classNumber: e.classNumber!,
      date: e.date!,
      duration: e.duration ?? undefined,
    }));
}
