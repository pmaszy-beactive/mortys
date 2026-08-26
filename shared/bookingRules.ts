/**
 * Phase-based booking rules engine for Morty's Driving School.
 *
 * Enforces all 4-phase progression requirements for the AUTO course.
 * Call validateClassBooking() before creating any enrollment.
 */

/**
 * Classify a class as theory vs driving. Uses the class's actual classType
 * field; falls back to the legacy class-number heuristic (1-5 = theory) only
 * when classType is missing.
 */
export function isTheoryClass(
  classType: string | null | undefined,
  classNumber: number | null | undefined,
): boolean {
  if (classType === "theory" || classType === "driving") {
    return classType === "theory";
  }
  return classNumber != null && classNumber <= 5;
}

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
   * Daily booking limit: number of classes this student already has booked on
   * the same date (excluding the class being evaluated). Only classes that
   * are still scheduled should be counted — enrollments in cancelled classes
   * must not consume a daily slot. Used to enforce the school-wide
   * "maximum 2 classes per day" policy.
   */
  sameDayAlreadyBookedCount?: number;
  /**
   * Total minutes of classes this student already has booked on the same
   * date (excluding the class being evaluated; scheduled classes only).
   * Used for the auto-course "no more than 3 hours per day" rule.
   */
  sameDayAlreadyBookedMinutes?: number;
  /** True when any of the same-day booked classes is an in-car session. */
  sameDayAlreadyBookedHasDriving?: boolean;
  /**
   * Effective daily booking limit. Precedence rule: an active
   * "max_bookings_per_day" booking policy (Settings → Booking Policies)
   * OVERRIDES the built-in default of MAX_CLASSES_PER_DAY (2). Callers that
   * have loaded booking policies should pass the policy value here; when
   * omitted, the built-in default applies.
   */
  maxClassesPerDay?: number;
  /**
   * Moto course only: has the office recorded the student's SAAQ 6R
   * knowledge-test pass? Required (together with yard-prep theory) before any
   * closed-circuit session can be booked. Theory 1 and the 6R test may be
   * done in either order.
   */
  saaq6rKnowledgePassed?: boolean;
  /**
   * Admin-only testing override for Auto Phase 1. Added to the real number of
   * days since Theory #1 without changing the student's attendance history.
   */
  phase1TimingAdvanceDays?: number;
  /** Admin-only testing advance for Auto Phase 2's Theory #6 → In-Car #4 wait. */
  phase2TimingAdvanceDays?: number;
  /** Admin-only testing advance for Auto Phase 3's Theory #8 → Theory #11 wait. */
  phase3TimingAdvanceDays?: number;
  /** Admin-only testing advance for Auto Phase 4's Theory #11 → In-Car #15 wait. */
  phase4TimingAdvanceDays?: number;
  /**
   * The student's current upcoming (not cancelled, not yet attended, class
   * still scheduled) bookings. Used for strict progression gating: the next
   * theory unlocks only when the previous one is completed, in-car lessons
   * may be held two-at-a-time (next number bookable while the previous one
   * is merely booked), duplicates of an already-booked class number are
   * blocked, and at most MAX_CONCURRENT_INCAR_BOOKINGS in-car bookings may
   * be held at once. When omitted, these checks are skipped (legacy callers).
   */
  upcomingBookings?: UpcomingBookingRecord[];
}

export interface UpcomingBookingRecord {
  classType: "theory" | "driving";
  classNumber: number;
}

