export interface PhaseClassItem {
  id: string;
  label: string;
  classType: 'theory' | 'driving';
  classNumber: number;
  specialNote?: string;
  mustBeFirst?: boolean;
  mustBeLast?: boolean;
  maxDurationMinutes?: number;
  /** Fixed session length for this class, when the curriculum dictates one. */
  durationMinutes?: number;
}

/**
 * External (SAAQ-administered) milestone shown as an informational step in a
 * course's progress display. Not bookable through the school.
 */
export interface ExternalMilestone {
  id: string;
  label: string;
  description: string;
  /** Phase number the milestone belongs with in the display. */
  afterPhase: number;
}

export interface PhaseDefinition {
  phase: number;
  label: string;
  minimumDays: number;
  classes: PhaseClassItem[];
  notes: string;
  orderingRule: 'strict' | 'flexible_middle' | 'flexible_after_first' | 'flexible_with_constraints';
}

export const PHASE_DEFINITIONS: PhaseDefinition[] = [
  {
    phase: 1,
    label: "Phase 1",
    minimumDays: 28,
    classes: [
      { id: "theory_1", label: "Theory #1", classType: "theory", classNumber: 1, mustBeFirst: true },
      { id: "theory_2", label: "Theory #2", classType: "theory", classNumber: 2 },
      { id: "theory_3", label: "Theory #3", classType: "theory", classNumber: 3 },
      { id: "theory_4", label: "Theory #4", classType: "theory", classNumber: 4 },
      { id: "theory_5", label: "Theory #5", classType: "theory", classNumber: 5, specialNote: "(test)", mustBeLast: true },
    ],
    notes: "This phase MUST begin with Theory #1. Classes 2-4 can be done in any order however class 1-4 must be completed before completing Theory #5.",
    orderingRule: 'flexible_middle',
  },
  {
    phase: 2,
    label: "Phase 2",
    minimumDays: 28,
    classes: [
      { id: "theory_6", label: "Theory #6", classType: "theory", classNumber: 6, mustBeFirst: true, specialNote: "(Bring an accompanied driver)" },
      { id: "theory_7", label: "Theory #7", classType: "theory", classNumber: 7 },
      { id: "driving_1", label: "In-Car #1", classType: "driving", classNumber: 1 },
      { id: "driving_2", label: "In-Car #2", classType: "driving", classNumber: 2 },
      { id: "driving_3", label: "In-Car #3", classType: "driving", classNumber: 3 },
      { id: "driving_4", label: "In-Car #4", classType: "driving", classNumber: 4 },
    ],
    notes: "The phase MUST begin with Theory #6. This phase MUST be done in the order you see here.",
    orderingRule: 'strict',
  },
  {
    phase: 3,
    label: "Phase 3",
    minimumDays: 56,
    classes: [
      { id: "theory_8", label: "Theory #8", classType: "theory", classNumber: 8, mustBeFirst: true },
      { id: "theory_9", label: "Theory #9", classType: "theory", classNumber: 9 },
      { id: "driving_5", label: "In-Car #5", classType: "driving", classNumber: 5 },
      { id: "driving_6", label: "In-Car #6", classType: "driving", classNumber: 6 },
      { id: "driving_7", label: "In-Car #7", classType: "driving", classNumber: 7 },
      { id: "driving_8", label: "In-Car #8", classType: "driving", classNumber: 8 },
      { id: "theory_10", label: "Theory #10", classType: "theory", classNumber: 10 },
      { id: "driving_9", label: "In-Car #9", classType: "driving", classNumber: 9 },
      { id: "driving_10", label: "In-Car #10", classType: "driving", classNumber: 10 },
    ],
    notes: "This phase MUST begin with Theory #8. Then can be completed in any order. However, the above is the recommended order by Morty's Driving School.",
    orderingRule: 'flexible_after_first',
  },
  {
    phase: 4,
    label: "Phase 4",
    minimumDays: 56,
    classes: [
      { id: "theory_11", label: "Theory #11", classType: "theory", classNumber: 11, mustBeFirst: true },
      { id: "theory_12", label: "Theory #12", classType: "theory", classNumber: 12 },
      { id: "driving_11", label: "In-Car #11", classType: "driving", classNumber: 11 },
      { id: "driving_12", label: "In-Car #12", classType: "driving", classNumber: 12 },
      { id: "driving_13", label: "In-Car #13", classType: "driving", classNumber: 13 },
      { id: "driving_14", label: "In-Car #14", classType: "driving", classNumber: 14 },
      { id: "driving_15", label: "In-Car #15", classType: "driving", classNumber: 15, mustBeLast: true, maxDurationMinutes: 60 },
    ],
    notes: "This phase MUST begin with Theory #11. In-cars 11-14 can be completed before theory #12, however theory #12 must be completed before in-car #15. In-car #15 must be last and 1-single hour. Cannot be combined in a 2-hour.",
    orderingRule: 'flexible_with_constraints',
  },
];

