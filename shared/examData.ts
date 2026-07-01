// Module 5 online exam definitions.
// Answer keys are kept server-authoritative (imported by the grading routes) and are
// safe to share with the client type layer because the client never imports the keys
// for grading — grading always happens on the server.

export const EXAM_PASS_PERCENT = 75;

export type ExamOption = "A" | "B" | "C" | "D";

export interface ExamTestDefinition {
  code: string;
  title: string;
  isRetake: boolean;
  questionCount: number;
  optionsPerQuestion: number;
  // 1-indexed answer key: answerKey[n] = correct option for question n
  answerKey: Record<number, ExamOption>;
}

// First-attempt test.
export const FIRST_ATTEMPT_CODE = "A-240115-133030";
// Retake test.
export const RETAKE_CODE = "A-240115-133143";

const firstAttemptKey: ExamOption[] = [
  "D", "C", "C", "A", "B", "C", "C", "D", "B", "D",
  "A", "D", "C", "B", "B", "C", "B", "B", "A", "B",
  "B", "C", "C", "B",
];

const retakeKey: ExamOption[] = [
  "B", "A", "A", "C", "C", "A", "A", "C", "D", "C",
  "A", "D", "D", "A", "D", "A", "B", "B", "A", "C",
  "C", "A", "B", "B",
];

function toKeyMap(arr: ExamOption[]): Record<number, ExamOption> {
  const map: Record<number, ExamOption> = {};
  arr.forEach((opt, i) => {
    map[i + 1] = opt;
  });
  return map;
}

export const EXAM_TESTS: Record<string, ExamTestDefinition> = {
  [FIRST_ATTEMPT_CODE]: {
    code: FIRST_ATTEMPT_CODE,
    title: "Module 5 Knowledge Test",
    isRetake: false,
    questionCount: firstAttemptKey.length,
    optionsPerQuestion: 4,
    answerKey: toKeyMap(firstAttemptKey),
  },
  [RETAKE_CODE]: {
    code: RETAKE_CODE,
    title: "Module 5 Knowledge Test (Retake)",
    isRetake: true,
    questionCount: retakeKey.length,
    optionsPerQuestion: 4,
    answerKey: toKeyMap(retakeKey),
  },
};

// The test code a student should take given how many attempts they've already made.
export function testCodeForAttempt(attemptNumber: number): string {
  return attemptNumber <= 1 ? FIRST_ATTEMPT_CODE : RETAKE_CODE;
}

// Public per-question image path served from client/public/exam-assets.
export function questionImagePath(testCode: string, questionNumber: number): string {
  return `/exam-assets/${testCode}/q${questionNumber}.png`;
}

export const EXAM_OPTIONS: ExamOption[] = ["A", "B", "C", "D"];
