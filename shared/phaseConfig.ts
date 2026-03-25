export interface PhaseClassItem {
  id: string;
  label: string;
  classType: 'theory' | 'driving';
  classNumber: number;
  specialNote?: string;
  mustBeFirst?: boolean;
  mustBeLast?: boolean;
  maxDurationMinutes?: number;
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

export interface PhaseProgressData {
  currentPhase: number;
  phases: PhaseProgress[];
}