/**
 * Scooter has no inherited multi-phase curriculum: it is exactly one 3-hour
 * theory session followed by one 3-hour practical session.
 */
export const SCOOTER_PHASE_DEFINITIONS: PhaseDefinition[] = [
  {
    phase: 1,
    label: "Scooter Course",
    minimumDays: 0,
    classes: [
      {
        id: "theory_1",
        label: "Scooter Theory",
        classType: "theory",
        classNumber: 1,
        mustBeFirst: true,
        durationMinutes: 180,
        specialNote: "(3 hours)",
      },
      {
        id: "driving_1",
        label: "Scooter Practical",
        classType: "driving",
        classNumber: 1,
        mustBeLast: true,
        durationMinutes: 180,
        specialNote: "(3 hours)",
      },
    ],
    notes: "Complete the 3-hour scooter theory session before the 3-hour practical session.",
    orderingRule: "strict",
  },
];

/**
 * Real Mortys motorcycle program (see the SAAQ course-steps document):
 * Theory 1 (yard prep, 3h) + external 6R knowledge test (either order, both
 * before closed circuit) → 4 closed-circuit sessions (4h each) → Theory 2
 * (road prep, 3h) → 3 road sessions (2h/4h/4h). SAAQ closed-track exam,
 * 11-month wait, and the final road exam are external milestones.
 * Counts must stay in sync with getCourseClassCounts (moto: 2 theory / 7 practical).
 */
export const MOTO_PHASE_DEFINITIONS: PhaseDefinition[] = [
  {
    phase: 1,
    label: "Yard Preparation",
    minimumDays: 0,
    classes: [
      { id: "theory_1", label: "Theory #1 — Yard Preparation", classType: "theory", classNumber: 1, mustBeFirst: true, durationMinutes: 180, specialNote: "(3 hours)" },
    ],
    notes: "One 3-hour theory class preparing you for the closed circuit. The SAAQ 6R knowledge test (self-study) can be done before or after this class, but BOTH must be complete before any closed-circuit session.",
    orderingRule: "strict",
  },
  {
    phase: 2,
    label: "Closed-Circuit Training",
    minimumDays: 0,
    classes: [
      { id: "driving_1", label: "Closed-Circuit Session #1", classType: "driving", classNumber: 1, durationMinutes: 240, specialNote: "(4 hours)" },
      { id: "driving_2", label: "Closed-Circuit Session #2", classType: "driving", classNumber: 2, durationMinutes: 240, specialNote: "(4 hours)" },
      { id: "driving_3", label: "Closed-Circuit Session #3", classType: "driving", classNumber: 3, durationMinutes: 240, specialNote: "(4 hours)" },
      { id: "driving_4", label: "Closed-Circuit Session #4", classType: "driving", classNumber: 4, durationMinutes: 240, specialNote: "(4 hours)" },
    ],
    notes: "Four 4-hour closed-circuit sessions (16 hours total). Unlocked once Theory #1 is completed AND your SAAQ 6R knowledge-test pass is recorded.",
    orderingRule: "strict",
  },
  {
    phase: 3,
    label: "Road Preparation",
    minimumDays: 0,
    classes: [
      { id: "theory_2", label: "Theory #2 — Road Preparation", classType: "theory", classNumber: 2, durationMinutes: 180, specialNote: "(3 hours)" },
    ],
    notes: "One 3-hour theory class preparing you for road training. Must be completed before any road session.",
    orderingRule: "strict",
  },
  {
    phase: 4,
    label: "Road Training",
    minimumDays: 0,
    classes: [
      { id: "driving_5", label: "Road Session #1", classType: "driving", classNumber: 5, durationMinutes: 120, specialNote: "(2 hours)" },
      { id: "driving_6", label: "Road Session #2", classType: "driving", classNumber: 6, durationMinutes: 240, specialNote: "(4 hours)" },
      { id: "driving_7", label: "Road Session #3", classType: "driving", classNumber: 7, durationMinutes: 240, specialNote: "(4 hours)" },
    ],
    notes: "Three road sessions (2h, 4h, 4h — 10 hours total) after the road-preparation theory class.",
    orderingRule: "strict",
  },
];

