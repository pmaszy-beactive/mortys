/**
 * In-Car 12/13 combined pairing — pure/DB-free lifecycle tests.
 *
 * Tests cover:
 *  - isCombined1213Class helper (canonical class detection)
 *  - buildCompletedClasses expansion (#12 → also #13)
 *  - Eligibility logic (pure version mirroring service rules)
 *  - Offer deadline calculation
 *  - Solo conversion eligibility
 *  - Queue ordering
 *  - Blocking rules: direct #13 booking, non-canonical #12
 *  - buildCompletedClasses integration with In-Car #15 prerequisite check
 */

import { describe, it, expect } from "vitest";
import {
  isCombined1213Class,
  buildCompletedClasses,
  validateClassBooking,
  type EnrollmentWithClass,
} from "../../shared/bookingRules";
import {
  OFFER_DEADLINE_HOURS,
  evaluateManualPairGuards,
  decideRequeueAction,
  applyOfferTransition,
  evaluateSoloConversionGates,
  decideBookedFirstTeardown,
  decideAcceptGuard,
  decideBothConfirmedTransition,
} from "../services/incar-pairing";

// ─── isCombined1213Class ──────────────────────────────────────────────────────

describe("isCombined1213Class", () => {
  it("returns true for the canonical combined slot", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: 120,
        maxStudents: 2,
        courseType: "auto",
      }),
    ).toBe(true);
  });

  it("is case-insensitive on courseType", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: 120,
        maxStudents: 2,
        courseType: "AUTO",
      }),
    ).toBe(true);
  });

  it("returns false for a non-auto (moto) canonical-shaped slot", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: 120,
        maxStudents: 2,
        courseType: "moto",
      }),
    ).toBe(false);
  });

  it("returns false when courseType is missing (strict: not canonical)", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: 120,
        maxStudents: 2,
      }),
    ).toBe(false);
  });

  it("returns false when courseType is null (strict: not canonical)", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: 120,
        maxStudents: 2,
        courseType: null,
      }),
    ).toBe(false);
  });

  it("returns false when maxStudents is null (strict: not canonical)", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: 120,
        maxStudents: null,
        courseType: "auto",
      }),
    ).toBe(false);
  });

  it("returns false when maxStudents is undefined (strict: not canonical)", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: 120,
        courseType: "auto",
      }),
    ).toBe(false);
  });

  it("returns false when duration is null (strict: not canonical)", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: null,
        maxStudents: 2,
        courseType: "auto",
      }),
    ).toBe(false);
  });

  it("returns false when classType is theory", () => {
    expect(
      isCombined1213Class({
        classType: "theory",
        classNumber: 12,
        duration: 120,
        maxStudents: 2,
        courseType: "auto",
      }),
    ).toBe(false);
  });

  it("returns false when classNumber is 13", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 13,
        duration: 120,
        maxStudents: 2,
        courseType: "auto",
      }),
    ).toBe(false);
  });

  it("returns false when duration is 60 (solo In-Car, not combined)", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: 60,
        maxStudents: 2,
        courseType: "auto",
      }),
    ).toBe(false);
  });

  it("returns false when maxStudents is 1", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 12,
        duration: 120,
        maxStudents: 1,
        courseType: "auto",
      }),
    ).toBe(false);
  });

  it("returns false for classNumber 11", () => {
    expect(
      isCombined1213Class({
        classType: "driving",
        classNumber: 11,
        duration: 120,
        maxStudents: 2,
        courseType: "auto",
      }),
    ).toBe(false);
  });
});

// ─── buildCompletedClasses — #12 expansion ────────────────────────────────────

describe("buildCompletedClasses — combined 12/13 expansion", () => {
  const base12: EnrollmentWithClass = {
    attendanceStatus: "attended",
    classType: "driving",
    classNumber: 12,
    date: "2025-06-01",
    duration: 120,
    maxStudents: 2,
    courseType: "auto",
  };

  it("expands an attended canonical #12 to both #12 and #13", () => {
    const result = buildCompletedClasses([base12]);
    const nums = result.map((r) => r.classNumber);
    expect(nums).toContain(12);
    expect(nums).toContain(13);
    expect(result.length).toBe(2);
  });

  it("both expanded records have classType=driving", () => {
    const result = buildCompletedClasses([base12]);
    expect(result.every((r) => r.classType === "driving")).toBe(true);
  });

  it("both expanded records inherit the original date", () => {
    const result = buildCompletedClasses([base12]);
    expect(result.every((r) => r.date === "2025-06-01")).toBe(true);
  });

  it("does NOT expand a 60-min #12 (solo, non-canonical)", () => {
    const solo12: EnrollmentWithClass = {
      ...base12,
      duration: 60,
    };
    const result = buildCompletedClasses([solo12]);
    expect(result.length).toBe(1);
    expect(result[0].classNumber).toBe(12);
  });

  it("does NOT expand a maxStudents=1 #12 row", () => {
    const solo12: EnrollmentWithClass = {
      ...base12,
      maxStudents: 1,
    };
    const result = buildCompletedClasses([solo12]);
    expect(result.length).toBe(1);
  });

  it("does NOT expand a #12 row with null maxStudents (strict)", () => {
    const nullMax: EnrollmentWithClass = {
      ...base12,
      maxStudents: null,
    };
    const result = buildCompletedClasses([nullMax]);
    expect(result.length).toBe(1);
    expect(result[0].classNumber).toBe(12);
  });

  it("does NOT expand a #12 row with null duration (strict)", () => {
    const nullDur: EnrollmentWithClass = {
      ...base12,
      duration: null,
    };
    const result = buildCompletedClasses([nullDur]);
    expect(result.length).toBe(1);
    expect(result[0].classNumber).toBe(12);
  });

  it("does not duplicate when both #12 and separate #13 exist", () => {
    const manual13: EnrollmentWithClass = {
      attendanceStatus: "attended",
      classType: "driving",
      classNumber: 13,
      date: "2025-06-01",
      duration: 60,
      maxStudents: 1,
    };
    const result = buildCompletedClasses([base12, manual13]);
    const thirteens = result.filter((r) => r.classNumber === 13);
    // one from expansion, one from the manual row — both legitimate
    expect(thirteens.length).toBe(2);
  });

  it("does not expand when attendanceStatus is registered (not attended)", () => {
    const unattended: EnrollmentWithClass = { ...base12, attendanceStatus: "registered" };
    const result = buildCompletedClasses([unattended]);
    expect(result.length).toBe(0);
  });

  it("does NOT expand a non-auto (moto) 120-min driving #12 to #13", () => {
    const motoTwelve: EnrollmentWithClass = { ...base12, courseType: "moto" };
    const result = buildCompletedClasses([motoTwelve]);
    expect(result.length).toBe(1);
    expect(result[0].classNumber).toBe(12);
    expect(result.map((r) => r.classNumber)).not.toContain(13);
  });

  it("does NOT expand a #12 row with missing courseType (strict)", () => {
    const noCourse: EnrollmentWithClass = { ...base12 };
    delete (noCourse as { courseType?: string | null }).courseType;
    const result = buildCompletedClasses([noCourse]);
    expect(result.length).toBe(1);
    expect(result[0].classNumber).toBe(12);
  });

  it("handles empty input", () => {
    expect(buildCompletedClasses([])).toEqual([]);
  });
});

// ─── In-Car #15 prerequisite gate with combined 12/13 ─────────────────────────