/** Maximum number of upcoming in-car bookings a student may hold at once. */
export const MAX_CONCURRENT_INCAR_BOOKINGS = 2;

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
    actualDaysElapsed?: number;
    timingAdvanceDays?: number;
    phaseLabel?: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(earlier: string, later: string): number {
  const a = new Date(earlier);
  const b = new Date(later);
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** Does the student currently hold an upcoming booking for this class? */
function hasUpcomingBooking(
  target: TargetClassInfo,
  classType: "theory" | "driving",
  classNumber: number,
): boolean {
  return (target.upcomingBookings ?? []).some(
    (b) => b.classType === classType && b.classNumber === classNumber,
  );
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
  // School-wide daily limit: maximum 2 classes per day (applies in every phase)
  const dailyLimitCheck = checkMaxClassesPerDay(target);
  if (dailyLimitCheck) return dailyLimitCheck;

  // Auto-course daily hours cap: no more than 3 hours of classes per day
  // when an in-car session is involved (a 2-hour in-car rules out a theory
  // class the same day; a 1-hour in-car + theory is fine).
  if (courseType === "auto") {
    const hoursCheck = checkMaxHoursPerDay(target);
    if (hoursCheck) return hoursCheck;
  }

  // Strict per-class progression gating (skipped when the caller did not
  // provide the student's upcoming bookings).
  if (target.upcomingBookings) {
    const seqCheck = validateSequentialProgression(target, completed, courseType);
    if (seqCheck) return seqCheck;
  }

  // Moto follows the real Mortys motorcycle program rules.
  if (courseType === "moto") {
    return validateMotoRules(target, completed);
  }

  // For other non-auto courses apply simplified rules
  if (courseType !== "auto") {
    return validateSimplifiedRules(target, completed, courseType);
  }

  return validateAutoRules(target, completed);
}

/**
 * Strict progression layer applied on top of the per-course rules:
 * - a class number already held as an upcoming booking cannot be booked again;
 * - theory classes unlock strictly one at a time — Theory #n requires
 *   Theory #(n-1) to be completed (attended), which also gates crossing into
 *   the next phase (e.g. Theory #7 stays locked until Theory #6 is done);
 * - driving lessons unlock sequentially: lesson #n is bookable when #(n-1)
 *   is completed OR currently booked;
 * - Auto and simplified-course students may hold up to
 *   MAX_CONCURRENT_INCAR_BOOKINGS upcoming driving bookings. Moto's
 *   multi-session closed-circuit progression is intentionally exempt.
 * Returns null when the target passes this layer.
 */
function validateSequentialProgression(
  target: TargetClassInfo,
  completed: CompletedClassRecord[],
  courseType: string,
): BookingValidationResult | null {
  const { classType, classNumber } = target;
  const upcoming = target.upcomingBookings ?? [];
  const label = classType === "driving" ? "In-Car" : "Theory";

  const isBooked = (type: "theory" | "driving", n: number) =>
    upcoming.some((b) => b.classType === type && b.classNumber === n);

  // Already-completed classes are not bookable again.
  if (hasCompleted(completed, classType, classNumber)) {
    return {
      allowed: false,
      reason: `You have already completed ${label} #${classNumber}.`,
      blockingRule: "class_number_already_completed",
    };
  }

  // Duplicate guard — one upcoming booking per class number.
  if (isBooked(classType, classNumber)) {
    return {
      allowed: false,
      reason: `You already have ${label} #${classNumber} booked. It will unlock again only if that booking is cancelled.`,
      blockingRule: "class_number_already_booked",
    };
  }

  // Auto-course ordering is fully governed by validateAutoRules, which
  // matches the school's phase documents (T2–4 in any order after T1,
  // Phase 3/4 flexible after the phase opener, Phase 2 strictly ordered).
  // The strict one-at-a-time gating below applies to simplified courses only.
  const strictSequence = courseType !== "auto";

  if (classType === "theory") {
    if (strictSequence && classNumber > 1 && !hasCompleted(completed, "theory", classNumber - 1)) {
      return {
        allowed: false,
        reason: `Theory #${classNumber} unlocks after you complete Theory #${classNumber - 1}.`,
        blockingRule: "previous_class_incomplete",
        detail: { prerequisitesNeeded: [`Theory #${classNumber - 1}`] },
      };
    }
    return null;
  }

  // Driving lessons
  const upcomingInCar = upcoming.filter((b) => b.classType === "driving").length;
  if (
    courseType.toLowerCase() !== "moto" &&
    upcomingInCar >= MAX_CONCURRENT_INCAR_BOOKINGS
  ) {
    return {
      allowed: false,
      reason: `You already hold ${MAX_CONCURRENT_INCAR_BOOKINGS} upcoming in-car bookings. Complete or cancel one before booking another.`,
      blockingRule: "max_concurrent_incar_bookings",
    };
  }
  if (
    strictSequence &&
    classNumber > 1 &&
    !hasCompleted(completed, "driving", classNumber - 1) &&
    !isBooked("driving", classNumber - 1)
  ) {
    return {
      allowed: false,
      reason: `In-Car #${classNumber} unlocks after In-Car #${classNumber - 1} is completed or booked.`,
      blockingRule: "previous_class_incomplete",
      detail: { prerequisitesNeeded: [`In-Car #${classNumber - 1}`] },
    };
  }
  return null;
}

/**
 * Built-in default daily limit. An active "max_bookings_per_day" booking
 * policy overrides this — see TargetClassInfo.maxClassesPerDay.
 */
export const MAX_CLASSES_PER_DAY = 2;

// Number of theory/driving sessions per course type. Shared by the booking
// rules below and the recurring-schedule generator (progressive series).
// Auto follows the full phased curriculum (Theory 1–12, In-Car 1–15); the
// fallback covers unknown course types under the simplified rules.
export function getCourseClassCounts(courseType: string): { theoryCount: number; drivingCount: number } {
  const config: Record<string, { theoryCount: number; drivingCount: number }> = {
    auto: { theoryCount: 12, drivingCount: 15 },
    // Moto (Mortys program): Theory 1 (yard prep) + Theory 2 (road prep);
    // practical sessions 1–4 are closed-circuit (240 min each), 5–7 are road
    // sessions (120/240/240 min).
    moto: { theoryCount: 2, drivingCount: 7 },
    // Scooter is a two-session course: one 3-hour theory and one 3-hour practical.
    scooter: { theoryCount: 1, drivingCount: 1 },
  };
  return config[(courseType || '').toLowerCase()] ?? { theoryCount: 5, drivingCount: 10 };
}

/** Auto-course rule (Phase 3 wording, applied whenever an in-car session is
 * involved): no more than 3 hours of classes in one day. Theory classes count
 * as 2 hours when duration is unknown; in-car sessions default to 1 hour. */
export const MAX_MINUTES_PER_DAY = 180;

function assumedMinutes(classType: "theory" | "driving", duration?: number): number {
  return duration ?? (classType === "theory" ? 120 : 60);
}

function checkMaxHoursPerDay(target: TargetClassInfo): BookingValidationResult | null {
  const bookedMinutes = target.sameDayAlreadyBookedMinutes ?? 0;
  if (bookedMinutes === 0) return null;
  const targetIsDriving = target.classType === "driving";
  // The cap only bites when an in-car session is part of the day — two
  // theory classes in one day are governed by the class-count limit alone.
  if (!targetIsDriving && !target.sameDayAlreadyBookedHasDriving) return null;
  const totalMinutes = bookedMinutes + assumedMinutes(target.classType, target.duration);
  if (totalMinutes > MAX_MINUTES_PER_DAY) {
    return {
      allowed: false,
      reason: `No more than 3 hours of classes can be taken in one day. This booking would bring your day to ${(totalMinutes / 60).toFixed(1).replace(/\.0$/, "")} hours. A 2-hour in-car lesson cannot be combined with a theory class on the same day.`,
      blockingRule: "max_hours_per_day",
      detail: {},
    };
  }
  return null;
}

function checkMaxClassesPerDay(
  target: TargetClassInfo
): BookingValidationResult | null {
  const limit = target.maxClassesPerDay ?? MAX_CLASSES_PER_DAY;
  const alreadyBooked = target.sameDayAlreadyBookedCount ?? 0;
  if (alreadyBooked >= limit) {
    return {
      allowed: false,
      reason: `Students can book a maximum of ${limit} ${limit === 1 ? "class" : "classes"} per day. You already have ${alreadyBooked} ${alreadyBooked === 1 ? "class" : "classes"} booked on this date. Please choose a different day.`,
      blockingRule: "max_classes_per_day",
      detail: {},
    };
  }
  return null;
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
        const actualElapsed = daysBetween(t1Date, date);
        const advanceDays = Math.max(0, Math.floor(target.phase1TimingAdvanceDays ?? 0));
        const elapsed = actualElapsed + advanceDays;
        if (elapsed < 28) {
          return {
            allowed: false,
            reason: `Theory #5 cannot be attended until at least 28 days after Theory #1. Only ${elapsed} day(s) count toward the wait since Theory #1 (completed ${t1Date}).`,
            blockingRule: "phase1_min_28_days",
            detail: { daysNeeded: 28, daysElapsed: elapsed, actualDaysElapsed: actualElapsed, timingAdvanceDays: advanceDays, phaseLabel: "Phase 1" },
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
      // Daily 2-classes limit is enforced globally in validateClassBooking
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
      // Daily 2-classes limit is enforced globally in validateClassBooking
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
        const actualElapsed = daysBetween(t8Date, date);
        const advanceDays = Math.max(0, Math.floor(target.phase3TimingAdvanceDays ?? 0));
        const elapsed = actualElapsed + advanceDays;
        if (elapsed < 56) {
          return {
            allowed: false,
            reason: `Phase 3 requires a minimum of 56 days. Only ${elapsed} day(s) count toward the wait since Theory #8 (completed ${t8Date}). ${56 - elapsed} more day(s) needed before you can start Phase 4.`,
            blockingRule: "phase3_min_56_days",
            detail: { daysNeeded: 56, daysElapsed: elapsed, actualDaysElapsed: actualElapsed, timingAdvanceDays: advanceDays, phaseLabel: "Phase 3" },
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

      // In-Car 2: In-Car 1 completed (or currently booked — students may hold
      // two consecutive in-car bookings at once)
      if (classNumber === 2) {
        if (!hasCompleted(completed, "driving", 1) && !hasUpcomingBooking(target, "driving", 1)) {
          return {
            allowed: false,
            reason: "In-Car #2 requires In-Car #1 to be completed first. Phase 2 in-car sessions must be done in order.",
            blockingRule: "phase2_incar_sequential",
            detail: { prerequisitesNeeded: ["In-Car #1"], phaseLabel: "Phase 2" },
          };
        }
        return { allowed: true };
      }

      // In-Car 3: In-Car 2 completed (or currently booked)
      if (classNumber === 3) {
        if (!hasCompleted(completed, "driving", 2) && !hasUpcomingBooking(target, "driving", 2)) {
          return {
            allowed: false,
            reason: "In-Car #3 requires In-Car #2 to be completed first. Phase 2 in-car sessions must be done in order.",
            blockingRule: "phase2_incar_sequential",
            detail: { prerequisitesNeeded: ["In-Car #2"], phaseLabel: "Phase 2" },
          };
        }
        return { allowed: true };
      }

      // In-Car 4: In-Car 3 completed (or currently booked) + 28 days since Theory 6
      if (classNumber === 4) {
        if (!hasCompleted(completed, "driving", 3) && !hasUpcomingBooking(target, "driving", 3)) {
          return {
            allowed: false,
            reason: "In-Car #4 requires In-Car #3 to be completed first. Phase 2 in-car sessions must be done in order.",
            blockingRule: "phase2_incar_sequential",
            detail: { prerequisitesNeeded: ["In-Car #3"], phaseLabel: "Phase 2" },
          };
        }
        const t6Date = dateOf(completed, "theory", 6);
        if (t6Date) {
          const actualElapsed = daysBetween(t6Date, date);
          const advanceDays = Math.max(0, Math.floor(target.phase2TimingAdvanceDays ?? 0));
          const elapsed = actualElapsed + advanceDays;
          if (elapsed < 28) {
            return {
              allowed: false,
              reason: `In-Car #4 cannot be completed until at least 28 days after Theory #6. Only ${elapsed} day(s) count toward the wait since Theory #6 (completed ${t6Date}). ${28 - elapsed} more day(s) needed.`,
              blockingRule: "phase2_min_28_days",
              detail: { daysNeeded: 28, daysElapsed: elapsed, actualDaysElapsed: actualElapsed, timingAdvanceDays: advanceDays, phaseLabel: "Phase 2" },
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

      // Daily 2-classes limit is enforced globally in validateClassBooking
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

      // In-Car 12 & 13: combined shared session.
      // In-Car 13 cannot be booked directly — it is only awarded as part of
      // the combined 12/13 paired session (see isCombined1213Class).
      // In-Car 12 must be a 2-student, 120-minute paired session booked
      // through the pairing queue, not through the normal booking path.
      if (classNumber === 13) {
        return {
          allowed: false,
          reason:
            "In-Car #13 cannot be booked directly. It is awarded automatically when you complete the combined In-Car #12/13 paired session. Please use the pairing queue to join a shared session.",
          blockingRule: "phase4_incar13_not_directly_bookable",
          detail: { phaseLabel: "Phase 4" },
        };
      }
      if (classNumber === 12) {
        // Must be the canonical combined slot: exactly 120 min AND
        // maxStudents = 2. No 60-minute #12 is bookable through ordinary
        // booking, and a missing/unknown duration or seat count is rejected.
        if (duration !== 120) {
          return {
            allowed: false,
            reason:
              "In-Car #12/13 must be booked as the 2-hour (120-minute) combined shared session. A 1-hour In-Car #12 cannot be booked directly.",
            blockingRule: "phase4_shared_session_required",
            detail: { phaseLabel: "Phase 4" },
          };
        }
        if (target.maxStudents !== 2) {
          return {
            allowed: false,
            reason:
              "In-Car #12/13 must be a shared session with exactly 2 students. This class is not configured as a 2-student session. Please contact the school.",
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
        const actualElapsed = daysBetween(t11Date, date);
        const advanceDays = Math.max(0, Math.floor(target.phase4TimingAdvanceDays ?? 0));
        const elapsed = actualElapsed + advanceDays;
        if (elapsed < 56) {
          return {
            allowed: false,
            reason: `Phase 4 requires a minimum of 56 days. Only ${elapsed} day(s) count toward the wait since Theory #11 (completed ${t11Date}). ${56 - elapsed} more day(s) needed before In-Car #15 can be scheduled.`,
            blockingRule: "phase4_min_56_days",
            detail: { daysNeeded: 56, daysElapsed: elapsed, actualDaysElapsed: actualElapsed, timingAdvanceDays: advanceDays, phaseLabel: "Phase 4" },
          };
        }
      }

      return { allowed: true };
    }
  }

  // Unknown class — allow with a warning (shouldn't happen)
  return { allowed: true };
}

// ─── Moto (Mortys motorcycle program) ────────────────────────────────────────

/** Practical sessions 1–4 are closed-circuit; 5–7 are road sessions. */
export const MOTO_CLOSED_CIRCUIT_SESSIONS = 4;
export const MOTO_ROAD_SESSIONS = 3;
/** Theory 1 (yard prep) and Theory 2 (road prep) are 3-hour classes. */
export const MOTO_THEORY_DURATION_MINUTES = 180;

/** Required duration (minutes) for each moto practical session number. */
export function getMotoPracticalDuration(classNumber: number): number | null {
  if (classNumber >= 1 && classNumber <= 4) return 240; // closed-circuit 4h
  if (classNumber === 5) return 120; // road session 1: 2h
  if (classNumber === 6 || classNumber === 7) return 240; // road sessions 2–3: 4h
  return null;
}

export function isMotoClosedCircuitSession(classNumber: number): boolean {
  return classNumber >= 1 && classNumber <= MOTO_CLOSED_CIRCUIT_SESSIONS;
}

/**
 * Real motorcycle program rules:
 * - Theory 1 (yard prep) — always bookable first.
 * - Theory 2 (road prep) — requires Theory 1 AND all four closed-circuit
 *   sessions (it prepares the student for road training, which follows the
 *   closed circuit in the program).
 * - Closed-circuit sessions (practical 1–4, 240 min): require Theory 1
 *   completed AND the SAAQ 6R knowledge-test pass recorded (either order
 *   between the two).
 * - Road sessions (practical 5–7, 120/240/240 min): require Theory 2 (road
 *   prep) completed. Session sequencing itself is enforced by the strict
 *   progression layer when upcoming bookings are provided.
 * - Class numbers outside the 2-theory / 7-practical program are rejected
 *   (legacy placeholder classes are not bookable), and practical sessions
 *   must carry their exact program duration.
 */
function validateMotoRules(
  target: TargetClassInfo,
  completed: CompletedClassRecord[],
): BookingValidationResult {
  const { classType, classNumber, duration } = target;

  if (classType === "theory") {
    if (classNumber > 2) {
      return {
        allowed: false,
        reason: `Theory #${classNumber} is not part of the motorcycle program (only Theory #1 yard preparation and Theory #2 road preparation exist). This looks like a legacy class — please contact the office.`,
        blockingRule: "moto_class_not_in_program",
      };
    }
    // Both program theory classes are fixed 3-hour classes; wrong or missing
    // durations indicate a legacy/misconfigured offering.
    if (duration !== MOTO_THEORY_DURATION_MINUTES) {
      return {
        allowed: false,
        reason: `Theory #${classNumber} (${classNumber === 1 ? "yard" : "road"} preparation) must be a 3-hour (${MOTO_THEORY_DURATION_MINUTES}-minute) class${duration != null ? ` (this class is ${duration} minutes)` : ""}.`,
        blockingRule: "moto_theory_duration",
      };
    }
    if (classNumber === 1) return { allowed: true };
    // Theory 2 (road prep) follows the closed circuit in the program.
    const missing: string[] = [];
    if (!hasCompleted(completed, "theory", 1)) missing.push("Theory #1 (Yard Preparation)");
    for (let n = 1; n <= MOTO_CLOSED_CIRCUIT_SESSIONS; n++) {
      if (!hasCompleted(completed, "driving", n)) missing.push(`Closed-Circuit Session #${n}`);
    }
    if (missing.length > 0) {
      return {
        allowed: false,
        reason: `Theory #2 (road preparation) requires Theory #1 and all four closed-circuit sessions to be completed first. Still needed: ${missing.join(", ")}.`,
        blockingRule: "moto_theory2_prerequisites",
        detail: { prerequisitesNeeded: missing },
      };
    }
    return { allowed: true };
  }

  // Practical sessions
  const requiredDuration = getMotoPracticalDuration(classNumber);
  if (requiredDuration == null) {
    return {
      allowed: false,
      reason: `Session #${classNumber} is not part of the motorcycle program (4 closed-circuit sessions and 3 road sessions). This looks like a legacy class — please contact the office.`,
      blockingRule: "moto_class_not_in_program",
    };
  }
  if (duration !== requiredDuration) {
    return {
      allowed: false,
      reason: `This ${isMotoClosedCircuitSession(classNumber) ? "closed-circuit" : "road"} session must be booked as a ${requiredDuration / 60}-hour (${requiredDuration}-minute) session${duration != null ? ` (this class is ${duration} minutes)` : ""}.`,
      blockingRule: "moto_session_duration",
    };
  }

  if (isMotoClosedCircuitSession(classNumber)) {
    const missing: string[] = [];
    if (!hasCompleted(completed, "theory", 1)) missing.push("Theory #1 (Yard Preparation)");
    if (!target.saaq6rKnowledgePassed) missing.push("SAAQ 6R knowledge test (pass recorded by the office)");
    if (missing.length > 0) {
      return {
        allowed: false,
        reason: `Closed-circuit sessions require the yard-preparation theory class AND a recorded SAAQ 6R knowledge-test pass (they can be done in either order). Still needed: ${missing.join(", ")}.`,
        blockingRule: "moto_closed_circuit_prerequisites",
        detail: { prerequisitesNeeded: missing },
      };
    }
    return { allowed: true };
  }

  // Road sessions (5–7)
  if (!hasCompleted(completed, "theory", 2)) {
    return {
      allowed: false,
      reason: "Road sessions require Theory #2 (road preparation) to be completed first.",
      blockingRule: "moto_road_requires_road_theory",
      detail: { prerequisitesNeeded: ["Theory #2 (Road Preparation)"] },
    };
  }
  return { allowed: true };
}

// ─── Simplified rules for Scooter ─────────────────────────────────────────────

function validateSimplifiedRules(
  target: TargetClassInfo,
  completed: CompletedClassRecord[],
  courseType: string
): BookingValidationResult {
  const { classType, classNumber } = target;

  // Config per course
  const c = getCourseClassCounts(courseType);

  const maxClassNumber = classType === "theory" ? c.theoryCount : c.drivingCount;
  if (
    !Number.isInteger(classNumber) ||
    classNumber < 1 ||
    classNumber > maxClassNumber
  ) {
    return {
      allowed: false,
      reason: `This session is not part of the ${courseType} course curriculum.`,
      blockingRule: "invalid_course_session",
    };
  }
  if (courseType.toLowerCase() === "scooter" && target.duration !== 180) {
    return {
      allowed: false,
      reason: "Scooter theory and practical sessions must each be 3 hours.",
      blockingRule: "scooter_session_duration",
    };
  }

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
        reason: courseType.toLowerCase() === "scooter"
          ? "You must complete the scooter theory session before booking the practical session."
          : `You must complete all ${c.theoryCount} theory classes before booking in-car sessions. You have completed ${completedTheory}.`,
        blockingRule: "theory_required_before_driving",
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

// ─── Combined In-Car 12/13 helper ─────────────────────────────────────────────

/**
 * Returns true when an enrollment row represents the canonical combined
 * In-Car 12/13 session (auto driving, classNumber=12, duration=120,
 * maxStudents=2).  These rows count as BOTH #12 AND #13 completed.
 *
 * Exported so routes (buildPhaseProgress) and tests can use the same check.
 */
export function isCombined1213Class(e: {
  classType: string | null;
  classNumber: number | null;
  duration: number | null;
  maxStudents?: number | null;
  courseType?: string | null;
}): boolean {
  // Strict canonical check: missing/unknown duration or maxStudents is NOT
  // canonical. A combined 12/13 slot is exactly AUTO-course driving #12,
  // 120 minutes, 2 seats — anything else (incl. a 60-minute or single-seat
  // #12, or a non-auto course) is not.
  return (
    (e.courseType ?? "").toLowerCase() === "auto" &&
    e.classType === "driving" &&
    e.classNumber === 12 &&
    e.duration === 120 &&
    e.maxStudents === 2
  );
}

// ─── Utility: build CompletedClassRecord[] from enrollment data ───────────────

export interface EnrollmentWithClass {
  attendanceStatus: string | null;
  classType: string | null;
  classNumber: number | null;
  date: string | null;
  duration: number | null;
  /**
   * Used by isCombined1213Class to expand #12 rows to also count as #13.
   * Required for the 12/13 expansion: a null/unknown value is treated as
   * NON-canonical (no expansion).
   */
  maxStudents?: number | null;
  /**
   * Course type of the class. The 12/13 combined expansion applies ONLY to
   * auto-course rows; a non-auto 120-min driving #12 must never expand to #13.
   */
  courseType?: string | null;
}

/**
 * Build the list of completed class records from enrollment rows.
 *
 * Special rule for the combined In-Car 12/13 session:
 *   An attended canonical #12 row (driving, classNumber=12, duration=120,
 *   maxStudents=2) is expanded to TWO records — one for #12 and one for #13 —
 *   so that progression checks for In-Car #15 (which requires both 12 and 13)
 *   are satisfied automatically.
 */
export function buildCompletedClasses(
  enrollments: EnrollmentWithClass[]
): CompletedClassRecord[] {
  const records: CompletedClassRecord[] = [];
  for (const e of enrollments) {
    if (
      e.attendanceStatus !== "attended" ||
      e.classType == null ||
      e.classNumber == null ||
      e.date == null
    ) {
      continue;
    }
    records.push({
      classType: e.classType as "theory" | "driving",
      classNumber: e.classNumber,
      date: e.date,
      duration: e.duration ?? undefined,
    });
    // Expand the combined 12/13 row to also count as In-Car #13.
    if (isCombined1213Class(e)) {
      records.push({
        classType: "driving",
        classNumber: 13,
        date: e.date,
        duration: e.duration ?? undefined,
      });
    }
  }
  return records;
}

/**
 * Merge validated scooter transfer credits into attended completion records.
 * Scooter transfer credits are intentionally limited to class #1 of each type;
 * out-of-range legacy values cannot unlock non-existent curriculum sessions.
 */
export function mergeScooterTransferCredits(
  completed: CompletedClassRecord[],
  student: {
    courseType?: string | null;
    completedTheoryClasses?: unknown;
    completedInCarSessions?: unknown;
    enrollmentDate?: string | null;
  } | null | undefined,
): CompletedClassRecord[] {
  if ((student?.courseType || "").toLowerCase() !== "scooter") return completed;

  const merged = [...completed];
  const creditDate = student?.enrollmentDate || "1970-01-01";
  const addCredit = (classType: "theory" | "driving", values: unknown) => {
    if (!Array.isArray(values) || !values.some((value) => value === 1)) return;
    if (merged.some((record) => record.classType === classType && record.classNumber === 1)) return;
    merged.push({ classType, classNumber: 1, date: creditDate, duration: 180 });
  };

  addCredit("theory", student?.completedTheoryClasses);
  addCredit("driving", student?.completedInCarSessions);
  return merged;
}
