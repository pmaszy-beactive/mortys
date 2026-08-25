import { describe, expect, it } from "vitest";
import { getPhaseDefinitionsForCourse, type PhaseClassProgress, type PhaseProgress } from "@shared/phaseConfig";
import { getPhaseClassBookState, type AvailableBookStateClass } from "./class-book-state";

const unlockedPhase: PhaseProgress = {
  phase: 1,
  label: "Phase 1",
  minimumDays: 0,
  dayCount: 0,
  isComplete: false,
  isCurrent: true,
  isLocked: false,
  completedCount: 0,
  totalCount: 1,
  notes: "",
  classes: [],
};
const lockedPhase: PhaseProgress = {
  ...unlockedPhase,
  phase: 2,
  label: "Phase 2",
  isCurrent: false,
  isLocked: true,
};

function curriculumRow(courseType: "moto" | "scooter", classType: "theory" | "driving", classNumber: number): PhaseClassProgress {
  const definition = getPhaseDefinitionsForCourse(courseType)
    .flatMap((phase) => phase.classes)
    .find((item) => item.classType === classType && item.classNumber === classNumber);
  if (!definition) throw new Error(`Missing ${courseType} ${classType} #${classNumber} curriculum row`);
  return { ...definition, isCompleted: false };
}

function session(classType: "theory" | "driving", classNumber: number, bookingAllowed: boolean, blockingReason?: string): AvailableBookStateClass {
  return { classType, classNumber, bookingAllowed, blockingReason };
}

describe("per-class Book state for moto and scooter curricula", () => {
  it("shows only scooter theory and practical, with practical locked until theory is complete", () => {
    const theory1 = curriculumRow("scooter", "theory", 1);
    const riding1 = curriculumRow("scooter", "driving", 1);
    const available = [
      session("theory", 1, true),
      session("driving", 1, false, "You must complete the scooter theory session before booking the practical session."),
    ];

    expect(getPhaseClassBookState(theory1, unlockedPhase, [], available).status).toBe("available");
    expect(getPhaseClassBookState(riding1, unlockedPhase, [], available)).toMatchObject({
      status: "blocked",
      reason: "You must complete the scooter theory session before booking the practical session.",
    });

    const afterAllTheory = [session("driving", 1, true)];
    expect(getPhaseClassBookState(riding1, unlockedPhase, [], afterAllTheory)).toEqual({ status: "available" });
  });

  it("matches moto's separate theory and closed-circuit session #1 rows", () => {
    const theory1 = curriculumRow("moto", "theory", 1);
    const circuit1 = curriculumRow("moto", "driving", 1);
    const available = [
      session("theory", 1, true),
      session("driving", 1, false, "Closed-circuit sessions require the yard-preparation theory class AND a recorded SAAQ 6R knowledge-test pass."),
    ];

    expect(getPhaseClassBookState(theory1, unlockedPhase, [], available).status).toBe("available");
    expect(getPhaseClassBookState(circuit1, unlockedPhase, [], available)).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("SAAQ 6R"),
    });
  });

  it("uses an open moto practical session rather than the same-number theory session", () => {
    const circuit1 = curriculumRow("moto", "driving", 1);
    const available = [
      session("theory", 1, false, "Already completed."),
      session("driving", 1, true),
    ];

    expect(getPhaseClassBookState(circuit1, unlockedPhase, [], available)).toEqual({ status: "available" });
  });
});