/** External SAAQ milestones for the moto program (informational only). */
export const MOTO_EXTERNAL_MILESTONES: ExternalMilestone[] = [
  {
    id: "saaq_6r_knowledge_test",
    label: "SAAQ 6R Knowledge Test",
    description: "Self-study knowledge test taken at the SAAQ. Can be done before or after Theory #1, but both must be complete before any closed-circuit session. Ask the office to record your pass.",
    afterPhase: 1,
  },
  {
    id: "saaq_closed_track_exam",
    label: "SAAQ Closed-Track Exam",
    description: "SAAQ-administered closed-track exam taken after closed-circuit training.",
    afterPhase: 2,
  },
  {
    id: "saaq_11_month_wait",
    label: "11-Month Learner Period",
    description: "You must hold your learner's licence for 11 months before the final SAAQ road exam.",
    afterPhase: 4,
  },
  {
    id: "saaq_final_road_exam",
    label: "SAAQ Road Exam",
    description: "Final SAAQ road exam after completing the course and the 11-month learner period.",
    afterPhase: 4,
  },
];

/** External milestones per course (empty for courses without any). */
export function getExternalMilestonesForCourse(courseType: string | null | undefined): ExternalMilestone[] {
  return (courseType || "auto").toLowerCase() === "moto" ? MOTO_EXTERNAL_MILESTONES : [];
}

/** Course-aware phase definitions. Auto uses the full 4-phase curriculum. */
export function getPhaseDefinitionsForCourse(courseType: string | null | undefined): PhaseDefinition[] {
  switch ((courseType || "auto").toLowerCase()) {
    case "moto":
      return MOTO_PHASE_DEFINITIONS;
    case "scooter":
      return SCOOTER_PHASE_DEFINITIONS;
    default:
      return PHASE_DEFINITIONS;
  }
}

export interface PhaseClassProgress {
  id: string;
  label: string;
  classType: 'theory' | 'driving';
  classNumber: number;
  specialNote?: string;
  isCompleted: boolean;
  date?: string;
  time?: string;
  duration?: number;
  instructorName?: string;
  enrollmentId?: number;
  classId?: number;
}

export interface PhaseProgress {
  phase: number;
  label: string;
  minimumDays: number;
  dayCount: number;
  isComplete: boolean;
  isCurrent: boolean;
  isLocked: boolean;
  completedCount: number;
  totalCount: number;
  notes: string;
  classes: PhaseClassProgress[];
}

export interface ExternalMilestoneProgress extends ExternalMilestone {
  /** Recorded as complete (currently only the moto 6R knowledge test can be). */
  isCompleted: boolean;
  /** Date the milestone was recorded (YYYY-MM-DD), when known. */
  date?: string;
}

export interface PhaseProgressData {
  currentPhase: number;
  phases: PhaseProgress[];
  /** External SAAQ milestones (informational; present for moto students). */
  externalMilestones?: ExternalMilestoneProgress[];
}
