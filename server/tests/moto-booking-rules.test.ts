import { describe, it, expect } from "vitest";
import {
  validateClassBooking,
  getCourseClassCounts,
  getMotoPracticalDuration,
  mergeScooterTransferCredits,
  type CompletedClassRecord,
  type TargetClassInfo,
} from "@shared/bookingRules";
import { getPhaseDefinitionsForCourse, getExternalMilestonesForCourse, PHASE_DEFINITIONS } from "@shared/phaseConfig";

const attended = (
  classType: "theory" | "driving",
  classNumber: number,
  date = "2026-01-05",
  duration?: number,
): CompletedClassRecord => ({ classType, classNumber, date, duration });

function motoTarget(partial: Partial<TargetClassInfo>): TargetClassInfo {
  return {
    classType: "driving",
    classNumber: 1,
    date: "2026-03-01",
    ...partial,
  } as TargetClassInfo;
}

describe("moto course structure", () => {
  it("has 2 theory classes and 7 practical sessions", () => {
    expect(getCourseClassCounts("moto")).toEqual({ theoryCount: 2, drivingCount: 7 });
  });

  it("assigns correct per-session practical durations (240×4 then 120/240/240)", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(getMotoPracticalDuration)).toEqual([
      240, 240, 240, 240, 120, 240, 240,
    ]);
  });

  it("phase definitions expose the real program with durations", () => {
    const phases = getPhaseDefinitionsForCourse("moto");
    expect(phases).toHaveLength(4);
    const all = phases.flatMap((p) => p.classes);
    expect(all.filter((c) => c.classType === "theory")).toHaveLength(2);
    expect(all.filter((c) => c.classType === "driving")).toHaveLength(7);
    expect(all.find((c) => c.id === "theory_1")?.durationMinutes).toBe(180);
    expect(all.find((c) => c.id === "driving_1")?.durationMinutes).toBe(240);
    expect(all.find((c) => c.id === "driving_5")?.durationMinutes).toBe(120);
  });

  it("exposes the SAAQ external milestones for moto only", () => {
    const ids = getExternalMilestonesForCourse("moto").map((m) => m.id);
    expect(ids).toEqual([
      "saaq_6r_knowledge_test",
      "saaq_closed_track_exam",
      "saaq_11_month_wait",
      "saaq_final_road_exam",
    ]);
    expect(getExternalMilestonesForCourse("auto")).toEqual([]);
    expect(getExternalMilestonesForCourse("scooter")).toEqual([]);
  });
});