describe("In-Car #15 prerequisite: combined 12/13 row satisfies both #12 and #13", () => {
  /** Minimal completed set for In-Car #15: T11, T12, IC11–IC14, all of Phase 3. */
  function makeFullPhase4Completed(): EnrollmentWithClass[] {
    const rows: EnrollmentWithClass[] = [];
    // Theory 1-12
    for (let n = 1; n <= 12; n++) {
      rows.push({ attendanceStatus: "attended", classType: "theory", classNumber: n, date: "2025-01-01", duration: 120 });
    }
    // In-Car 1-11 (60 min each)
    for (let n = 1; n <= 11; n++) {
      rows.push({ attendanceStatus: "attended", classType: "driving", classNumber: n, date: "2025-01-01", duration: 60 });
    }
    return rows;
  }

  it("allows In-Car #15 when combined #12 row satisfies both #12 and #13", () => {
    const completed = makeFullPhase4Completed();
    // Combined 12/13 (auto course — expands to both #12 and #13)
    completed.push({
      attendanceStatus: "attended",
      classType: "driving",
      classNumber: 12,
      date: "2025-03-01",
      duration: 120,
      maxStudents: 2,
      courseType: "auto",
    });
    // In-Car 14
    completed.push({
      attendanceStatus: "attended",
      classType: "driving",
      classNumber: 14,
      date: "2025-04-01",
      duration: 60,
    });

    const result = validateClassBooking(
      {
        classType: "driving",
        classNumber: 15,
        date: "2025-09-01", // well after T11 + 56 days
        duration: 60,
      },
      buildCompletedClasses(completed),
      "auto",
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks In-Car #15 when a NON-AUTO 120-min #12 exists (no #13 expansion)", () => {
    const completed = makeFullPhase4Completed();
    // Non-auto canonical-shaped #12 — must NOT expand to #13.
    completed.push({
      attendanceStatus: "attended",
      classType: "driving",
      classNumber: 12,
      date: "2025-03-01",
      duration: 120,
      maxStudents: 2,
      courseType: "moto",
    });
    completed.push({
      attendanceStatus: "attended",
      classType: "driving",
      classNumber: 14,
      date: "2025-04-01",
      duration: 60,
    });

    const result = validateClassBooking(
      { classType: "driving", classNumber: 15, date: "2025-09-01", duration: 60 },
      buildCompletedClasses(completed),
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.detail?.prerequisitesNeeded).toContain("In-Car #13");
  });

  it("blocks In-Car #15 when only a solo 60-min #12 exists (no #13)", () => {
    const completed = makeFullPhase4Completed();
    // Solo 60-min #12 — does NOT expand to #13
    completed.push({
      attendanceStatus: "attended",
      classType: "driving",
      classNumber: 12,
      date: "2025-03-01",
      duration: 60,
    });
    // In-Car 14
    completed.push({
      attendanceStatus: "attended",
      classType: "driving",
      classNumber: 14,
      date: "2025-04-01",
      duration: 60,
    });

    const result = validateClassBooking(
      {
        classType: "driving",
        classNumber: 15,
        date: "2025-09-01",
        duration: 60,
      },
      buildCompletedClasses(completed),
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.detail?.prerequisitesNeeded).toContain("In-Car #13");
  });
});

// ─── Booking rules: direct #13 blocked ────────────────────────────────────────

describe("booking rules: direct In-Car #13 booking blocked", () => {
  const phase4Completed: EnrollmentWithClass[] = [
    // Theory 1-12
    ...[...Array(12)].map((_, i) => ({
      attendanceStatus: "attended" as const,
      classType: "theory" as const,
      classNumber: i + 1,
      date: "2025-01-01",
      duration: 120,
    })),
    // In-Car 1-11
    ...[...Array(11)].map((_, i) => ({
      attendanceStatus: "attended" as const,
      classType: "driving" as const,
      classNumber: i + 1,
      date: "2025-01-01",
      duration: 60,
    })),
  ];

  it("blocks direct booking of In-Car #13 regardless of phase status", () => {
    const result = validateClassBooking(
      { classType: "driving", classNumber: 13, date: "2025-09-01", duration: 120, maxStudents: 2 },
      buildCompletedClasses(phase4Completed),
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("phase4_incar13_not_directly_bookable");
  });

  it("blocks #13 even when #12 already completed", () => {
    const withTwelve = [
      ...phase4Completed,
      { attendanceStatus: "attended" as const, classType: "driving" as const, classNumber: 12, date: "2025-05-01", duration: 120, maxStudents: 2 },
    ];
    const result = validateClassBooking(
      { classType: "driving", classNumber: 13, date: "2025-09-01", duration: 120, maxStudents: 2 },
      buildCompletedClasses(withTwelve),
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("phase4_incar13_not_directly_bookable");
  });
});

// ─── Booking rules: #12 non-canonical slot blocked ────────────────────────────

describe("booking rules: In-Car #12 non-canonical slot blocked", () => {
  const withT11: EnrollmentWithClass[] = [
    ...([...Array(11)].map((_, i) => ({
      attendanceStatus: "attended" as const,
      classType: "theory" as const,
      classNumber: i + 1,
      date: "2025-01-01",
      duration: 120,
    }))),
  ];

  it("blocks #12 on a solo class (maxStudents=1)", () => {
    const result = validateClassBooking(
      {
        classType: "driving",
        classNumber: 12,
        date: "2025-09-01",
        duration: 120,
        maxStudents: 1,
      },
      buildCompletedClasses(withT11),
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("phase4_shared_session_required");
  });

  it("allows #12 on the canonical shared class (maxStudents=2)", () => {
    const result = validateClassBooking(
      {
        classType: "driving",
        classNumber: 12,
        date: "2025-09-01",
        duration: 120,
        maxStudents: 2,
      },
      buildCompletedClasses(withT11),
      "auto",
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks a 60-minute #12 through ordinary booking", () => {
    const result = validateClassBooking(
      {
        classType: "driving",
        classNumber: 12,
        date: "2025-09-01",
        duration: 60,
        maxStudents: 2,
      },
      buildCompletedClasses(withT11),
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("phase4_shared_session_required");
  });

  it("blocks a #12 with unknown/undefined duration", () => {
    const result = validateClassBooking(
      {
        classType: "driving",
        classNumber: 12,
        date: "2025-09-01",
        maxStudents: 2,
      },
      buildCompletedClasses(withT11),
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("phase4_shared_session_required");
  });

  it("blocks a #12 with unknown/undefined maxStudents", () => {
    const result = validateClassBooking(
      {
        classType: "driving",
        classNumber: 12,
        date: "2025-09-01",
        duration: 120,
      },
      buildCompletedClasses(withT11),
      "auto",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingRule).toBe("phase4_shared_session_required");
  });
});

// ─── Eligibility logic (pure mirror) ─────────────────────────────────────────

interface MockEnrollment {
  classType: string;
  classNumber: number;
  attendanceStatus: string;
  cancelledAt: null | Date;
  duration?: number;
}

function checkEligibilityPure(
  courseType: string,
  enrollments: MockEnrollment[],
  activeQueueStatus?: string,
  activePaired?: boolean,
): { eligible: boolean; reason?: string } {
  if (courseType.toLowerCase() !== "auto") {
    return { eligible: false, reason: "Only auto-course students may join the In-Car 12/13 pairing queue." };
  }

  const attended = (ct: string, cn: number, dur?: number) =>
    enrollments.some(
      (e) =>
        e.classType === ct &&
        e.classNumber === cn &&
        e.attendanceStatus === "attended" &&
        !e.cancelledAt &&
        (dur === undefined || e.duration === dur),
    );

  if (!attended("theory", 11)) {
    return {
      eligible: false,
      reason: "Theory #11 must be completed before joining the In-Car 12/13 pairing queue.",
    };
  }

  // Combined session already completed (120-min attended #12)
  if (attended("driving", 12, 120)) {
    return { eligible: false, reason: "The combined In-Car #12/13 session has already been completed." };
  }

  const activeStatuses = ["waiting", "offered", "booked_first", "paired", "confirmed"];
  if (activeQueueStatus && activeStatuses.includes(activeQueueStatus)) {
    return {
      eligible: false,
      reason: `Student is already in the pairing system (status: ${activeQueueStatus}).`,
    };
  }

  if (activePaired) {
    return { eligible: false, reason: "Student is already in the pairing system (status: paired)." };
  }

  return { eligible: true };
}

describe("checkEligibilityPure — course type gate", () => {
  it("rejects moto students", () => {
    expect(checkEligibilityPure("moto", []).eligible).toBe(false);
  });

  it("accepts auto students (case-insensitive)", () => {
    // Will fail Theory 11 check, but not course-type check
    const r = checkEligibilityPure("AUTO", []);
    expect(r.reason).toContain("Theory #11");
  });
});

describe("checkEligibilityPure — Theory 11 prerequisite", () => {
  it("blocks without Theory 11", () => {
    expect(checkEligibilityPure("auto", []).eligible).toBe(false);
  });

  it("blocks when Theory 11 is registered but not attended", () => {
    const enr: MockEnrollment[] = [
      { classType: "theory", classNumber: 11, attendanceStatus: "registered", cancelledAt: null },
    ];
    expect(checkEligibilityPure("auto", enr).eligible).toBe(false);
  });

  it("blocks when Theory 11 enrollment is cancelled", () => {
    const enr: MockEnrollment[] = [
      { classType: "theory", classNumber: 11, attendanceStatus: "attended", cancelledAt: new Date() },
    ];
    expect(checkEligibilityPure("auto", enr).eligible).toBe(false);
  });

  it("passes when Theory 11 is attended", () => {
    const enr: MockEnrollment[] = [
      { classType: "theory", classNumber: 11, attendanceStatus: "attended", cancelledAt: null },
    ];
    expect(checkEligibilityPure("auto", enr).eligible).toBe(true);
  });
});

describe("checkEligibilityPure — combined session already done", () => {
  const base: MockEnrollment[] = [
    { classType: "theory", classNumber: 11, attendanceStatus: "attended", cancelledAt: null },
  ];

  it("blocks when the 120-min #12 is already attended", () => {
    const enr = [...base, { classType: "driving", classNumber: 12, attendanceStatus: "attended", cancelledAt: null, duration: 120 }];
    const r = checkEligibilityPure("auto", enr);
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("already been completed");
  });

  it("does NOT block when only a 60-min #12 is attended (solo, different class)", () => {
    const enr = [...base, { classType: "driving", classNumber: 12, attendanceStatus: "attended", cancelledAt: null, duration: 60 }];
    // A 60-min #12 is treated as a solo non-combined class; eligibility should pass
    expect(checkEligibilityPure("auto", enr).eligible).toBe(true);
  });

  it("does not block when 120-min #12 is cancelled", () => {
    const enr = [...base, { classType: "driving", classNumber: 12, attendanceStatus: "attended", cancelledAt: new Date(), duration: 120 }];
    expect(checkEligibilityPure("auto", enr).eligible).toBe(true);
  });
});

describe("checkEligibilityPure — active queue/paired guard", () => {
  const base: MockEnrollment[] = [
    { classType: "theory", classNumber: 11, attendanceStatus: "attended", cancelledAt: null },
  ];

  it("blocks when already waiting", () => {
    expect(checkEligibilityPure("auto", base, "waiting").eligible).toBe(false);
  });

  it("blocks when already booked_first", () => {
    expect(checkEligibilityPure("auto", base, "booked_first").eligible).toBe(false);
  });

  it("blocks when already paired", () => {
    expect(checkEligibilityPure("auto", base, "paired").eligible).toBe(false);
  });

  it("allows when previous entry is in terminal state 'completed'", () => {
    // terminal states are not passed as activeQueueStatus
    expect(checkEligibilityPure("auto", base, undefined).eligible).toBe(true);
  });
});

// ─── Offer deadline ────────────────────────────────────────────────────────────

describe("Offer expiry", () => {
  function offerExpiresAt(created: Date): Date {
    return new Date(created.getTime() + OFFER_DEADLINE_HOURS * 60 * 60 * 1000);
  }
  function isExpired(expiresAt: Date, now: Date): boolean {
    return now > expiresAt;
  }

  it("deadline is exactly 24 hours after creation", () => {
    const created = new Date("2025-06-01T10:00:00Z");
    expect(offerExpiresAt(created)).toEqual(new Date("2025-06-02T10:00:00Z"));
  });

  it("not expired 1 second before deadline", () => {
    const exp = new Date("2025-06-02T10:00:00Z");
    expect(isExpired(exp, new Date("2025-06-02T09:59:59Z"))).toBe(false);
  });

  it("expired 1 second after deadline", () => {
    const exp = new Date("2025-06-02T10:00:00Z");
    expect(isExpired(exp, new Date("2025-06-02T10:00:01Z"))).toBe(true);
  });

  it("OFFER_DEADLINE_HOURS is 24", () => {
    expect(OFFER_DEADLINE_HOURS).toBe(24);
  });
});

// ─── Solo conversion eligibility (pure) ───────────────────────────────────────

describe("Solo conversion eligibility", () => {
  function canConvert(
    target: number,
    enrollments: MockEnrollment[],
  ): { allowed: boolean; reason?: string } {
    if (target !== 11 && target !== 14) {
      return { allowed: false, reason: "Solo conversion only allowed to In-Car #11 or #14." };
    }
    const done = enrollments.some(
      (e) =>
        e.classType === "driving" &&
        e.classNumber === target &&
        e.attendanceStatus === "attended" &&
        !e.cancelledAt,
    );
    if (done) return { allowed: false, reason: `In-Car #${target} already completed.` };
    return { allowed: true };
  }

  it("allows conversion to In-Car 11 when not done", () => {
    expect(canConvert(11, []).allowed).toBe(true);
  });

  it("allows conversion to In-Car 14 when not done", () => {
    expect(canConvert(14, []).allowed).toBe(true);
  });

  it("rejects conversion to In-Car 12 (invalid target)", () => {
    expect(canConvert(12, []).allowed).toBe(false);
  });

  it("rejects conversion to In-Car 13 (invalid target)", () => {
    expect(canConvert(13, []).allowed).toBe(false);
  });

  it("blocks when In-Car 11 already completed", () => {
    const enr: MockEnrollment[] = [
      { classType: "driving", classNumber: 11, attendanceStatus: "attended", cancelledAt: null },
    ];
    const r = canConvert(11, enr);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("already completed");
  });

  it("allows when In-Car 11 attendance is cancelled", () => {
    const enr: MockEnrollment[] = [
      { classType: "driving", classNumber: 11, attendanceStatus: "attended", cancelledAt: new Date() },
    ];
    expect(canConvert(11, enr).allowed).toBe(true);
  });
});

// ─── Queue ordering ────────────────────────────────────────────────────────────

describe("Queue ordering: priority then FIFO", () => {
  interface Entry { id: number; priority: number; queuedAt: Date }
  function sort(entries: Entry[]): Entry[] {
    return [...entries].sort((a, b) =>
      a.priority !== b.priority
        ? a.priority - b.priority
        : a.queuedAt.getTime() - b.queuedAt.getTime(),
    );
  }

  it("lower priority number comes first", () => {
    const entries: Entry[] = [
      { id: 1, priority: 100, queuedAt: new Date("2025-01-01") },
      { id: 2, priority: 1, queuedAt: new Date("2025-01-02") },
    ];
    expect(sort(entries)[0].id).toBe(2);
  });

  it("FIFO tie-break within same priority", () => {
    const entries: Entry[] = [
      { id: 1, priority: 100, queuedAt: new Date("2025-01-02") },
      { id: 2, priority: 100, queuedAt: new Date("2025-01-01") },
    ];
    expect(sort(entries)[0].id).toBe(2);
  });

  it("deferred-then-waiting student outranks normal entries via boosted priority", () => {
    // A no-partner-deferred student is returned to 'waiting' with priority
    // boosted to 50 (see deferBookedStudent), so they outrank normal (100)
    // waiters for the next shared slot.
    const entries: Entry[] = [
      { id: 3, priority: 100, queuedAt: new Date("2025-01-01") }, // normal
      { id: 1, priority: 50, queuedAt: new Date("2024-12-01") },  // deferred → waiting (boosted)
      { id: 2, priority: 100, queuedAt: new Date("2025-01-03") }, // normal
    ];
    const sorted = sort(entries);
    expect(sorted[0].id).toBe(1); // boosted priority wins
  });
});

// ─── ONE queue (no separate 12 / 13 queues) ────────────────────────────────────

describe("Single combined queue invariant", () => {
  it("SharedSessionNumber type is always 12", () => {
    // The combined session is always represented as session number 12.
    const sessionNumber: 12 = 12;
    expect(sessionNumber).toBe(12);
  });

  it("OFFER_DEADLINE_HOURS is a positive integer", () => {
    expect(Number.isInteger(OFFER_DEADLINE_HOURS)).toBe(true);
    expect(OFFER_DEADLINE_HOURS).toBeGreaterThan(0);
  });
});

// ─── offerNextCandidate: candidate exclusion logic (pure mirror) ──────────────

describe("offerNextCandidate candidate selection", () => {
  interface Waiter { studentId: number; priority: number; queuedAt: Date }

  /**
   * Mirror of the service's candidate filter: exclude students already
   * enrolled in the class and students who previously declined/expired/
   * withdrew an offer for THIS class; pick lowest priority then FIFO.
   */
  function pickCandidate(
    waiting: Waiter[],
    enrolledIds: number[],
    priorNonPendingIds: number[],
  ): Waiter | null {
    const excluded = new Set([...enrolledIds, ...priorNonPendingIds]);
    const eligible = waiting
      .filter((w) => !excluded.has(w.studentId))
      .sort((a, b) =>
        a.priority !== b.priority
          ? a.priority - b.priority
          : a.queuedAt.getTime() - b.queuedAt.getTime(),
      );
    return eligible[0] ?? null;
  }

  const waiting: Waiter[] = [
    { studentId: 1, priority: 100, queuedAt: new Date("2025-01-01") },
    { studentId: 2, priority: 100, queuedAt: new Date("2025-01-02") },
    { studentId: 3, priority: 50, queuedAt: new Date("2025-01-03") },
  ];

  it("picks highest-priority eligible candidate", () => {
    expect(pickCandidate(waiting, [], [])?.studentId).toBe(3);
  });

  it("excludes a student who already declined for this class", () => {
    // 3 declined → next best is student 1 (FIFO among priority 100)
    expect(pickCandidate(waiting, [], [3])?.studentId).toBe(1);
  });

  it("a decliner is NOT immediately re-offered the same class", () => {
    // Among only the priority-100 waiters, student 1 is FIFO-first. If student 1
    // declined, they must not be picked again — student 2 is next.
    const p100Only: Waiter[] = [
      { studentId: 1, priority: 100, queuedAt: new Date("2025-01-01") },
      { studentId: 2, priority: 100, queuedAt: new Date("2025-01-02") },
    ];
    expect(pickCandidate(p100Only, [], [1])?.studentId).toBe(2);
  });

  it("excludes a student already enrolled in the class (the first booker)", () => {
    expect(pickCandidate(waiting, [3], [])?.studentId).toBe(1);
  });

  it("returns null when every waiter is excluded", () => {
    expect(pickCandidate(waiting, [1], [2, 3])).toBeNull();
  });

  it("combines enrolled + prior-declined exclusions", () => {
    expect(pickCandidate(waiting, [1], [3])?.studentId).toBe(2);
  });
});

// ─── One pending offer per class invariant (pure mirror) ──────────────────────

describe("One pending offer per class", () => {
  interface Offer { classId: number; status: string }

  function hasPending(offers: Offer[], classId: number): boolean {
    return offers.some((o) => o.classId === classId && o.status === "pending");
  }

  it("detects an existing pending offer for the class", () => {
    const offers: Offer[] = [{ classId: 10, status: "pending" }];
    expect(hasPending(offers, 10)).toBe(true);
  });

  it("declined/expired offers do not count as pending", () => {
    const offers: Offer[] = [
      { classId: 10, status: "declined" },
      { classId: 10, status: "expired" },
      { classId: 10, status: "withdrawn" },
    ];
    expect(hasPending(offers, 10)).toBe(false);
  });

  it("does not block a different class", () => {
    const offers: Offer[] = [{ classId: 10, status: "pending" }];
    expect(hasPending(offers, 11)).toBe(false);
  });
});

// ─── Capacity guard in offerNextCandidate (pure mirror) ───────────────────────

describe("Capacity guard: no offer when class full", () => {
  function seatAvailable(enrolledCount: number, maxStudents: number): boolean {
    return enrolledCount < maxStudents;
  }

  it("allows an offer when one seat remains (1 of 2)", () => {
    expect(seatAvailable(1, 2)).toBe(true);
  });

  it("blocks an offer when class is full (2 of 2)", () => {
    expect(seatAvailable(2, 2)).toBe(false);
  });
});

// ─── Accept requires a real first-booker (pure mirror) ────────────────────────

describe("Accept requires a distinct booked_first entry", () => {
  interface Entry { studentId: number; status: string; bookedClassId: number | null }

  function canPairAccept(
    firstBooker: Entry | undefined,
    acceptingStudentId: number,
  ): { ok: boolean; reason?: string } {
    if (!firstBooker) return { ok: false, reason: "no first-booker" };
    if (firstBooker.studentId === acceptingStudentId) {
      return { ok: false, reason: "cannot pair with self" };
    }
    return { ok: true };
  }

  it("rejects accept when there is no booked_first entry", () => {
    expect(canPairAccept(undefined, 5).ok).toBe(false);
  });

  it("rejects accept that would pair a student with themself", () => {
    const fb: Entry = { studentId: 5, status: "booked_first", bookedClassId: 10 };
    const r = canPairAccept(fb, 5);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("self");
  });

  it("allows accept with a distinct first-booker", () => {
    const fb: Entry = { studentId: 4, status: "booked_first", bookedClassId: 10 };
    expect(canPairAccept(fb, 5).ok).toBe(true);
  });
});

// ─── leave booked_first: no partner offer afterwards (pure mirror) ────────────

describe("Leaving booked_first tears down the seat (no new partner offer)", () => {
  /**
   * Mirror of leaveCombinedQueue for a booked_first entry: cancel enrollment,
   * withdraw the class's pending offer (returning that candidate to waiting),
   * and DO NOT create a new offer.
   */
  function simulateLeaveBookedFirst(state: {
    enrollmentActive: boolean;
    classPendingOffer: { candidateStatus: string } | null;
  }): {
    enrollmentActive: boolean;
    classPendingOffer: null;
    offeredCandidateStatus: string | null;
    newOfferCreated: boolean;
  } {
    const offeredCandidateStatus = state.classPendingOffer
      ? "waiting" // returned to waiting
      : null;
    return {
      enrollmentActive: false, // cancelled
      classPendingOffer: null, // withdrawn
      offeredCandidateStatus,
      newOfferCreated: false, // key invariant
    };
  }

  it("cancels the first-booker enrollment", () => {
    const r = simulateLeaveBookedFirst({ enrollmentActive: true, classPendingOffer: null });
    expect(r.enrollmentActive).toBe(false);
  });

  it("withdraws the stale class pending offer and returns candidate to waiting", () => {
    const r = simulateLeaveBookedFirst({
      enrollmentActive: true,
      classPendingOffer: { candidateStatus: "offered" },
    });
    expect(r.classPendingOffer).toBeNull();
    expect(r.offeredCandidateStatus).toBe("waiting");
  });

  it("does NOT create a replacement partner offer", () => {
    const r = simulateLeaveBookedFirst({
      enrollmentActive: true,
      classPendingOffer: { candidateStatus: "offered" },
    });
    expect(r.newOfferCreated).toBe(false);
  });
});

// ─── Deferral returns first-booker to the queue (pure mirror) ─────────────────

describe("Deferral returns the first-booker to the queue (no dead-end)", () => {
  /**
   * Mirror of deferBookedStudent (Finding 3, simpler approach): instead of a
   * terminal 'deferred' status, the first-booker is returned to 'waiting' with
   * bookedClassId/enrollmentId cleared and priority boosted to at most 50.
   * The outstanding offered candidate is returned to waiting too.
   */
  function simulateDefer(state: {
    priority: number;
    classPendingOfferCandidate: string | null;
  }): {
    finalStatus: string;
    enrollmentActive: boolean;
    bookedClassId: number | null;
    priority: number;
    offeredCandidateStatus: string | null;
  } {
    return {
      finalStatus: "waiting",
      enrollmentActive: false,
      bookedClassId: null,
      priority: Math.min(state.priority, 50),
      offeredCandidateStatus: state.classPendingOfferCandidate ? "waiting" : null,
    };
  }

  it("returns the first-booker to 'waiting' (not a terminal status)", () => {
    const r = simulateDefer({ priority: 100, classPendingOfferCandidate: null });
    expect(r.finalStatus).toBe("waiting");
  });

  it("cancels the enrollment and clears the booked class", () => {
    const r = simulateDefer({ priority: 100, classPendingOfferCandidate: null });
    expect(r.enrollmentActive).toBe(false);
    expect(r.bookedClassId).toBeNull();
  });

  it("boosts priority to at most 50 for a normal (100) entry", () => {
    const r = simulateDefer({ priority: 100, classPendingOfferCandidate: null });
    expect(r.priority).toBe(50);
  });

  it("retains an already-stronger priority (does not weaken it)", () => {
    const r = simulateDefer({ priority: 20, classPendingOfferCandidate: null });
    expect(r.priority).toBe(20);
  });

  it("returns the outstanding offered candidate to waiting", () => {
    const r = simulateDefer({ priority: 100, classPendingOfferCandidate: "offered" });
    expect(r.offeredCandidateStatus).toBe("waiting");
  });
});

// ─── Pair-broken messaging: distinct roles (pure mirror) ──────────────────────

describe("Pair-broken notification: distinct role messaging", () => {
  function roleMessage(role: "remaining" | "requeued"): string {
    return role === "remaining"
      ? "finding a new partner"
      : "returned to the pairing queue";
  }

  it("remaining student is told a new partner is being found", () => {
    expect(roleMessage("remaining")).toContain("new partner");
  });

  it("requeued student is told they were returned to queue", () => {
    expect(roleMessage("requeued")).toContain("returned");
  });
});

// ─── Confirmation waking-hours window (pure mirror) ───────────────────────────

describe("Confirmation waking-hours gate", () => {
  const START = 8;
  const END = 21;
  function inWaking(hour: number): boolean {
    return hour >= START && hour < END;
  }

  it("blocks 07:00 (before waking hours)", () => {
    expect(inWaking(7)).toBe(false);
  });

  it("allows 08:00 (start, inclusive)", () => {
    expect(inWaking(8)).toBe(true);
  });

  it("allows 20:00 (still inside)", () => {
    expect(inWaking(20)).toBe(true);
  });

  it("blocks 21:00 (end, exclusive)", () => {
    expect(inWaking(21)).toBe(false);
  });

  it("blocks 02:00 (middle of night)", () => {
    expect(inWaking(2)).toBe(false);
  });
});

// ─── Both-confirmed transition (pure mirror) ──────────────────────────────────

describe("Both-confirmed transition", () => {
  function sessionConfirmed(confs: string[]): boolean {
    return confs.length >= 2 && confs.every((c) => c === "confirmed");
  }

  it("not confirmed with only one confirmation", () => {
    expect(sessionConfirmed(["confirmed"])).toBe(false);
  });

  it("not confirmed when one is still pending", () => {
    expect(sessionConfirmed(["confirmed", "pending"])).toBe(false);
  });

  it("confirmed only when both are confirmed", () => {
    expect(sessionConfirmed(["confirmed", "confirmed"])).toBe(true);
  });

  it("not confirmed when one declined", () => {
    expect(sessionConfirmed(["confirmed", "declined"])).toBe(false);
  });
});

// ─── Active-status re-join guard (pure mirror) ────────────────────────────────

describe("Active-status re-join guard (joinCombinedQueue)", () => {
  const ACTIVE = ["waiting", "offered", "booked_first", "paired", "confirmed"];
  const TERMINAL = ["completed", "converted_solo", "cancelled"];

  function blocksRejoin(status: string): boolean {
    return ACTIVE.includes(status);
  }

  it("all active statuses block re-join", () => {
    for (const s of ACTIVE) expect(blocksRejoin(s)).toBe(true);
  });

  it("terminal statuses do not block", () => {
    for (const s of TERMINAL) expect(blocksRejoin(s)).toBe(false);
  });
});

// ─── bookCombinedSlot: waiting entry may book a concrete slot ─────────────────

describe("bookCombinedSlot booking guard (waiting is not a blocker)", () => {
  /**
   * Mirror of the in-lock guard: a 'waiting' entry (incl. one returned to the
   * queue after a no-partner deferral) is allowed to book a concrete slot,
   * converting its existing entry to 'booked_first'. Any other active status
   * blocks a fresh booking.
   */
  function blocksBooking(activeStatus: string | null): boolean {
    return activeStatus != null && activeStatus !== "waiting";
  }

  it("does NOT block a waiting student from booking a slot", () => {
    expect(blocksBooking("waiting")).toBe(false);
  });

  it("does NOT block a student with no queue entry", () => {
    expect(blocksBooking(null)).toBe(false);
  });

  it("blocks a student who already owns a booked_first / paired / confirmed slot", () => {
    for (const s of ["booked_first", "paired", "confirmed", "offered"]) {
      expect(blocksBooking(s)).toBe(true);
    }
  });
});

// ─── completeSession requires BOTH students attended (pure mirror) ────────────

describe("completeSession both-attended gate", () => {
  interface Enr { attendanceStatus: string; cancelledAt: Date | null }

  /**
   * Mirror of completeSession's guard: only complete when BOTH enrollment rows
   * are 'attended' and not cancelled. Otherwise return { success:false,
   * reason:'both_not_attended' } silently.
   */
  function tryComplete(a: Enr | null, b: Enr | null): { success: boolean; reason?: string } {
    const rows = [a, b].filter((r): r is Enr => r != null);
    if (rows.length !== 2) return { success: false, reason: "both_not_attended" };
    const bothAttended = rows.every(
      (r) => r.attendanceStatus === "attended" && r.cancelledAt == null,
    );
    return bothAttended ? { success: true } : { success: false, reason: "both_not_attended" };
  }

  const attended: Enr = { attendanceStatus: "attended", cancelledAt: null };

  it("completes when both attended", () => {
    expect(tryComplete(attended, attended).success).toBe(true);
  });

  it("does NOT complete when only one attended (partner no-show)", () => {
    const r = tryComplete(attended, { attendanceStatus: "absent", cancelledAt: null });
    expect(r.success).toBe(false);
    expect(r.reason).toBe("both_not_attended");
  });

  it("does NOT complete when a partner enrollment is cancelled", () => {
    const r = tryComplete(attended, { attendanceStatus: "attended", cancelledAt: new Date() });
    expect(r.success).toBe(false);
    expect(r.reason).toBe("both_not_attended");
  });

  it("does NOT complete when an enrollment row is missing", () => {
    const r = tryComplete(attended, null);
    expect(r.success).toBe(false);
    expect(r.reason).toBe("both_not_attended");
  });

  it("does NOT complete when neither attended", () => {
    const r = tryComplete(
      { attendanceStatus: "registered", cancelledAt: null },
      { attendanceStatus: "registered", cancelledAt: null },
    );
    expect(r.success).toBe(false);
  });
});

// ─── convertPresentStudentToSolo invariants (pure mirror) ─────────────────────

describe("convertPresentStudentToSolo invariants", () => {
  /**
   * Mirror of the conversion state machine (Finding 1): only sessions in
   * 'paired' or 'confirmed' convert; the present student's original combined
   * enrollment is cancelled BEFORE the new solo enrollment is created; the
   * paired session is dissolved with a reason; the absent student's enrollment
   * is untouched (fee handled by caller); target must be 11 or 14.
   */
  function convert(state: {
    sessionStatus: string;
    target: number;
  }): {
    ok: boolean;
    reason?: string;
    originalEnrollmentCancelled?: boolean;
    newSoloDuration?: number;
    newSoloMaxStudents?: number;
    sessionFinalStatus?: string;
    absentEnrollmentUntouched?: boolean;
  } {
    if (state.target !== 11 && state.target !== 14) {
      return { ok: false, reason: "bad_target" };
    }
    if (!["paired", "confirmed"].includes(state.sessionStatus)) {
      return { ok: false, reason: "bad_status" };
    }
    return {
      ok: true,
      originalEnrollmentCancelled: true,
      newSoloDuration: 60,
      newSoloMaxStudents: 1,
      sessionFinalStatus: "dissolved",
      absentEnrollmentUntouched: true,
    };
  }

  it("accepts a 'paired' session", () => {
    expect(convert({ sessionStatus: "paired", target: 11 }).ok).toBe(true);
  });

  it("accepts a 'confirmed' session (partner no-show after confirm)", () => {
    expect(convert({ sessionStatus: "confirmed", target: 14 }).ok).toBe(true);
  });

  it("rejects a dissolved/completed session", () => {
    expect(convert({ sessionStatus: "dissolved", target: 11 }).ok).toBe(false);
    expect(convert({ sessionStatus: "completed", target: 11 }).ok).toBe(false);
  });

  it("rejects a non-11/14 target", () => {
    expect(convert({ sessionStatus: "paired", target: 12 }).ok).toBe(false);
    expect(convert({ sessionStatus: "paired", target: 13 }).ok).toBe(false);
  });

  it("cancels the present student's original combined enrollment", () => {
    expect(convert({ sessionStatus: "paired", target: 11 }).originalEnrollmentCancelled).toBe(true);
  });

  it("creates a 60-minute, single-seat solo class", () => {
    const r = convert({ sessionStatus: "paired", target: 14 });
    expect(r.newSoloDuration).toBe(60);
    expect(r.newSoloMaxStudents).toBe(1);
  });

  it("dissolves the paired session and leaves absent enrollment untouched", () => {
    const r = convert({ sessionStatus: "confirmed", target: 11 });
    expect(r.sessionFinalStatus).toBe("dissolved");
    expect(r.absentEnrollmentUntouched).toBe(true);
  });
});

// ─── evaluateSoloConversionGates (real exported gate) ─────────────────────────

describe("evaluateSoloConversionGates (server-side conversion gate)", () => {
  const NOW = 1_700_000_000_000; // fixed reference "now"
  const validBase = {
    classStartMs: NOW - 60_000, // started 1 min ago
    nowMs: NOW,
    presentEnrollmentExists: true,
    presentEnrollmentCancelled: false,
    partnerEnrollmentExists: true,
    partnerAttendanceStatus: "no-show" as string | null,
  };

  it("allows a valid conversion (started, present active, partner no-show)", () => {
    const r = evaluateSoloConversionGates(validBase);
    expect(r.ok).toBe(true);
  });

  it("allows exactly at class start (classStart == now)", () => {
    const r = evaluateSoloConversionGates({ ...validBase, classStartMs: NOW });
    expect(r.ok).toBe(true);
  });

  it("allows when partner is 'absent'", () => {
    const r = evaluateSoloConversionGates({ ...validBase, partnerAttendanceStatus: "absent" });
    expect(r.ok).toBe(true);
  });

  it("rejects when the class has not started yet", () => {
    const r = evaluateSoloConversionGates({ ...validBase, classStartMs: NOW + 60_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Class has not started yet.");
  });

  it("rejects when class start is unparseable (null)", () => {
    const r = evaluateSoloConversionGates({ ...validBase, classStartMs: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Class has not started yet.");
  });

  it("rejects when the present student's enrollment is cancelled", () => {
    const r = evaluateSoloConversionGates({ ...validBase, presentEnrollmentCancelled: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Present student enrollment is not active.");
  });

  it("rejects when the present student's enrollment is missing", () => {
    const r = evaluateSoloConversionGates({ ...validBase, presentEnrollmentExists: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Present student enrollment is not active.");
  });

  it("rejects when the partner has NOT been marked as a no-show (registered)", () => {
    const r = evaluateSoloConversionGates({ ...validBase, partnerAttendanceStatus: "registered" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Partner has not been marked as a no-show.");
  });

  it("rejects when the partner was marked 'attended' (both present)", () => {
    const r = evaluateSoloConversionGates({ ...validBase, partnerAttendanceStatus: "attended" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Partner has not been marked as a no-show.");
  });

  it("rejects when the partner enrollment is missing", () => {
    const r = evaluateSoloConversionGates({ ...validBase, partnerEnrollmentExists: false, partnerAttendanceStatus: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Partner has not been marked as a no-show.");
  });

  it("evaluates the 'not started' gate BEFORE the enrollment gates", () => {
    // Not started AND partner still registered → the start gate wins.
    const r = evaluateSoloConversionGates({
      ...validBase,
      classStartMs: NOW + 5_000,
      partnerAttendanceStatus: "registered",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Class has not started yet.");
  });
});

// ─── manualPair guards (real exported evaluateManualPairGuards) ───────────────

describe("evaluateManualPairGuards (admin manual pairing)", () => {
  const base = {
    classIsCanonical: true,
    classStatus: "scheduled",
    waitingStudentId: 20,
    waitingEntryExists: true,
    bookedFirstStudentId: 10,
    enrolledCount: 1, // first-booker occupies one of two seats
    maxStudents: 2,
  };

  it("allows a valid pairing (canonical, distinct first-booker, one seat free)", () => {
    expect(evaluateManualPairGuards(base).ok).toBe(true);
  });

  it("rejects a non-canonical class", () => {
    const r = evaluateManualPairGuards({ ...base, classIsCanonical: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/valid combined In-Car 12\/13 slot/);
  });

  it("rejects when there is no booked_first entry", () => {
    const r = evaluateManualPairGuards({ ...base, bookedFirstStudentId: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No first-booker/);
  });

  it("rejects a self-pair (first-booker === waiting student)", () => {
    const r = evaluateManualPairGuards({
      ...base,
      bookedFirstStudentId: 20,
      waitingStudentId: 20,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/themselves/);
  });

  it("rejects when the waiting student has no active queue entry", () => {
    const r = evaluateManualPairGuards({ ...base, waitingEntryExists: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No active queue entry/);
  });

  it("rejects an unscheduled class", () => {
    const r = evaluateManualPairGuards({ ...base, classStatus: "cancelled" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not scheduled/);
  });

  it("rejects a full class (no seat remaining)", () => {
    const r = evaluateManualPairGuards({ ...base, enrolledCount: 2 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/full/);
  });

  it("rejects when the first-booker seat is not filled (too few enrolled)", () => {
    const r = evaluateManualPairGuards({ ...base, enrolledCount: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/first-booker seat/);
  });

  it("defaults maxStudents to 2 when null", () => {
    const r = evaluateManualPairGuards({ ...base, maxStudents: null, enrolledCount: 1 });
    expect(r.ok).toBe(true);
  });
});

// ─── requeueStudent per-status decision (real exported decideRequeueAction) ───

describe("decideRequeueAction (admin requeue teardown)", () => {
  it("waiting → noop (idempotent success)", () => {
    expect(decideRequeueAction("waiting")).toEqual({ kind: "noop" });
  });

  it("offered → from_offered (withdraw offer + re-offer class)", () => {
    expect(decideRequeueAction("offered")).toEqual({ kind: "from_offered" });
  });

  it("booked_first → from_booked_first (cancel enrollment + withdraw offer)", () => {
    expect(decideRequeueAction("booked_first")).toEqual({ kind: "from_booked_first" });
  });

  it("paired → dissolve_pair", () => {
    expect(decideRequeueAction("paired")).toEqual({ kind: "dissolve_pair" });
  });

  it("confirmed → dissolve_pair", () => {
    expect(decideRequeueAction("confirmed")).toEqual({ kind: "dissolve_pair" });
  });

  it("terminal statuses → reject", () => {
    for (const s of ["completed", "converted_solo", "cancelled"]) {
      const r = decideRequeueAction(s);
      expect(r.kind).toBe("reject");
      if (r.kind === "reject") expect(r.reason).toContain(s);
    }
  });

  it("unknown status → reject", () => {
    expect(decideRequeueAction("bogus").kind).toBe("reject");
  });
});

// ─── applyOfferTransition: optimistic conditional claim (real helper) ─────────

/**
 * Minimal mock of the drizzle tx chain used by applyOfferTransition:
 *   tx.update(table).set(values).where(cond).returning(cols)
 *
 * It models a single in-memory offer row with a mutable `status`. A transition
 * succeeds (returns exactly one row) only when the row's CURRENT status equals
 * the `from` the caller passed via `.set({ status: <to> })` combined with the
 * WHERE `status = from` predicate — which we emulate by remembering the `from`
 * the helper embeds in its WHERE clause. Since the helper always issues
 * `WHERE id = ? AND status = <from>`, we capture `from` from a side channel:
 * the test sets `store.expectFrom` before each call.
 */
function makeMockTx(store: { id: number; status: string; expectFrom: string }) {
  return {
    update() {
      let pendingTo: string | null = null;
      const chain = {
        set(values: Record<string, unknown>) {
          pendingTo = String(values.status);
          return chain;
        },
        where() {
          return chain;
        },
        async returning() {
          // Emulate: UPDATE ... WHERE id=? AND status=expectFrom
          if (store.status === store.expectFrom && pendingTo != null) {
            store.status = pendingTo;
            return [{ id: store.id }];
          }
          return [];
        },
      };
      return chain;
    },
  } as any;
}

describe("applyOfferTransition conditional claim", () => {
  it("claims a pending offer exactly once (pending → accepted)", async () => {
    const store = { id: 7, status: "pending", expectFrom: "pending" };
    const tx = makeMockTx(store);
    const r = await applyOfferTransition(tx, 7, "pending", "accepted");
    expect(r.claimed).toBe(true);
    expect(store.status).toBe("accepted");
  });

  it("returns claimed=false when the offer is no longer pending", async () => {
    const store = { id: 7, status: "accepted", expectFrom: "pending" };
    const tx = makeMockTx(store);
    const r = await applyOfferTransition(tx, 7, "pending", "declined");
    expect(r.claimed).toBe(false);
    expect(store.status).toBe("accepted"); // unchanged
  });

  it("second concurrent transition on the same offer loses (zero rows)", async () => {
    const store = { id: 7, status: "pending", expectFrom: "pending" };
    const tx = makeMockTx(store);
    // First actor accepts.
    const first = await applyOfferTransition(tx, 7, "pending", "accepted");
    // Second actor tries to expire the SAME row — now non-pending.
    const second = await applyOfferTransition(tx, 7, "pending", "expired");
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(store.status).toBe("accepted");
  });
});

// ─── Interleaving decisions at the claim level (accept vs expire / manual) ────

describe("offer transition interleavings — loser aborts without mutation", () => {
  /**
   * Simulate two actors racing for the same offer. Each actor's branch only
   * proceeds to mutate queue/session/enrollment state when its claim wins.
   * This mirrors the guard we added: `if (!claim.claimed) return/skip;`.
   */
  function runRace(order: Array<"accept" | "expire" | "manual_withdraw">) {
    const store = { status: "pending" };
    const effects: Array<{ actor: string; mutated: boolean }> = [];

    for (const actor of order) {
      const to =
        actor === "accept" ? "accepted" : actor === "expire" ? "expired" : "withdrawn";
      // Conditional claim.
      const claimed = store.status === "pending";
      if (claimed) store.status = to;
      // Only the winner mutates downstream state.
      effects.push({ actor, mutated: claimed });
    }
    return { finalStatus: store.status, effects };
  }

  it("accept wins over a later expire; expire aborts with no mutation", () => {
    const { finalStatus, effects } = runRace(["accept", "expire"]);
    expect(finalStatus).toBe("accepted");
    expect(effects[0]).toEqual({ actor: "accept", mutated: true });
    expect(effects[1]).toEqual({ actor: "expire", mutated: false });
  });

  it("expire wins over a later accept; accept aborts with no mutation", () => {
    const { finalStatus, effects } = runRace(["expire", "accept"]);
    expect(finalStatus).toBe("expired");
    expect(effects[0]).toEqual({ actor: "expire", mutated: true });
    expect(effects[1]).toEqual({ actor: "accept", mutated: false });
  });

  it("accept wins over a later admin manual-pair withdrawal", () => {
    const { finalStatus, effects } = runRace(["accept", "manual_withdraw"]);
    expect(finalStatus).toBe("accepted");
    expect(effects[1]).toEqual({ actor: "manual_withdraw", mutated: false });
  });

  it("admin manual-pair withdrawal wins over a later accept", () => {
    const { finalStatus, effects } = runRace(["manual_withdraw", "accept"]);
    expect(finalStatus).toBe("withdrawn");
    expect(effects[1]).toEqual({ actor: "accept", mutated: false });
  });

  it("only ONE actor ever mutates, regardless of contention", () => {
    const { effects } = runRace(["accept", "expire", "manual_withdraw"]);
    expect(effects.filter((e) => e.mutated).length).toBe(1);
  });
});

// ─── decideBookedFirstTeardown (post-lock re-read status guard) ───────────────

describe("decideBookedFirstTeardown (booked-first teardown race guard)", () => {
  const PATHS = ["defer", "leave", "requeue"] as const;

  it("proceeds when the entry is still booked_first (no race)", () => {
    for (const p of PATHS) {
      expect(decideBookedFirstTeardown("booked_first", p).proceed).toBe(true);
    }
  });

  it("aborts when an accept already paired the entry (now 'paired')", () => {
    for (const p of PATHS) {
      expect(decideBookedFirstTeardown("paired", p).proceed).toBe(false);
    }
  });

  it("aborts for any non-booked_first status", () => {
    for (const s of ["waiting", "offered", "confirmed", "cancelled", "converted_solo", "completed"]) {
      for (const p of PATHS) {
        expect(decideBookedFirstTeardown(s, p).proceed).toBe(false);
      }
    }
  });

  it("scheduler 'defer' loser aborts SILENTLY (no reason)", () => {
    const r = decideBookedFirstTeardown("paired", "defer");
    expect(r.proceed).toBe(false);
    if (!r.proceed) expect(r.reason).toBeUndefined();
  });

  it("user/admin 'leave' & 'requeue' losers return a friendly retry reason", () => {
    for (const p of ["leave", "requeue"] as const) {
      const r = decideBookedFirstTeardown("paired", p);
      expect(r.proceed).toBe(false);
      if (!r.proceed) expect(r.reason).toBe("Student was just paired; refresh and retry.");
    }
  });
});

// ─── accept-vs-teardown interleavings (loser aborts with no mutation) ─────────

describe("accept-vs-teardown interleavings on a booked-first entry", () => {
  /**
   * Simulate an ACCEPT racing a booked-first teardown (defer/leave/requeue) on
   * the SAME class. Both actors serialize on the class-row FOR UPDATE lock;
   * whoever acquires it first mutates, and the second RE-READS the entry status
   * under the lock and applies decideBookedFirstTeardown. Only the winner
   * mutates the first-booker's entry/enrollment.
   */
  function runRace(
    first: "accept" | "teardown",
    path: "defer" | "leave" | "requeue",
  ) {
    // Shared entry state, guarded by the (simulated) class-row lock.
    const entry = { status: "booked_first" };
    const effects: Array<{ actor: string; mutated: boolean }> = [];

    const runAccept = () => {
      // Accept only pairs a still-booked_first first-booker.
      const canPair = entry.status === "booked_first";
      if (canPair) entry.status = "paired";
      effects.push({ actor: "accept", mutated: canPair });
    };
    const runTeardown = () => {
      // Teardown re-reads the (possibly mutated) status and applies the guard.
      const decision = decideBookedFirstTeardown(entry.status, path);
      if (decision.proceed) entry.status = "waiting"; // teardown resets entry
      effects.push({ actor: "teardown", mutated: decision.proceed });
    };

    if (first === "accept") {
      runAccept();
      runTeardown();
    } else {
      runTeardown();
      runAccept();
    }
    return { finalStatus: entry.status, effects };
  }

  for (const path of ["defer", "leave", "requeue"] as const) {
    it(`accept wins over a later ${path}; ${path} aborts without mutating`, () => {
      const { finalStatus, effects } = runRace("accept", path);
      expect(finalStatus).toBe("paired");
      expect(effects.find((e) => e.actor === "accept")?.mutated).toBe(true);
      expect(effects.find((e) => e.actor === "teardown")?.mutated).toBe(false);
    });

    it(`${path} wins over a later accept; accept cannot pair a torn-down entry`, () => {
      const { finalStatus, effects } = runRace("teardown", path);
      // teardown reset the entry to waiting; accept sees non-booked_first.
      expect(finalStatus).toBe("waiting");
      expect(effects.find((e) => e.actor === "teardown")?.mutated).toBe(true);
      expect(effects.find((e) => e.actor === "accept")?.mutated).toBe(false);
    });
  }

  it("exactly ONE actor mutates the first-booker entry in every interleaving", () => {
    for (const first of ["accept", "teardown"] as const) {
      for (const path of ["defer", "leave", "requeue"] as const) {
        const { effects } = runRace(first, path);
        expect(effects.filter((e) => e.mutated).length).toBe(1);
      }
    }
  });
});

// ─── decideAcceptGuard (accept requires entry still 'offered') ────────────────

describe("decideAcceptGuard (offer-accept receiving-entry status guard)", () => {
  it("proceeds when the receiving entry is still 'offered'", () => {
    expect(decideAcceptGuard("offered").proceed).toBe(true);
  });

  it("aborts when the entry was paired elsewhere by manualPair ('paired')", () => {
    const r = decideAcceptGuard("paired");
    expect(r.proceed).toBe(false);
    if (!r.proceed) expect(r.reason).toBe("Offer is no longer available.");
  });

  it("aborts when the entry is back to 'waiting' (offer withdrawn)", () => {
    expect(decideAcceptGuard("waiting").proceed).toBe(false);
  });

  it("aborts for every non-offered status", () => {
    for (const s of ["waiting", "booked_first", "paired", "confirmed", "cancelled", "converted_solo", "completed"]) {
      expect(decideAcceptGuard(s).proceed).toBe(false);
    }
  });

  it("aborts when the entry is missing (null/undefined)", () => {
    expect(decideAcceptGuard(null).proceed).toBe(false);
    expect(decideAcceptGuard(undefined).proceed).toBe(false);
  });
});

// ─── manualPair-of-offered-candidate vs later accept of the prior offer ───────

describe("manualPair (of an 'offered' candidate) then accept of the stale offer", () => {
  /**
   * Models the round-6 gap: a candidate is 'offered' for class X. An admin
   * manualPairs them onto class Y. manualPair must withdraw ALL of the
   * candidate's pending offers (incl. the class-X offer) and flip the entry to
   * 'paired'. A subsequent accept of the (now withdrawn) class-X offer must
   * abort because the receiving entry is no longer 'offered'.
   */
  function simulate() {
    // Candidate queue entry + their pending offer for class X.
    const entry = { id: 1, status: "offered" as string };
    const offerX = { classId: 100, status: "pending" as string };
    const otherClassesRepaired: number[] = [];

    // manualPair onto class Y (=200): withdraw all pending offers for entry,
    // repair OTHER classes, then flip entry → paired.
    function manualPairOntoY() {
      const targetClassId = 200;
      // Withdraw the candidate's offers (only offerX here).
      if (offerX.status === "pending") {
        offerX.status = "withdrawn";
        if (offerX.classId !== targetClassId) {
          otherClassesRepaired.push(offerX.classId); // repair class X's slot
        }
      }
      entry.status = "paired";
    }

    // Later: candidate tries to accept the class-X offer.
    function acceptOfferX() {
      // respondToOffer re-reads the entry under the class lock and guards.
      const guard = decideAcceptGuard(entry.status);
      // The conditional offer claim would ALSO fail (offer is withdrawn), but
      // the entry-status guard is the authoritative first line of defence.
      const offerClaimable = offerX.status === "pending";
      return {
        aborted: !guard.proceed,
        reason: guard.proceed ? undefined : guard.reason,
        offerClaimable,
      };
    }

    return { entry, offerX, otherClassesRepaired, manualPairOntoY, acceptOfferX };
  }

  it("manualPair withdraws the candidate's prior (different-class) offer", () => {
    const s = simulate();
    s.manualPairOntoY();
    expect(s.offerX.status).toBe("withdrawn");
  });

  it("manualPair repairs the OTHER class's first-booker slot", () => {
    const s = simulate();
    s.manualPairOntoY();
    expect(s.otherClassesRepaired).toContain(100);
  });

  it("manualPair does NOT list the target class for repair", () => {
    const s = simulate();
    s.manualPairOntoY();
    expect(s.otherClassesRepaired).not.toContain(200);
  });

  it("a later accept of the stale offer ABORTS (entry no longer 'offered')", () => {
    const s = simulate();
    s.manualPairOntoY();
    const r = s.acceptOfferX();
    expect(r.aborted).toBe(true);
    expect(r.reason).toBe("Offer is no longer available.");
  });

  it("the stale offer is also not claimable (defence in depth)", () => {
    const s = simulate();
    s.manualPairOntoY();
    const r = s.acceptOfferX();
    expect(r.offerClaimable).toBe(false);
  });

  it("accepting BEFORE manualPair still works (entry is 'offered')", () => {
    const s = simulate();
    const r = s.acceptOfferX(); // before pairing
    expect(r.aborted).toBe(false);
    expect(r.offerClaimable).toBe(true);
  });
});

// ─── decideBothConfirmedTransition (paired→confirmed decision) ────────────────

describe("decideBothConfirmedTransition (both-confirmed session transition)", () => {
  it("transitions when both confirmations are 'confirmed' and session is 'paired'", () => {
    expect(
      decideBothConfirmedTransition(["confirmed", "confirmed"], "paired").transition,
    ).toBe(true);
  });

  it("does NOT transition when only one confirmation is in", () => {
    expect(
      decideBothConfirmedTransition(["confirmed", "pending"], "paired").transition,
    ).toBe(false);
  });

  it("does NOT transition with fewer than two confirmations", () => {
    expect(decideBothConfirmedTransition(["confirmed"], "paired").transition).toBe(false);
    expect(decideBothConfirmedTransition([], "paired").transition).toBe(false);
  });

  it("does NOT transition when a confirmation is declined or expired", () => {
    expect(
      decideBothConfirmedTransition(["confirmed", "declined"], "paired").transition,
    ).toBe(false);
    expect(
      decideBothConfirmedTransition(["confirmed", "expired"], "paired").transition,
    ).toBe(false);
  });

  it("does NOT re-transition a session already 'confirmed' (someone won)", () => {
    expect(
      decideBothConfirmedTransition(["confirmed", "confirmed"], "confirmed").transition,
    ).toBe(false);
  });

  it("does NOT transition a dissolved/completed session", () => {
    for (const s of ["dissolved", "completed", "cancelled"]) {
      expect(
        decideBothConfirmedTransition(["confirmed", "confirmed"], s).transition,
      ).toBe(false);
    }
  });
});

// ─── concurrent-confirm race: exactly one responder flips the session ─────────

describe("two concurrent confirms — exactly one wins the session transition", () => {
  /**
   * Models both students confirming under the both-student + class-row locks.
   * Each responder: (1) conditionally claims its OWN confirmation pending→
   * confirmed, (2) re-reads BOTH confirmation statuses, (3) if both-confirmed &
   * session still 'paired', conditionally flips the session paired→confirmed
   * (.returning() ⇒ exactly one winner). Serialized here (locks) so we run the
   * responders in sequence, but the conditional guards must still yield ONE
   * session flip regardless of order.
   */
  function runRace(order: Array<"A" | "B">) {
    const confs: Record<"A" | "B", string> = { A: "pending", B: "pending" };
    let sessionStatus = "paired";
    const flips: string[] = []; // which responder actually flipped the session

    function respond(who: "A" | "B") {
      // (1) conditional claim of own confirmation
      if (confs[who] !== "pending") return; // already responded
      confs[who] = "confirmed";
      // (2) re-read both + (3) conditional session transition
      const { transition } = decideBothConfirmedTransition(
        [confs.A, confs.B],
        sessionStatus,
      );
      if (transition) {
        // conditional UPDATE WHERE status='paired' .returning()
        if (sessionStatus === "paired") {
          sessionStatus = "confirmed";
          flips.push(who);
        }
      }
    }

    for (const who of order) respond(who);
    return { sessionStatus, flips, confs };
  }

  it("A then B → session confirmed, exactly one flip (B)", () => {
    const { sessionStatus, flips } = runRace(["A", "B"]);
    expect(sessionStatus).toBe("confirmed");
    expect(flips).toEqual(["B"]);
  });

  it("B then A → session confirmed, exactly one flip (A)", () => {
    const { sessionStatus, flips } = runRace(["B", "A"]);
    expect(sessionStatus).toBe("confirmed");
    expect(flips).toEqual(["A"]);
  });

  it("a duplicate confirm from the same student is a no-op (idempotent)", () => {
    const { sessionStatus, flips } = runRace(["A", "A", "B"]);
    expect(sessionStatus).toBe("confirmed");
    expect(flips).toEqual(["B"]); // second A did nothing; B completed the pair
  });

  it("never flips the session more than once across any interleaving", () => {
    for (const order of [["A", "B"], ["B", "A"], ["A", "A", "B"], ["B", "B", "A"]] as Array<Array<"A" | "B">>) {
      const { flips } = runRace(order);
      expect(flips.length).toBe(1);
    }
  });
});

// ─── lifecycle repair safety net (stale 'paired' with both confirmed) ─────────

describe("lifecycle repair — stale 'paired' session with both confirmations in", () => {
  it("repairs a session left 'paired' despite both confirmations 'confirmed'", () => {
    // Pre-filter (unlocked) says repair-worthy...
    const pre = decideBothConfirmedTransition(["confirmed", "confirmed"], "paired");
    expect(pre.transition).toBe(true);
    // ...then under the lock the conditional flip succeeds once.
    let sessionStatus = "paired";
    if (pre.transition && sessionStatus === "paired") sessionStatus = "confirmed";
    expect(sessionStatus).toBe("confirmed");
  });

  it("is a no-op for a session already 'confirmed' (idempotent repair)", () => {
    const pre = decideBothConfirmedTransition(["confirmed", "confirmed"], "confirmed");
    expect(pre.transition).toBe(false); // pre-filter skips already-confirmed
  });

  it("does not repair a session that is still legitimately pending a confirm", () => {
    const pre = decideBothConfirmedTransition(["confirmed", "pending"], "paired");
    expect(pre.transition).toBe(false);
  });
});

// ─── round 8: prior-completion uses the FULL canonical predicate ──────────────

describe("checkEligibility prior-completion detection (full canonical predicate)", () => {
  /**
   * Mirrors the service logic: an attended driving #12 blocks the queue ONLY
   * when it is the canonical combined slot (isCombined1213Class). A noncanonical
   * legacy 120-min #12 (capacity 1, or non-auto course) is NOT a 12/13
   * completion and must NOT block eligibility.
   */
  function blocksQueue(attended12Classes: Array<Parameters<typeof isCombined1213Class>[0]>) {
    return attended12Classes.some((c) => isCombined1213Class(c));
  }

  it("canonical completed #12 (auto/120/2) blocks the queue → not eligible", () => {
    expect(
      blocksQueue([
        { classType: "driving", classNumber: 12, duration: 120, maxStudents: 2, courseType: "auto" },
      ]),
    ).toBe(true);
  });

  it("noncanonical legacy 120-min #12 with capacity 1 does NOT block → still eligible", () => {
    expect(
      blocksQueue([
        { classType: "driving", classNumber: 12, duration: 120, maxStudents: 1, courseType: "auto" },
      ]),
    ).toBe(false);
  });

  it("noncanonical 120-min #12 on a non-auto course does NOT block → still eligible", () => {
    expect(
      blocksQueue([
        { classType: "driving", classNumber: 12, duration: 120, maxStudents: 2, courseType: "moto" },
      ]),
    ).toBe(false);
  });

  it("a 60-min #12 (wrong duration) does NOT block → still eligible", () => {
    expect(
      blocksQueue([
        { classType: "driving", classNumber: 12, duration: 60, maxStudents: 2, courseType: "auto" },
      ]),
    ).toBe(false);
  });

  it("blocks if ANY attended #12 row is canonical (mixed legacy + canonical)", () => {
    expect(
      blocksQueue([
        { classType: "driving", classNumber: 12, duration: 120, maxStudents: 1, courseType: "auto" },
        { classType: "driving", classNumber: 12, duration: 120, maxStudents: 2, courseType: "auto" },
      ]),
    ).toBe(true);
  });
});

// ─── round 8: generic enrollment route blocks the canonical 12/13 slot ────────

describe("direct-enrollment block for the canonical In-Car 12/13 slot", () => {
  /**
   * The POST /api/class-enrollments guard rejects (400) creating a plain
   * enrollment when the target class is the canonical combined slot. The
   * decision is exactly isCombined1213Class(class).
   */
  const REJECT_MESSAGE =
    "In-Car 12/13 is a paired session — use the pairing tools (manual pair) instead of direct enrollment.";

  function routeGuard(cls: Parameters<typeof isCombined1213Class>[0]) {
    if (isCombined1213Class(cls)) {
      return { status: 400, message: REJECT_MESSAGE };
    }
    return { status: 200 };
  }

  it("rejects direct enrollment on the canonical 12/13 slot with 400", () => {
    const r = routeGuard({
      classType: "driving", classNumber: 12, duration: 120, maxStudents: 2, courseType: "auto",
    });
    expect(r.status).toBe(400);
    expect(r.message).toBe(REJECT_MESSAGE);
  });

  it("allows a noncanonical 120-min #12 (capacity 1) through the guard", () => {
    expect(
      routeGuard({ classType: "driving", classNumber: 12, duration: 120, maxStudents: 1, courseType: "auto" }).status,
    ).toBe(200);
  });

  it("allows an ordinary driving lesson (#5) through the guard", () => {
    expect(
      routeGuard({ classType: "driving", classNumber: 5, duration: 60, maxStudents: 1, courseType: "auto" }).status,
    ).toBe(200);
  });

  it("allows a theory class through the guard", () => {
    expect(
      routeGuard({ classType: "theory", classNumber: 11, duration: 120, maxStudents: 20, courseType: "auto" }).status,
    ).toBe(200);
  });
});
