import type { PhaseClassProgress, PhaseProgress } from "@shared/phaseConfig";

export interface ClassBookState {
  status: "available" | "completed" | "booked" | "in_review" | "locked" | "blocked" | "none";
  /** Human-readable reason when the class isn't bookable. */
  reason?: string;
}

export interface BookStateClass {
  classType?: string | null;
  classNumber: number;
  status?: string | null;
}

export interface AvailableBookStateClass extends BookStateClass {
  bookingAllowed?: boolean;
  blockingReason?: string;
}

function getClassType(classItem: BookStateClass): "theory" | "driving" {
  if (classItem.classType === "theory" || classItem.classType === "driving") {
    return classItem.classType;
  }
  return classItem.classNumber <= 5 ? "theory" : "driving";
}

/**
 * Translates the server's per-session availability annotations into the state
 * shown beside a curriculum row. Class type is matched explicitly so courses
 * whose theory and practical numbering both start at 1 remain unambiguous.
 */
export function getPhaseClassBookState(
  classItem: PhaseClassProgress,
  phase: PhaseProgress,
  bookedClasses: BookStateClass[],
  availableClasses: AvailableBookStateClass[],
): ClassBookState {
  if (classItem.isCompleted) return { status: "completed" };
  if (classItem.isInReview) return { status: "in_review" };

  const alreadyBooked = bookedClasses.some((bookedClass) =>
    bookedClass.status !== "cancelled" &&
    getClassType(bookedClass) === classItem.classType &&
    bookedClass.classNumber === classItem.classNumber,
  );
  if (alreadyBooked) return { status: "booked", reason: "You already have this class booked." };

  const sessions = availableClasses.filter((availableClass) =>
    getClassType(availableClass) === classItem.classType &&
    availableClass.classNumber === classItem.classNumber,
  );
  const openSessions = sessions.filter((session) => session.bookingAllowed !== false);

  // The availability API runs the authoritative per-class progression rules.
  // Prefer an explicitly allowed session over the phase summary so a stale or
  // broader phase lock cannot keep Phase 3 rows locked after Theory #8.
  if (openSessions.length > 0) {
    return { status: "available" };
  }

  if (phase.isLocked) {
    return { status: "locked", reason: "Complete the previous phase to unlock this class." };
  }

  if (sessions.length === 0) {
    return { status: "none", reason: "No sessions are scheduled for this class yet." };
  }

  const reason = sessions.find((session) => session.blockingReason)?.blockingReason;
  return { status: "blocked", reason: reason || "Booking rules currently block this class." };
}