describe("moto booking rules", () => {
  it("allows Theory #1 with nothing completed", () => {
    const res = validateClassBooking(
      motoTarget({ classType: "theory", classNumber: 1, duration: 180 }),
      [],
      "moto",
    );
    expect(res.allowed).toBe(true);
  });

  it("blocks Theory #2 until Theory #1 AND all closed-circuit sessions are done", () => {
    const res = validateClassBooking(
      motoTarget({ classType: "theory", classNumber: 2, duration: 180 }),
      [],
      "moto",
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe("moto_theory2_prerequisites");

    // Theory #1 alone is not enough — closed circuit comes first in the program.
    const afterTheory1 = validateClassBooking(
      motoTarget({ classType: "theory", classNumber: 2, duration: 180 }),
      [attended("theory", 1)],
      "moto",
    );
    expect(afterTheory1.allowed).toBe(false);
    expect(afterTheory1.blockingRule).toBe("moto_theory2_prerequisites");

    const afterCircuit = validateClassBooking(
      motoTarget({ classType: "theory", classNumber: 2, duration: 180 }),
      [
        attended("theory", 1),
        attended("driving", 1),
        attended("driving", 2),
        attended("driving", 3),
        attended("driving", 4),
      ],
      "moto",
    );
    expect(afterCircuit.allowed).toBe(true);
  });

  it("rejects legacy classes outside the 2-theory / 7-practical program", () => {
    const theory3 = validateClassBooking(
      motoTarget({ classType: "theory", classNumber: 3, duration: 180 }),
      [attended("theory", 1), attended("theory", 2)],
      "moto",
    );
    expect(theory3.allowed).toBe(false);
    expect(theory3.blockingRule).toBe("moto_class_not_in_program");

    const completedAll = [
      attended("theory", 1),
      attended("theory", 2),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => attended("driving", n)),
    ];
    const driving8 = validateClassBooking(
      motoTarget({ classNumber: 8, duration: 240, saaq6rKnowledgePassed: true }),
      completedAll,
      "moto",
    );
    expect(driving8.allowed).toBe(false);
    expect(driving8.blockingRule).toBe("moto_class_not_in_program");
  });

  it("rejects moto theory classes with wrong or missing duration; accepts 180", () => {
    const wrong = validateClassBooking(
      motoTarget({ classType: "theory", classNumber: 1, duration: 120 }),
      [],
      "moto",
    );
    expect(wrong.allowed).toBe(false);
    expect(wrong.blockingRule).toBe("moto_theory_duration");

    const missing = validateClassBooking(
      motoTarget({ classType: "theory", classNumber: 2, duration: undefined }),
      [attended("theory", 1), ...[1, 2, 3, 4].map((n) => attended("driving", n))],
      "moto",
    );
    expect(missing.allowed).toBe(false);
    expect(missing.blockingRule).toBe("moto_theory_duration");

    const ok = validateClassBooking(
      motoTarget({ classType: "theory", classNumber: 1, duration: 180 }),
      [],
      "moto",
    );
    expect(ok.allowed).toBe(true);
  });

  it("rejects a practical session with a missing duration", () => {
    const res = validateClassBooking(
      motoTarget({ classNumber: 1, duration: undefined, saaq6rKnowledgePassed: true }),
      [attended("theory", 1)],
      "moto",
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe("moto_session_duration");
  });

  it("blocks closed-circuit when only Theory #1 is done (6R missing)", () => {
    const res = validateClassBooking(
      motoTarget({ classNumber: 1, duration: 240 }),
      [attended("theory", 1)],
      "moto",
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe("moto_closed_circuit_prerequisites");
    expect(res.reason).toMatch(/6R/);
  });

  it("blocks closed-circuit when only 6R is recorded (theory missing)", () => {
    const res = validateClassBooking(
      motoTarget({ classNumber: 1, duration: 240, saaq6rKnowledgePassed: true }),
      [],
      "moto",
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe("moto_closed_circuit_prerequisites");
  });

  it("allows closed-circuit once Theory #1 AND 6R are both done — either order", () => {
    const res = validateClassBooking(
      motoTarget({ classNumber: 1, duration: 240, saaq6rKnowledgePassed: true }),
      [attended("theory", 1)],
      "moto",
    );
    expect(res.allowed).toBe(true);
  });

  it("rejects a closed-circuit session with the wrong duration", () => {
    const res = validateClassBooking(
      motoTarget({ classNumber: 2, duration: 120, saaq6rKnowledgePassed: true }),
      [attended("theory", 1), attended("driving", 1)],
      "moto",
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe("moto_session_duration");
  });

  it("blocks road sessions until road-prep Theory #2 is done", () => {
    const completed = [
      attended("theory", 1),
      attended("driving", 1),
      attended("driving", 2),
      attended("driving", 3),
      attended("driving", 4),
    ];
    const res = validateClassBooking(
      motoTarget({ classNumber: 5, duration: 120, saaq6rKnowledgePassed: true }),
      completed,
      "moto",
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe("moto_road_requires_road_theory");
  });

  it("allows road session 1 (120 min) after Theory #2; enforces 240 for sessions 6–7", () => {
    const completed = [
      attended("theory", 1),
      attended("theory", 2),
      attended("driving", 1),
      attended("driving", 2),
      attended("driving", 3),
      attended("driving", 4),
    ];
    expect(
      validateClassBooking(
        motoTarget({ classNumber: 5, duration: 120, saaq6rKnowledgePassed: true }),
        completed,
        "moto",
      ).allowed,
    ).toBe(true);
    const wrong = validateClassBooking(
      motoTarget({ classNumber: 6, duration: 120, saaq6rKnowledgePassed: true }),
      [...completed, attended("driving", 5)],
      "moto",
    );
    expect(wrong.allowed).toBe(false);
    expect(wrong.blockingRule).toBe("moto_session_duration");
  });

  it("keeps sequential progression: session #2 locked until #1 completed or booked", () => {
    const res = validateClassBooking(
      motoTarget({
        classNumber: 2,
        duration: 240,
        saaq6rKnowledgePassed: true,
        upcomingBookings: [],
      }),
      [attended("theory", 1)],
      "moto",
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe("previous_class_incomplete");
  });

  it("blocks Session #3 on a full date but allows it on another day", () => {
    const upcomingBookings = [
      { classType: "driving" as const, classNumber: 1 },
      { classType: "driving" as const, classNumber: 2 },
    ];
    const completed = [attended("theory", 1)];

    const sameDay = validateClassBooking(
      motoTarget({
        classNumber: 3,
        date: "2026-03-02",
        duration: 240,
        saaq6rKnowledgePassed: true,
        sameDayAlreadyBookedCount: 2,
        upcomingBookings,
      }),
      completed,
      "moto",
    );
    expect(sameDay.allowed).toBe(false);
    expect(sameDay.blockingRule).toBe("max_classes_per_day");

    const anotherDay = validateClassBooking(
      motoTarget({
        classNumber: 3,
        date: "2026-03-03",
        duration: 240,
        saaq6rKnowledgePassed: true,
        sameDayAlreadyBookedCount: 0,
        upcomingBookings,
      }),
      completed,
      "moto",
    );
    expect(anotherDay).toEqual({ allowed: true });
  });
});

describe("auto and scooter behavior unchanged", () => {
  it("auto: Theory #6 still requires Phase 1 complete", () => {
    const res = validateClassBooking(
      { classType: "theory", classNumber: 6, date: "2026-03-01" },
      [attended("theory", 1)],
      "auto",
    );
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe("phase2_requires_phase1_complete");
  });

  it("auto: counts and phase definitions untouched", () => {
    expect(getCourseClassCounts("auto")).toEqual({ theoryCount: 12, drivingCount: 15 });
    expect(getPhaseDefinitionsForCourse("auto")).toBe(PHASE_DEFINITIONS);
  });

  it("scooter: has exactly one theory and one practical session", () => {
    const blockedPractical = validateClassBooking(
      { classType: "driving", classNumber: 1, date: "2026-03-01", duration: 180 },
      [],
      "scooter",
    );
    expect(blockedPractical.allowed).toBe(false);
    expect(blockedPractical.blockingRule).toBe("theory_required_before_driving");

    const allowedPractical = validateClassBooking(
      { classType: "driving", classNumber: 1, date: "2026-03-01", duration: 180 },
      [attended("theory", 1)],
      "scooter",
    );
    expect(allowedPractical).toEqual({ allowed: true });

    const extraTheory = validateClassBooking(
      { classType: "theory", classNumber: 2, date: "2026-03-01", duration: 180 },
      [attended("theory", 1)],
      "scooter",
    );
    expect(extraTheory.blockingRule).toBe("invalid_course_session");

    const wrongDuration = validateClassBooking(
      { classType: "theory", classNumber: 1, date: "2026-03-01", duration: 120 },
      [],
      "scooter",
    );
    expect(wrongDuration.blockingRule).toBe("scooter_session_duration");
    expect(getCourseClassCounts("scooter")).toEqual({ theoryCount: 1, drivingCount: 1 });

    const phases = getPhaseDefinitionsForCourse("scooter");
    expect(phases).toHaveLength(1);
    expect(phases[0].classes).toEqual([
      expect.objectContaining({ classType: "theory", classNumber: 1, durationMinutes: 180 }),
      expect.objectContaining({ classType: "driving", classNumber: 1, durationMinutes: 180 }),
    ]);
  });

  it("merges only valid scooter transfer credits without duplicating attendance", () => {
    const theoryCredit = mergeScooterTransferCredits([], {
      courseType: "scooter",
      completedTheoryClasses: [1, 2],
      completedInCarSessions: [],
      enrollmentDate: "2026-01-10",
    });
    expect(theoryCredit).toEqual([
      { classType: "theory", classNumber: 1, date: "2026-01-10", duration: 180 },
    ]);

    const bothCredits = mergeScooterTransferCredits(theoryCredit, {
      courseType: "scooter",
      completedTheoryClasses: [1],
      completedInCarSessions: [1, 3],
      enrollmentDate: "2026-01-10",
    });
    expect(bothCredits).toEqual([
      { classType: "theory", classNumber: 1, date: "2026-01-10", duration: 180 },
      { classType: "driving", classNumber: 1, date: "2026-01-10", duration: 180 },
    ]);
  });
});
