import type { Express } from "express";
import { createServer, type Server } from "http";
import { randomUUID, timingSafeEqual } from "crypto";
import Stripe from "stripe";
import {
  isS3Configured,
  uploadToS3,
  downloadFromS3,
  deleteFromS3,
  buildDocumentKey,
  isS3Key,
} from "./services/s3";
import { storage } from "./storage";
import { captureRequestError } from "./services/error-logger";
import { checkClassStart, getClassStartTime, formatClassSchedule, getSchoolLocalDate } from "./services/class-time";
import { validateProgressionForStudent, withStudentBookingLock } from "./services/booking-validation";
import { enqueueJob, retryJob, cancelJob as cancelQueueJob, runJobNow, getBillingHoldUntil, isBillingHoldActive, getRegisteredJobTypes, validateEnqueueInput } from "./job-queue";
import {
  getTaxRates, computeInvoiceTotals, createInvoiceWithNumber, getEffectivePackagePrice,
  logPricingChange, ensureBillingCustomer, computeBillingReport, recordInvoicePayment, refundVoidedInvoiceCharge,
} from "./services/billing";
import { jobs as jobsTable, JOB_STATUSES, JOB_CATEGORIES, type JobCategory } from "@shared/schema";
import { desc as descOrder } from "drizzle-orm";
import { db } from "./db";
import { sql, eq, and, not, isNull, isNotNull, ne, count, desc, inArray } from "drizzle-orm";
import {
  lessonRecords,
  students,
  classes,
  classEnrollments,
  evaluations,
  instructorAvailability,
  instructors,
  notificationPreferences,
  notificationDeliveries,
  emailVerificationTokens,
  studentRegistrations,
  studentDocuments,
  paymentAllocations,
  paymentIntakes,
  studentTransactions,
  courseStartDates,
  examAttempts,
  insertCourseStartDateSchema,
  insertBookingPolicySchema,
  policyOverrideLogs,
} from "@shared/schema";
import {
  EXAM_TESTS,
  EXAM_PASS_PERCENT,
  FIRST_ATTEMPT_CODE,
  RETAKE_CODE,
  EXAM_OPTIONS,
  testCodeForAttempt,
  questionImagePath,
} from "@shared/examData";
import { getPhaseDefinitionsForCourse, getExternalMilestonesForCourse } from "@shared/phaseConfig";
import { buildAutoCurriculumPlan, buildMotoCurriculumPlan, buildCandidateDates, scheduleAutoCurriculum, findCurriculumConflicts, getMotoClassRequirements, getCourseClassRequirements, validateCourseClassConfiguration, splitVirtualEnrollment, VIRTUAL_CLASS_MAX_STUDENTS } from "@shared/curriculumPlanner";
import type { PhaseProgressData, PhaseProgress, PhaseClassProgress } from "@shared/phaseConfig";
import { validateClassBooking, buildCompletedClasses, mergeScooterTransferCredits, MAX_CLASSES_PER_DAY, isTheoryClass, getCourseClassCounts, isCombined1213Class, type BookingValidationResult } from "@shared/bookingRules";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { loginUser, isAuthenticatedTraditional } from "./auth";
import { loginInstructor, isInstructorAuthenticated } from "./instructor-auth";
import { loginStudent, isStudentAuthenticated, generateStudentToken } from "./student-auth";
import { loginParent, isParentAuthenticated } from "./parent-auth";
import { initializeDatabase } from "./init-db";
import { LegacyScraper } from "./services/legacy-scraper";
import {
  getManifest as getImportManifest,
  runImport,
  getImportState,
  isImportRunning,
} from "./services/json-importer";
import { loadOrAnalyzeImportGaps } from "./services/import-gap-analysis";
import { getNightlyScrapeLog } from "./services/nightly-scrape-log";
import { checkInstructorAvailability } from "./services/availability";
import { chargeNoShowFee as chargeNoShowFeeImpl } from "./services/no-show-fee";
import { isPortalUserAuthenticated, handleAssistantChat } from "./services/process-assistant";
import * as notificationService from "./services/notifications";
// Task 272: In-Car #12/13 combined-session pairing service.
import {
  bookCombinedSlot,
  joinCombinedQueue,
  leaveCombinedQueue,
  getStudentPairingStatus,
  getAdminPairingOverview,
  getPairingAuditHistory,
  respondToOffer,
  respondToConfirmation,
  manualPair,
  requeueStudent,
  convertPresentStudentToSolo,
  completeSession,
  getActivePairedSessions,
} from "./services/incar-pairing";
import {
  generateInviteToken,
  getInviteExpiry,
  sendInstructorInviteEmail,
  sendPasswordResetEmail,
  sendParentInviteEmail,
  sendPolicyOverrideNotification,
} from "./inviteService";
import { z } from "zod";
import {
  insertStudentSchema,
  insertInstructorSchema,
  insertClassSchema,
  insertContractSchema,
  hasAllClauseInitials,
  insertEvaluationSchema,
  insertNoteSchema,
  insertCommunicationSchema,
  insertClassEnrollmentSchema,
  insertInstructorAvailabilitySchema,
  insertZoomMeetingSchema,
  insertZoomAttendanceSchema,
  insertZoomSettingsSchema,
  insertSchoolPermitSchema,
  insertPermitNumberSchema,
  insertStudentTransactionSchema,
  insertTransferCreditSchema,
  insertLocationSchema,
  insertVehicleSchema,
  insertInstructorReminderSettingsSchema,
} from "@shared/schema";

// Migration state
let scraper: LegacyScraper | null = null;
let migrationInProgress = false;

// Phase definitions for driving school progression
interface PhaseDefinition {
  name: string;
  order: number;
  description: string;
  requiredTheoryClasses: number;
  requiredInCarSessions: number;
  estimatedDays: number;
}

const COURSE_PHASES: Record<string, PhaseDefinition[]> = {
  auto: [
    { name: "Theory Phase", order: 1, description: "Complete all theory classes", requiredTheoryClasses: 5, requiredInCarSessions: 0, estimatedDays: 30 },
    { name: "In-Car Training", order: 2, description: "Complete practical driving sessions", requiredTheoryClasses: 5, requiredInCarSessions: 10, estimatedDays: 60 },
    { name: "Road Test Prep", order: 3, description: "Prepare for your road test", requiredTheoryClasses: 5, requiredInCarSessions: 15, estimatedDays: 30 },
    { name: "Completed", order: 4, description: "Graduation!", requiredTheoryClasses: 5, requiredInCarSessions: 15, estimatedDays: 0 },
  ],
  // Counts must match getCourseClassCounts in shared/bookingRules.ts
  // (moto: Theory 1 yard prep + 4 closed-circuit, then Theory 2 road prep + 3 road sessions)
  moto: [
    { name: "Yard Preparation", order: 1, description: "Yard-prep theory + SAAQ 6R knowledge test", requiredTheoryClasses: 1, requiredInCarSessions: 0, estimatedDays: 14 },
    { name: "Closed-Circuit Training", order: 2, description: "Four 4-hour closed-circuit sessions", requiredTheoryClasses: 1, requiredInCarSessions: 4, estimatedDays: 30 },
    { name: "Road Training", order: 3, description: "Road-prep theory + three road sessions", requiredTheoryClasses: 2, requiredInCarSessions: 7, estimatedDays: 30 },
    { name: "Completed", order: 4, description: "Graduation!", requiredTheoryClasses: 2, requiredInCarSessions: 7, estimatedDays: 0 },
  ],
  scooter: [
    { name: "Scooter Course", order: 1, description: "Complete one 3-hour theory session and one 3-hour practical session", requiredTheoryClasses: 1, requiredInCarSessions: 1, estimatedDays: 1 },
    { name: "Completed", order: 2, description: "Graduation!", requiredTheoryClasses: 1, requiredInCarSessions: 1, estimatedDays: 0 },
  ],
};

interface PhaseProgressSummary {
  currentPhase: PhaseDefinition;
  nextPhase: PhaseDefinition | null;
  daysInPhase: number;
  estimatedDaysLeft: number;
  phaseProgress: number;
  requirements: {
    label: string;
    completed: number;
    required: number;
    isComplete: boolean;
  }[];
  allPhases: (PhaseDefinition & { isComplete: boolean; isCurrent: boolean })[];
}

function calculatePhaseProgress(
  student: any,
  completedTheoryClasses: number,
  completedInCarSessions: number,
  enrollments: any[]
): PhaseProgressSummary {
  const courseType = (student.courseType || 'auto').toLowerCase();
  const phases = COURSE_PHASES[courseType] || COURSE_PHASES.auto;
  
  // Determine current phase based on cumulative requirements.
  // Each phase defines the total classes needed to COMPLETE that phase:
  //   Phase 0 (Theory): 5 theory, 0 in-car → complete when 5 theory done
  //   Phase 1 (In-Car): 5 theory, 10 in-car → complete when 10 in-car done
  //   Phase 2 (Road Test Prep): 5 theory, 15 in-car → complete when 15 in-car done
  //   Phase 3 (Completed): final state
  // A student advances to the next phase once they meet the current phase's requirements.
  
  let currentPhaseIndex = 0;
  
  // Find the highest phase whose requirements are FULLY met
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const theoryMet = completedTheoryClasses >= phase.requiredTheoryClasses;
    const inCarMet = completedInCarSessions >= phase.requiredInCarSessions;
    
    if (theoryMet && inCarMet) {
      currentPhaseIndex = i;
    } else {
      break;
    }
  }
  
  // When the current phase's requirements are fully met, advance to the next phase.
  // This ensures completed phases show as "isComplete" with a green checkmark,
  // and the student is shown working on the next phase (e.g., Theory done → In-Car Training).
  if (currentPhaseIndex < phases.length - 1) {
    const phase = phases[currentPhaseIndex];
    const theoryMet = completedTheoryClasses >= phase.requiredTheoryClasses;
    const inCarMet = completedInCarSessions >= phase.requiredInCarSessions;
    if (theoryMet && inCarMet) {
      currentPhaseIndex = currentPhaseIndex + 1;
    }
  }
  
  const currentPhase = phases[currentPhaseIndex];
  const nextPhase = currentPhaseIndex < phases.length - 1 ? phases[currentPhaseIndex + 1] : null;
  
  // Calculate days in phase using enrollment date as base
  const enrollmentDate = student.enrollmentDate 
    ? new Date(student.enrollmentDate) 
    : (student.createdAt ? new Date(student.createdAt) : new Date());
  
  // Estimate phase start based on cumulative estimated days from previous phases
  let estimatedPhaseStartDays = 0;
  for (let i = 0; i < currentPhaseIndex; i++) {
    estimatedPhaseStartDays += phases[i].estimatedDays;
  }
  
  const phaseStartDate = new Date(enrollmentDate);
  phaseStartDate.setDate(phaseStartDate.getDate() + estimatedPhaseStartDays);
  
  const now = new Date();
  const daysInPhase = Math.max(0, Math.floor((now.getTime() - phaseStartDate.getTime()) / (1000 * 60 * 60 * 24)));
  
  // Calculate phase progress percentage based on current phase requirements
  let phaseProgressPercent = 0;
  
  if (currentPhaseIndex === 0) {
    // First step may be theory-only (Auto/Moto) or the entire compact course
    // (Scooter: one theory + one practical).
    const theoryRequired = currentPhase.requiredTheoryClasses;
    const practicalRequired = currentPhase.requiredInCarSessions;
    const totalRequired = theoryRequired + practicalRequired;
    const totalCompleted =
      Math.min(completedTheoryClasses, theoryRequired) +
      Math.min(completedInCarSessions, practicalRequired);
    phaseProgressPercent = totalRequired > 0 ? Math.min(100, (totalCompleted / totalRequired) * 100) : 100;
  } else if (currentPhaseIndex < phases.length - 1) {
    // Training phases - progress based on in-car sessions for this phase
    const prevPhase = phases[currentPhaseIndex - 1];
    const sessionsNeededForPhase = currentPhase.requiredInCarSessions - prevPhase.requiredInCarSessions;
    const sessionsCompletedInPhase = Math.max(0, completedInCarSessions - prevPhase.requiredInCarSessions);
    phaseProgressPercent = sessionsNeededForPhase > 0 
      ? Math.min(100, (sessionsCompletedInPhase / sessionsNeededForPhase) * 100) 
      : 100;
  } else {
    // Completed phase
    phaseProgressPercent = 100;
  }
  
  // Estimate days remaining based on progress in current phase
  const progressRatio = phaseProgressPercent / 100;
  const estimatedDaysLeft = Math.max(0, Math.round(currentPhase.estimatedDays * (1 - progressRatio)));
  
  // Build requirements list filtered by current phase focus.
  // Only show requirements relevant to the active step:
  //   Theory Phase → theory class count
  //   Training phases → in-car session count for this phase segment
  const requirements: PhaseProgressSummary['requirements'] = [];
  
  if (nextPhase) {
    if (currentPhaseIndex === 0) {
      const theoryRequired = currentPhase.requiredTheoryClasses;
      if (theoryRequired > 0) {
        requirements.push({
          label: "Theory Classes",
          completed: Math.min(completedTheoryClasses, theoryRequired),
          required: theoryRequired,
          isComplete: completedTheoryClasses >= theoryRequired,
        });
      }
      const practicalRequired = currentPhase.requiredInCarSessions;
      if (practicalRequired > 0) {
        requirements.push({
          label: courseType === "scooter" ? "Practical Sessions" : "In-Car Sessions",
          completed: Math.min(completedInCarSessions, practicalRequired),
          required: practicalRequired,
          isComplete: completedInCarSessions >= practicalRequired,
        });
      }
    } else {
      // Training phases: show in-car requirements scoped to this phase segment
      const prevPhase = phases[currentPhaseIndex - 1];
      const sessionsForThisPhase = currentPhase.requiredInCarSessions - prevPhase.requiredInCarSessions;
      const completedInThisPhase = Math.min(
        Math.max(0, completedInCarSessions - prevPhase.requiredInCarSessions),
        sessionsForThisPhase
      );
      requirements.push({
        label: "In-Car Sessions",
        completed: completedInThisPhase,
        required: sessionsForThisPhase,
        isComplete: completedInThisPhase >= sessionsForThisPhase,
      });
      
      // Show theory if still incomplete (edge case: student somehow in training without finishing theory)
      if (completedTheoryClasses < currentPhase.requiredTheoryClasses) {
        requirements.push({
          label: "Theory Classes",
          completed: completedTheoryClasses,
          required: currentPhase.requiredTheoryClasses,
          isComplete: false,
        });
      }
    }
  }
  
  // Build all phases with status
  const allPhases = phases.map((phase, index) => ({
    ...phase,
    isComplete: index < currentPhaseIndex,
    isCurrent: index === currentPhaseIndex,
  }));
  
  return {
    currentPhase,
    nextPhase,
    daysInPhase,
    estimatedDaysLeft,
    phaseProgress: Math.round(phaseProgressPercent),
    requirements,
    allPhases,
  };
}

// Initialize Stripe
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn('Missing STRIPE_SECRET_KEY - payment features will not work');
}


async function buildPhaseProgress(studentId: number): Promise<PhaseProgressData> {
  // Course-aware curriculum: auto, moto, and scooter each use their matching
  // phase definitions and booking-rule structure.
  const studentRow = await storage.getStudent(studentId);
  const phaseDefinitions = getPhaseDefinitionsForCourse(studentRow?.courseType);
  const transferCompletionKeys = new Set(
    mergeScooterTransferCredits([], studentRow).map(
      (record) => `${record.classType}_${record.classNumber}`,
    ),
  );

  const enrollmentRows = await db
    .select({
      enrollmentId: classEnrollments.id,
      classId: classEnrollments.classId,
      attendanceStatus: classEnrollments.attendanceStatus,
      classType: classes.classType,
      classNumber: classes.classNumber,
      date: classes.date,
      time: classes.time,
      duration: classes.duration,
      maxStudents: classes.maxStudents,
      courseType: classes.courseType,
      instructorId: classes.instructorId,
      instructorFirstName: instructors.firstName,
      instructorLastName: instructors.lastName,
    })
    .from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .leftJoin(instructors, eq(classes.instructorId, instructors.id))
    .where(
      and(
        eq(classEnrollments.studentId, studentId),
        isNull(classEnrollments.cancelledAt)
      )
    );

  const completedMap = new Map<string, typeof enrollmentRows[0]>();
  for (const row of enrollmentRows) {
    if (row.attendanceStatus === 'attended') {
      const key = `${row.classType}_${row.classNumber}`;
      completedMap.set(key, row);

      // Task 272: an attended canonical combined In-Car 12/13 session
      // (auto driving, classNumber=12, duration=120, maxStudents=2) counts as
      // BOTH In-Car #12 and In-Car #13 completed, so populate driving_13 too.
      if (
        isCombined1213Class({
          classType: row.classType,
          classNumber: row.classNumber,
          duration: row.duration,
          maxStudents: row.maxStudents,
          courseType: row.courseType,
        })
      ) {
        completedMap.set('driving_13', row);
      }
    }
  }

  let currentPhase = phaseDefinitions[phaseDefinitions.length - 1].phase;
  const phases: PhaseProgress[] = [];

  for (let i = 0; i < phaseDefinitions.length; i++) {
    const phaseDef = phaseDefinitions[i];
    const phaseClasses: PhaseClassProgress[] = [];
    let completedCount = 0;
    let earliestDate: string | null = null;

    for (const classItem of phaseDef.classes) {
      const key = `${classItem.classType}_${classItem.classNumber}`;
      const completed = completedMap.get(key);
      const isCompleted = !!completed || transferCompletionKeys.has(key);

      if (isCompleted) completedCount++;
      if (completed?.date && (!earliestDate || completed.date < earliestDate)) {
        earliestDate = completed.date;
      }

      phaseClasses.push({
        id: classItem.id,
        label: classItem.label,
        classType: classItem.classType,
        classNumber: classItem.classNumber,
        specialNote: classItem.specialNote,
        isCompleted,
        date: completed?.date || undefined,
        time: completed?.time || undefined,
        duration: completed?.duration || undefined,
        instructorName: completed?.instructorFirstName && completed?.instructorLastName
          ? `${completed.instructorFirstName} ${completed.instructorLastName}`
          : undefined,
        enrollmentId: completed?.enrollmentId || undefined,
        classId: completed?.classId || undefined,
      });
    }

    const isComplete = completedCount === phaseDef.classes.length;
    let dayCount = 0;
    if (earliestDate) {
      const start = new Date(earliestDate);
      const now = new Date();
      dayCount = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if ((studentRow?.courseType || "auto").toLowerCase() === "auto") {
        const timingAdvances = [
          0,
          studentRow?.phase1TimingAdvanceDays ?? 0,
          studentRow?.phase2TimingAdvanceDays ?? 0,
          studentRow?.phase3TimingAdvanceDays ?? 0,
          studentRow?.phase4TimingAdvanceDays ?? 0,
        ];
        dayCount += Math.max(0, timingAdvances[phaseDef.phase] ?? 0);
      }
    }

    phases.push({
      phase: phaseDef.phase,
      label: phaseDef.label,
      minimumDays: phaseDef.minimumDays,
      dayCount,
      isComplete,
      isCurrent: false,
      isLocked: false,
      completedCount,
      totalCount: phaseDef.classes.length,
      notes: phaseDef.notes,
      classes: phaseClasses,
    });
  }

  let foundCurrent = false;
  for (let i = 0; i < phases.length; i++) {
    if (!foundCurrent && !phases[i].isComplete) {
      phases[i].isCurrent = true;
      currentPhase = phases[i].phase;
      foundCurrent = true;
    }
    if (i > 0 && !phases[i - 1].isComplete && !phases[i].isComplete && phases[i].completedCount === 0) {
      phases[i].isLocked = true;
    }
  }
  if (!foundCurrent) {
    phases[phases.length - 1].isCurrent = true;
    currentPhase = phases[phases.length - 1].phase;
  }

  // External SAAQ milestones (moto): informational steps; the 6R knowledge
  // test shows as completed once the office has recorded the pass date.
  const milestoneDefs = getExternalMilestonesForCourse(studentRow?.courseType);
  const externalMilestones = milestoneDefs.length > 0
    ? milestoneDefs.map((m) => ({
        ...m,
        isCompleted: m.id === "saaq_6r_knowledge_test" && !!studentRow?.saaqKnowledgeTestDate,
        date: m.id === "saaq_6r_knowledge_test" ? (studentRow?.saaqKnowledgeTestDate ?? undefined) : undefined,
      }))
    : undefined;

  return { currentPhase, phases, externalMilestones };
}

async function storeDocument(
  documentData: string,
  studentId: number,
  documentId: number,
  filename: string,
  mimeType: string
): Promise<string> {
  if (!isS3Configured() || !documentData.startsWith("data:")) {
    return documentData;
  }
  const [header, base64] = documentData.split(",");
  const detectedMime = header.match(/data:([^;]+)/)?.[1] || mimeType || "application/octet-stream";
  const buffer = Buffer.from(base64, "base64");
  const key = buildDocumentKey(studentId, documentId, filename);
  return await uploadToS3(key, buffer, detectedMime);
}

/**
 * Effective per-day booking limit. Precedence rule: an active
 * "max_bookings_per_day" booking policy (scoped to the class's course/class
 * type) OVERRIDES the built-in default MAX_CLASSES_PER_DAY (2).
 */
type DailyLimitPolicyLike = {
  id?: number;
  name?: string;
  policyType: string;
  value: number;
  courseType?: string | null;
  classType?: string | null;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
};

// Resolve the effective per-day booking limit. Precedence: an active
// max_bookings_per_day policy that is inside its effective-date window
// OVERRIDES the built-in default (MAX_CLASSES_PER_DAY). When several
// policies match, the most specific one (course+class scope > single
// scope > global) wins deterministically instead of depending on DB
// row order. Returns which policy supplied the limit so booking
// decisions can be logged/audited.
function resolveDailyLimit(
  policies: DailyLimitPolicyLike[],
  scope?: { courseType?: string | null; classType?: string | null },
): { limit: number; policy: DailyLimitPolicyLike | null } {
  const now = new Date();
  const inEffect = (p: DailyLimitPolicyLike) => {
    const from = p.effectiveFrom ? new Date(p.effectiveFrom) : null;
    const to = p.effectiveTo ? new Date(p.effectiveTo) : null;
    if (from && from > now) return false;
    if (to && to < now) return false;
    return true;
  };
  const candidates = policies
    .filter(p =>
      p.policyType === 'max_bookings_per_day' &&
      inEffect(p) &&
      (scope === undefined || (
        (!p.courseType || p.courseType === scope.courseType) &&
        (!p.classType || p.classType === scope.classType)
      ))
    )
    .sort((a, b) => {
      const spec = (p: DailyLimitPolicyLike) => (p.courseType ? 1 : 0) + (p.classType ? 1 : 0);
      return spec(b) - spec(a);
    });
  const policy = candidates[0] ?? null;
  return { limit: policy?.value ?? MAX_CLASSES_PER_DAY, policy };
}

/**
 * Upcoming (held) bookings for the strict-progression layer: enrollments
 * that are not cancelled, not yet attended, whose class is still scheduled
 * and has not started yet (school-local time).
 */
function computeUpcomingBookings(
  enrollments: { classId: number | null; cancelledAt: Date | string | null; attendanceStatus: string | null }[],
  allClasses: { id: number; classType: string | null; classNumber: number | null; date: string | null; time: string | null; status: string | null; isExtra?: boolean | null }[],
): { classType: "theory" | "driving"; classNumber: number }[] {
  const result: { classType: "theory" | "driving"; classNumber: number }[] = [];
  for (const e of enrollments) {
    if (e.cancelledAt || e.attendanceStatus === 'attended' || e.attendanceStatus === 'absent' || e.attendanceStatus === 'no-show') continue;
    const cls = allClasses.find(c => c.id === e.classId);
    if (!cls || cls.status !== 'scheduled') continue;
    if (cls.isExtra) continue; // extra lessons never count toward numbered progression
    if (!cls.classType || cls.classNumber == null || !cls.date) continue;
    if (hasClassStarted({ date: cls.date, time: cls.time || "00:00" })) continue;
    result.push({ classType: cls.classType as "theory" | "driving", classNumber: cls.classNumber });
  }
  return result;
}

/**
 * Authoritative eligibility check for moving an enrollment to a new class.
 * Runs the same booking-rule engine as direct booking (strict progression,
 * duplicate class numbers, in-car concurrency, daily limit), excluding the
 * enrollment being moved. Used by the reschedule endpoint, the reschedule
 * fee payment-intent creation, and the Stripe webhook — all three paths must
 * agree before a move happens or a fee is charged.
 */
type RescheduleTargetClass = {
  classType: string | null; classNumber: number | null; date: string | null;
  time: string | null; duration: number | null; maxStudents: number | null;
  courseType: string | null;
};

/** Fetches the student's booking state once so many candidate targets can be validated cheaply. */
async function buildRescheduleContext(studentId: number, enrollmentId: number) {
  const enrollments = (await storage.getClassEnrollmentsByStudent(studentId))
    .filter(e => e.id !== enrollmentId);
  const allClasses = await storage.getClasses();
  const enrollmentDetails = enrollments
    .filter(e => !e.cancelledAt)
    .map(e => {
      const cls = allClasses.find(c => c.id === e.classId);
      return {
        attendanceStatus: e.attendanceStatus,
        classType: cls?.classType ?? null,
        classNumber: cls?.classNumber ?? null,
        date: cls?.date ?? null,
        duration: cls?.duration ?? null,
              maxStudents: cls?.maxStudents ?? null,
        courseType: cls?.courseType ?? null,
        classStatus: cls?.status ?? null,
      };
    });
  const studentRow = await storage.getStudent(studentId);
  return {
    enrollmentDetails,
    completed: mergeScooterTransferCredits(buildCompletedClasses(enrollmentDetails), studentRow),
    upcomingBookings: computeUpcomingBookings(enrollments, allClasses),
    saaq6rKnowledgePassed: !!studentRow?.saaqKnowledgeTestDate,
    phase1TimingAdvanceDays: studentRow?.phase1TimingAdvanceDays ?? 0,
    phase2TimingAdvanceDays: studentRow?.phase2TimingAdvanceDays ?? 0,
    phase3TimingAdvanceDays: studentRow?.phase3TimingAdvanceDays ?? 0,
    phase4TimingAdvanceDays: studentRow?.phase4TimingAdvanceDays ?? 0,
  };
}

function validateRescheduleTargetWithContext(
  ctx: Awaited<ReturnType<typeof buildRescheduleContext>>,
  courseType: string | null | undefined,
  newClass: RescheduleTargetClass,
  dailyLimit: number,
): BookingValidationResult {
  // A reschedule can never move a student into a different course's class.
  if (
    newClass.courseType &&
    (courseType || 'auto').toLowerCase() !== newClass.courseType.toLowerCase()
  ) {
    return { allowed: false, reason: "You can only reschedule into classes from your own course.", blockingRule: "course_type_mismatch" };
  }
  if (newClass.date && hasClassStarted({ date: newClass.date, time: newClass.time || "00:00" })) {
    return { allowed: false, reason: "The selected class has already started and can no longer be booked.", blockingRule: "class_started" };
  }
  const newClassDate = newClass.date ?? new Date().toISOString().slice(0, 10);
  const sameDayDetails = ctx.enrollmentDetails.filter(
    d => d.date === newClassDate && d.classStatus === 'scheduled'
  );
  const sameDayBooked = sameDayDetails.length;
  const sameDayMinutes = sameDayDetails.reduce(
    (sum, d) => sum + (d.duration ?? (d.classType === 'theory' ? 120 : 60)), 0);
  const sameDayHasDriving = sameDayDetails.some(d => d.classType === 'driving');
  return validateClassBooking(
    {
      classType: newClass.classType as "theory" | "driving",
      classNumber: newClass.classNumber ?? 0,
      date: newClassDate,
      duration: newClass.duration ?? undefined,
      maxStudents: newClass.maxStudents ?? undefined,
      sameDayAlreadyBookedCount: sameDayBooked,
      sameDayAlreadyBookedMinutes: sameDayMinutes,
      sameDayAlreadyBookedHasDriving: sameDayHasDriving,
      maxClassesPerDay: dailyLimit,
      saaq6rKnowledgePassed: ctx.saaq6rKnowledgePassed,
      phase1TimingAdvanceDays: ctx.phase1TimingAdvanceDays,
      phase2TimingAdvanceDays: ctx.phase2TimingAdvanceDays,
      phase3TimingAdvanceDays: ctx.phase3TimingAdvanceDays,
      phase4TimingAdvanceDays: ctx.phase4TimingAdvanceDays,
      upcomingBookings: ctx.upcomingBookings,
    },
    ctx.completed,
    (courseType || 'auto').toLowerCase(),
  );
}

async function validateRescheduleTarget(
  studentId: number,
  courseType: string | null | undefined,
  enrollmentId: number,
  newClass: RescheduleTargetClass,
): Promise<BookingValidationResult> {
  const ctx = await buildRescheduleContext(studentId, enrollmentId);
  const policies = await storage.getActiveBookingPolicies(newClass.courseType || undefined, newClass.classType || undefined);
  return validateRescheduleTargetWithContext(ctx, courseType, newClass, resolveDailyLimit(policies).limit);
}

function effectiveDailyLimit(
  policies: DailyLimitPolicyLike[],
  scope?: { courseType?: string | null; classType?: string | null },
): number {
  return resolveDailyLimit(policies, scope).limit;
}

/**
 * Scope + date-window overlap check for daily-limit policies. Two
 * max_bookings_per_day policies conflict when their course/class scopes can
 * both match the same class (null = "all") and their effective windows
 * intersect — enforcement then picks whichever is found first, which is
 * arbitrary. Used to warn staff at save time.
 */
function findOverlappingDailyLimitPolicies(
  candidate: {
    id?: number;
    policyType: string;
    isActive: boolean;
    courseType?: string | null;
    classType?: string | null;
    effectiveFrom?: Date | string | null;
    effectiveTo?: Date | string | null;
  },
  policies: Array<{
    id: number;
    name: string;
    policyType: string;
    isActive: boolean;
    value: number;
    courseType?: string | null;
    classType?: string | null;
    effectiveFrom?: Date | string | null;
    effectiveTo?: Date | string | null;
  }>,
) {
  if (candidate.policyType !== 'max_bookings_per_day' || !candidate.isActive) return [];
  const scopesOverlap = (a?: string | null, b?: string | null) => !a || !b || a === b;
  const toTime = (d?: Date | string | null, fallback?: number) =>
    d ? new Date(d).getTime() : fallback!;
  const datesOverlap = (
    aFrom?: Date | string | null, aTo?: Date | string | null,
    bFrom?: Date | string | null, bTo?: Date | string | null,
  ) =>
    toTime(aFrom, -Infinity) <= toTime(bTo, Infinity) &&
    toTime(bFrom, -Infinity) <= toTime(aTo, Infinity);
  return policies.filter(p =>
    p.id !== candidate.id &&
    p.policyType === 'max_bookings_per_day' &&
    p.isActive &&
    scopesOverlap(candidate.courseType, p.courseType) &&
    scopesOverlap(candidate.classType, p.classType) &&
    datesOverlap(candidate.effectiveFrom, candidate.effectiveTo, p.effectiveFrom, p.effectiveTo)
  );
}

// Class dates/times are stored as wall-clock strings in the school's local
// timezone. The server may run in a different timezone (e.g. UTC in Docker),
// so any "has the class started?" / "how long until start?" comparison must
// convert using the school's timezone rather than the server's.
// Helpers live in server/services/class-time.ts so they can be unit-tested.

/**
 * True once the class's scheduled start time has passed (optionally allowing
 * a grace window of minutes before start). Used by booking flows, where an
 * unparseable stored schedule is treated as "not started" (fail open —
 * booking remains possible; attendance flows use attendanceStartGate below,
 * which reports unparseable schedules explicitly instead).
 */
function hasClassStarted(classData: { date: string; time: string }, earlyWindowMinutes = 0): boolean {
  return checkClassStart(classData, earlyWindowMinutes).status === "started";
}

/**
 * Shared gate for all attendance-related actions (check-in, check-out,
 * no-show, mark-complete, bulk attendance). Returns null when the action is
 * allowed; otherwise returns the block details (audit reason + honest client
 * message). An unparseable stored date/time is reported distinctly and logged
 * server-side instead of masquerading as "before start time".
 */
function attendanceStartGate(
  classData: { id: number; date: string; time: string },
  earlyWindowMinutes = 0,
): { blockReason: string; message: string } | null {
  const check = checkClassStart(classData, earlyWindowMinutes);
  if (check.status === "started") return null;
  if (check.status === "invalid") {
    console.error(
      `[attendance] Class ${classData.id} has an unparseable schedule (date="${classData.date}", time="${classData.time}") — blocking attendance action with a schedule-data error instead of a start-time error.`,
    );
    return {
      blockReason: `Class schedule could not be interpreted (date="${classData.date}", time="${classData.time}")`,
      message: "We couldn't determine this class's scheduled time from its stored date/time — please contact the office to correct the class schedule.",
    };
  }
  const scheduled = formatClassSchedule(classData);
  return {
    blockReason: earlyWindowMinutes > 0
      ? `Attempted before check-in window (${earlyWindowMinutes} minutes before scheduled start ${scheduled})`
      : `Attempted before the class's scheduled start time (${scheduled})`,
    message: earlyWindowMinutes > 0
      ? `Check-in opens ${earlyWindowMinutes} minutes before the class's scheduled start time. This class is scheduled for ${scheduled}.`
      : `This action isn't available before the class's scheduled start time. This class is scheduled for ${scheduled}.`,
  };
}

/**
 * Evaluate the max_bookings_per_week, min_booking_notice, and
 * max_pending_bookings policies against a target class + the student's
 * existing enrollments. Returns a violation ({ policyType, message }) for the
 * first policy breached, or null when all pass.
 *
 * - Week window is Monday–Sunday containing the target class date.
 * - "Pending" bookings are enrollments still in "registered" status for
 *   scheduled classes on today or a future date.
 */
function checkWeeklyNoticePendingPolicies(
  policies: Array<{ policyType: string; value: number }>,
  target: { date: string | null; time: string | null },
  existing: Array<{ date: string | null; classStatus: string | null; attendanceStatus: string | null }>,
): { policyType: string; message: string } | null {
  const weeklyPolicy = policies.find(p => p.policyType === 'max_bookings_per_week');
  if (weeklyPolicy && target.date) {
    const d = new Date(`${target.date}T00:00:00`);
    const day = d.getDay(); // 0 = Sunday
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekStart = monday.toISOString().slice(0, 10);
    const weekEnd = sunday.toISOString().slice(0, 10);
    const inWeek = existing.filter(
      e => e.date && e.classStatus === 'scheduled' && e.date >= weekStart && e.date <= weekEnd
    ).length;
    if (inWeek >= weeklyPolicy.value) {
      return {
        policyType: 'max_bookings_per_week',
        message: `Weekly booking limit reached: the student already has ${inWeek} booking(s) during the week of ${weekStart}. Maximum bookings per week is ${weeklyPolicy.value}.`,
      };
    }
  }

  const noticePolicy = policies.find(p => p.policyType === 'min_booking_notice');
  if (noticePolicy && target.date) {
    const classStart = getClassStartTime({ date: target.date, time: target.time || '00:00' });
    const hoursUntil = classStart ? (classStart.getTime() - Date.now()) / (1000 * 60 * 60) : Infinity;
    if (hoursUntil < noticePolicy.value) {
      return {
        policyType: 'min_booking_notice',
        message: `This class starts too soon: bookings require at least ${noticePolicy.value} hour(s) notice, but the class starts in ${Math.max(0, Math.floor(hoursUntil))} hour(s).`,
      };
    }
  }

  const pendingPolicy = policies.find(p => p.policyType === 'max_pending_bookings');
  if (pendingPolicy) {
    const today = new Date().toISOString().slice(0, 10);
    const pendingCount = existing.filter(
      e =>
        e.date &&
        e.date >= today &&
        e.classStatus === 'scheduled' &&
        (e.attendanceStatus === 'registered' || !e.attendanceStatus)
    ).length;
    if (pendingCount >= pendingPolicy.value) {
      return {
        policyType: 'max_pending_bookings',
        message: `Pending booking limit reached: the student has ${pendingCount} upcoming unconfirmed booking(s). Maximum pending bookings is ${pendingPolicy.value}.`,
      };
    }
  }

  return null;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Public endpoint — publishable key is meant to be exposed
  app.get('/api/stripe-config', (_req, res) => {
    res.json({ publicKey: process.env.VITE_STRIPE_PUBLIC_KEY || '' });
  });

  // ─── Stripe Webhook ────────────────────────────────────────────────────────
  // Must be registered before any session/auth middleware so it receives the
  // raw Buffer body (set up by express.raw in index.ts).
  // To test locally: stripe listen --forward-to localhost:5000/api/stripe/webhook
  // Set STRIPE_WEBHOOK_SECRET to the signing secret shown by the CLI or dashboard.
  app.post('/api/stripe/webhook', async (req: any, res: any) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.warn('[webhook] STRIPE_WEBHOOK_SECRET not set — skipping verification');
      return res.status(400).json({ message: 'Webhook secret not configured' });
    }

    let event: any;
    try {
      const stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-10-29.clover' });
      event = stripeInstance.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      captureRequestError(err);
      console.error('[webhook] Signature verification failed:', err.message);
      return res.status(400).json({ message: `Webhook signature invalid: ${err.message}` });
    }

    try {
      const stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-10-29.clover' });

      if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object as any;
        const { type, purpose, enrollmentId, studentId, finalAmount, finalDescription, cardBrand } = pi.metadata || {};

        // ── Reschedule fee paid ────────────────────────────────────────────
        if (purpose === 'reschedule' && enrollmentId) {
          const { policyFeePayments: pfp } = await import("@shared/schema");
          const existing = await db.select().from(pfp)
            .where(eq(pfp.paymentIntentId, pi.id)).limit(1);
          if (existing.length === 0) {
            await db.insert(pfp).values({
              paymentIntentId: pi.id,
              enrollmentId: parseInt(enrollmentId),
              status: 'reschedule',
              amount: pi.amount,
              currency: pi.currency,
            });
            console.log(`[webhook] Reschedule fee recorded for enrollment ${enrollmentId}`);
            // If the target class was stored in metadata, execute the reschedule now so the
            // student's booking is moved even if the browser never calls /reschedule.
            // Run the same availability check as the /reschedule endpoint to prevent booking
            // a full, ineligible, or non-existent class via metadata.
            const newClassIdMeta = pi.metadata?.newClassId;
            const studentIdForReschedule = pi.metadata?.studentId;
            if (newClassIdMeta && studentIdForReschedule) {
              const enrollmentRec = await storage.getClassEnrollment(parseInt(enrollmentId));
              if (enrollmentRec && !enrollmentRec.cancelledAt) {
                const newCid = parseInt(newClassIdMeta);
                // Re-run availability/eligibility check identical to /reschedule endpoint,
                // plus the authoritative booking-rule validation (strict progression,
                // duplicates, in-car concurrency). The webhook must never move an
                // enrollment the browser endpoint would reject.
                // Validation + move run under the per-student lock so the
                // webhook can't race a parallel booking/reschedule request.
                await withStudentBookingLock(parseInt(studentIdForReschedule), async (bookingTx) => {
                const availableClasses = await storage.getAvailableClasses(parseInt(studentIdForReschedule), {});
                const webhookTarget = await storage.getClass(newCid);
                const webhookStudent = await storage.getStudent(parseInt(studentIdForReschedule));
                const webhookValidation = webhookTarget
                  ? await validateRescheduleTarget(parseInt(studentIdForReschedule), webhookStudent?.courseType, parseInt(enrollmentId), webhookTarget)
                  : { allowed: false as const, reason: "Class not found" };
                // Any failure to execute the paid move — rule rejection OR the
                // class no longer being available (full, cancelled, removed) —
                // means the student must not stay charged. Refund idempotently.
                const refundFailedMove = async (why: string) => {
                  console.warn(`[webhook] Reschedule to class ${newCid} for student ${studentIdForReschedule} not executed (${why}) — refunding fee`);
                  try {
                    await stripeInstance.refunds.create(
                      { payment_intent: pi.id, reason: 'requested_by_customer' },
                      { idempotencyKey: `reschedule-invalid-refund-${pi.id}` },
                    );
                    await db.update(pfp).set({ status: 'reschedule_refunded' }).where(eq(pfp.paymentIntentId, pi.id));
                    console.log(`[webhook] Reschedule fee refunded for enrollment ${enrollmentId} (target ${newCid}: ${why})`);
                  } catch (refundErr) {
                    captureRequestError(refundErr);
                    console.error(`[webhook] FAILED to auto-refund reschedule fee ${pi.id} — needs manual refund:`, refundErr);
                  }
                };
                if (!webhookValidation.allowed) {
                  await refundFailedMove(webhookValidation.reason ?? 'rejected by booking rules');
                } else if (availableClasses.find(c => c.id === newCid)) {
                  await storage.updateClassEnrollment(parseInt(enrollmentId), {
                    classId: newCid,
                    lastPaymentIntentId: pi.id,
                  }, bookingTx);
                  console.log(`[webhook] Reschedule executed: enrollment ${enrollmentId} → class ${newCid}`);
                } else {
                  await refundFailedMove('class no longer available');
                }
                });
              }
            }
          }
        }

        // ── Cancel fee paid — record fee AND execute cancellation ──────────
        if (purpose === 'cancel' && enrollmentId) {
          const { policyFeePayments: pfp } = await import("@shared/schema");
          const existing = await db.select().from(pfp)
            .where(eq(pfp.paymentIntentId, pi.id)).limit(1);
          if (existing.length === 0) {
            await db.insert(pfp).values({
              paymentIntentId: pi.id,
              enrollmentId: parseInt(enrollmentId),
              status: 'cancel',
              amount: pi.amount,
              currency: pi.currency,
            });
            const enrollment = await storage.getClassEnrollment(parseInt(enrollmentId));
            if (enrollment && !enrollment.cancelledAt) {
              await storage.updateClassEnrollment(parseInt(enrollmentId), {
                cancelledAt: new Date(),
                lastPaymentIntentId: pi.id,
              });
              console.log(`[webhook] Cancellation executed for enrollment ${enrollmentId}`);
              // A cancelled in-car lesson frees the student's slot #1 —
              // notify them their remaining upcoming in-car booking (if any)
              // is now their next lesson, same as the browser cancel route.
              if (enrollment.studentId && enrollment.classId) {
                const cancelledClass = await storage.getClass(enrollment.classId);
                if (cancelledClass?.classType === 'driving') {
                  notifyInCarSlotPromotion(enrollment.studentId).catch((err) => {
                    captureRequestError(err);
                    console.error("[in-car slots] Failed to send promotion email after webhook cancellation:", err);
                  });
                }
              }
            }
          }
        }

        // ── Extra lesson payment ───────────────────────────────────────────
        if (type === 'extra_lesson') {
          const { classEnrollments: ceTable } = await import("@shared/schema");
          const [enrollment] = await db.select().from(ceTable)
            .where(eq(ceTable.lastPaymentIntentId, pi.id)).limit(1);
          if (enrollment && enrollment.paymentStatus !== 'paid') {
            await storage.updateClassEnrollment(enrollment.id, {
              paymentStatus: 'paid',
              paidAmount: pi.amount,
              lastPaymentIntentId: pi.id,
            });
            console.log(`[webhook] Extra lesson payment confirmed for enrollment ${enrollment.id}`);
          }
        }

        // ── Billing checkout (package / lesson / balance) ──────────────────
        if ((type === 'package' || type === 'lesson' || type === 'balance') && studentId) {
          const { studentTransactions: stTable } = await import("@shared/schema");
          const [existingTx] = await db.select().from(stTable)
            .where(eq(stTable.referenceNumber, pi.id)).limit(1);
          if (!existingTx) {
            const amount = parseFloat(finalAmount || '0');
            const desc = finalDescription || 'Payment';
            const brand = cardBrand || 'card';
            const studentIdInt = parseInt(studentId);
            const transaction = await storage.createStudentTransaction({
              studentId: studentIdInt,
              date: new Date().toISOString().split('T')[0],
              description: desc,
              amount: String(amount),
              gst: '0.00',
              pst: '0.00',
              total: String(amount),
              transactionType: 'payment',
              paymentMethod: brand,
              referenceNumber: pi.id,
            });
            await storage.createBillingReceipt({
              transactionId: transaction.id!,
              receiptNumber: `REC-${Date.now()}-${studentIdInt}`,
              pdfPath: null,
            });
            console.log(`[webhook] Billing transaction created for student ${studentId}`);
          }
        }
      }

      if (event.type === 'payment_intent.payment_failed') {
        const pi = event.data.object as any;
        const { type } = pi.metadata || {};
        if (type === 'extra_lesson') {
          const { classEnrollments: ceTable } = await import("@shared/schema");
          const [enrollment] = await db.select().from(ceTable)
            .where(eq(ceTable.lastPaymentIntentId, pi.id)).limit(1);
          if (enrollment && enrollment.paymentStatus === 'pending') {
            await storage.updateClassEnrollment(enrollment.id, { paymentStatus: 'failed' });
            console.log(`[webhook] Extra lesson payment failed for enrollment ${enrollment.id}`);
          }
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      captureRequestError(err);
      console.error('[webhook] Handler error:', err);
      res.status(500).json({ message: 'Webhook handler failed' });
    }
  });
  // ─── End Stripe Webhook ────────────────────────────────────────────────────

  const isProduction = process.env.NODE_ENV === "production";

  // Trust the Replit (and any other) reverse proxy so Express sees the original
  // HTTPS protocol via X-Forwarded-Proto. Without this, behind Replit's HTTPS
  // proxy req.secure is false, and express-session silently refuses to set a
  // `secure: true` cookie — so login succeeds (200) but no session cookie is
  // stored and every following request is 401. This must run before any session
  // middleware. (In production setupAuth also sets this; setting it twice is safe.)
  app.set("trust proxy", 1);

  // Choose appropriate auth middleware based on environment
  // For production, create a hybrid middleware that checks both auth methods
  const authMiddleware = isProduction
    ? async (req: any, res: any, next: any) => {
        // First try Replit auth
        if (req.user && req.user.claims) {
          const userId = req.user.claims.sub;
          const user = await storage.getUser(userId);
          if (user) {
            req.user = user;
            return next();
          }
        }

        // Fallback to session-based auth
        const sessionUserId = (req.session as any)?.userId;
        if (sessionUserId) {
          const user = await storage.getUser(sessionUserId);
          if (user) {
            req.user = user;
            return next();
          }
        }

        res.status(401).json({ message: "Unauthorized" });
      }
    : isAuthenticatedTraditional;

  const isAdminOrInstructor = async (req: any, res: any, next: any) => {
    const instructorId = (req.session as any)?.instructorId;
    if (instructorId) {
      const instructor = await storage.getInstructor(instructorId);
      if (instructor && instructor.status === 'active') {
        req.instructor = instructor;
        return next();
      }
    }
    authMiddleware(req, res, next);
  };

  // Admin-only guard: authenticate first, then require admin/owner role.
  const requireAdmin = (req: any, res: any, next: any) => {
    authMiddleware(req, res, (err?: any) => {
      if (err) return next(err);
      const user = req.user;
      if (!user || (user.role !== "admin" && user.role !== "owner")) {
        return res.status(403).json({ message: "Admin access required" });
      }
      next();
    });
  };

  if (isProduction) {
    // Production: Use Replit Auth with demo fallback
    await setupAuth(app);

    // Set up session middleware for demo auth fallback in production
    const session = (await import("express-session")).default;
    const connectPg = (await import("connect-pg-simple")).default;

    const sessionTtl = 60 * 60 * 1000; // 1 hour in milliseconds
    const pgStore = connectPg(session);
    const sessionStore = new pgStore({
      pool: (await import("./db")).pool,
      createTableIfMissing: false,
      ttl: sessionTtl / 1000, // Convert to seconds for PostgreSQL TTL
      tableName: "sessions",
    });

    app.use(
      session({
        secret: process.env.SESSION_SECRET || "prod-secret-key",
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          secure: true, // HTTPS in production
          maxAge: sessionTtl,
        },
      }),
    );

    // Demo login endpoint for production
    app.post("/api/auth/login", async (req, res) => {
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
      const { username, password } = req.body;
      console.log(`[login] attempt: username="${username}" ip=${ip}`);

      try {
        if (!username || !password) {
          console.log(`[login] rejected: missing credentials`);
          return res.status(400).json({
            success: false,
            message: "Username and password required",
          });
        }

        const result = await loginUser(username, password);
        console.log(`[login] loginUser result: success=${result.success} message="${result.message}"`);

        if (result.success && result.user) {
          (req.session as any).userId = result.user.id;
          console.log(`[login] saving session for userId=${result.user.id}`);

          await new Promise<void>((resolve, reject) => {
            req.session.save((err) => {
              if (err) {
                console.error(`[login] session.save failed:`, err);
                reject(err);
              } else {
                console.log(`[login] session saved OK, sessionID=${req.sessionID}`);
                resolve();
              }
            });
          });

          const { password: _pw, ...safeUser } = result.user as any;
          res.json({ success: true, user: safeUser });
        } else {
          res.status(401).json({ success: false, message: result.message });
        }
      } catch (error: any) {
        captureRequestError(error);
        console.error(`[login] FATAL error for "${username}":`, error?.message || error);
        console.error(`[login] stack:`, error?.stack);
        res.status(500).json({ success: false, message: error?.message || "Login failed" });
      }
    });

    // Hybrid auth endpoint - check both Replit auth and session
    app.get("/api/auth/user", async (req: any, res) => {
      try {
        const stripPassword = (u: any) => { const { password: _, ...safe } = u; return safe; };

        // First try Replit auth
        if (req.user && req.user.claims) {
          const userId = req.user.claims.sub;
          const user = await storage.getUser(userId);
          if (user) return res.json(stripPassword(user));
        }

        // Fallback to session-based auth
        const sessionUserId = (req.session as any)?.userId;
        if (sessionUserId) {
          const user = await storage.getUser(sessionUserId);
          if (user) return res.json(stripPassword(user));
        }

        res.status(401).json({ message: "Unauthorized" });
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching user:", error);
        res.status(401).json({ message: "Unauthorized" });
      }
    });

    app.post("/api/auth/logout", (req, res) => {
      req.session?.destroy((err) => {
        if (err) {
          return res.status(500).json({ message: "Logout failed" });
        }
        res.json({ success: true });
      });
    });
  } else {
    // Development: Use traditional auth for demos
    const session = (await import("express-session")).default;
    const connectPg = (await import("connect-pg-simple")).default;

    const sessionTtl = 60 * 60 * 1000; // 1 hour in milliseconds
    const pgStore = connectPg(session);
    const sessionStore = new pgStore({
      pool: (await import("./db")).pool,
      createTableIfMissing: false,
      ttl: sessionTtl / 1000, // Convert to seconds for PostgreSQL TTL
      tableName: "sessions",
    });

    // In Replit's preview pane the app runs inside an iframe (replit.com outer page),
    // so cookies are treated as third-party and need SameSite=None; Secure.
    const inReplitWorkspace = !!process.env.REPL_ID;

    app.use(
      session({
        secret: process.env.SESSION_SECRET || "dev-secret-key",
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          secure: inReplitWorkspace, // Replit proxy is always HTTPS
          sameSite: inReplitWorkspace ? "none" : "lax",
          maxAge: sessionTtl,
        },
      }),
    );

    // Traditional auth routes for development
    app.post("/api/auth/login", async (req, res) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return res.status(400).json({
            success: false,
            message: "Username and password required",
          });
        }

        const result = await loginUser(username, password);

        if (result.success && result.user) {
          (req.session as any).userId = result.user.id;

          await new Promise<void>((resolve, reject) => {
            req.session.save((err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          const { password: _pw, ...safeUser } = result.user as any;
          res.json({ success: true, user: safeUser });
        } else {
          res.status(401).json({ success: false, message: result.message });
        }
      } catch (error) {
        captureRequestError(error);
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Login failed" });
      }
    });

    app.get(
      "/api/auth/user",
      isAuthenticatedTraditional,
      async (req: any, res) => {
        try {
          const { password: _, ...safe } = req.user as any;
          res.json(safe);
        } catch (error) {
          captureRequestError(error);
          console.error("Error fetching user:", error);
          res.status(500).json({ message: "Failed to fetch user" });
        }
      },
    );

    app.post("/api/auth/logout", (req, res) => {
      req.session?.destroy((err) => {
        if (err) {
          return res.status(500).json({ message: "Logout failed" });
        }
        res.json({ success: true });
      });
    });

  }

  // Admin forgot password — send reset email (registered for BOTH production
  // and development auth setups; do not move inside the branches above).
    app.post("/api/auth/forgot-password", async (req, res) => {
      try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: "Email is required" });

        const user = await storage.getUserByEmail(email);
        // Always return success to avoid user enumeration
        if (!user) return res.json({ success: true, message: "If that email is registered, a reset link has been sent" });

        const token = generateInviteToken();
        const expiry = new Date();
        expiry.setHours(expiry.getHours() + 1);

        const { db } = await import("./db");
        const { users: usersTable } = await import("../shared/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(usersTable).set({ resetPasswordToken: token, resetPasswordExpiry: expiry }).where(eq(usersTable.id, user.id));

        const { sendAdminPasswordResetEmail } = await import("./services/sendgrid");
        sendAdminPasswordResetEmail(user.email!, user.firstName || "Admin", token).catch((e) =>
          console.error("Failed to send admin reset email:", e)
        );

        res.json({ success: true, message: "If that email is registered, a reset link has been sent" });
      } catch (error) {
        captureRequestError(error);
        console.error("Admin forgot-password error:", error);
        res.status(500).json({ message: "Failed to process request" });
      }
    });

    // Validate admin reset token
    app.get("/api/auth/reset-password/:token/validate", async (req, res) => {
      try {
        const user = await storage.getUserByAdminResetToken(req.params.token);
        if (!user) return res.status(404).json({ message: "Invalid or expired reset link" });
        if (user.resetPasswordExpiry && new Date() > new Date(user.resetPasswordExpiry)) {
          return res.status(410).json({ message: "Reset link has expired. Please request a new one." });
        }
        res.json({ valid: true, firstName: user.firstName, email: user.email });
      } catch (error) {
        captureRequestError(error);
        console.error("Admin reset token validation error:", error);
        res.status(500).json({ message: "Failed to validate token" });
      }
    });

    // Complete admin password reset
    app.post("/api/auth/reset-password/:token", async (req, res) => {
      try {
        const { password } = req.body;
        if (!password || password.length < 8) {
          return res.status(400).json({ message: "Password must be at least 8 characters" });
        }

        const user = await storage.getUserByAdminResetToken(req.params.token);
        if (!user) return res.status(404).json({ message: "Invalid or expired reset link" });
        if (user.resetPasswordExpiry && new Date() > new Date(user.resetPasswordExpiry)) {
          return res.status(410).json({ message: "Reset link has expired. Please request a new one." });
        }

        const bcrypt = await import("bcryptjs");
        const hashed = await bcrypt.hash(password, 10);

        const { db } = await import("./db");
        const { users: usersTable } = await import("../shared/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(usersTable).set({ password: hashed, resetPasswordToken: null, resetPasswordExpiry: null }).where(eq(usersTable.id, user.id));

        res.json({ success: true, message: "Password reset successfully. You can now log in." });
      } catch (error) {
        captureRequestError(error);
        console.error("Admin reset password error:", error);
        res.status(500).json({ message: "Failed to reset password" });
      }
    });

  // Production troubleshooting endpoints
  app.post("/api/admin/create-admin-user", async (req, res) => {
    try {
      const existingUsers = await storage.getUsers();
      if (existingUsers && existingUsers.length > 0) {
        return res.status(400).json({
          message: "Admin user already exists",
          count: existingUsers.length,
        });
      }

      const adminUser = await storage.createUser({
        email: "admin@mortys.com",
        firstName: "Admin",
        lastName: "User",
        profileImageUrl: null,
      });

      res.json({
        success: true,
        message: "Admin user created successfully",
        user: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
        },
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating admin user:", error);
      res.status(500).json({
        message: "Failed to create admin user",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/admin/verify-user", async (req, res) => {
    try {
      const { username } = req.query;
      const user = await storage.getUserByUsername(username as string);
      res.json({
        exists: !!user,
        details: user
          ? {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
            }
          : null,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error verifying user:", error);
      res.status(500).json({
        message: "Failed to verify user",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/admin/force-init-db", async (req, res) => {
    try {
      await initializeDatabase();
      res.json({ success: true, message: "Database initialization completed" });
    } catch (error) {
      captureRequestError(error);
      console.error("Error initializing database:", error);
      res.status(500).json({
        message: "Failed to initialize database",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Debug endpoint for session testing
  app.get("/api/debug/session", (req, res) => {
    res.json({
      sessionExists: !!req.session,
      sessionId: req.sessionID,
      userId: (req.session as any)?.userId,
      username: (req.session as any)?.username,
      cookies: req.headers.cookie,
      environment: process.env.NODE_ENV,
      hasDbUrl: !!process.env.DATABASE_URL,
      dbUrlPrefix: process.env.DATABASE_URL?.substring(0, 20) + "...",
      host: req.get("host"),
      origin: req.get("origin"),
    });
  });

  // Production database test endpoint
  app.get("/api/debug/db-test", async (req, res) => {
    try {
      console.log("Testing database connection...");
      const testUser = await storage.getUserByUsername("admin");
      console.log(
        "Database test result:",
        testUser ? "User found" : "User not found",
      );

      res.json({
        dbConnected: !!testUser,
        userExists: !!testUser,
        environment: process.env.NODE_ENV,
        hasDbUrl: !!process.env.DATABASE_URL,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Database test error:", error);
      res.status(500).json({
        dbConnected: false,
        error: error instanceof Error ? error.message : String(error),
        environment: process.env.NODE_ENV,
      });
    }
  });

  // Email sending route
  app.post("/api/send-email", authMiddleware, async (req, res) => {
    try {
      const { sendBulkEmail } = await import("./services/sendgrid");
      const { recipients, subject, message, fromEmail } = req.body;

      if (
        !recipients ||
        !Array.isArray(recipients) ||
        recipients.length === 0
      ) {
        return res
          .status(400)
          .json({ message: "Recipients array is required" });
      }

      if (!subject || !message) {
        return res
          .status(400)
          .json({ message: "Subject and message are required" });
      }

      const from = process.env.SENDGRID_FROM_EMAIL || "info@mortysdrivingschool.com";
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #2563eb; margin: 0;">Morty's Driving School</h2>
          </div>
          <div style="background-color: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb;">
            <h3 style="color: #374151; margin-top: 0;">${subject}</h3>
            <div style="color: #6b7280; line-height: 1.6;">
              ${message.replace(/\n/g, "<br>")}
            </div>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>This message was sent from Morty's Driving School communication system.</p>
          </div>
        </div>
      `;

      const result = await sendBulkEmail(
        recipients,
        from,
        subject,
        message,
        htmlContent,
      );

      res.json({
        success: result.success,
        sentCount: result.sentCount,
        totalRecipients: recipients.length,
        errors: result.errors,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Email sending error:", error);
      res.status(500).json({ message: "Failed to send emails", error: error });
    }
  });

  // Settings routes
  app.get("/api/settings", authMiddleware, async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json({
        nextContractNumber: parseInt(settings.nextContractNumber || "1"),
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Settings fetch error:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", authMiddleware, async (req, res) => {
    try {
      const { nextContractNumber } = req.body;
      if (typeof nextContractNumber === "number" && nextContractNumber >= 1) {
        await storage.setSetting(
          "nextContractNumber",
          nextContractNumber.toString(),
        );
        res.json({ nextContractNumber });
      } else {
        res.status(400).json({ message: "Invalid contract number" });
      }
    } catch (error) {
      captureRequestError(error);
      console.error("Settings update error:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // Booking Policies routes
  app.get("/api/booking-policies", authMiddleware, async (req, res) => {
    try {
      const policies = await storage.getBookingPolicies();
      res.json(policies);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching booking policies:", error);
      res.status(500).json({ message: "Failed to fetch booking policies" });
    }
  });

  app.get("/api/booking-policies/active", authMiddleware, async (req, res) => {
    try {
      const { courseType, classType } = req.query;
      const policies = await storage.getActiveBookingPolicies(
        courseType as string | undefined,
        classType as string | undefined
      );
      res.json(policies);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching active booking policies:", error);
      res.status(500).json({ message: "Failed to fetch active booking policies" });
    }
  });

  app.get("/api/booking-policies/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const policy = await storage.getBookingPolicy(id);
      if (!policy) {
        return res.status(404).json({ message: "Booking policy not found" });
      }
      res.json(policy);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching booking policy:", error);
      res.status(500).json({ message: "Failed to fetch booking policy" });
    }
  });

  const nullableCoercedDate = z.preprocess(
    (v) => (v === undefined ? undefined : v === null || v === "" ? null : v),
    z.coerce.date().nullable()
  ).optional();
  const bookingPolicyDateCoercion = {
    effectiveFrom: nullableCoercedDate,
    effectiveTo: nullableCoercedDate,
  };
  const createBookingPolicySchema = insertBookingPolicySchema.extend(bookingPolicyDateCoercion);
  const updateBookingPolicySchema = insertBookingPolicySchema.partial().extend(bookingPolicyDateCoercion);

  app.post("/api/booking-policies", authMiddleware, async (req, res) => {
    try {
      const parsed = createBookingPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid booking policy data", errors: parsed.error.flatten().fieldErrors });
      }
      const existing = await storage.getBookingPolicies();
      const policy = await storage.createBookingPolicy(parsed.data);
      const overlaps = findOverlappingDailyLimitPolicies(
        { ...parsed.data, id: policy.id, isActive: parsed.data.isActive ?? true },
        existing,
      );
      res.status(201).json({
        ...policy,
        ...(overlaps.length > 0 && {
          overlapWarning: {
            message: `This daily-limit policy overlaps ${overlaps.length} other active daily-limit ${overlaps.length === 1 ? 'policy' : 'policies'}. When scopes overlap, whichever policy is matched first wins — the effective limit may not be the one you expect.`,
            policies: overlaps.map(p => ({ id: p.id, name: p.name, value: p.value, courseType: p.courseType ?? null, classType: p.classType ?? null })),
          },
        }),
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating booking policy:", error);
      res.status(500).json({ message: "Failed to create booking policy" });
    }
  });

  const updateBookingPolicyHandler = async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const { changeReason, ...rawPolicyData } = req.body;
      const parsedPolicy = updateBookingPolicySchema.safeParse(rawPolicyData);
      if (!parsedPolicy.success) {
        return res.status(400).json({ message: "Invalid booking policy data", errors: parsedPolicy.error.flatten().fieldErrors });
      }
      const policyData = parsedPolicy.data;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User authentication required" });
      }
      
      const existing = await storage.getBookingPolicies();

      // Use version tracking if changeReason is provided
      const policy = changeReason
        ? await storage.updateBookingPolicyWithVersion(id, policyData, userId, changeReason)
        : await storage.updateBookingPolicy(id, policyData);

      const overlaps = findOverlappingDailyLimitPolicies(
        {
          id,
          policyType: policy.policyType,
          isActive: policy.isActive,
          courseType: policy.courseType,
          classType: policy.classType,
          effectiveFrom: policy.effectiveFrom,
          effectiveTo: policy.effectiveTo,
        },
        existing,
      );
      res.json({
        ...policy,
        ...(overlaps.length > 0 && {
          overlapWarning: {
            message: `This daily-limit policy overlaps ${overlaps.length} other active daily-limit ${overlaps.length === 1 ? 'policy' : 'policies'}. When scopes overlap, whichever policy is matched first wins — the effective limit may not be the one you expect.`,
            policies: overlaps.map(p => ({ id: p.id, name: p.name, value: p.value, courseType: p.courseType ?? null, classType: p.classType ?? null })),
          },
        }),
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating booking policy:", error);
      res.status(500).json({ message: "Failed to update booking policy" });
    }
  };
  app.patch("/api/booking-policies/:id", authMiddleware, updateBookingPolicyHandler);
  app.put("/api/booking-policies/:id", authMiddleware, updateBookingPolicyHandler);

  app.delete("/api/booking-policies/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBookingPolicy(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      console.error("Error deleting booking policy:", error);
      res.status(500).json({ message: "Failed to delete booking policy" });
    }
  });

  // Booking Policy Version History routes
  app.get("/api/booking-policies/:id/versions", authMiddleware, async (req, res) => {
    try {
      const policyId = parseInt(req.params.id);
      const versions = await storage.getBookingPolicyVersions(policyId);
      
      // Enrich versions with user details
      const enrichedVersions = await Promise.all(versions.map(async (version) => {
        const changedByUser = version.changedBy ? await storage.getUser(version.changedBy) : null;
        return {
          ...version,
          changedByName: changedByUser ? `${changedByUser.firstName || ''} ${changedByUser.lastName || ''}`.trim() || changedByUser.email : 'Unknown',
          changedByEmail: changedByUser?.email || 'Unknown',
        };
      }));
      
      res.json(enrichedVersions);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching booking policy versions:", error);
      res.status(500).json({ message: "Failed to fetch booking policy version history" });
    }
  });

  // Get effective booking policies (considering effective dates)
  app.get("/api/booking-policies/effective", authMiddleware, async (req, res) => {
    try {
      const { courseType, classType } = req.query;
      const policies = await storage.getEffectiveBookingPolicies(
        courseType as string | undefined, 
        classType as string | undefined
      );
      res.json(policies);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching effective booking policies:", error);
      res.status(500).json({ message: "Failed to fetch effective booking policies" });
    }
  });

  // Policy Override Logs routes - Audit trail for policy overrides
  app.get("/api/policy-override-logs", authMiddleware, async (req: any, res) => {
    try {
      const { staffUserId, studentId, startDate, endDate, policyType, actionType } = req.query;
      const filters: any = {};
      if (staffUserId) filters.staffUserId = staffUserId as string;
      if (studentId) filters.studentId = parseInt(studentId as string);
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      if (policyType) filters.policyType = policyType as string;
      if (actionType) filters.actionType = actionType as string;

      const logs = await storage.getPolicyOverrideLogs(Object.keys(filters).length > 0 ? filters : undefined);
      
      // Enrich logs with staff, student, and class details
      const enrichedLogs = await Promise.all(logs.map(async (log) => {
        const staff = log.staffUserId ? await storage.getUser(log.staffUserId) : null;
        const student = log.studentId ? await storage.getStudent(log.studentId) : null;
        const classData = log.classId ? await storage.getClass(log.classId) : null;
        
        return {
          ...log,
          staffName: staff ? `${staff.firstName || ''} ${staff.lastName || ''}`.trim() || staff.email : 'Unknown',
          studentName: student ? `${student.firstName} ${student.lastName}` : null,
          classInfo: classData ? `${classData.date} ${classData.time} - ${classData.courseType}` : null
        };
      }));
      
      res.json(enrichedLogs);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching policy override logs:", error);
      res.status(500).json({ message: "Failed to fetch policy override logs" });
    }
  });

  app.get("/api/policy-override-logs/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const log = await storage.getPolicyOverrideLog(id);
      if (!log) {
        return res.status(404).json({ message: "Override log not found" });
      }
      res.json(log);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching policy override log:", error);
      res.status(500).json({ message: "Failed to fetch policy override log" });
    }
  });

  // ------------------------------------------------------------
  // Job Control — admin management of the background job queue
  // ------------------------------------------------------------
  app.get("/api/admin/jobs", requireAdmin, async (req: any, res) => {
    try {
      const { status, category } = req.query;
      const conditions = [];
      if (status && JOB_STATUSES.includes(status)) conditions.push(eq(jobsTable.status, status));
      if (category && JOB_CATEGORIES.includes(category)) conditions.push(eq(jobsTable.category, category));
      const rows = await db.select().from(jobsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(descOrder(jobsTable.id))
        .limit(200);
      const holdUntil = getBillingHoldUntil();
      const holdActive = isBillingHoldActive();
      res.json({
        billingHoldUntil: holdUntil ? holdUntil.toISOString() : null,
        billingHoldActive: holdActive,
        jobs: rows.map((j) => ({
          ...j,
          // A queued billing job during the startup hold is "held": it will
          // not run until the hold ends, regardless of its scheduled time.
          held: holdActive && j.status === "queued" && j.category === "billing",
        })),
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching jobs:", error);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  app.post("/api/admin/jobs", requireAdmin, async (req: any, res) => {
    try {
      const { type, category, payload, scheduledFor, maxAttempts } = req.body || {};
      if (!type || typeof type !== "string") {
        return res.status(400).json({ message: "Job type is required" });
      }
      if (!getRegisteredJobTypes().includes(type)) {
        return res.status(400).json({ message: `Unknown job type "${type}". Registered types: ${getRegisteredJobTypes().join(", ")}` });
      }
      if (category && !JOB_CATEGORIES.includes(category)) {
        return res.status(400).json({ message: `Invalid category. Must be one of: ${JOB_CATEGORIES.join(", ")}` });
      }
      const validationError = validateEnqueueInput({ scheduledFor, maxAttempts });
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }
      const job = await enqueueJob({
        type,
        category: category as JobCategory | undefined,
        payload,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
        maxAttempts: typeof maxAttempts === "number" ? maxAttempts : undefined,
      });
      res.status(201).json(job);
    } catch (error) {
      captureRequestError(error);
      console.error("Error enqueuing job:", error);
      res.status(500).json({ message: "Failed to enqueue job" });
    }
  });

  app.post("/api/admin/jobs/:id/retry", requireAdmin, async (req: any, res) => {
    try {
      const job = await retryJob(parseInt(req.params.id));
      if (!job) return res.status(409).json({ message: "Job cannot be retried — it must be failed, cancelled, or succeeded, and any still-active run must finish winding down first (wait a minute and try again)" });
      res.json(job);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to retry job" });
    }
  });

  app.post("/api/admin/jobs/:id/cancel", requireAdmin, async (req: any, res) => {
    try {
      const job = await cancelQueueJob(parseInt(req.params.id));
      if (!job) return res.status(409).json({ message: "Job cannot be cancelled (must be queued or running)" });
      res.json(job);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to cancel job" });
    }
  });

  app.post("/api/admin/jobs/:id/run-now", requireAdmin, async (req: any, res) => {
    try {
      const job = await runJobNow(parseInt(req.params.id));
      if (!job) return res.status(409).json({ message: "Job cannot be run now (must be queued)" });
      res.json(job);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to run job" });
    }
  });

  // -------------------- In-house Billing (admin) --------------------
  // All pricing/invoicing lives in the app's own tables; Stripe is only the
  // card processor. Heavy work runs through the job queue (billing category).

  // --- Tax rates ---
  app.get("/api/admin/billing/tax-rates", requireAdmin, async (_req: any, res) => {
    try {
      res.json(await getTaxRates());
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch tax rates" });
    }
  });

  app.put("/api/admin/billing/tax-rates", requireAdmin, async (req: any, res) => {
    try {
      const { gstRate, qstRate } = req.body;
      for (const [key, value] of [["gstRate", gstRate], ["qstRate", qstRate]] as const) {
        if (value !== undefined && (typeof value !== "number" || !isFinite(value) || value < 0 || value > 100)) {
          return res.status(400).json({ message: `${key} must be a number between 0 and 100` });
        }
      }
      const before = await getTaxRates();
      if (gstRate !== undefined) await storage.setSetting("billingGstRate", String(gstRate));
      if (qstRate !== undefined) await storage.setSetting("billingQstRate", String(qstRate));
      const after = await getTaxRates();
      await logPricingChange({ settingKey: "taxRates", action: "updated", before, after, changedBy: req.user?.id });
      res.json(after);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to update tax rates" });
    }
  });

  // --- Pricing catalog ---
  app.get("/api/admin/billing/lesson-packages", requireAdmin, async (_req: any, res) => {
    try {
      res.json(await storage.getLessonPackages());
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch lesson packages" });
    }
  });

  app.get("/api/admin/billing/pricing", requireAdmin, async (_req: any, res) => {
    try {
      const { pricingItems } = await import("@shared/schema");
      const items = await db.select().from(pricingItems).orderBy(pricingItems.itemType, pricingItems.name);
      res.json(items);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch pricing items" });
    }
  });

  app.post("/api/admin/billing/pricing", requireAdmin, async (req: any, res) => {
    try {
      const { pricingItems, insertPricingItemSchema, PRICING_ITEM_TYPES } = await import("@shared/schema");
      const parsed = insertPricingItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid pricing item", errors: parsed.error.flatten().fieldErrors });
      }
      if (!(PRICING_ITEM_TYPES as readonly string[]).includes(parsed.data.itemType)) {
        return res.status(400).json({ message: `itemType must be one of: ${PRICING_ITEM_TYPES.join(", ")}` });
      }
      const amount = parseFloat(String(parsed.data.amount));
      if (!isFinite(amount) || amount < 0 || amount > 100000) {
        return res.status(400).json({ message: "amount must be between 0 and 100,000" });
      }
      const [item] = await db.insert(pricingItems).values(parsed.data).returning();
      await logPricingChange({ pricingItemId: item.id, action: "created", after: item, changedBy: req.user?.id });
      res.status(201).json(item);
    } catch (error: any) {
      captureRequestError(error);
      if (error?.code === "23505") return res.status(409).json({ message: "A pricing item with this code already exists" });
      res.status(500).json({ message: "Failed to create pricing item" });
    }
  });

  app.put("/api/admin/billing/pricing/:id", requireAdmin, async (req: any, res) => {
    try {
      const { pricingItems, insertPricingItemSchema } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(pricingItems).where(eq(pricingItems.id, id));
      if (!existing) return res.status(404).json({ message: "Pricing item not found" });
      const parsed = insertPricingItemSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid pricing item", errors: parsed.error.flatten().fieldErrors });
      }
      if (parsed.data.amount !== undefined) {
        const amount = parseFloat(String(parsed.data.amount));
        if (!isFinite(amount) || amount < 0 || amount > 100000) {
          return res.status(400).json({ message: "amount must be between 0 and 100,000" });
        }
      }
      const [updated] = await db.update(pricingItems)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(pricingItems.id, id)).returning();
      const action = parsed.data.isActive === false && existing.isActive ? "deactivated"
        : parsed.data.isActive === true && !existing.isActive ? "activated" : "updated";
      await logPricingChange({ pricingItemId: id, action, before: existing, after: updated, changedBy: req.user?.id });
      res.json(updated);
    } catch (error: any) {
      captureRequestError(error);
      if (error?.code === "23505") return res.status(409).json({ message: "A pricing item with this code already exists" });
      res.status(500).json({ message: "Failed to update pricing item" });
    }
  });

  app.get("/api/admin/billing/pricing-history", requireAdmin, async (req: any, res) => {
    try {
      const { pricingChangeLogs, pricingItems, users } = await import("@shared/schema");
      const itemId = req.query.pricingItemId ? parseInt(req.query.pricingItemId as string) : undefined;
      const rows = await db.select({
        log: pricingChangeLogs,
        itemName: pricingItems.name,
        changedByEmail: users.email,
      }).from(pricingChangeLogs)
        .leftJoin(pricingItems, eq(pricingChangeLogs.pricingItemId, pricingItems.id))
        .leftJoin(users, eq(pricingChangeLogs.changedBy, users.id))
        .where(itemId ? eq(pricingChangeLogs.pricingItemId, itemId) : undefined)
        .orderBy(desc(pricingChangeLogs.createdAt))
        .limit(200);
      res.json(rows.map((r) => ({ ...r.log, itemName: r.itemName, changedByEmail: r.changedByEmail })));
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch pricing history" });
    }
  });

  // --- Billing customers ---
  app.get("/api/admin/billing/customers", requireAdmin, async (_req: any, res) => {
    try {
      const { billingCustomers, students } = await import("@shared/schema");
      const rows = await db.select({
        customer: billingCustomers,
        firstName: students.firstName,
        lastName: students.lastName,
        studentEmail: students.email,
      }).from(billingCustomers)
        .innerJoin(students, eq(billingCustomers.studentId, students.id))
        .orderBy(desc(billingCustomers.updatedAt));
      res.json(rows.map((r) => ({ ...r.customer, firstName: r.firstName, lastName: r.lastName, studentEmail: r.studentEmail })));
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch billing customers" });
    }
  });

  app.put("/api/admin/billing/customers/:id", requireAdmin, async (req: any, res) => {
    try {
      const { billingCustomers } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const allowed = ["billingName", "billingEmail", "billingPhone", "billingAddress", "notes"] as const;
      const updates: Record<string, string | null> = {};
      for (const key of allowed) {
        if (key in req.body) {
          const v = req.body[key];
          if (v !== null && typeof v !== "string") return res.status(400).json({ message: `${key} must be a string` });
          updates[key] = v;
        }
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No valid fields to update" });
      const [updated] = await db.update(billingCustomers)
        .set({ ...updates, syncStatus: "pending", updatedAt: new Date() })
        .where(eq(billingCustomers.id, id)).returning();
      if (!updated) return res.status(404).json({ message: "Billing customer not found" });
      // Keep Stripe in sync via a queued job.
      await enqueueJob({ type: "billing:sync-customer", category: "billing", payload: { studentId: updated.studentId } });
      res.json(updated);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to update billing customer" });
    }
  });

  app.post("/api/admin/billing/customers/:studentId/sync", requireAdmin, async (req: any, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const student = await storage.getStudent(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });
      await ensureBillingCustomer(studentId);
      const job = await enqueueJob({ type: "billing:sync-customer", category: "billing", payload: { studentId } });
      res.status(202).json({ jobId: job.id, message: "Customer sync job enqueued" });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to enqueue customer sync" });
    }
  });

  app.post("/api/admin/billing/customers/sync-all", requireAdmin, async (_req: any, res) => {
    try {
      const job = await enqueueJob({ type: "billing:sync-all-customers", category: "billing" });
      res.status(202).json({ jobId: job.id, message: "Bulk customer sync job enqueued" });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to enqueue bulk sync" });
    }
  });

  // --- Invoices ---
  app.get("/api/admin/billing/invoices", requireAdmin, async (req: any, res) => {
    try {
      const { invoices, students } = await import("@shared/schema");
      const status = req.query.status as string | undefined;
      const rows = await db.select({
        invoice: invoices,
        firstName: students.firstName,
        lastName: students.lastName,
      }).from(invoices)
        .innerJoin(students, eq(invoices.studentId, students.id))
        .where(status && status !== "all" ? eq(invoices.status, status) : undefined)
        .orderBy(desc(invoices.createdAt))
        .limit(500);
      res.json(rows.map((r) => ({ ...r.invoice, studentName: `${r.firstName} ${r.lastName}` })));
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.post("/api/admin/billing/invoices", requireAdmin, async (req: any, res) => {
    try {
      const { invoices } = await import("@shared/schema");
      const { studentId, lineItems, dueDate, description, notes } = req.body;
      if (!studentId || !Number.isInteger(studentId)) return res.status(400).json({ message: "studentId is required" });
      const student = await storage.getStudent(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });
      if (!Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ message: "At least one line item is required" });
      }
      for (const li of lineItems) {
        if (!li.description || typeof li.description !== "string") return res.status(400).json({ message: "Each line item needs a description" });
        const qty = Number(li.quantity), unit = parseFloat(li.unitAmount);
        if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return res.status(400).json({ message: "Line item quantity must be an integer between 1 and 1000" });
        if (!isFinite(unit) || unit < 0 || unit > 100000) return res.status(400).json({ message: "Line item unit amount must be between 0 and 100,000" });
      }
      if (dueDate !== undefined && dueDate !== null && dueDate !== "" && isNaN(new Date(dueDate).getTime())) {
        return res.status(400).json({ message: "dueDate must be a valid date" });
      }
      const rates = await getTaxRates();
      const totals = computeInvoiceTotals(lineItems, rates);
      if (parseFloat(totals.total) <= 0) return res.status(400).json({ message: "Invoice total must be greater than zero" });
      await ensureBillingCustomer(studentId);
      const invoice = await createInvoiceWithNumber({
        studentId,
        amount: totals.total,
        subtotal: totals.subtotal,
        gst: totals.gst,
        qst: totals.qst,
        lineItems,
        dueDate: dueDate || null,
        status: "draft",
        description: description || lineItems.map((li: any) => li.description).join(", "),
        notes: notes || null,
        createdBy: req.user?.id ?? null,
      });
      res.status(201).json(invoice);
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating invoice:", error);
      res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  app.post("/api/admin/billing/invoices/:id/submit", requireAdmin, async (req: any, res) => {
    try {
      const { invoices } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const method = req.body?.method === "email" ? "email" : "charge_card";
      const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      // Atomically claim the transition to "submitted" so a double-click or a
      // concurrent submit cannot enqueue two jobs for the same invoice.
      const { inArray } = await import("drizzle-orm");
      const [claimed] = await db.update(invoices)
        .set({ status: "submitted", submissionMethod: method, updatedAt: new Date() })
        .where(and(eq(invoices.id, id), inArray(invoices.status, ["draft", "failed", "unpaid", "overdue"])))
        .returning();
      if (!claimed) {
        return res.status(409).json({ message: `Invoice cannot be submitted from status "${invoice.status}"` });
      }
      const job = await enqueueJob({ type: "billing:submit-invoice", category: "billing", payload: { invoiceId: id, method } });
      res.status(202).json({ jobId: job.id, message: `Invoice submission job enqueued (${method})` });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to enqueue invoice submission" });
    }
  });

  app.post("/api/admin/billing/invoices/:id/void", requireAdmin, async (req: any, res) => {
    try {
      const { invoices } = await import("@shared/schema");
      const id = parseInt(req.params.id);
      const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (invoice.status === "paid") return res.status(409).json({ message: "Paid invoices cannot be voided" });
      if (invoice.status === "void") return res.status(409).json({ message: "Invoice is already void" });
      if (invoice.status === "charging") {
        // A pending 3DS flow holds the claim with a persisted PaymentIntent.
        // Void is allowed only if we can cancel that intent first; a charge job
        // mid-flight (no intent yet, or an uncancellable one) blocks the void.
        if (invoice.stripePaymentIntentId && stripe) {
          const pi = await stripe.paymentIntents.retrieve(invoice.stripePaymentIntentId);
          if (pi.status === "succeeded") return res.status(409).json({ message: "This invoice was just charged — it cannot be voided" });
          if (pi.status !== "canceled") {
            try {
              await stripe.paymentIntents.cancel(pi.id);
            } catch {
              return res.status(409).json({ message: "A charge is in progress — try again shortly" });
            }
          }
          // Intent is dead — void conditionally on the exact claim we cancelled.
          const [voided] = await db.update(invoices)
            .set({ status: "void", voidedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(invoices.id, id), eq(invoices.status, "charging"), eq(invoices.stripePaymentIntentId, pi.id)))
            .returning();
          if (!voided) return res.status(409).json({ message: "Invoice state changed — refresh and try again" });
          return res.json(voided);
        } else {
          return res.status(409).json({ message: "A charge is in progress — try again shortly" });
        }
      }
      // Conditional update so a void can never overwrite a concurrent payment or charge.
      const { notInArray } = await import("drizzle-orm");
      const [updated] = await db.update(invoices)
        .set({ status: "void", voidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(invoices.id, id), notInArray(invoices.status, ["paid", "void", "cancelled", "charging"])))
        .returning();
      if (!updated) return res.status(409).json({ message: "Invoice state changed — refresh and try again" });
      res.json(updated);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to void invoice" });
    }
  });

  // --- Reporting ---
  app.get("/api/admin/billing/report", requireAdmin, async (req: any, res) => {
    try {
      const report = await computeBillingReport(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
      res.json(report);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to compute billing report" });
    }
  });

  app.get("/api/admin/billing/report.csv", requireAdmin, async (req: any, res) => {
    try {
      const report = await computeBillingReport(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
      const lines = [
        "Metric,Count,Amount",
        `Revenue (payments),${report.paymentCount},${report.revenue.toFixed(2)}`,
        `Refunds,,${report.refunds.toFixed(2)}`,
        `Net revenue,,${report.netRevenue.toFixed(2)}`,
        `Invoices paid,${report.invoicesPaid},${report.invoicesPaidAmount.toFixed(2)}`,
        `Outstanding invoices,${report.outstandingCount},${report.outstandingAmount.toFixed(2)}`,
        `Failed charges,${report.failedCount},${report.failedAmount.toFixed(2)}`,
        `Aging 0-30 days,${report.aging.current},${report.agingAmounts.current.toFixed(2)}`,
        `Aging 31-60 days,${report.aging.days31to60},${report.agingAmounts.days31to60.toFixed(2)}`,
        `Aging 61-90 days,${report.aging.days61to90},${report.agingAmounts.days61to90.toFixed(2)}`,
        `Aging 90+ days,${report.aging.over90},${report.agingAmounts.over90.toFixed(2)}`,
      ];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="billing-report-${report.startDate}-to-${report.endDate}.csv"`);
      res.send(lines.join("\n"));
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to export billing report" });
    }
  });

  app.post("/api/admin/billing/report-job", requireAdmin, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.body || {};
      for (const d of [startDate, endDate]) {
        if (d !== undefined && d !== null && d !== "" && isNaN(new Date(d).getTime())) {
          return res.status(400).json({ message: "Dates must be valid" });
        }
      }
      const job = await enqueueJob({ type: "billing:report", category: "billing", payload: { startDate, endDate } });
      res.status(202).json({ jobId: job.id, message: "Report job enqueued — output will appear in Job Control" });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to enqueue report job" });
    }
  });

  // --- Student: view & pay invoices in-app ---
  app.get("/api/student/billing/invoices", isStudentAuthenticated, async (req: any, res) => {
    try {
      const { invoices } = await import("@shared/schema");
      const rows = await db.select().from(invoices)
        .where(eq(invoices.studentId, req.student.id))
        .orderBy(desc(invoices.createdAt));
      // Students never see drafts.
      res.json(rows.filter((i) => i.status !== "draft"));
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.post("/api/student/billing/invoices/:id/pay", isStudentAuthenticated, async (req: any, res) => {
    try {
      if (!stripe) return res.status(500).json({ message: "Payment system is not configured" });
      const { invoices, studentPaymentMethods } = await import("@shared/schema");
      const student = req.student;
      const id = parseInt(req.params.id);
      const [invoice] = await db.select().from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.studentId, student.id)));
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (invoice.status === "paid") return res.status(409).json({ message: "Invoice is already paid" });
      if (invoice.status === "charging") {
        // A claim is live (admin job, another tab, or a pending 3DS flow).
        // Reconcile against the persisted PaymentIntent instead of guessing.
        if (invoice.stripePaymentIntentId) {
          const pi = await stripe.paymentIntents.retrieve(invoice.stripePaymentIntentId);
          if (pi.status === "succeeded") {
            const outcome = await recordInvoicePayment(invoice, pi.id, null);
            if (outcome === "voided") {
              await refundVoidedInvoiceCharge(invoice, pi.id);
              return res.status(409).json({ message: "This invoice was voided — your payment has been refunded" });
            }
            return res.json({ status: "paid", invoiceId: invoice.id });
          }
          if (pi.status === "requires_action") {
            return res.status(202).json({ status: "requires_action", clientSecret: pi.client_secret, paymentIntentId: pi.id });
          }
          if (["canceled", "requires_payment_method"].includes(pi.status)) {
            // Dead intent from an abandoned/failed attempt — release the claim.
            await db.update(invoices).set({ status: "failed", failureReason: `Previous payment attempt ${pi.status}`, updatedAt: new Date() })
              .where(and(eq(invoices.id, id), eq(invoices.status, "charging")));
            return res.status(409).json({ message: "Previous payment attempt expired — please try again" });
          }
        }
        return res.status(409).json({ message: "A payment for this invoice is already in progress" });
      }
      if (!["submitted", "failed", "unpaid", "overdue"].includes(invoice.status)) {
        return res.status(409).json({ message: "This invoice cannot be paid right now" });
      }
      const { paymentMethodId } = req.body;
      const methods = await db.select().from(studentPaymentMethods).where(eq(studentPaymentMethods.studentId, student.id));
      const card = paymentMethodId ? methods.find((m) => m.id === paymentMethodId) : (methods.find((m) => m.isDefault) || methods[0]);
      if (!card) return res.status(400).json({ message: "No saved payment method — please add a card first" });

      // Atomically claim the invoice ("charging") so an admin charge job or a
      // duplicate click cannot charge it at the same time.
      const { inArray: inArr } = await import("drizzle-orm");
      const [claimed] = await db.update(invoices)
        .set({ status: "charging", updatedAt: new Date() })
        .where(and(eq(invoices.id, id), inArr(invoices.status, ["submitted", "failed", "unpaid", "overdue"])))
        .returning();
      if (!claimed) return res.status(409).json({ message: "Invoice state changed — refresh and try again" });

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(parseFloat(invoice.amount) * 100),
          currency: "cad",
          customer: student.stripeCustomerId || undefined,
          payment_method: card.stripePaymentMethodId,
          confirm: true,
          description: `Invoice ${invoice.invoiceNumber}: ${invoice.description}`,
          metadata: { invoiceId: String(invoice.id), studentId: String(student.id), purpose: "invoice" },
          return_url: `${process.env.APP_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000')}/student/billing`,
        }, { idempotencyKey: `invoice-pay-${invoice.id}-${claimed.updatedAt?.getTime() ?? Date.now()}` });

        if (paymentIntent.status === "requires_action") {
          // Keep the "charging" claim alive during 3DS so a void cannot race
          // the pending authorization; persist the intent so /confirm, retries,
          // and void can all reconcile against it.
          await db.update(invoices).set({ stripePaymentIntentId: paymentIntent.id, updatedAt: new Date() })
            .where(and(eq(invoices.id, id), eq(invoices.status, "charging")));
          return res.status(202).json({ status: "requires_action", clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
        }
        if (paymentIntent.status !== "succeeded") {
          await db.update(invoices).set({ status: "failed", failureReason: paymentIntent.last_payment_error?.message || paymentIntent.status, updatedAt: new Date() })
            .where(and(eq(invoices.id, id), eq(invoices.status, "charging")));
          return res.status(400).json({ message: "Payment failed", status: paymentIntent.status, details: paymentIntent.last_payment_error?.message });
        }
        const outcome = await recordInvoicePayment(claimed, paymentIntent.id, card.cardBrand);
        if (outcome === "voided") {
          await refundVoidedInvoiceCharge(claimed, paymentIntent.id);
          return res.status(409).json({ message: "This invoice was voided — your payment has been refunded" });
        }
        res.json({ status: "paid", invoiceId: invoice.id });
      } catch (chargeError: any) {
        await db.update(invoices).set({ status: "failed", failureReason: chargeError?.message || String(chargeError), updatedAt: new Date() })
          .where(and(eq(invoices.id, id), eq(invoices.status, "charging")));
        throw chargeError;
      }
    } catch (error: any) {
      captureRequestError(error);
      console.error("Error paying invoice:", error);
      if (error.type === "StripeCardError") return res.status(400).json({ message: error.message || "Card declined" });
      res.status(500).json({ message: error.message || "Failed to pay invoice" });
    }
  });

  app.post("/api/student/billing/invoices/:id/confirm", isStudentAuthenticated, async (req: any, res) => {
    try {
      if (!stripe) return res.status(500).json({ message: "Payment system is not configured" });
      const { invoices } = await import("@shared/schema");
      const student = req.student;
      const id = parseInt(req.params.id);
      const { paymentIntentId } = req.body;
      if (!paymentIntentId) return res.status(400).json({ message: "paymentIntentId is required" });
      const [invoice] = await db.select().from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.studentId, student.id)));
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (invoice.status === "paid") return res.json({ status: "paid", invoiceId: invoice.id });
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (paymentIntent.metadata.invoiceId !== String(invoice.id) || paymentIntent.metadata.studentId !== String(student.id)) {
        return res.status(403).json({ message: "Payment does not belong to this invoice" });
      }
      if (invoice.status === "void" || invoice.status === "cancelled") {
        // Void raced the 3DS flow: if the charge went through, refund it now.
        if (paymentIntent.status === "succeeded") {
          await refundVoidedInvoiceCharge(invoice, paymentIntent.id);
          return res.status(409).json({ message: "This invoice was voided — your payment has been refunded" });
        }
        return res.status(409).json({ message: "This invoice was voided — no payment was taken" });
      }
      if (paymentIntent.status !== "succeeded") {
        return res.status(400).json({ message: "Payment not yet completed", status: paymentIntent.status });
      }
      const methods = await storage.getStudentPaymentMethods(student.id);
      const card = methods.find((m: any) => m.stripePaymentMethodId === paymentIntent.payment_method) || null;
      const outcome = await recordInvoicePayment(invoice, paymentIntent.id, card?.cardBrand ?? null);
      if (outcome === "voided") {
        await refundVoidedInvoiceCharge(invoice, paymentIntent.id);
        return res.status(409).json({ message: "This invoice was voided — your payment has been refunded" });
      }
      res.json({ status: "paid", invoiceId: invoice.id });
    } catch (error: any) {
      captureRequestError(error);
      res.status(500).json({ message: error.message || "Failed to confirm invoice payment" });
    }
  });

  // Attendance Audit Logs - Admin/owner review of attendance & completion actions
  app.get("/api/attendance-audit-logs", requireAdmin, async (req: any, res) => {
    try {
      const { instructorId, classId, startDate, endDate, outcome, action } = req.query;
      const filters: any = {};
      if (instructorId) filters.instructorId = parseInt(instructorId as string);
      if (classId) filters.classId = parseInt(classId as string);
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      if (outcome) filters.outcome = outcome;
      if (action) filters.action = action;

      const logs = await storage.getAttendanceAuditLogs(Object.keys(filters).length > 0 ? filters : undefined);

      // Enrich logs with student and class details
      const enrichedLogs = await Promise.all(logs.map(async (log) => {
        const student = log.studentId ? await storage.getStudent(log.studentId) : null;
        const classData = log.classId ? await storage.getClass(log.classId) : null;
        return {
          ...log,
          studentName: student ? `${student.firstName} ${student.lastName}` : null,
          classInfo: classData ? `${classData.date} ${classData.time} - ${classData.courseType} #${classData.classNumber}` : null,
        };
      }));

      res.json(enrichedLogs);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching attendance audit logs:", error);
      res.status(500).json({ message: "Failed to fetch attendance audit logs" });
    }
  });

  // User permissions routes - Check if user can override booking policies
  app.get("/api/users/:id/can-override-policies", authMiddleware, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({ 
        canOverride: user.canOverrideBookingPolicies || user.role === 'admin',
        role: user.role 
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error checking user permissions:", error);
      res.status(500).json({ message: "Failed to check user permissions" });
    }
  });

  // All other routes now require authentication
  // Students routes
  app.get("/api/students", authMiddleware, async (req, res) => {
    try {
      // If no search parameters provided, return recent students
      const {
        searchTerm,
        courseType,
        status,
        locationId,
        phoneNumber,
        attestationNumber,
        contractNumber,
        dateOfBirth,
        enrollmentDate,
        isTransfer,
        limit = 10,
        offset = 0,
      } = req.query;

      // Convert string query parameters to appropriate types
      const searchParams = {
        searchTerm: searchTerm as string | undefined,
        courseType: courseType as string | undefined,
        status: status as string | undefined,
        locationId: locationId ? parseInt(locationId as string) : undefined,
        phoneNumber: phoneNumber as string | undefined,
        attestationNumber: attestationNumber as string | undefined,
        contractNumber: contractNumber as string | undefined,
        dateOfBirth: dateOfBirth as string | undefined,
        enrollmentDate: enrollmentDate as string | undefined,
        isTransfer: isTransfer === 'true' ? true : undefined,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      };

      const result = await storage.searchStudents(searchParams);
      // Return the full result object with students array and total count
      res.json(result);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching students:", error);
      res.status(500).json({ message: "Failed to fetch students" });
    }
  });

  app.get("/api/students/stats", authMiddleware, async (_req, res) => {
    try {
      const activeCount = await storage.getStudentCountByStatus("active");
      res.json({ activeCount });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student stats:", error);
      res.status(500).json({ message: "Failed to fetch student stats" });
    }
  });

  app.get("/api/students/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const student = await storage.getStudent(id);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      const hoursMap = await storage.getStudentsAttendedHours([student.id]);
      const hours = hoursMap.get(student.id);
      const theoryHoursCompleted = hours ? Math.round(hours.theoryHours * 10) / 10 : 0;
      const practicalHoursCompleted = hours ? Math.round(hours.drivingHours * 10) / 10 : 0;
      res.json({
        ...student,
        theoryHoursCompleted,
        practicalHoursCompleted,
        totalHoursCompleted: Math.round((theoryHoursCompleted + practicalHoursCompleted) * 10) / 10,
      });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch student" });
    }
  });

  const restrictedPhaseTimingOverrideFields = [1, 2, 3, 4].flatMap((phase) => [
    `phase${phase}TimingAdvanceDays`,
    `phase${phase}TimingOverrideReason`,
    `phase${phase}TimingOverrideSetAt`,
    `phase${phase}TimingOverrideSetBy`,
  ]);

  app.post("/api/students", authMiddleware, async (req, res) => {
    try {
      const attemptedRestrictedFields = restrictedPhaseTimingOverrideFields.filter(
        (field) => Object.prototype.hasOwnProperty.call(req.body, field),
      );
      if (attemptedRestrictedFields.length > 0) {
        return res.status(403).json({
          message: "Phase timing overrides must be set through the admin-only override control after the student is created.",
        });
      }
      const studentData = insertStudentSchema.parse(req.body);
      const student = await storage.createStudent(studentData);
      
      // Auto-generate contract from template
      try {
        const template = await storage.getContractTemplateByType(student.courseType);
        if (template) {
          const today = new Date().toISOString().split('T')[0];
          const contractNumber = `CNT-${Date.now()}-${student.id}`;
          
          await storage.createContract({
            studentId: student.id,
            templateId: template.id,
            courseType: student.courseType,
            contractDate: today,
            amount: template.baseAmount,
            paymentMethod: template.defaultPaymentMethod || 'installment',
            status: 'pending',
            autoGenerated: true,
            contractNumber: contractNumber,
          });
        }
      } catch (contractError) {
        captureRequestError(contractError);
        console.error("Contract auto-generation failed:", contractError);
        // Don't fail student creation if contract generation fails
      }
      
      res.status(201).json(student);
    } catch (error) {
      captureRequestError(error);
      console.error("Student creation error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      res.status(400).json({ message: "Invalid student data" });
    }
  });

  app.put("/api/students/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const attemptedRestrictedFields = restrictedPhaseTimingOverrideFields.filter(
        (field) => Object.prototype.hasOwnProperty.call(req.body, field),
      );
      if (attemptedRestrictedFields.length > 0) {
        return res.status(403).json({
          message: "Phase timing overrides must be changed through the admin-only override control.",
        });
      }
      const updateData = req.body;
      const student = await storage.updateStudent(id, updateData);
      res.json(student);
    } catch (error) {
      captureRequestError(error);
      console.error("Student update error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      res.status(400).json({ message: "Failed to update student" });
    }
  });

  const phaseTimingOverrideSchema = z.object({
    phase: z.number().int().min(1).max(4),
    advanceDays: z.number().int().min(0).max(365),
    reason: z.string().trim().min(3).max(500),
  });

  const updatePhaseTimingOverride = async (req: any, res: any) => {
    try {
      const studentId = parseInt(req.params.id);
      if (!Number.isInteger(studentId)) {
        return res.status(400).json({ message: "Invalid student ID." });
      }

      const { phase, advanceDays, reason } = phaseTimingOverrideSchema.parse(req.body);
      const existing = await storage.getStudent(studentId);
      if (!existing) {
        return res.status(404).json({ message: "Student not found." });
      }
      if ((existing.courseType || "").toLowerCase() !== "auto") {
        return res.status(400).json({
          message: `The Phase ${phase} elapsed-day override is only available for Auto students.`,
        });
      }

      const student = await db.transaction(async (tx) => {
        const phaseFields = {
          1: {
            advanceColumn: students.phase1TimingAdvanceDays,
            update: {
              phase1TimingAdvanceDays: advanceDays,
              phase1TimingOverrideReason: advanceDays > 0 ? reason : null,
              phase1TimingOverrideSetAt: new Date(),
              phase1TimingOverrideSetBy: req.user.id,
            },
          },
          2: {
            advanceColumn: students.phase2TimingAdvanceDays,
            update: {
              phase2TimingAdvanceDays: advanceDays,
              phase2TimingOverrideReason: advanceDays > 0 ? reason : null,
              phase2TimingOverrideSetAt: new Date(),
              phase2TimingOverrideSetBy: req.user.id,
            },
          },
          3: {
            advanceColumn: students.phase3TimingAdvanceDays,
            update: {
              phase3TimingAdvanceDays: advanceDays,
              phase3TimingOverrideReason: advanceDays > 0 ? reason : null,
              phase3TimingOverrideSetAt: new Date(),
              phase3TimingOverrideSetBy: req.user.id,
            },
          },
          4: {
            advanceColumn: students.phase4TimingAdvanceDays,
            update: {
              phase4TimingAdvanceDays: advanceDays,
              phase4TimingOverrideReason: advanceDays > 0 ? reason : null,
              phase4TimingOverrideSetAt: new Date(),
              phase4TimingOverrideSetBy: req.user.id,
            },
          },
        } as const;
        const fields = phaseFields[phase as 1 | 2 | 3 | 4];
        const [lockedStudent] = await tx
          .select({
            courseType: students.courseType,
            advanceDays: fields.advanceColumn,
          })
          .from(students)
          .where(eq(students.id, studentId))
          .for("update");

        if (!lockedStudent) {
          throw new Error(`Student disappeared while locking the Phase ${phase} timing override.`);
        }
        if ((lockedStudent.courseType || "").toLowerCase() !== "auto") {
          const error: any = new Error(`The Phase ${phase} elapsed-day override is only available for Auto students.`);
          error.statusCode = 400;
          throw error;
        }
        const previousDays = lockedStudent.advanceDays ?? 0;

        const [updatedStudent] = await tx
          .update(students)
          .set(fields.update)
          .where(eq(students.id, studentId))
          .returning();

        if (!updatedStudent) {
          throw new Error(`Student disappeared while updating the Phase ${phase} timing override.`);
        }

        await tx.insert(policyOverrideLogs).values({
          staffUserId: req.user.id,
          actionType: advanceDays > 0 ? "set" : "clear",
          policyType: `phase${phase}_timing`,
          reason,
          studentId,
          classId: null,
          enrollmentId: null,
          originalValue: `${previousDays} day(s)`,
          overriddenValue: `${advanceDays} day(s)`,
          notificationSent: false,
          notificationRecipients: null,
        });

        return updatedStudent;
      });

      res.json(student);
    } catch (error: any) {
      captureRequestError(error);
      if (error?.name === "ZodError") {
        return res.status(400).json({
          message: "Phase must be 1 through 4, advance days must be a whole number from 0 to 365, and a reason of at least 3 characters is required.",
          errors: error.errors,
        });
      }
      console.error("Phase timing override update error:", error);
      res.status(error?.statusCode || 500).json({
        message: error?.statusCode
          ? error.message
          : "Failed to update the phase timing override.",
      });
    }
  };

  app.put("/api/students/:id/phase-timing-override", requireAdmin, updatePhaseTimingOverride);
  // Backward-compatible Phase 1 route for any older admin client still open.
  app.put("/api/students/:id/phase1-timing-override", requireAdmin, (req: any, res) => {
    req.body = { ...req.body, phase: 1 };
    return updatePhaseTimingOverride(req, res);
  });

  app.delete("/api/students/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteStudent(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to delete student" });
    }
  });

  app.post("/api/students/bulk-delete", authMiddleware, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "No student IDs provided" });
      }
      
      let deletedCount = 0;
      for (const id of ids) {
        try {
          await storage.deleteStudent(parseInt(id));
          deletedCount++;
        } catch (error) {
          captureRequestError(error);
          console.error(`Failed to delete student ${id}:`, error);
        }
      }
      
      res.json({ deletedCount, totalRequested: ids.length });
    } catch (error) {
      captureRequestError(error);
      console.error("Bulk delete error:", error);
      res.status(500).json({ message: "Failed to delete students" });
    }
  });

  // Admin: Get lesson notes for a specific student
  app.get("/api/students/:id/lesson-notes", authMiddleware, async (req, res) => {
    try {
      const studentId = parseInt(req.params.id);
      const notes = await storage.getLessonNotesByStudent(studentId);
      res.json(notes);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student lesson notes:", error);
      res.status(500).json({ message: "Failed to fetch lesson notes" });
    }
  });

  // Student Notes - Get notes for a student (admin/instructor)
  app.get("/api/students/:id/phase-progress", async (req: any, res) => {
    try {
      const studentId = parseInt(req.params.id);
      const userId = req.session?.userId;
      const instructorId = req.session?.instructorId;
      
      if (!userId && !instructorId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const phaseProgress = await buildPhaseProgress(studentId);
      res.json(phaseProgress);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student phase progress:", error);
      res.status(500).json({ message: "Failed to fetch phase progress" });
    }
  });

  app.get("/api/students/:id/notes", async (req: any, res) => {
    try {
      const studentId = parseInt(req.params.id);
      const userId = req.session?.userId;
      const instructorId = req.session?.instructorId;
      
      if (!userId && !instructorId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const noteType = req.query.type as string | undefined;
      const notes = await storage.getStudentNotes(studentId, noteType);
      res.json(notes);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student notes:", error);
      res.status(500).json({ message: "Failed to fetch student notes" });
    }
  });

  // Student Notes - Create a note
  app.post("/api/students/:id/notes", async (req: any, res) => {
    try {
      const studentId = parseInt(req.params.id);
      const userId = req.session?.userId;
      const instructorId = req.session?.instructorId;
      
      if (!userId && !instructorId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { noteType, content } = req.body;
      if (!noteType || !content) {
        return res.status(400).json({ message: "noteType and content are required" });
      }
      if (!['internal', 'student_visible'].includes(noteType)) {
        return res.status(400).json({ message: "noteType must be 'internal' or 'student_visible'" });
      }

      let authorId: string;
      let authorName: string;
      let authorRole: string;

      if (userId) {
        const user = await storage.getUser(userId);
        if (!user) return res.status(401).json({ message: "User not found" });
        authorId = String(user.id);
        authorName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Admin';
        authorRole = (user as any).role || 'admin';
      } else {
        const instructor = await storage.getInstructor(instructorId);
        if (!instructor) return res.status(401).json({ message: "Instructor not found" });
        authorId = `instructor_${instructor.id}`;
        authorName = `${instructor.firstName} ${instructor.lastName}`;
        authorRole = 'instructor';
      }

      const note = await storage.createStudentNote({
        studentId,
        authorId,
        authorName,
        authorRole,
        noteType,
        content,
      });
      res.status(201).json(note);
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating student note:", error);
      res.status(500).json({ message: "Failed to create student note" });
    }
  });

  // Student Notes - Delete a note
  app.delete("/api/students/:id/notes/:noteId", async (req: any, res) => {
    try {
      const noteId = parseInt(req.params.noteId);
      const userId = req.session?.userId;
      const instructorId = req.session?.instructorId;
      
      if (!userId && !instructorId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (userId) {
        const user = await storage.getUser(userId);
        const userRole = (user as any)?.role;
        if (userRole === 'admin' || userRole === 'owner') {
          await storage.deleteStudentNote(noteId);
          return res.status(204).send();
        }
      }

      const allNotes = await storage.getStudentNotes(parseInt(req.params.id));
      const note = allNotes.find(n => n.id === noteId);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }

      const currentAuthorId = userId
        ? String(userId)
        : `instructor_${instructorId}`;

      if (note.authorId === currentAuthorId) {
        await storage.deleteStudentNote(noteId);
        return res.status(204).send();
      }

      return res.status(403).json({ message: "You can only delete your own notes" });
    } catch (error) {
      captureRequestError(error);
      console.error("Error deleting student note:", error);
      res.status(500).json({ message: "Failed to delete student note" });
    }
  });

  // Student Portal - Get student-visible notes
  app.get("/api/student-portal/notes", async (req: any, res) => {
    try {
      const studentId = req.session?.studentId;
      if (!studentId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const notes = await storage.getStudentNotes(studentId, 'student_visible');
      res.json(notes);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student portal notes:", error);
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  // Student Course Enrollments - Allows students to enroll in multiple courses
  app.get("/api/students/:id/courses", authMiddleware, async (req, res) => {
    try {
      const studentId = parseInt(req.params.id);
      const courses = await storage.getStudentCourses(studentId);
      res.json(courses);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student courses:", error);
      res.status(500).json({ message: "Failed to fetch student courses" });
    }
  });

  // Admin: Get parents linked to a student
  app.get("/api/student/:id/parents", authMiddleware, async (req, res) => {
    try {
      const studentId = parseInt(req.params.id);
      const parents = await storage.getStudentParents(studentId);
      res.json(parents);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student parents:", error);
      res.status(500).json({ message: "Failed to fetch student parents" });
    }
  });

  // Admin: Get parent by ID
  app.get("/api/parents/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parent = await storage.getParent(id);
      if (!parent) {
        return res.status(404).json({ message: "Parent not found" });
      }
      res.json(parent);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching parent:", error);
      res.status(500).json({ message: "Failed to fetch parent" });
    }
  });

  app.post("/api/students/:id/courses", authMiddleware, async (req, res) => {
    try {
      const studentId = parseInt(req.params.id);
      const courseData = { ...req.body, studentId };
      const course = await storage.createStudentCourse(courseData);
      res.status(201).json(course);
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating student course:", error);
      res.status(400).json({ message: "Failed to create student course" });
    }
  });

  app.put("/api/student-courses/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const course = await storage.updateStudentCourse(id, req.body);
      res.json(course);
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating student course:", error);
      res.status(400).json({ message: "Failed to update student course" });
    }
  });

  app.delete("/api/student-courses/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteStudentCourse(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      console.error("Error deleting student course:", error);
      res.status(500).json({ message: "Failed to delete student course" });
    }
  });

  // Admin: Get all students with their courses and parent/guardian info
  app.get("/api/students-full", authMiddleware, async (req, res) => {
    try {
      const allStudents = await storage.getStudents();
      
      // For each student, get their courses and parent relationships
      const studentsWithDetails = await Promise.all(
        allStudents.map(async (student) => {
          const courses = await storage.getStudentCourses(student.id);
          const parentRelationships = await storage.getStudentParents(student.id);
          
          // Get full parent details for each relationship
          const parentsWithDetails = await Promise.all(
            parentRelationships.map(async (rel) => {
              const parent = await storage.getParent(rel.parentId);
              return {
                ...rel,
                parent
              };
            })
          );
          
          return {
            ...student,
            courses,
            parents: parentsWithDetails
          };
        })
      );
      
      res.json(studentsWithDetails);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching students with details:", error);
      res.status(500).json({ message: "Failed to fetch students" });
    }
  });

  // Instructors routes
  app.get("/api/instructors", authMiddleware, async (req, res) => {
    try {
      const instructors = await storage.getInstructors();
      res.json(instructors);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch instructors" });
    }
  });

  app.get("/api/instructors/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const instructor = await storage.getInstructor(id);
      if (!instructor) {
        return res.status(404).json({ message: "Instructor not found" });
      }
      res.json(instructor);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch instructor" });
    }
  });

  app.post("/api/instructors", authMiddleware, async (req, res) => {
    try {
      const instructorData = insertInstructorSchema.parse(req.body);

      // Generate invite token and expiry
      const inviteToken = generateInviteToken();
      const inviteExpiry = getInviteExpiry();

      // Create instructor with invite fields
      const instructor = await storage.createInstructor({
        ...instructorData,
        inviteToken,
        inviteExpiry,
        accountStatus: "pending_invite",
        inviteSentAt: new Date(),
      });

      // Send invite email asynchronously (don't wait for it)
      sendInstructorInviteEmail(
        instructor.email,
        instructor.firstName,
        inviteToken,
      ).catch((error) => {
        console.error("Failed to send invite email:", error);
        // Don't fail the request if email fails
      });

      res.status(201).json(instructor);
    } catch (error: any) {
      captureRequestError(error);
      console.error("Instructor creation error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err: any) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      // Handle PostgreSQL unique constraint violations
      if (error.code === "23505") {
        const detail = error.detail || "";
        if (detail.includes("email")) {
          return res.status(400).json({ message: "An instructor with this email address already exists. Please use a different email." });
        }
        return res.status(400).json({ message: "An instructor with these details already exists in the system." });
      }
      res.status(500).json({ message: "Failed to create instructor. Please try again." });
    }
  });

  app.put("/api/instructors/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log("Updating instructor", id, "with data:", req.body);

      // Parse and validate the update data using the same schema as create
      const updateData = insertInstructorSchema.partial().parse(req.body);
      console.log("Validated update data:", updateData);

      const instructor = await storage.updateInstructor(id, updateData);
      console.log("Updated instructor result:", instructor);
      res.json(instructor);
    } catch (error: any) {
      captureRequestError(error);
      console.error("Instructor update error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err: any) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      if (error.code === "23505") {
        const detail = error.detail || "";
        if (detail.includes("email")) {
          return res.status(400).json({ message: "An instructor with this email address already exists." });
        }
        return res.status(400).json({ message: "An instructor with these details already exists in the system." });
      }
      res.status(500).json({ message: "Failed to update instructor. Please try again." });
    }
  });

  app.delete("/api/instructors/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Wrap all operations in a transaction for data integrity
      await db.transaction(async (tx) => {
        // 1. Unassign instructor from all classes (set instructor_id to null)
        await tx
          .update(classes)
          .set({ instructorId: null })
          .where(eq(classes.instructorId, id));

        // 2. Unassign instructor from all students (set instructor_id to null)
        await tx
          .update(students)
          .set({ instructorId: null })
          .where(eq(students.instructorId, id));

        // 3. Remove instructor as favorite from all students (set favorite_instructor_id to null)
        await tx
          .update(students)
          .set({ favoriteInstructorId: null })
          .where(eq(students.favoriteInstructorId, id));

        // 4. Delete all evaluations for this instructor
        await tx.delete(evaluations).where(eq(evaluations.instructorId, id));

        // 5. Delete all availability schedules for this instructor
        await tx
          .delete(instructorAvailability)
          .where(eq(instructorAvailability.instructorId, id));

        // 6. Delete all lesson records for this instructor
        await tx
          .delete(lessonRecords)
          .where(eq(lessonRecords.instructorId, id));

        // 7. Finally, delete the instructor
        await tx.delete(instructors).where(eq(instructors.id, id));
      });

      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      console.error("Error deleting instructor:", error);
      res.status(500).json({ message: "Failed to delete instructor" });
    }
  });

  // Get instructor hours with optional filtering
  app.get("/api/instructors/hours", authMiddleware, async (req, res) => {
    try {
      const { instructorId, startDate, endDate } = req.query;

      const params: {
        instructorId?: number;
        startDate?: string;
        endDate?: string;
      } = {};

      if (instructorId) {
        params.instructorId = parseInt(instructorId as string);
      }
      if (startDate) {
        params.startDate = startDate as string;
      }
      if (endDate) {
        params.endDate = endDate as string;
      }

      const hours = await storage.getInstructorHours(params);
      res.json(hours);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching instructor hours:", error);
      res.status(500).json({ message: "Failed to fetch instructor hours" });
    }
  });

  // Classes routes
  app.get("/api/classes", authMiddleware, async (req, res) => {
    try {
      const allClasses = await storage.getClasses();
      const counts = await db
        .select({
          classId: classEnrollments.classId,
          enrolledCount: count(sql`CASE WHEN ${classEnrollments.cancelledAt} IS NULL THEN 1 END`),
          historicalCount: count(classEnrollments.id),
        })
        .from(classEnrollments)
        .groupBy(classEnrollments.classId);
      const countMap = new Map(counts.map(c => [c.classId, { enrolled: Number(c.enrolledCount), historical: Number(c.historicalCount) }]));
      res.json(allClasses.map(c => ({
        ...c,
        enrolledCount: countMap.get(c.id)?.enrolled ?? 0,
        historicalEnrollmentCount: countMap.get(c.id)?.historical ?? 0,
      })));
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch classes" });
    }
  });

  // Get all change requests (classes with change_requested status)
  app.get("/api/change-requests", authMiddleware, async (req, res) => {
    try {
      const allClasses = await storage.getClasses();
      const changeRequests = allClasses.filter(
        (c) => c.confirmationStatus === 'change_requested'
      );
      res.json(changeRequests);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch change requests" });
    }
  });

  app.get("/api/classes/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const classData = await storage.getClass(id);
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      res.json(classData);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch class" });
    }
  });

  const virtualSplitSchema = z.object({
    parts: z.array(z.object({
      instructorId: z.number().int().positive(),
      zoomLink: z.string().trim().url().refine(link => /^https:\/\//i.test(link), "Zoom links must use HTTPS"),
    })).min(2),
  });

  app.post("/api/admin/classes/:id/split-virtual", requireAdmin, async (req: any, res) => {
    try {
      const classId = Number(req.params.id);
      if (!Number.isInteger(classId) || classId < 1) {
        return res.status(400).json({ message: "Invalid class id" });
      }
      const input = virtualSplitSchema.parse(req.body);
      const classData = await storage.getClass(classId);
      if (!classData) return res.status(404).json({ message: "Class not found" });
      if (!classData.zoomLink?.trim()) {
        return res.status(400).json({ message: "Only virtual classes with a Zoom link can be split." });
      }
      if (classData.sessionGroupId) {
        return res.status(409).json({ message: "This class has already been split into a session group." });
      }
      const enrollments = await storage.getClassEnrollmentsByClass(classId);
      const distribution = splitVirtualEnrollment(enrollments.length);
      if (distribution.classCount < 2) {
        return res.status(400).json({ message: `This class has ${enrollments.length} students and does not exceed the ${VIRTUAL_CLASS_MAX_STUDENTS}-student virtual limit.` });
      }
      if (input.parts.length !== distribution.classCount) {
        return res.status(400).json({
          message: `This roster requires exactly ${distribution.classCount} classes (${distribution.studentCounts.join("/")}).`,
        });
      }
      const instructorIds = input.parts.map(part => part.instructorId);
      if (new Set(instructorIds).size !== instructorIds.length) {
        return res.status(400).json({ message: "Choose a different instructor for each split class." });
      }
      const assignedInstructors = await Promise.all(instructorIds.map(id => storage.getInstructor(id)));
      if (assignedInstructors.some(instructor => !instructor || instructor.status !== "active")) {
        return res.status(400).json({ message: "Every split class must use an active instructor." });
      }
      const normalizedLinks = input.parts.map(part => part.zoomLink.trim().toLowerCase());
      if (new Set(normalizedLinks).size !== normalizedLinks.length) {
        return res.status(400).json({ message: "Enter a different Zoom link for each split class." });
      }
      const violations = (await Promise.all(input.parts.map(part =>
        checkInstructorAvailability(part.instructorId, classData.date, classData.time, classData.duration)
      ))).filter((violation): violation is NonNullable<typeof violation> => !!violation);
      if (violations.length > 0) {
        return res.status(409).json({
          message: "One or more instructors are unavailable for this session.",
          availabilityViolations: violations.map(violation => violation.message),
        });
      }

      const sessionGroupId = randomUUID();
      const result = await db.transaction(async tx => {
        const [lockedClass] = await tx
          .select()
          .from(classes)
          .where(eq(classes.id, classId))
          .for("update");
        if (!lockedClass) throw new Error("Class not found");
        if (!lockedClass.zoomLink?.trim()) throw new Error("Class is no longer virtual");
        if (lockedClass.sessionGroupId) throw new Error("Class has already been split");

        // Serialize split assignments that use any of these instructors, then
        // re-check active status and overlapping classes inside the same
        // transaction that creates the siblings.
        const lockedInstructors = await tx
          .select()
          .from(instructors)
          .where(inArray(instructors.id, [...instructorIds].sort((a, b) => a - b)))
          .orderBy(instructors.id)
          .for("update");
        if (lockedInstructors.length !== instructorIds.length ||
            lockedInstructors.some(instructor => instructor.status !== "active")) {
          throw new Error("Every split class must use an active instructor");
        }
        const existingInstructorClasses = await tx
          .select({
            id: classes.id,
            instructorId: classes.instructorId,
            time: classes.time,
            duration: classes.duration,
          })
          .from(classes)
          .where(and(
            eq(classes.date, lockedClass.date),
            inArray(classes.instructorId, instructorIds),
            ne(classes.status, "cancelled"),
            ne(classes.id, classId),
          ));
        const toMinutes = (value: string) => {
          const [hours, minutes] = value.split(":").map(Number);
          return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
        };
        const splitStart = toMinutes(lockedClass.time);
        const splitEnd = splitStart === null ? null : splitStart + lockedClass.duration;
        const conflict = existingInstructorClasses.find(existing => {
          const existingStart = toMinutes(existing.time);
          if (splitStart === null || splitEnd === null || existingStart === null) return true;
          const existingEnd = existingStart + existing.duration;
          return splitStart < existingEnd && existingStart < splitEnd;
        });
        if (conflict) {
          const instructor = lockedInstructors.find(row => row.id === conflict.instructorId);
          const name = instructor ? `${instructor.firstName} ${instructor.lastName}` : `Instructor #${conflict.instructorId}`;
          throw new Error(`${name} is already booked for an overlapping class at ${conflict.time}`);
        }

        const lockedEnrollments = await tx
          .select()
          .from(classEnrollments)
          .where(and(eq(classEnrollments.classId, classId), isNull(classEnrollments.cancelledAt)))
          .orderBy(classEnrollments.id)
          .for("update");
        const lockedDistribution = splitVirtualEnrollment(lockedEnrollments.length);
        if (lockedDistribution.classCount !== input.parts.length) {
          throw new Error(`Enrollment changed while splitting; ${lockedEnrollments.length} students now require ${lockedDistribution.classCount} classes`);
        }

        const [firstClass] = await tx
          .update(classes)
          .set({
            instructorId: input.parts[0].instructorId,
            zoomLink: input.parts[0].zoomLink.trim(),
            maxStudents: VIRTUAL_CLASS_MAX_STUDENTS,
            sessionGroupId,
            detachedFromSeries: true,
          })
          .where(eq(classes.id, classId))
          .returning();
        const splitClasses = [firstClass];
        for (let index = 1; index < input.parts.length; index++) {
          const [sibling] = await tx
            .insert(classes)
            .values({
              courseType: lockedClass.courseType,
              classType: lockedClass.classType,
              classNumber: lockedClass.classNumber,
              date: lockedClass.date,
              time: lockedClass.time,
              duration: lockedClass.duration,
              instructorId: input.parts[index].instructorId,
              vehicleId: lockedClass.vehicleId,
              vehicleConfirmed: lockedClass.vehicleConfirmed,
              confirmedAt: lockedClass.confirmedAt,
              room: lockedClass.room,
              maxStudents: VIRTUAL_CLASS_MAX_STUDENTS,
              status: lockedClass.status,
              lessonType: lockedClass.lessonType,
              isExtra: lockedClass.isExtra,
              price: lockedClass.price,
              topic: lockedClass.topic,
              confirmationStatus: lockedClass.confirmationStatus,
              zoomLink: input.parts[index].zoomLink.trim(),
              hasTest: lockedClass.hasTest,
              seriesId: lockedClass.seriesId,
              detachedFromSeries: true,
              sessionGroupId,
            })
            .returning();
          splitClasses.push(sibling);
        }

        const assignments: Array<{ classData: typeof splitClasses[number]; studentIds: number[] }> = [];
        let cursor = 0;
        for (let index = 0; index < splitClasses.length; index++) {
          const assigned = lockedEnrollments.slice(cursor, cursor + lockedDistribution.studentCounts[index]);
          cursor += assigned.length;
          if (index > 0 && assigned.length > 0) {
            await tx
              .update(classEnrollments)
              .set({ classId: splitClasses[index].id })
              .where(inArray(classEnrollments.id, assigned.map(enrollment => enrollment.id)));
          }
          assignments.push({
            classData: splitClasses[index],
            studentIds: assigned.flatMap(enrollment => enrollment.studentId == null ? [] : [enrollment.studentId]),
          });
        }
        return { classes: splitClasses, assignments, distribution: lockedDistribution.studentCounts };
      });

      const triggeredBy = req.user?.id || req.session?.userId || "system";
      for (const assignment of result.assignments) {
        const instructor = assignment.classData.instructorId
          ? await storage.getInstructor(assignment.classData.instructorId)
          : null;
        try {
          await notificationService.notifyVirtualClassSplit({
            studentIds: assignment.studentIds,
            classId: assignment.classData.id,
            classTitle: `${assignment.classData.courseType.toUpperCase()} ${assignment.classData.classType === "driving" ? "Driving" : "Theory"} Class #${assignment.classData.classNumber}`,
            date: assignment.classData.date,
            time: assignment.classData.time,
            zoomLink: assignment.classData.zoomLink!,
            instructorName: instructor ? `${instructor.firstName} ${instructor.lastName}` : "Assigned instructor",
          }, String(triggeredBy));
        } catch (notifyError) {
          captureRequestError(notifyError);
          console.error("Failed to notify student about virtual class split:", notifyError);
        }
      }
      res.status(201).json({
        sessionGroupId,
        distribution: result.distribution,
        classes: result.classes,
      });
    } catch (error) {
      captureRequestError(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues[0]?.message || "Invalid split details" });
      }
      const message = error instanceof Error ? error.message : "Failed to split virtual class";
      const status = /changed while splitting|already been split|already booked/i.test(message) ? 409 : 400;
      res.status(status).json({ message });
    }
  });

  app.post("/api/classes", authMiddleware, async (req, res) => {
    try {
      console.log("Class creation request body:", req.body);
      const classData = insertClassSchema.parse(req.body);
      const configurationError = validateCourseClassConfiguration(classData);
      if (configurationError) {
        return res.status(400).json({ message: configurationError });
      }
      if (classData.zoomLink?.trim() && (classData.maxStudents ?? 15) > VIRTUAL_CLASS_MAX_STUDENTS) {
        return res.status(400).json({ message: `Virtual classes cannot exceed ${VIRTUAL_CLASS_MAX_STUDENTS} students.` });
      }
      console.log("Class data after validation:", classData);
      const availabilityViolation = await checkInstructorAvailability(
        classData.instructorId, classData.date, classData.time, classData.duration,
      );
      if (availabilityViolation) {
        return res.status(409).json({
          message: availabilityViolation.message,
          availabilityViolations: [availabilityViolation.message],
        });
      }
      const newClass = await storage.createClass(classData);
      console.log("Class created successfully:", newClass);
      res.status(201).json(newClass);
    } catch (error) {
      captureRequestError(error);
      console.error("Class creation error:", error);
      if (error instanceof Error) {
        res
          .status(400)
          .json({ message: "Invalid class data", error: error.message });
      } else {
        res.status(400).json({ message: "Invalid class data" });
      }
    }
  });

  // Bulk class generation — creates recurring classes over a date range
  app.post("/api/admin/classes/bulk", authMiddleware, async (req, res) => {
    try {
      const {
        courseType, classType, classNumber, daysOfWeek, time, duration,
        instructorId, maxStudents, lessonType, startDate, endDate, hasTest, zoomLink,
        progressive, motoTrainingStage
      } = req.body;
      if (typeof zoomLink === "string" && zoomLink.trim() && Number(maxStudents) > VIRTUAL_CLASS_MAX_STUDENTS) {
        return res.status(400).json({ message: `Virtual classes cannot exceed ${VIRTUAL_CLASS_MAX_STUDENTS} students.` });
      }

      if (!courseType || !classType || !classNumber || !daysOfWeek?.length || !time || !startDate || !endDate) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const start = new Date(startDate + "T00:00:00");
      const end = new Date(endDate + "T00:00:00");
      if (end < start) return res.status(400).json({ message: "End date must be after start date" });

      const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 366) return res.status(400).json({ message: "Date range cannot exceed 1 year" });

      const dates: string[] = [];
      const cur = new Date(start);
      while (cur <= end) {
        if (daysOfWeek.includes(cur.getDay())) {
          dates.push(cur.toISOString().slice(0, 10));
        }
        cur.setDate(cur.getDate() + 1);
      }

      if (dates.length === 0) return res.status(400).json({ message: "No dates match the selected days of week in this range" });

      // ── Full-curriculum planner (auto course) ────────────────────────────
      // Lays out the entire 4-phase program (Theory 1–12, In-Car 1–15) in the
      // school's recommended order on the selected weekdays, spacing classes
      // so the phase minimums hold: T5 ≥ 28 days after T1, In-Car #4 ≥ 28
      // days after T6, Phase 3 ends ≥ 56 days after T8, In-Car #15 ≥ 56 days
      // after T11. One class per date. Candidate dates extend up to a year
      // from the start date regardless of endDate so the plan always fits.
      if (req.body.fullCurriculum) {
        const fullCourse = (courseType || '').toLowerCase();
        if (fullCourse !== 'auto' && fullCourse !== 'moto') {
          return res.status(400).json({ message: "Full curriculum planning is only available for the auto and moto courses." });
        }
        const candidates = buildCandidateDates(startDate, daysOfWeek);
        const plan = fullCourse === 'moto'
          ? buildMotoCurriculumPlan(parseInt(maxStudents) || 24)
          : buildAutoCurriculumPlan(parseInt(maxStudents) || 24);
        const planResult = scheduleAutoCurriculum(candidates, plan);
        if (!planResult.ok) {
          return res.status(400).json({
            message: "Not enough matching dates within a year to fit the full curriculum with its minimum phase durations. Select more days of the week or an earlier start date.",
          });
        }
        const scheduled = planResult.scheduled;

        // Pre-validate instructor availability (one check per weekday used).
        if (instructorId) {
          const instId = parseInt(instructorId);
          const violations: string[] = [];
          const checkedDays = new Set<number>();
          for (const s of scheduled) {
            const dow = new Date(s.date + "T00:00:00").getDay();
            if (checkedDays.has(dow)) continue;
            checkedDays.add(dow);
            const violation = await checkInstructorAvailability(instId, s.date, time, Math.max(...scheduled.filter(x => new Date(x.date + "T00:00:00").getDay() === dow).map(x => x.duration)));
            if (violation) violations.push(violation.message);
          }
          if (violations.length > 0) {
            return res.status(409).json({
              message: "Schedule falls outside the instructor's availability. No classes were created.",
              availabilityViolations: violations,
              conflicts: violations,
            });
          }

          // Pre-check date/time conflicts with the instructor's existing
          // scheduled classes (e.g. running the generator twice). No partial
          // creation: refuse the whole plan when any date overlaps.
          const planDates = Array.from(new Set(scheduled.map(s => s.date)));
          const existingRows = await db
            .select({ date: classes.date, time: classes.time, duration: classes.duration })
            .from(classes)
            .where(and(
              eq(classes.instructorId, instId),
              ne(classes.status, 'cancelled'),
              inArray(classes.date, planDates),
            ));
          const scheduleConflicts = findCurriculumConflicts(scheduled, time, existingRows);
          if (scheduleConflicts.length > 0) {
            const conflictMessages = scheduleConflicts.map(c =>
              `${c.date}: planned ${c.classType} #${c.classNumber} at ${time} overlaps an existing class at ${c.existing.time} (${c.existing.duration ?? 120} min)`
            );
            return res.status(409).json({
              message: "The instructor already has classes scheduled at these times. No classes were created.",
              scheduleConflicts: conflictMessages,
              conflicts: conflictMessages,
            });
          }
        }

        const curriculumSeriesId = randomUUID();
        const createdPlan = await db.transaction(async (tx) => {
          const created = [];
          for (const s of scheduled) {
            created.push(await storage.createClass({
              courseType,
              classType: s.classType,
              classNumber: s.classNumber,
              date: s.date,
              time,
              duration: s.duration,
              instructorId: instructorId ? parseInt(instructorId) : null,
              maxStudents: s.maxStudents,
              lessonType: lessonType || 'regular',
              status: 'scheduled',
              hasTest: s.hasTest ?? false,
              zoomLink: zoomLink || null,
              seriesId: curriculumSeriesId,
            } as any, tx));
          }
          return created;
        });
        return res.status(201).json({
          message: `Created the full ${courseType} curriculum: ${createdPlan.length} classes from ${scheduled[0].date} to ${scheduled[scheduled.length - 1].date}.`,
          count: createdPlan.length,
          created: createdPlan.length,
          seriesId: curriculumSeriesId,
          classes: createdPlan,
        });
      }

      // Progressive series: instead of repeating the same class on every
      // date, assign incrementing class numbers (Class 1, 2, ... n) across
      // consecutive dates, capped at the course's session count. Extra dates
      // beyond the final class number are not created.
      // Strict validation: only an integer primitive or a digit-only string.
      // Number()/parseInt coercion would silently accept "1.5", "1abc",
      // booleans, or arrays.
      const isValidClassNumber =
        (typeof classNumber === 'number' && Number.isInteger(classNumber)) ||
        (typeof classNumber === 'string' && /^\d+$/.test(classNumber.trim()));
      const startNumber = isValidClassNumber ? Number(classNumber) : NaN;
      if (!isValidClassNumber || startNumber < 1) {
        return res.status(400).json({ message: "Class number must be a positive integer" });
      }
      const isMotoPracticalRequest =
        (courseType || '').toLowerCase() === 'moto' &&
        classType === 'driving';
      if (!req.body.fullCurriculum) {
        const configurationError = validateCourseClassConfiguration({
          courseType,
          classType,
          classNumber: startNumber,
          duration: Number(duration),
          maxStudents: Number(maxStudents),
        });
        if (configurationError) {
          return res.status(400).json({ message: configurationError });
        }
        if (isMotoPracticalRequest) {
          if (motoTrainingStage !== 'closed-circuit' && motoTrainingStage !== 'road') {
            return res.status(400).json({
              message: "Choose Closed-Circuit Training or Road Training for the motorcycle series.",
            });
          }
          const requirements = getMotoClassRequirements(classType, startNumber);
          if (requirements?.stage !== motoTrainingStage) {
            return res.status(400).json({
              message: `Motorcycle class #${startNumber} does not belong to the selected ${motoTrainingStage === 'road' ? 'Road Training' : 'Closed-Circuit Training'} stage.`,
            });
          }
        }
      }
      let progressiveDates = dates;
      if (progressive) {
        const counts = getCourseClassCounts(courseType);
        const isMotoPracticalSeries = isMotoPracticalRequest;
        if (
          isMotoPracticalSeries &&
          motoTrainingStage !== 'closed-circuit' &&
          motoTrainingStage !== 'road'
        ) {
          return res.status(400).json({
            message: "Choose Closed-Circuit Training or Road Training for the motorcycle series.",
          });
        }
        const minNumber =
          isMotoPracticalSeries && motoTrainingStage === 'road' ? 5 : 1;
        const maxNumber =
          isMotoPracticalSeries
            ? motoTrainingStage === 'closed-circuit' ? 4 : 7
            : classType === 'driving' ? counts.drivingCount : counts.theoryCount;
        if (startNumber < minNumber) {
          return res.status(400).json({
            message: `${motoTrainingStage === 'road' ? 'Road Training' : 'Closed-Circuit Training'} starts at motorcycle class #${minNumber}.`,
          });
        }
        if (startNumber > maxNumber) {
          return res.status(400).json({
            message: isMotoPracticalSeries
              ? `Class number ${startNumber} is outside the selected motorcycle training stage.`
              : `Class number ${startNumber} exceeds the ${maxNumber} ${classType} sessions for the ${courseType} course.`,
          });
        }
        const requiredDates = maxNumber - startNumber + 1;
        if (isMotoPracticalSeries && dates.length < requiredDates) {
          return res.status(400).json({
            message: `Select at least ${requiredDates} matching date${requiredDates === 1 ? '' : 's'} to schedule the remaining ${motoTrainingStage === 'road' ? 'Road Training' : 'Closed-Circuit Training'} sessions.`,
          });
        }
        progressiveDates = dates.slice(0, requiredDates);
      }

      // Pre-validate every date against the instructor's availability before
      // creating anything (no partial creation).
      if (instructorId) {
        const instId = parseInt(instructorId);
        const availabilityViolations: string[] = [];
        const checkedDayDurations = new Set<string>();
        for (let index = 0; index < progressiveDates.length; index++) {
          const date = progressiveDates[index];
          const dow = new Date(date + "T00:00:00").getDay();
          const generatedClassNumber = progressive ? startNumber + index : startNumber;
          const generatedRequirements = getCourseClassRequirements(
            courseType,
            classType,
            generatedClassNumber,
          );
          const generatedDuration = generatedRequirements?.duration ?? (parseInt(duration) || 120);
          const availabilityKey = `${dow}:${generatedDuration}`;
          if (checkedDayDurations.has(availabilityKey)) continue;
          checkedDayDurations.add(availabilityKey);
          const violation = await checkInstructorAvailability(instId, date, time, generatedDuration);
          if (violation) availabilityViolations.push(violation.message);
        }
        if (availabilityViolations.length > 0) {
          return res.status(409).json({
            message: `Schedule falls outside the instructor's availability. No classes were created.`,
            availabilityViolations,
            conflicts: availabilityViolations,
          });
        }
      }

      const seriesId = randomUUID();
      const rowsToCreate = progressiveDates.map((date, i) => {
        const generatedClassNumber = progressive ? startNumber + i : startNumber;
        const generatedRequirements = getCourseClassRequirements(
          courseType,
          classType,
          generatedClassNumber,
        );
        const generatedDuration = generatedRequirements?.duration ?? (parseInt(duration) || 120);
        return {
          courseType,
          classType,
          classNumber: generatedClassNumber,
          date,
          time,
          duration: generatedDuration,
          instructorId: instructorId ? parseInt(instructorId) : null,
          maxStudents: generatedRequirements?.maxStudents ?? (parseInt(maxStudents) || 15),
          lessonType: lessonType || 'regular',
          hasTest: hasTest || false,
          zoomLink: zoomLink || null,
          status: 'scheduled',
          seriesId,
        };
      });
      const created = await db.transaction(async (tx) => {
        const createdClasses = [];
        for (const row of rowsToCreate) {
          createdClasses.push(await storage.createClass(row, tx));
        }
        return createdClasses;
      });

      res.status(201).json({ created: created.length, dates: progressiveDates, seriesId, progressive: !!progressive });
    } catch (error) {
      captureRequestError(error);
      console.error("Bulk class creation error:", error);
      res.status(500).json({ message: "Failed to create classes bulk" });
    }
  });

  // ----- Recurring class series management -----

  // Helper: fetch a series' classes with enrollment info
  async function getSeriesClassesWithEnrollments(seriesId: string) {
    const seriesClasses = await db.select().from(classes)
      .where(eq(classes.seriesId, seriesId));
    seriesClasses.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const result = [];
    for (const cls of seriesClasses) {
      const enrollments = await storage.getClassEnrollmentsByClass(cls.id);
      const enrolledStudents = [];
      for (const enr of enrollments) {
        if (!enr.studentId) continue;
        const student = await storage.getStudent(enr.studentId);
        if (student) enrolledStudents.push({ id: student.id, name: `${student.firstName} ${student.lastName}` });
      }
      result.push({ ...cls, enrolledCount: enrolledStudents.length, enrolledStudents });
    }
    return result;
  }

  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Fetch all classes in a series (with enrolled student info for confirmations)
  app.get("/api/class-series/:seriesId", authMiddleware, async (req, res) => {
    try {
      const seriesClasses = await getSeriesClassesWithEnrollments(req.params.seriesId);
      if (seriesClasses.length === 0) return res.status(404).json({ message: "Series not found" });
      res.json({ seriesId: req.params.seriesId, today: todayLocal(), classes: seriesClasses });
    } catch (error) {
      captureRequestError(error);
      console.error("Fetch class series error:", error);
      res.status(500).json({ message: "Failed to fetch class series" });
    }
  });

  // Update a series (scope: 'all' or 'future'). Past classes are never modified.
  // Detached classes (individually edited) are skipped and reported.
  app.patch("/api/class-series/:seriesId", authMiddleware, async (req, res) => {
    try {
      const { seriesId } = req.params;
      const { scope, fromDate, updates } = req.body || {};
      if (scope !== 'all' && scope !== 'future') {
        return res.status(400).json({ message: "scope must be 'all' or 'future'" });
      }
      const allowed = ['time', 'duration', 'instructorId', 'maxStudents', 'room', 'zoomLink'] as const;
      const updateData: Record<string, any> = {};
      for (const key of allowed) {
        if (updates && updates[key] !== undefined) updateData[key] = updates[key];
      }
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      if (updateData.duration !== undefined) updateData.duration = parseInt(updateData.duration) || 120;
      if (updateData.maxStudents !== undefined) updateData.maxStudents = parseInt(updateData.maxStudents) || 15;
      if (updateData.instructorId !== undefined && updateData.instructorId !== null) {
        updateData.instructorId = parseInt(updateData.instructorId);
      }

      const seriesClasses = await getSeriesClassesWithEnrollments(seriesId);
      if (seriesClasses.length === 0) return res.status(404).json({ message: "Series not found" });

      const today = todayLocal();
      const cutoff = scope === 'future' && fromDate ? fromDate : today;
      // Never touch past classes; 'future' scope additionally respects fromDate.
      const effectiveCutoff = cutoff < today ? today : cutoff;

      const triggeredBy = (req as any).user?.id || (req.session as any)?.userId || 'system';
      let skippedPast = 0, skippedDetached = 0, skippedCancelled = 0;
      const targets: typeof seriesClasses = [];
      for (const cls of seriesClasses) {
        if (cls.date < effectiveCutoff) { skippedPast++; continue; }
        if (cls.detachedFromSeries) { skippedDetached++; continue; }
        if (cls.status === 'cancelled') { skippedCancelled++; continue; }
        targets.push(cls);
      }
      for (const cls of targets) {
        const configurationError = validateCourseClassConfiguration({
          courseType: cls.courseType,
          classType: cls.classType,
          classNumber: cls.classNumber,
          duration: updateData.duration !== undefined ? updateData.duration : cls.duration,
          maxStudents: updateData.maxStudents !== undefined ? updateData.maxStudents : cls.maxStudents,
        });
        if (configurationError) {
          return res.status(400).json({
            message: `${configurationError} No classes were changed.`,
          });
        }
      }
      const virtualCapacityViolation = targets.some(cls => {
        const zoomLink = updateData.zoomLink !== undefined ? updateData.zoomLink : cls.zoomLink;
        const maxStudents = updateData.maxStudents !== undefined ? updateData.maxStudents : cls.maxStudents;
        return typeof zoomLink === "string" && zoomLink.trim() && maxStudents > VIRTUAL_CLASS_MAX_STUDENTS;
      });
      if (virtualCapacityViolation) {
        return res.status(400).json({ message: `Virtual classes cannot exceed ${VIRTUAL_CLASS_MAX_STUDENTS} students. No classes were changed.` });
      }

      // Pre-validate ALL target classes for instructor/room double-bookings
      // before mutating anything, so a conflict never leaves the series
      // partially updated.
      const parseTime = (t: unknown): number | null => {
        if (typeof t !== 'string') return null;
        const [h, m] = t.split(':').map(Number);
        return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
      };
      const conflictErrors: string[] = [];
      const availabilityViolations: string[] = [];
      const seriesClassIds = new Set(seriesClasses.map(c => c.id));
      const scheduleFieldsChanged =
        updateData.time !== undefined || updateData.duration !== undefined || updateData.instructorId !== undefined;
      for (const cls of targets) {
        const newTime = updateData.time !== undefined ? updateData.time : cls.time;
        const newDuration = updateData.duration !== undefined ? updateData.duration : cls.duration;
        const newInstructorId = updateData.instructorId !== undefined ? updateData.instructorId : cls.instructorId;
        const newRoom = updateData.room !== undefined ? updateData.room : cls.room;

        if (scheduleFieldsChanged) {
          const violation = await checkInstructorAvailability(newInstructorId, cls.date, newTime, newDuration);
          if (violation) availabilityViolations.push(`${cls.date}: ${violation.message}`);
        }

        const startMin = parseTime(newTime);
        if (startMin === null) continue;
        const endMin = startMin + (newDuration || 120);

        const sameDay = await db.select().from(classes).where(and(
          eq(classes.date, cls.date),
          eq(classes.status, 'scheduled'),
          ne(classes.id, cls.id),
        ));
        for (const other of sameDay) {
          // Other classes in this same series that are also being updated
          // will carry the same new values, but they're on other dates —
          // sameDay only matches this date, so any same-series match here is
          // a detached/cancelled-scope sibling and still a real conflict.
          if (seriesClassIds.has(other.id) && targets.some(t => t.id === other.id)) continue;
          const otherStart = parseTime(other.time);
          if (otherStart === null) continue;
          const otherEnd = otherStart + (other.duration || 120);
          const overlaps = !(endMin <= otherStart || otherEnd <= startMin);
          if (!overlaps) continue;
          if (newInstructorId && other.instructorId === newInstructorId) {
            conflictErrors.push(`${cls.date}: instructor is already booked at ${other.time} (class #${other.id})`);
          }
          if (newRoom && other.room === newRoom) {
            conflictErrors.push(`${cls.date}: room "${newRoom}" is already booked at ${other.time} (class #${other.id})`);
          }
        }
      }
      if (availabilityViolations.length > 0) {
        return res.status(409).json({
          message: `Series update falls outside the instructor's availability on ${availabilityViolations.length} class${availabilityViolations.length !== 1 ? 'es' : ''}. No classes were changed.`,
          availabilityViolations,
          conflicts: availabilityViolations,
        });
      }
      if (conflictErrors.length > 0) {
        return res.status(409).json({
          message: `Series update would create ${conflictErrors.length} scheduling conflict${conflictErrors.length !== 1 ? 's' : ''}. No classes were changed.`,
          conflicts: conflictErrors,
        });
      }

      let updated = 0;
      const affectedStudents = new Map<number, string>();

      for (const cls of targets) {
        const before = cls;
        await storage.updateClass(cls.id, updateData);
        updated++;
        for (const s of cls.enrolledStudents) affectedStudents.set(s.id, s.name);

        // Reuse existing schedule-change notification for enrolled students
        if (cls.enrolledCount > 0) {
          const changes: any = {};
          let hasChanges = false;
          if (updateData.time !== undefined && updateData.time !== before.time) {
            changes.oldTime = before.time;
            changes.newTime = updateData.time;
            hasChanges = true;
          }
          if (updateData.instructorId !== undefined && updateData.instructorId !== before.instructorId) {
            const oldInstructor = before.instructorId ? await storage.getInstructor(before.instructorId) : null;
            const newInstructor = updateData.instructorId ? await storage.getInstructor(updateData.instructorId) : null;
            changes.oldInstructor = oldInstructor ? `${oldInstructor.firstName} ${oldInstructor.lastName}` : 'Unassigned';
            changes.newInstructor = newInstructor ? `${newInstructor.firstName} ${newInstructor.lastName}` : 'Unassigned';
            hasChanges = true;
          }
          if (hasChanges) {
            try {
              await notificationService.notifyScheduleChange({
                id: cls.id,
                title: `${before.courseType.toUpperCase()} ${before.classType === 'driving' ? 'Driving' : 'Theory'} Class #${before.classNumber} (${before.date})`,
                changes,
              }, String(triggeredBy));
            } catch (notifyError) {
              captureRequestError(notifyError);
              console.error("Failed to send series schedule change notification:", notifyError);
            }
          }
        }
      }

      res.json({
        updated,
        skippedPast,
        skippedDetached,
        skippedCancelled,
        affectedStudents: Array.from(affectedStudents, ([id, name]) => ({ id, name })),
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Update class series error:", error);
      res.status(500).json({ message: "Failed to update class series" });
    }
  });

  // Change which days of the week a series runs on (scope: 'all' or 'future').
  // Future classes on removed days are deleted and replacements are generated
  // on the new days under the same seriesId. Enrolled students on removed
  // dates are moved to the nearest new-schedule class where possible; students
  // who can't be moved are escalated to the office. Past, detached, and
  // cancelled classes are never touched.
  app.post("/api/class-series/:seriesId/change-days", authMiddleware, async (req, res) => {
    try {
      const { seriesId } = req.params;
      const { scope, fromDate, daysOfWeek, dryRun } = req.body || {};
      const isDryRun = dryRun === true;
      if (scope !== 'all' && scope !== 'future') {
        return res.status(400).json({ message: "scope must be 'all' or 'future'" });
      }
      if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0 ||
          daysOfWeek.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return res.status(400).json({ message: "daysOfWeek must be a non-empty array of integers 0-6" });
      }
      const daySet = new Set<number>(daysOfWeek);

      const seriesClasses = await getSeriesClassesWithEnrollments(seriesId);
      if (seriesClasses.length === 0) return res.status(404).json({ message: "Series not found" });

      const today = todayLocal();
      const cutoff = scope === 'future' && fromDate ? fromDate : today;
      const effectiveCutoff = cutoff < today ? today : cutoff;

      const triggeredBy = (req as any).user?.id || (req.session as any)?.userId || 'system';
      let skippedPast = 0, skippedDetached = 0, skippedCancelled = 0;
      const targets: typeof seriesClasses = [];
      for (const cls of seriesClasses) {
        if (cls.date < effectiveCutoff) { skippedPast++; continue; }
        if (cls.detachedFromSeries) { skippedDetached++; continue; }
        if (cls.status === 'cancelled') { skippedCancelled++; continue; }
        targets.push(cls);
      }
      if (targets.length === 0) {
        return res.status(400).json({ message: "No upcoming classes in this series can be changed" });
      }

      // Local-date helpers (avoid UTC shifting).
      const dayOf = (dateStr: string) => new Date(dateStr + "T00:00:00").getDay();
      const template = targets[0];
      for (const cls of targets) {
        const configurationError = validateCourseClassConfiguration(cls);
        if (configurationError) {
          return res.status(400).json({
            message: `${configurationError} The series days were not changed.`,
          });
        }
      }
      const templateFields = [
        'courseType', 'classType', 'classNumber', 'time', 'duration',
        'instructorId', 'maxStudents', 'lessonType', 'hasTest', 'zoomLink', 'room',
      ] as const;
      const hasMixedTemplates = targets.some((cls) =>
        templateFields.some((field) => cls[field] !== template[field])
      );
      if (hasMixedTemplates) {
        return res.status(400).json({
          message: "This series contains different class sessions or schedules, so its days cannot be changed as one repeating class. No classes were changed.",
        });
      }
      if (template.zoomLink?.trim() && template.maxStudents > VIRTUAL_CLASS_MAX_STUDENTS) {
        return res.status(400).json({
          message: `This virtual series exceeds the ${VIRTUAL_CLASS_MAX_STUDENTS}-student limit. Split its over-capacity sessions before changing the series days.`,
        });
      }
      const firstDate = targets[0].date;
      const lastDate = targets[targets.length - 1].date;
      // Never extend the series earlier than its first upcoming class.
      const rangeStart = firstDate > effectiveCutoff ? firstDate : effectiveCutoff;

      // Build the new set of dates: every day in [rangeStart, lastDate]
      // matching the new days of week.
      const desiredDates: string[] = [];
      {
        const cur = new Date(rangeStart + "T00:00:00");
        const end = new Date(lastDate + "T00:00:00");
        while (cur <= end) {
          if (daySet.has(cur.getDay())) {
            desiredDates.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
      if (desiredDates.length === 0) {
        return res.status(400).json({ message: "No dates match the selected days of week in this series' range" });
      }

      const existingDates = new Set(targets.map(c => c.date));
      const kept = targets.filter(c => daySet.has(dayOf(c.date)));
      const toRemove = targets.filter(c => !daySet.has(dayOf(c.date)));
      const toCreate = desiredDates.filter(d => !existingDates.has(d));

      // Pre-validate every new date for instructor/room double-bookings before
      // creating or deleting anything (no partial updates).
      const parseTime = (t: unknown): number | null => {
        if (typeof t !== 'string') return null;
        const [h, m] = t.split(':').map(Number);
        return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
      };
      const startMin = parseTime(template.time);
      const endMin = startMin !== null ? startMin + (template.duration || 120) : null;
      const removedIds = new Set(toRemove.map(c => c.id));
      const conflictErrors: string[] = [];
      const availabilityViolations: string[] = [];
      {
        const checkedDays = new Set<number>();
        for (const date of toCreate) {
          const dow = dayOf(date);
          if (checkedDays.has(dow)) continue;
          checkedDays.add(dow);
          const violation = await checkInstructorAvailability(
            template.instructorId, date, template.time, template.duration,
          );
          if (violation) availabilityViolations.push(violation.message);
        }
      }
      if (availabilityViolations.length > 0 && !isDryRun) {
        return res.status(409).json({
          message: `The new days fall outside the instructor's availability. No classes were changed.`,
          availabilityViolations,
          conflicts: availabilityViolations,
        });
      }
      if (startMin !== null && endMin !== null) {
        for (const date of toCreate) {
          const sameDay = await db.select().from(classes).where(and(
            eq(classes.date, date),
            eq(classes.status, 'scheduled'),
          ));
          for (const other of sameDay) {
            if (removedIds.has(other.id)) continue; // will be deleted
            const otherStart = parseTime(other.time);
            if (otherStart === null) continue;
            const otherEnd = otherStart + (other.duration || 120);
            const overlaps = !(endMin <= otherStart || otherEnd <= startMin);
            if (!overlaps) continue;
            if (template.instructorId && other.instructorId === template.instructorId) {
              conflictErrors.push(`${date}: instructor is already booked at ${other.time} (class #${other.id})`);
            }
            if (template.room && other.room === template.room) {
              conflictErrors.push(`${date}: room "${template.room}" is already booked at ${other.time} (class #${other.id})`);
            }
          }
        }
      }
      if (conflictErrors.length > 0 && !isDryRun) {
        return res.status(409).json({
          message: `Changing the series days would create ${conflictErrors.length} scheduling conflict${conflictErrors.length !== 1 ? 's' : ''}. No classes were changed.`,
          conflicts: conflictErrors,
        });
      }

      // Dry-run: simulate the moves without mutating anything and report the
      // plan, including students at risk of needing manual follow-up.
      if (isDryRun) {
        // Virtual new schedule: kept classes (real capacity/enrollment) plus
        // to-be-created classes (empty, template capacity).
        const virtualSchedule = [
          ...kept.map(c => ({
            date: c.date,
            capacity: Math.max(0, (c.maxStudents || 15) - (c.enrolledStudents?.length || 0)),
            enrolledIds: new Set<number>((c.enrolledStudents || []).map(s => s.id)),
            isNew: false,
          })),
          ...toCreate.map(d => ({
            date: d,
            capacity: template.maxStudents || 15,
            enrolledIds: new Set<number>(),
            isNew: true,
          })),
        ].sort((a, b) => a.date.localeCompare(b.date));

        const plannedMoves: { studentId: number; studentName: string; fromDate: string; toDate: string }[] = [];
        const atRisk: { studentId: number; studentName: string; fromDate: string; reason: string }[] = [];

        for (const cls of toRemove) {
          const dest =
            virtualSchedule.find(n => n.date >= cls.date) ||
            [...virtualSchedule].reverse().find(n => n.date < cls.date);
          for (const s of cls.enrolledStudents || []) {
            if (!dest) {
              atRisk.push({ studentId: s.id, studentName: s.name, fromDate: cls.date, reason: "No replacement class available" });
              continue;
            }
            if (dest.enrolledIds.has(s.id)) {
              plannedMoves.push({ studentId: s.id, studentName: s.name, fromDate: cls.date, toDate: dest.date });
              continue;
            }
            if (dest.capacity <= 0) {
              atRisk.push({ studentId: s.id, studentName: s.name, fromDate: cls.date, reason: `Class on ${dest.date} is full` });
              continue;
            }
            dest.capacity--;
            dest.enrolledIds.add(s.id);
            plannedMoves.push({ studentId: s.id, studentName: s.name, fromDate: cls.date, toDate: dest.date });
          }
        }

        return res.json({
          dryRun: true,
          wouldCreate: toCreate.length,
          wouldDelete: toRemove.length,
          kept: kept.length,
          plannedMoves,
          atRisk,
          conflicts: conflictErrors,
          availabilityViolations,
          skippedPast,
          skippedDetached,
          skippedCancelled,
        });
      }

      // Create the replacement classes on the new days.
      const createdClasses: (typeof template)[] = [] as any;
      for (const date of toCreate) {
        const cls = await storage.createClass({
          courseType: template.courseType,
          classType: template.classType,
          classNumber: template.classNumber,
          date,
          time: template.time,
          duration: template.duration || 120,
          instructorId: template.instructorId ?? null,
          maxStudents: template.maxStudents || 15,
          lessonType: template.lessonType || 'regular',
          hasTest: template.hasTest || false,
          zoomLink: template.zoomLink || null,
          room: template.room || null,
          status: 'scheduled',
          seriesId,
        } as any);
        createdClasses.push(cls as any);
      }

      // New schedule (kept + created), sorted by date, used to pick move targets.
      const newSchedule = [
        ...kept.map(c => ({ id: c.id, date: c.date, time: c.time })),
        ...createdClasses.map((c: any) => ({ id: c.id, date: c.date, time: c.time })),
      ].sort((a, b) => a.date.localeCompare(b.date));

      const titleOf = (cls: typeof template) =>
        `${cls.courseType.toUpperCase()} ${cls.classType === 'driving' ? 'Driving' : 'Theory'} Class #${cls.classNumber}`;

      // Move enrolled students off removed-day classes, then delete them.
      const moved: { studentId: number; studentName: string; fromDate: string; toDate: string }[] = [];
      const needsAttention: { studentId: number; studentName: string; note?: string }[] = [];
      let deleted = 0;

      for (const cls of toRemove) {
        const movedHere: number[] = [];
        const stuckHere: { id: number; name: string }[] = [];
        // Nearest new-schedule class on/after the removed date, else nearest before.
        const dest =
          newSchedule.find(n => n.date >= cls.date) ||
          [...newSchedule].reverse().find(n => n.date < cls.date);

        for (const s of cls.enrolledStudents) {
          if (!dest) {
            stuckHere.push(s);
            needsAttention.push({ studentId: s.id, studentName: s.name, note: `Was enrolled on ${cls.date} — no replacement class available` });
            continue;
          }
          try {
            // Schedule-driven moves keep the student's existing position when
            // the replacement is the same class (type + number) on a new date
            // — no progression re-check needed. If the destination would
            // change the student's class number/type, the strict progression
            // rules apply (excluding the enrollment on the removed class).
            // Validation + booking run under the per-student lock so they
            // cannot race a parallel booking or reschedule.
            const moveResult = await withStudentBookingLock(s.id, async (bookingTx) => {
              const destClass = await storage.getClass(dest.id);
              if (!destClass) {
                return { blocked: `Was enrolled on ${cls.date} — replacement class not found` } as const;
              }
              const likeForLike = destClass.classType === cls.classType && destClass.classNumber === cls.classNumber;
              if (!likeForLike) {
                const progression = await validateProgressionForStudent(s.id, destClass, { excludeClassId: cls.id });
                if (!progression.allowed) {
                  return { blocked: `Was enrolled on ${cls.date} — move to ${dest.date} blocked by booking rules: ${progression.reason || 'not allowed'}` } as const;
                }
              }
              return { result: await storage.bookClass(s.id, dest.id, bookingTx) } as const;
            });
            if ('blocked' in moveResult) {
              stuckHere.push(s);
              needsAttention.push({ studentId: s.id, studentName: s.name, note: moveResult.blocked });
              continue;
            }
            const result = moveResult.result;
            const alreadyEnrolled = !result.success && result.message?.includes("already enrolled");
            if (result.success || alreadyEnrolled) {
              movedHere.push(s.id);
              moved.push({ studentId: s.id, studentName: s.name, fromDate: cls.date, toDate: dest.date });
            } else {
              stuckHere.push(s);
              needsAttention.push({ studentId: s.id, studentName: s.name, note: `Was enrolled on ${cls.date} — could not be moved to ${dest.date}: ${result.message || 'unknown error'}` });
            }
          } catch (err: any) {
            captureRequestError(err);
            stuckHere.push(s);
            needsAttention.push({ studentId: s.id, studentName: s.name, note: `Was enrolled on ${cls.date} — could not be moved to ${dest.date}: ${err?.message || err}` });
          }
        }

        // Notify moved students (scoped to them only).
        if (movedHere.length > 0 && dest) {
          try {
            await notificationService.notifySeriesDayMove({
              studentIds: movedHere,
              classTitle: titleOf(cls),
              oldDate: cls.date,
              newDate: dest.date,
              time: cls.time,
              newClassId: dest.id,
            }, String(triggeredBy));
          } catch (notifyError) {
            captureRequestError(notifyError);
            console.error("Failed to send series day-move notification:", notifyError);
          }
        }
        // Notify students who could not be moved that their class is gone.
        if (stuckHere.length > 0) {
          try {
            await notificationService.notifySeriesDayRemoved({
              studentIds: stuckHere.map(s => s.id),
              classTitle: titleOf(cls),
              date: cls.date,
              time: cls.time,
              classId: cls.id,
            }, String(triggeredBy));
          } catch (notifyError) {
            captureRequestError(notifyError);
            console.error("Failed to send series day-removed notification:", notifyError);
          }
        }

        // Deleting the class removes its enrollments (moved students already
        // have their new booking; stuck students were notified + escalated).
        await storage.deleteClass(cls.id);
        deleted++;
      }

      // Escalate unmovable students to the office.
      let officeNotified = false;
      if (needsAttention.length > 0) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const oldDays = Array.from(new Set(targets.map(c => dayOf(c.date)))).sort().map(d => dayNames[d]).join('/');
        const newDays = Array.from(daySet).sort().map(d => dayNames[d]).join('/');
        try {
          const notifId = await notificationService.notifySeriesDaysActionNeeded({
            seriesTitle: titleOf(template),
            oldDays,
            newDays,
            reason: "Some enrolled students could not be moved automatically to a class on the new days.",
            students: needsAttention,
          });
          officeNotified = notifId !== null;
        } catch (notifyError) {
          captureRequestError(notifyError);
          console.error("Failed to send series days action-needed notification:", notifyError);
        }
      }

      res.json({
        created: createdClasses.length,
        deleted,
        kept: kept.length,
        moved,
        needsAttention,
        officeNotified,
        skippedPast,
        skippedDetached,
        skippedCancelled,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Change series days error:", error);
      res.status(500).json({ message: "Failed to change series days" });
    }
  });

  // Delete a series (scope: 'all' or 'future'). Past classes are never deleted.
  app.delete("/api/class-series/:seriesId", authMiddleware, async (req, res) => {
    try {
      const { seriesId } = req.params;
      const scope = (req.query.scope as string) || 'all';
      const fromDate = req.query.fromDate as string | undefined;
      if (scope !== 'all' && scope !== 'future') {
        return res.status(400).json({ message: "scope must be 'all' or 'future'" });
      }

      const seriesClasses = await getSeriesClassesWithEnrollments(seriesId);
      if (seriesClasses.length === 0) return res.status(404).json({ message: "Series not found" });

      const today = todayLocal();
      const cutoff = scope === 'future' && fromDate ? fromDate : today;
      const effectiveCutoff = cutoff < today ? today : cutoff;

      const triggeredBy = (req as any).user?.id || (req.session as any)?.userId || 'system';
      let deleted = 0, skippedPast = 0;
      const affectedStudents = new Map<number, string>();

      for (const cls of seriesClasses) {
        if (cls.date < effectiveCutoff) { skippedPast++; continue; }

        // Notify enrolled students before removing the class
        if (cls.enrolledCount > 0) {
          for (const s of cls.enrolledStudents) affectedStudents.set(s.id, s.name);
          try {
            await notificationService.notifyClassCancelled({
              id: cls.id,
              title: `${cls.courseType.toUpperCase()} ${cls.classType === 'driving' ? 'Driving' : 'Theory'} Class #${cls.classNumber}`,
              date: cls.date,
              time: cls.time,
              reason: 'The recurring schedule was cancelled by the office.',
            }, String(triggeredBy));
          } catch (notifyError) {
            captureRequestError(notifyError);
            console.error("Failed to send series cancellation notification:", notifyError);
          }
        }

        await storage.deleteClass(cls.id);
        deleted++;
      }

      res.json({
        deleted,
        skippedPast,
        affectedStudents: Array.from(affectedStudents, ([id, name]) => ({ id, name })),
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Delete class series error:", error);
      res.status(500).json({ message: "Failed to delete class series" });
    }
  });

  app.put("/api/classes/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      
      // Get existing class data to compare for changes
      const existingClass = await storage.getClass(id);
      if (!existingClass) {
        return res.status(404).json({ message: "Class not found" });
      }
      const configurationError = validateCourseClassConfiguration({
        courseType: updateData.courseType !== undefined ? updateData.courseType : existingClass.courseType,
        classType: updateData.classType !== undefined ? updateData.classType : existingClass.classType,
        classNumber: updateData.classNumber !== undefined ? Number(updateData.classNumber) : existingClass.classNumber,
        duration: updateData.duration !== undefined ? Number(updateData.duration) : existingClass.duration,
        maxStudents: updateData.maxStudents !== undefined ? Number(updateData.maxStudents) : existingClass.maxStudents,
      });
      if (configurationError) {
        return res.status(400).json({ message: configurationError });
      }
      const resultingZoomLink = updateData.zoomLink !== undefined ? updateData.zoomLink : existingClass?.zoomLink;
      const resultingMaxStudents = updateData.maxStudents !== undefined ? Number(updateData.maxStudents) : existingClass?.maxStudents;
      if (typeof resultingZoomLink === "string" && resultingZoomLink.trim() && resultingMaxStudents && resultingMaxStudents > VIRTUAL_CLASS_MAX_STUDENTS) {
        return res.status(400).json({ message: `Virtual classes cannot exceed ${VIRTUAL_CLASS_MAX_STUDENTS} students.` });
      }

      // Validate against instructor availability when schedule-relevant
      // fields are changing.
      const scheduleChanging =
        updateData.date !== undefined || updateData.time !== undefined ||
        updateData.duration !== undefined || updateData.instructorId !== undefined;
      if (existingClass && scheduleChanging) {
        const newDate = updateData.date !== undefined ? updateData.date : existingClass.date;
        const newTime = updateData.time !== undefined ? updateData.time : existingClass.time;
        const newDuration = updateData.duration !== undefined ? updateData.duration : existingClass.duration;
        const newInstructorId = updateData.instructorId !== undefined ? updateData.instructorId : existingClass.instructorId;
        const violation = await checkInstructorAvailability(newInstructorId, newDate, newTime, newDuration);
        if (violation) {
          return res.status(409).json({
            message: violation.message,
            availabilityViolations: [violation.message],
          });
        }
      }

      // If this class belongs to a recurring series and a schedule-relevant
      // field is being changed individually, flag it as detached so later
      // series-wide edits don't silently overwrite it.
      if (existingClass?.seriesId && !existingClass.detachedFromSeries) {
        const detachFields = ['date', 'time', 'duration', 'instructorId', 'maxStudents', 'room', 'zoomLink'] as const;
        const changedIndividually = detachFields.some(
          f => updateData[f] !== undefined && updateData[f] !== (existingClass as any)[f]
        );
        if (changedIndividually) {
          updateData.detachedFromSeries = true;
        }
      }

      const classData = await storage.updateClass(id, updateData);
      
      // Send schedule change notifications if relevant fields changed
      if (existingClass && classData) {
        const changes: any = {};
        let hasChanges = false;
        
        if (existingClass.date !== classData.date) {
          changes.oldDate = existingClass.date;
          changes.newDate = classData.date;
          hasChanges = true;
        }
        if (existingClass.time !== classData.time || existingClass.duration !== classData.duration) {
          changes.oldTime = `${existingClass.time} (${existingClass.duration} min)`;
          changes.newTime = `${classData.time} (${classData.duration} min)`;
          hasChanges = true;
        }
        if (existingClass.instructorId !== classData.instructorId) {
          const oldInstructor = existingClass.instructorId ? await storage.getInstructor(existingClass.instructorId) : null;
          const newInstructor = classData.instructorId ? await storage.getInstructor(classData.instructorId) : null;
          changes.oldInstructor = oldInstructor ? `${oldInstructor.firstName} ${oldInstructor.lastName}` : 'Unassigned';
          changes.newInstructor = newInstructor ? `${newInstructor.firstName} ${newInstructor.lastName}` : 'Unassigned';
          hasChanges = true;
        }
        if ((existingClass.room || '') !== (classData.room || '')) {
          changes.oldLocation = existingClass.room || 'No room assigned';
          changes.newLocation = classData.room || 'No room assigned';
          hasChanges = true;
        }
        
        if (hasChanges) {
          try {
            const triggeredBy = (req as any).user?.id || (req.session as any)?.userId || 'system';
            await notificationService.notifyScheduleChange({
              id: classData.id,
              title: `${classData.courseType.toUpperCase()} ${classData.classType === 'driving' ? 'Driving' : 'Theory'} Class #${classData.classNumber} (${classData.date})`,
              changes,
            }, triggeredBy);
          } catch (notifyError) {
            captureRequestError(notifyError);
            console.error("Failed to send schedule change notification:", notifyError);
          }
        }
      }
      
      res.json(classData);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Failed to update class" });
    }
  });

  app.delete("/api/classes/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const classData = await storage.getClass(id);
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }
      // Past classes (school-local time) can only be deleted when no student
      // ever enrolled — this preserves attendance/lesson history.
      const startCheck = checkClassStart({ date: classData.date, time: classData.time });
      const isPastClass = startCheck.status === "started";
      if (isPastClass) {
        const enrollmentCount = await storage.countClassEnrollmentHistory(id);
        if (enrollmentCount > 0) {
          return res.status(409).json({
            message: `This past class cannot be deleted because ${enrollmentCount} student enrollment record${enrollmentCount === 1 ? " exists" : "s exist"} (including cancelled ones). Past classes with enrollment history are kept to preserve attendance records.`,
          });
        }
      }
      await storage.deleteClass(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to delete class" });
    }
  });

  // Approve change request
  app.post("/api/change-requests/:id/approve", authMiddleware, async (req, res) => {
    try {
      const classId = parseInt(req.params.id);
      const updateData = req.body;
      const existingClass = await storage.getClass(classId);
      if (!existingClass) {
        return res.status(404).json({ message: "Class not found" });
      }

      const configurationError = validateCourseClassConfiguration({
        courseType: updateData.courseType !== undefined ? updateData.courseType : existingClass.courseType,
        classType: updateData.classType !== undefined ? updateData.classType : existingClass.classType,
        classNumber: updateData.classNumber !== undefined ? Number(updateData.classNumber) : existingClass.classNumber,
        duration: updateData.duration !== undefined ? Number(updateData.duration) : existingClass.duration,
        maxStudents: updateData.maxStudents !== undefined ? Number(updateData.maxStudents) : existingClass.maxStudents,
      });
      if (configurationError) {
        return res.status(400).json({ message: configurationError });
      }

      const resultingZoomLink = updateData.zoomLink !== undefined ? updateData.zoomLink : existingClass.zoomLink;
      const resultingMaxStudents = updateData.maxStudents !== undefined ? Number(updateData.maxStudents) : existingClass.maxStudents;
      if (typeof resultingZoomLink === "string" && resultingZoomLink.trim() && resultingMaxStudents > VIRTUAL_CLASS_MAX_STUDENTS) {
        return res.status(400).json({ message: `Virtual classes cannot exceed ${VIRTUAL_CLASS_MAX_STUDENTS} students.` });
      }

      const scheduleChanging =
        updateData.date !== undefined || updateData.time !== undefined ||
        updateData.duration !== undefined || updateData.instructorId !== undefined;
      if (scheduleChanging) {
        const violation = await checkInstructorAvailability(
          updateData.instructorId !== undefined ? Number(updateData.instructorId) : existingClass.instructorId,
          updateData.date !== undefined ? updateData.date : existingClass.date,
          updateData.time !== undefined ? updateData.time : existingClass.time,
          updateData.duration !== undefined ? Number(updateData.duration) : existingClass.duration,
        );
        if (violation) {
          return res.status(409).json({
            message: violation.message,
            availabilityViolations: [violation.message],
          });
        }
      }
      
      // Update the class with new details and reset confirmation status
      const updatedClass = await storage.updateClass(classId, {
        ...updateData,
        confirmationStatus: 'pending',
        changeRequestReason: null,
        changeRequestTime: null,
        changeRequestedAt: null,
      });
      
      res.json({ success: true, class: updatedClass });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to approve change request" });
    }
  });

  // Deny change request
  app.post("/api/change-requests/:id/deny", authMiddleware, async (req, res) => {
    try {
      const classId = parseInt(req.params.id);
      
      // Reset confirmation status and clear change request fields
      const updatedClass = await storage.updateClass(classId, {
        confirmationStatus: 'pending',
        changeRequestReason: null,
        changeRequestTime: null,
        changeRequestedAt: null,
      });
      
      res.json({ success: true, class: updatedClass });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to deny change request" });
    }
  });

  // Class enrollments routes
  app.get("/api/class-enrollments", authMiddleware, async (req, res) => {
    try {
      const { studentId } = req.query;
      if (studentId) {
        const enrollments = await storage.getClassEnrollmentsByStudent(
          Number(studentId),
        );
        res.json(enrollments);
      } else {
        const enrollments = await storage.getClassEnrollments();
        res.json(enrollments);
      }
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch class enrollments" });
    }
  });

  app.get(
    "/api/class-enrollments/class/:classId",
    authMiddleware,
    async (req, res) => {
      try {
        const classId = parseInt(req.params.classId);
        const enrollments = await storage.getClassEnrollmentsByClass(classId);
        res.json(enrollments);
      } catch (error) {
        captureRequestError(error);
        res.status(500).json({ message: "Failed to fetch class enrollments" });
      }
    },
  );

  // Enrolled students (with names) for a class — used by the admin
  // scheduling screen to show who is behind the "X/Y" enrollment count.
  app.get(
    "/api/classes/:classId/enrolled-students",
    authMiddleware,
    async (req, res) => {
      try {
        const classId = parseInt(req.params.classId);
        if (isNaN(classId)) {
          return res.status(400).json({ message: "Invalid class id" });
        }
        const rows = await db
          .select({
            enrollmentId: classEnrollments.id,
            studentId: students.id,
            firstName: students.firstName,
            lastName: students.lastName,
            attendanceStatus: classEnrollments.attendanceStatus,
            cancelledAt: classEnrollments.cancelledAt,
          })
          .from(classEnrollments)
          .innerJoin(students, eq(classEnrollments.studentId, students.id))
          .where(eq(classEnrollments.classId, classId));
        const active = rows
          .filter((r) => !r.cancelledAt)
          .map(({ cancelledAt, ...r }) => r)
          .sort((a, b) =>
            `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
          );
        res.json(active);
      } catch (error) {
        captureRequestError(error);
        res.status(500).json({ message: "Failed to fetch enrolled students" });
      }
    },
  );

  app.get("/api/class-enrollments/student/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const enrollments = await storage.getClassEnrollmentsByStudent(studentId);
      res.json(enrollments);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch student enrollments" });
    }
  });

  app.post("/api/class-enrollments", authMiddleware, async (req: any, res) => {
    try {
      // Extract override flags before schema parsing to avoid validation error
      const { overridePolicy, overrideReason, ...enrollmentBody } = req.body;
      const enrollmentData = insertClassEnrollmentSchema.parse(enrollmentBody);

      // Validation + creation run under the per-student lock so parallel
      // enrollments can't race the progression/concurrency checks.
      return await withStudentBookingLock(enrollmentData.studentId ?? 0, async (bookingTx) => {

      // Check if user has permission to override booking policies
      const canOverride = req.user?.canOverrideBookingPolicies === true;

      // Track policy violations for logging
      const policyViolations: { policyType: string; originalValue: string; overriddenValue: string }[] = [];

      // Get class data for policy checks
      const classData = await storage.getClass(enrollmentData.classId!);

      // ── Task 272: block direct enrollment on the canonical In-Car 12/13
      // paired slot. Creating a plain enrollment here would bypass the pairing
      // service (no offer/pair/confirmation lifecycle, no second-seat handling).
      // Staff must use the pairing tools (manual pair) instead.
      if (
        classData &&
        isCombined1213Class({
          classType: classData.classType ?? null,
          classNumber: classData.classNumber ?? null,
          duration: classData.duration ?? null,
          maxStudents: classData.maxStudents ?? null,
          courseType: classData.courseType ?? null,
        })
      ) {
        return res.status(400).json({
          message:
            "In-Car 12/13 is a paired session — use the pairing tools (manual pair) instead of direct enrollment.",
        });
      }

      if (classData && enrollmentData.studentId) {
        // ── Phase ordering & prerequisite validation (admin enrollment) ─────────
        // Admins with override permission can bypass; others must comply
        if (!overridePolicy || !canOverride) {
          const studentForPhase = await storage.getStudent(enrollmentData.studentId);
          if (studentForPhase) {
            const studentEnrollmentsPhase = await storage.getClassEnrollmentsByStudent(enrollmentData.studentId);
            const allClassesPhase = await storage.getClasses();
            const enrollmentDetailsPhase = studentEnrollmentsPhase
              .filter(e => !e.cancelledAt)
              .map(e => {
                const cls = allClassesPhase.find(c => c.id === e.classId);
                return {
                  attendanceStatus: e.attendanceStatus,
                  classType: cls?.classType ?? null,
                  classNumber: cls?.classNumber ?? null,
                  date: cls?.date ?? null,
                  duration: cls?.duration ?? null,
              maxStudents: cls?.maxStudents ?? null,
                  courseType: cls?.courseType ?? null,
                  classStatus: cls?.status ?? null,
                };
              });
            const completedForPhase = mergeScooterTransferCredits(
              buildCompletedClasses(enrollmentDetailsPhase),
              studentForPhase,
            );
            // NOTE: the daily booking limit is NOT checked here — it is
            // enforced below via the max_bookings_per_day policy check (which
            // uses the policy value when set, falling back to the built-in
            // default) so authorized staff can override it with a reason.
            const targetDatePhase = classData.date ?? new Date().toISOString().slice(0, 10);
            // Same-day scheduled minutes for the auto 3-hours-per-day rule —
            // must be enforced on the admin enrollment path too (overridable
            // with the same overridePolicy flag as the other checks).
            const sameDayPhase = enrollmentDetailsPhase.filter(
              d => d.date === targetDatePhase && d.classStatus === 'scheduled'
            );
            const targetForPhase = {
              classType: classData.classType as "theory" | "driving",
              classNumber: classData.classNumber ?? 0,
              date: targetDatePhase,
              duration: classData.duration ?? undefined,
              maxStudents: classData.maxStudents ?? undefined,
              sameDayAlreadyBookedMinutes: sameDayPhase.reduce(
                (sum, d) => sum + (d.duration ?? (d.classType === 'theory' ? 120 : 60)), 0),
              sameDayAlreadyBookedHasDriving: sameDayPhase.some(d => d.classType === 'driving'),
              saaq6rKnowledgePassed: !!studentForPhase.saaqKnowledgeTestDate,
              phase1TimingAdvanceDays: studentForPhase.phase1TimingAdvanceDays ?? 0,
              phase2TimingAdvanceDays: studentForPhase.phase2TimingAdvanceDays ?? 0,
              phase3TimingAdvanceDays: studentForPhase.phase3TimingAdvanceDays ?? 0,
              phase4TimingAdvanceDays: studentForPhase.phase4TimingAdvanceDays ?? 0,
              upcomingBookings: computeUpcomingBookings(studentEnrollmentsPhase, allClassesPhase),
            };
            const phaseCheck = validateClassBooking(
              targetForPhase,
              completedForPhase,
              (studentForPhase.courseType || 'auto').toLowerCase()
            );
            if (!phaseCheck.allowed) {
              return res.status(400).json({
                message: phaseCheck.reason ?? "Enrollment not allowed based on student's current phase.",
                policyViolation: phaseCheck.blockingRule ?? 'phase_ordering',
                detail: phaseCheck.detail,
                canOverride,
              });
            }
          }
        } else if (overridePolicy && canOverride) {
          // Override requested — log it but don't block; require a reason
          if (!overrideReason) {
            return res.status(400).json({
              message: 'A reason is required when overriding phase ordering rules.',
              requiresReason: true,
            });
          }
          policyViolations.push({
            policyType: 'phase_ordering',
            originalValue: 'Phase prerequisite required',
            overriddenValue: 'Manually overridden by authorized staff',
          });
        }
      }
      if (classData) {
        const classType = isTheoryClass(classData.classType, classData.classNumber) ? 'theory' : 'driving';
        const policies = await storage.getActiveBookingPolicies(classData.courseType || undefined, classType);

        // Check max_duration policy
        const maxDurationPolicy = policies.find(p => p.policyType === 'max_duration');
        if (maxDurationPolicy && classData.duration && classData.duration > maxDurationPolicy.value) {
          if (!overridePolicy || !canOverride) {
            return res.status(400).json({ 
              message: `Class duration exceeds policy limit (${maxDurationPolicy.value} minutes). ${canOverride ? 'Provide overrideReason to override.' : 'Contact an authorized staff member to override.'}`,
              policyViolation: 'max_duration',
              canOverride
            });
          }
          // Require reason for override
          if (!overrideReason) {
            return res.status(400).json({ 
              message: 'A reason is required when overriding booking policies.',
              requiresReason: true
            });
          }
          policyViolations.push({
            policyType: 'max_duration',
            originalValue: `${maxDurationPolicy.value} minutes`,
            overriddenValue: `${classData.duration} minutes`
          });
        }

        // Check the daily booking limit. Precedence rule: an active
        // max_bookings_per_day policy OVERRIDES the built-in default of
        // MAX_CLASSES_PER_DAY (2).
        const dailyLimit = effectiveDailyLimit(policies);
        if (classData.date && enrollmentData.studentId) {
          const studentEnrollments = await storage.getClassEnrollmentsByStudent(enrollmentData.studentId);
          const classesForStudent = await Promise.all(
            studentEnrollments
              .filter(e => !e.cancelledAt)
              .map(async (e) => e.classId ? await storage.getClass(e.classId) : null)
          );
          // Only count classes that are still scheduled — enrollments in
          // cancelled classes must not consume a daily slot.
          const bookingsOnSameDay = classesForStudent.filter(
            c => c && c.date === classData.date && c.status === 'scheduled'
          ).length;

          if (bookingsOnSameDay >= dailyLimit) {
            if (!overridePolicy || !canOverride) {
              return res.status(400).json({ 
                message: `Student has ${bookingsOnSameDay} booking(s) on this date. Maximum is ${dailyLimit}. ${canOverride ? 'Provide overrideReason to override.' : ''}`,
                policyViolation: 'max_bookings_per_day',
                canOverride
              });
            }
            // Require reason for override
            if (!overrideReason) {
              return res.status(400).json({ 
                message: 'A reason is required when overriding booking policies.',
                requiresReason: true
              });
            }
            policyViolations.push({
              policyType: 'max_bookings_per_day',
              originalValue: `${dailyLimit} bookings`,
              overriddenValue: `${bookingsOnSameDay + 1} bookings`
            });
          }

          // Check max_bookings_per_week / min_booking_notice /
          // max_pending_bookings policies
          const existingForPolicies = studentEnrollments
            .filter(e => !e.cancelledAt)
            .map(e => {
              const cls = classesForStudent.find(c => c && c.id === e.classId);
              return {
                date: cls?.date ?? null,
                classStatus: cls?.status ?? null,
                attendanceStatus: e.attendanceStatus ?? null,
              };
            });
          const wnpViolation = checkWeeklyNoticePendingPolicies(
            policies,
            { date: classData.date, time: classData.time },
            existingForPolicies,
          );
          if (wnpViolation) {
            if (!overridePolicy || !canOverride) {
              return res.status(400).json({
                message: `${wnpViolation.message} ${canOverride ? 'Provide overrideReason to override.' : 'Contact an authorized staff member to override.'}`,
                policyViolation: wnpViolation.policyType,
                canOverride
              });
            }
            if (!overrideReason) {
              return res.status(400).json({
                message: 'A reason is required when overriding booking policies.',
                requiresReason: true
              });
            }
            policyViolations.push({
              policyType: wnpViolation.policyType,
              originalValue: wnpViolation.message,
              overriddenValue: 'Manually overridden by authorized staff'
            });
          }
        }
      }

      // Validate learner's permit for driving (in-car) classes
      if (classData && enrollmentData.studentId) {
        const classType = isTheoryClass(classData.classType, classData.classNumber) ? 'theory' : 'driving';
        if (classType === 'driving') {
          const studentForPermit = await storage.getStudent(enrollmentData.studentId);
          if (studentForPermit) {
            if (!studentForPermit.learnerPermitNumber) {
              if (!overridePolicy || !canOverride) {
                return res.status(400).json({
                  message: "Student does not have a learner's permit on file. A valid permit is required for driving classes.",
                  policyViolation: 'permit_required',
                  canOverride
                });
              }
              if (!overrideReason) {
                return res.status(400).json({
                  message: 'A reason is required when overriding permit requirements.',
                  requiresReason: true
                });
              }
              policyViolations.push({
                policyType: 'permit_required',
                originalValue: 'Valid permit required',
                overriddenValue: 'No permit on file'
              });
            } else if (studentForPermit.learnerPermitExpiryDate) {
              const permitExpiry = new Date(studentForPermit.learnerPermitExpiryDate);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              
              if (permitExpiry < today) {
                if (!overridePolicy || !canOverride) {
                  return res.status(400).json({
                    message: "Student's learner's permit has expired. Cannot enroll in driving classes.",
                    policyViolation: 'permit_expired',
                    canOverride
                  });
                }
                if (!overrideReason) {
                  return res.status(400).json({
                    message: 'A reason is required when overriding permit requirements.',
                    requiresReason: true
                  });
                }
                policyViolations.push({
                  policyType: 'permit_expired',
                  originalValue: `Permit valid until ${permitExpiry.toLocaleDateString()}`,
                  overriddenValue: 'Expired permit'
                });
              } else if (classData.date) {
                const classDate = new Date(classData.date);
                if (classDate > permitExpiry) {
                  if (!overridePolicy || !canOverride) {
                    return res.status(400).json({
                      message: `Student's learner's permit expires on ${permitExpiry.toLocaleDateString()}. Cannot book class after that date.`,
                      policyViolation: 'permit_expires_before_class',
                      canOverride
                    });
                  }
                  if (!overrideReason) {
                    return res.status(400).json({
                      message: 'A reason is required when overriding permit requirements.',
                      requiresReason: true
                    });
                  }
                  policyViolations.push({
                    policyType: 'permit_expires_before_class',
                    originalValue: `Permit expires ${permitExpiry.toLocaleDateString()}`,
                    overriddenValue: `Class on ${classData.date}`
                  });
                }
              }
            }
          }
        }
      }

      // Create the enrollment
      const enrollment = await storage.createClassEnrollment(enrollmentData, bookingTx);

      // Log policy overrides and send notifications if any occurred
      if (policyViolations.length > 0 && req.user?.id && classData) {
        const student = enrollmentData.studentId ? await storage.getStudent(enrollmentData.studentId) : null;
        const staffName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'Staff';
        const studentName = student ? `${student.firstName} ${student.lastName}` : 'Unknown Student';
        const classInfo = `${classData.date} ${classData.time} - ${classData.courseType || 'Unknown'}`;
        
        // Get admin users to notify (users with admin role)
        const users = await storage.getUsers();
        const adminEmails = users
          .filter(u => u.role === 'admin' && u.email)
          .map(u => u.email!)
          .filter(Boolean);
        
        // Also notify the student if they have an email
        if (student?.email) {
          adminEmails.push(student.email);
        }

        for (const violation of policyViolations) {
          // Send email notification
          let notificationRecipients: string[] = [];
          if (adminEmails.length > 0) {
            try {
              notificationRecipients = await sendPolicyOverrideNotification({
                recipientEmails: adminEmails,
                staffName,
                studentName,
                actionType: 'book',
                policyType: violation.policyType,
                reason: overrideReason,
                classInfo,
                originalValue: violation.originalValue,
                overriddenValue: violation.overriddenValue,
                overrideDate: new Date()
              });
            } catch (emailError) {
              captureRequestError(emailError);
              console.error('Failed to send policy override notification:', emailError);
            }
          }

          // Create the audit log
          await storage.createPolicyOverrideLog({
            staffUserId: req.user.id,
            actionType: 'book',
            policyType: violation.policyType,
            reason: overrideReason,
            studentId: enrollmentData.studentId,
            classId: enrollmentData.classId,
            enrollmentId: enrollment.id,
            originalValue: violation.originalValue,
            overriddenValue: violation.overriddenValue,
            notificationSent: notificationRecipients.length > 0,
            notificationRecipients: notificationRecipients.length > 0 ? JSON.stringify(notificationRecipients) : null
          });

          // Also send in-app notification via unified notification service
          try {
            await notificationService.notifyPolicyOverride({
              studentId: enrollmentData.studentId ?? undefined,
              classId: enrollmentData.classId ?? undefined,
              policyType: violation.policyType,
              reason: overrideReason,
              staffName,
            }, req.user.id);
          } catch (notifyError) {
            captureRequestError(notifyError);
            console.error("Failed to send policy override notification via service:", notifyError);
          }
        }
      }

      // Auto-generate a contract when this is the student's first class enrollment
      if (enrollmentData.studentId && !enrollment.cancelledAt) {
        try {
          const allEnrollments = await storage.getClassEnrollmentsByStudent(enrollmentData.studentId);
          const activeEnrollments = allEnrollments.filter((e: any) => !e.cancelledAt);
          if (activeEnrollments.length === 1) {
            const existingContracts = await storage.getContractsByStudent(enrollmentData.studentId);
            if (existingContracts.length === 0) {
              const studentForContract = await storage.getStudent(enrollmentData.studentId);
              if (studentForContract) {
                const priceMap: Record<string, string> = { auto: "1130.00", moto: "1100.00", scooter: "375.00" };
                const courseType = (studentForContract.courseType || "auto").toLowerCase();
                await storage.createContract({
                  studentId: enrollmentData.studentId,
                  courseType,
                  contractDate: new Date().toISOString().split("T")[0],
                  amount: priceMap[courseType] ?? "1130.00",
                  paymentMethod: "full",
                  status: "pending",
                  specialNotes: "Auto-generated upon first class enrollment",
                  attestationGenerated: false,
                  autoGenerated: true,
                });
                console.log(`Auto-generated contract for student ${enrollmentData.studentId}`);
              }
            }
          }
        } catch (contractErr) {
          captureRequestError(contractErr);
          console.error("Auto-contract generation failed (non-critical):", contractErr);
        }
      }

      res.status(201).json(enrollment);
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating enrollment:", error);
      res.status(400).json({
        message: error instanceof Error && error.message === "Class is full"
          ? "Class is full"
          : "Invalid enrollment data",
      });
    }
  });

  // Helper: auto-generate a contract if the student has none, triggered when they complete Class 1
  async function autoContractOnClass1(studentId: number, classId: number) {
    try {
      const cls = await storage.getClass(classId);
      if (!cls || cls.classNumber !== 1) return;
      const existingContracts = await storage.getContractsByStudent(studentId);
      if (existingContracts.length > 0) return;
      const student = await storage.getStudent(studentId);
      if (!student) return;
      const priceMap: Record<string, string> = { auto: "1130.00", moto: "1100.00", scooter: "375.00" };
      const courseType = (student.courseType || "auto").toLowerCase();
      await storage.createContract({
        studentId,
        courseType,
        contractDate: new Date().toISOString().split("T")[0],
        amount: priceMap[courseType] ?? "1130.00",
        paymentMethod: "full",
        status: "pending",
        specialNotes: "Auto-generated when student completed Class 1",
        attestationGenerated: false,
        autoGenerated: true,
      });
      console.log(`Auto-generated contract for student ${studentId} after completing Class 1`);
    } catch (err) {
      captureRequestError(err);
      console.error("Auto-contract on Class 1 completion failed (non-critical):", err);
    }
  }

  // Notify a student that an upcoming in-car booking has become their next
  // lesson (slot #1) — triggered when their previous next in-car booking is
  // cancelled or missed. The student can keep the promoted booking or cancel
  // it from My Classes. Class-related mail: subject to UAT redirection.
  async function notifyInCarSlotPromotion(studentId: number) {
    const student = await storage.getStudent(studentId);
    if (!student?.email) return;
    const enrollments = await storage.getClassEnrollmentsByStudent(studentId);
    const allClasses = await storage.getClasses();
    const upcomingInCar = enrollments
      .filter(e => !e.cancelledAt && e.attendanceStatus !== 'attended' && e.attendanceStatus !== 'absent' && e.attendanceStatus !== 'no-show')
      .map(e => allClasses.find(c => c.id === e.classId))
      .filter((c): c is NonNullable<typeof c> =>
        !!c && c.status === 'scheduled' && c.classType === 'driving' && !!c.date &&
        !hasClassStarted({ date: c.date, time: c.time || "00:00" }))
      .sort((a, b) => `${a.date}T${a.time || ''}`.localeCompare(`${b.date}T${b.time || ''}`));
    if (upcomingInCar.length === 0) return;
    const next = upcomingInCar[0];
    const when = `${next.date} at ${next.time || ''}`.trim();
    const { sendEmail } = await import("./services/sendgrid");
    await sendEmail({
      to: [student.email],
      from: process.env.SENDGRID_FROM_EMAIL || "info@mortysdrivingschool.com",
      subject: "Your in-car lesson is now your next lesson",
      text: `Hi ${student.firstName || ''},\n\nYour in-car lesson scheduled for ${when} has moved up: it is now your next in-car lesson (#1).\n\nIf this time still works for you, no action is needed. If not, you can cancel this appointment from the My Classes page in your student portal.\n\nMorty's Driving School`,
      html: `<p>Hi ${student.firstName || ''},</p><p>Your in-car lesson scheduled for <strong>${when}</strong> has moved up: it is now your <strong>next in-car lesson (#1)</strong>.</p><p>If this time still works for you, no action is needed. If not, you can cancel this appointment from the <em>My Classes</em> page in your student portal.</p><p>Morty's Driving School</p>`,
    });
    console.log(`[in-car slots] Promotion email sent to student ${studentId} for class on ${when}`);
  }

  // No-show fee helpers (contract clause T01731) live in
  // server/services/no-show-fee.ts so they can be tested directly.
  // This wrapper binds the module-level Stripe client.
  function chargeNoShowFee(
    studentId: number,
    classData: { classType?: string | null; duration?: number | null; id?: number; classNumber?: number | null; date?: string | null; time?: string | null },
    enrollmentId?: number,
  ): Promise<void> {
    return chargeNoShowFeeImpl(stripe, studentId, classData, enrollmentId);
  }

  // Task 272: find the active (paired|confirmed) In-Car 12/13 paired session
  // for a given class, if one exists. Returns null on any lookup failure so
  // callers never block their response on it.
  async function findActivePairedSessionForClass(classId: number) {
    try {
      const sessions = await getActivePairedSessions();
      return sessions.find((s) => s.classId === classId) ?? null;
    } catch (err) {
      captureRequestError(err);
      console.error("[lesson-pairing] Failed to look up active paired session (non-critical):", err);
      return null;
    }
  }

  // Task 272: mark the combined 12/13 paired session for a class complete once
  // an enrollment on that canonical slot is marked attended. Idempotent in the
  // service; failures are logged but never block the caller.
  async function maybeCompletePairedSessionForClass(
    classData: { classType?: string | null; classNumber?: number | null; duration?: number | null; maxStudents?: number | null; courseType?: string | null; id?: number } | null | undefined,
    req: any,
  ): Promise<void> {
    if (!classData?.id) return;
    if (
      !isCombined1213Class({
        classType: classData.classType ?? null,
        classNumber: classData.classNumber ?? null,
        duration: classData.duration ?? null,
        maxStudents: classData.maxStudents ?? null,
        courseType: classData.courseType ?? null,
      })
    ) {
      return;
    }
    try {
      const session = await findActivePairedSessionForClass(classData.id);
      if (!session) return;
      const actor = req?.instructor ?? req?.user;
      await completeSession({
        pairedSessionId: session.id,
        actorId: actor?.id != null ? String(actor.id) : "system",
        actorRole: req?.instructor ? "instructor" : req?.user ? "admin" : "system",
      });
    } catch (err) {
      captureRequestError(err);
      console.error("[lesson-pairing] Failed to complete paired session after attendance (non-critical):", err);
    }
  }

  app.put("/api/class-enrollments/:id", isAdminOrInstructor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // Whitelist updatable fields. Moving an enrollment to a different class
      // (classId) is deliberately NOT allowed here — moves must go through the
      // validated booking/reschedule paths so progression rules always apply.
      const allowedFields = ["attendanceStatus", "testScore", "paymentStatus", "paidAmount"] as const;
      const updateData: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) updateData[field] = req.body[field];
      }
      const rejected = Object.keys(req.body).filter(k => !(allowedFields as readonly string[]).includes(k));
      if (rejected.length > 0) {
        return res.status(400).json({ message: `Fields not updatable via this endpoint: ${rejected.join(", ")}` });
      }
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No updatable fields provided" });
      }
      // Capture prior status before overwriting so we can detect first-time
      // transitions into absent/no-show for the no-show fee charge below.
      const prevEnrollment = await storage.getClassEnrollment(id);
      const prevAttendanceStatus = prevEnrollment?.attendanceStatus ?? null;

      const enrollment = await storage.updateClassEnrollment(id, updateData);
      if (updateData.attendanceStatus === "attended" && enrollment.studentId && enrollment.classId) {
        await autoContractOnClass1(enrollment.studentId, enrollment.classId);
        // Task 272: complete the combined 12/13 paired session for this class
        // (idempotent, non-blocking).
        const attendedClass = await storage.getClass(enrollment.classId);
        await maybeCompletePairedSessionForClass(attendedClass, req);
      }
      // A missed in-car lesson promotes the student's other upcoming in-car
      // booking (if any) to slot #1 — notify them to confirm or cancel it.
      if ((updateData.attendanceStatus === "absent" || updateData.attendanceStatus === "no-show") && enrollment.studentId && enrollment.classId) {
        const missedClass = await storage.getClass(enrollment.classId);
        if (missedClass?.classType === 'driving') {
          notifyInCarSlotPromotion(enrollment.studentId).catch(err => {
            captureRequestError(err);
            console.error("In-car slot promotion email failed (non-critical):", err);
          });
        }
        // Charge no-show fee per contract clause T01731 on first transition.
        const isFirstMissedTransition =
          prevAttendanceStatus !== 'absent' &&
          prevAttendanceStatus !== 'no-show';
        if (isFirstMissedTransition && missedClass) {
          chargeNoShowFee(enrollment.studentId, missedClass, id).catch(err => {
            captureRequestError(err);
            console.error("[no-show fee] Failed to charge fee via generic enrollment update:", err);
          });
        }
      }
      res.json(enrollment);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Failed to update enrollment" });
    }
  });

  app.delete("/api/class-enrollments/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteClassEnrollment(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to delete enrollment" });
    }
  });

  // ---- Attendance time-based enforcement + audit trail helpers ----

  // Students may be checked in up to 15 minutes before the scheduled start time.
  const CHECK_IN_EARLY_WINDOW_MINUTES = 15;

  // Extract the acting user (instructor session or admin user) for audit entries.
  function getAttendanceActor(req: any): { actorType: string; actorId: string; actorName: string | null } {
    if (req.instructor) {
      return {
        actorType: "instructor",
        actorId: String(req.instructor.id),
        actorName: `${req.instructor.firstName || ""} ${req.instructor.lastName || ""}`.trim() || req.instructor.email || null,
      };
    }
    if (req.user) {
      return {
        actorType: "admin",
        actorId: String(req.user.id),
        actorName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email || null,
      };
    }
    return { actorType: "unknown", actorId: "unknown", actorName: null };
  }

  // Write an attendance audit entry; never let audit failures break the request.
  async function logAttendanceAction(entry: {
    req: any;
    action: string;
    outcome: "success" | "blocked";
    classId?: number | null;
    enrollmentId?: number | null;
    studentId?: number | null;
    instructorId?: number | null;
    previousStatus?: string | null;
    newStatus?: string | null;
    blockReason?: string | null;
    details?: string | null;
  }) {
    try {
      const actor = getAttendanceActor(entry.req);
      await storage.createAttendanceAuditLog({
        ...actor,
        action: entry.action,
        outcome: entry.outcome,
        classId: entry.classId ?? null,
        enrollmentId: entry.enrollmentId ?? null,
        studentId: entry.studentId ?? null,
        instructorId: entry.instructorId ?? null,
        previousStatus: entry.previousStatus ?? null,
        newStatus: entry.newStatus ?? null,
        blockReason: entry.blockReason ?? null,
        details: entry.details ?? null,
      });
    } catch (err) {
      console.error("Failed to write attendance audit log (non-critical):", err);
    }
  }

  // Student Check-in/Check-out for lessons
  app.post("/api/class-enrollments/:id/check-in", isAdminOrInstructor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { signature } = req.body;
      
      if (!signature) {
        return res.status(400).json({ message: "Signature is required for check-in" });
      }

      const existingEnrollment = await storage.getClassEnrollment(id);
      if (!existingEnrollment || !existingEnrollment.classId) {
        return res.status(404).json({ message: "Enrollment not found" });
      }

      const checkInClass = await storage.getClass(existingEnrollment.classId);
      if (!checkInClass) {
        return res.status(404).json({ message: "Class not found" });
      }

      // Check-in opens 15 minutes before the scheduled start time
      const checkInBlock = attendanceStartGate(checkInClass, CHECK_IN_EARLY_WINDOW_MINUTES);
      if (checkInBlock) {
        await logAttendanceAction({
          req, action: "check_in", outcome: "blocked",
          classId: checkInClass.id, enrollmentId: id, studentId: existingEnrollment.studentId,
          instructorId: checkInClass.instructorId,
          previousStatus: existingEnrollment.attendanceStatus,
          blockReason: checkInBlock.blockReason,
        });
        return res.status(400).json({ message: checkInBlock.message });
      }

      const allEvaluations = await storage.getEvaluations();
      const classEvaluation = allEvaluations.find(
        e => e.classId === existingEnrollment.classId && (e.signedOff || (e.instructorSignature && e.studentSignature))
      );
      if (!classEvaluation) {
        return res.status(400).json({ message: "Evaluation must be completed for this class before checking in students" });
      }
      
      const enrollment = await storage.updateClassEnrollment(id, {
        checkInSignature: signature,
        checkInAt: new Date(),
        attendanceStatus: "checked_in"
      });

      await logAttendanceAction({
        req, action: "check_in", outcome: "success",
        classId: checkInClass.id, enrollmentId: id, studentId: existingEnrollment.studentId,
        instructorId: checkInClass.instructorId,
        previousStatus: existingEnrollment.attendanceStatus, newStatus: "checked_in",
      });
      
      res.json(enrollment);
    } catch (error) {
      captureRequestError(error);
      console.error("Error during check-in:", error);
      res.status(500).json({ message: "Failed to check in student" });
    }
  });

  app.post("/api/class-enrollments/:id/check-out", isAdminOrInstructor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { signature } = req.body;
      
      if (!signature) {
        return res.status(400).json({ message: "Signature is required for check-out" });
      }

      const existingEnrollment = await storage.getClassEnrollment(id);
      if (!existingEnrollment || !existingEnrollment.classId) {
        return res.status(404).json({ message: "Enrollment not found" });
      }

      const checkOutClass = await storage.getClass(existingEnrollment.classId);
      if (!checkOutClass) {
        return res.status(404).json({ message: "Class not found" });
      }

      // Check-out is only allowed once the class's scheduled start time has passed
      const checkOutBlock = attendanceStartGate(checkOutClass);
      if (checkOutBlock) {
        await logAttendanceAction({
          req, action: "check_out", outcome: "blocked",
          classId: checkOutClass.id, enrollmentId: id, studentId: existingEnrollment.studentId,
          instructorId: checkOutClass.instructorId,
          previousStatus: existingEnrollment.attendanceStatus,
          blockReason: checkOutBlock.blockReason,
        });
        return res.status(400).json({ message: checkOutBlock.message });
      }

      const enrollment = await storage.updateClassEnrollment(id, {
        checkOutSignature: signature,
        checkOutAt: new Date(),
        attendanceStatus: "attended"
      });

      await logAttendanceAction({
        req, action: "check_out", outcome: "success",
        classId: checkOutClass.id, enrollmentId: id, studentId: existingEnrollment.studentId,
        instructorId: checkOutClass.instructorId,
        previousStatus: existingEnrollment.attendanceStatus, newStatus: "attended",
      });

      if (existingEnrollment?.studentId && existingEnrollment?.classId) {
        await autoContractOnClass1(existingEnrollment.studentId, existingEnrollment.classId);
      }

      // Task 272: complete the combined 12/13 paired session for this class
      // once the student is marked attended (idempotent, non-blocking).
      await maybeCompletePairedSessionForClass(checkOutClass, req);

      res.json(enrollment);
    } catch (error) {
      captureRequestError(error);
      console.error("Error during check-out:", error);
      res.status(500).json({ message: "Failed to check out student" });
    }
  });

  app.post("/api/class-enrollments/:id/no-show", isAdminOrInstructor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      const existingEnrollment = await storage.getClassEnrollment(id);
      if (!existingEnrollment || !existingEnrollment.classId) {
        return res.status(404).json({ message: "Enrollment not found" });
      }

      const noShowClass = await storage.getClass(existingEnrollment.classId);
      if (!noShowClass) {
        return res.status(404).json({ message: "Class not found" });
      }

      // No-show can only be recorded once the class's scheduled start time has passed
      const noShowBlock = attendanceStartGate(noShowClass);
      if (noShowBlock) {
        await logAttendanceAction({
          req, action: "no_show", outcome: "blocked",
          classId: noShowClass.id, enrollmentId: id, studentId: existingEnrollment.studentId,
          instructorId: noShowClass.instructorId,
          previousStatus: existingEnrollment.attendanceStatus,
          blockReason: noShowBlock.blockReason,
        });
        return res.status(400).json({ message: noShowBlock.message });
      }

      const allEvaluations = await storage.getEvaluations();
      const classEvaluation = allEvaluations.find(
        e => e.classId === existingEnrollment.classId && (e.signedOff || (e.instructorSignature && e.studentSignature))
      );
      if (!classEvaluation) {
        return res.status(400).json({ message: "Evaluation must be completed for this class before marking students as no-show" });
      }
      
      const enrollment = await storage.updateClassEnrollment(id, {
        attendanceStatus: "no-show"
      });

      await logAttendanceAction({
        req, action: "no_show", outcome: "success",
        classId: noShowClass.id, enrollmentId: id, studentId: existingEnrollment.studentId,
        instructorId: noShowClass.instructorId,
        previousStatus: existingEnrollment.attendanceStatus, newStatus: "no-show",
      });

      // A missed in-car lesson frees the student's slot #1 — notify them that
      // their remaining upcoming in-car booking (if any) is now their next lesson.
      if (noShowClass.classType === 'driving' && existingEnrollment.studentId) {
        notifyInCarSlotPromotion(existingEnrollment.studentId).catch((err) => {
          captureRequestError(err);
          console.error("[in-car slots] Failed to send promotion email after no-show:", err);
        });
      }
      // Charge the no-show fee per contract clause T01731 — only on the
      // first transition into no-show (not on idempotent re-submissions).
      if (existingEnrollment.studentId && existingEnrollment.attendanceStatus !== 'no-show') {
        chargeNoShowFee(existingEnrollment.studentId, noShowClass, id).catch((err) => {
          captureRequestError(err);
          console.error("[no-show fee] Failed to charge fee after no-show mark:", err);
        });
      }

      // NOTE (Task 272): a no-show on a combined In-Car 12/13 session is NOT
      // automatically requeued or converted here. Conversion of the present
      // student to a solo lesson (and any requeue of the absent student) is an
      // explicit admin/instructor action via the pairing convert endpoint.
      // Surface a hint so the admin UI can offer the convert action when an
      // active paired session still exists for this class. The no-show fee
      // flow above is unchanged.
      let noShowResponse: Record<string, any> = { ...enrollment };
      if (
        isCombined1213Class({
          classType: noShowClass.classType,
          classNumber: noShowClass.classNumber,
          duration: noShowClass.duration,
          maxStudents: noShowClass.maxStudents,
          courseType: noShowClass.courseType,
        })
      ) {
        const pairedSession = await findActivePairedSessionForClass(noShowClass.id);
        if (pairedSession) {
          noShowResponse = {
            ...noShowResponse,
            pairedSessionId: pairedSession.id,
            canConvertPresentStudent: true,
          };
        }
      }

      res.json(noShowResponse);
    } catch (error) {
      captureRequestError(error);
      console.error("Error marking no-show:", error);
      res.status(500).json({ message: "Failed to mark student as no-show" });
    }
  });

  // Reset attendance (undo) - only allowed on the same day as the class
  app.post("/api/class-enrollments/:id/reset-attendance", isAdminOrInstructor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      const existingEnrollment = await storage.getClassEnrollment(id);
      if (!existingEnrollment || !existingEnrollment.classId) {
        return res.status(404).json({ message: "Enrollment not found" });
      }

      const classData = await storage.getClass(existingEnrollment.classId);
      if (!classData) {
        return res.status(404).json({ message: "Class not found" });
      }

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (classData.date !== todayStr) {
        await logAttendanceAction({
          req, action: "reset_attendance", outcome: "blocked",
          classId: classData.id, enrollmentId: id, studentId: existingEnrollment.studentId,
          instructorId: classData.instructorId,
          previousStatus: existingEnrollment.attendanceStatus,
          blockReason: "Attempted on a different day than the class",
        });
        return res.status(400).json({ message: "Attendance can only be corrected on the same day as the class" });
      }

      const enrollment = await storage.updateClassEnrollment(id, {
        checkInAt: null,
        checkInSignature: null,
        checkOutAt: null,
        checkOutSignature: null,
        attendanceStatus: "registered"
      });

      await logAttendanceAction({
        req, action: "reset_attendance", outcome: "success",
        classId: classData.id, enrollmentId: id, studentId: existingEnrollment.studentId,
        instructorId: classData.instructorId,
        previousStatus: existingEnrollment.attendanceStatus, newStatus: "registered",
      });

      res.json(enrollment);
    } catch (error) {
      captureRequestError(error);
      console.error("Error resetting attendance:", error);
      res.status(500).json({ message: "Failed to reset attendance" });
    }
  });

  // Get enrolled students for a class with their check-in status
  app.get("/api/classes/:classId/attendance", isAdminOrInstructor, async (req, res) => {
    try {
      const classId = parseInt(req.params.classId);
      const enrollments = await storage.getClassEnrollmentsByClass(classId);
      
      // Get student details for each enrollment and normalize to camelCase
      const enrollmentsWithStudents = await Promise.all(
        enrollments
          .filter(e => !e.cancelledAt)
          .map(async (enrollment: any) => {
            const student = enrollment.studentId 
              ? await storage.getStudent(enrollment.studentId) 
              : null;
            return {
              id: enrollment.id,
              classId: enrollment.classId || enrollment.class_id,
              studentId: enrollment.studentId || enrollment.student_id,
              attendanceStatus: enrollment.attendanceStatus || enrollment.attendance_status,
              testScore: enrollment.testScore || enrollment.test_score,
              cancelledAt: enrollment.cancelledAt || enrollment.cancelled_at,
              checkInSignature: enrollment.checkInSignature || enrollment.check_in_signature,
              checkInAt: enrollment.checkInAt || enrollment.check_in_at,
              checkOutSignature: enrollment.checkOutSignature || enrollment.check_out_signature,
              checkOutAt: enrollment.checkOutAt || enrollment.check_out_at,
              student: student ? {
                id: student.id,
                firstName: student.firstName,
                lastName: student.lastName,
                email: student.email,
                phone: student.phone
              } : null
            };
          })
      );
      
      res.json(enrollmentsWithStudents);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching class attendance:", error);
      res.status(500).json({ message: "Failed to fetch class attendance" });
    }
  });

  // Contracts routes
  app.get("/api/contracts", async (req, res) => {
    try {
      const { studentId } = req.query;
      if (studentId) {
        const contracts = await storage.getContractsByStudent(
          Number(studentId),
        );
        res.json(contracts);
      } else {
        const contracts = await storage.getContracts();
        res.json(contracts);
      }
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch contracts" });
    }
  });

  app.get("/api/contracts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const contract = await storage.getContract(id);
      if (!contract) {
        return res.status(404).json({ message: "Contract not found" });
      }
      res.json(contract);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch contract" });
    }
  });

  app.get("/api/contracts/student/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const contracts = await storage.getContractsByStudent(studentId);
      res.json(contracts);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch student contracts" });
    }
  });

  app.post("/api/contracts", async (req, res) => {
    try {
      const contractData = insertContractSchema.parse(req.body);
      if (contractData.status === "active" && !hasAllClauseInitials(contractData.clauseInitials)) {
        return res.status(400).json({
          message: "All contract clauses must be initialed before the contract can be activated",
        });
      }
      const contract = await storage.createContract(contractData);
      res.status(201).json(contract);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Invalid contract data" });
    }
  });

  app.put("/api/contracts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = { ...req.body };
      const existing = await storage.getContract(id);
      if (!existing) {
        return res.status(404).json({ message: "Contract not found" });
      }
      const becomingActive = updateData.status === "active" && existing.status !== "active";
      if (becomingActive) {
        const effectiveInitials =
          updateData.clauseInitials !== undefined ? updateData.clauseInitials : existing.clauseInitials;
        if (!hasAllClauseInitials(effectiveInitials)) {
          return res.status(400).json({
            message: "All contract clauses must be initialed before the contract can be activated",
          });
        }
        if (!updateData.signedDate) {
          updateData.signedDate = getSchoolLocalDate();
        }
      }
      const contract = await storage.updateContract(id, updateData);

      if (becomingActive && contract.studentId) {
        try {
          const student = await storage.getStudent(contract.studentId);
          if (!student) {
            console.error(
              `[contracts] Contract #${contract.id} became active, but student #${contract.studentId} was not found for the office notification.`,
            );
          } else {
            await notificationService.notifyContractSigned({
              contractId: contract.id,
              contractNumber: contract.contractNumber,
              studentId: student.id,
              studentName: `${student.firstName} ${student.lastName}`.trim(),
              studentEmail: student.email,
              courseType: contract.courseType,
              signedDate: contract.signedDate || updateData.signedDate,
            });
          }
        } catch (notificationError) {
          captureRequestError(notificationError);
          console.error(
            `[contracts] Failed to notify the office that contract #${contract.id} was signed (contract remains active):`,
            notificationError,
          );
        }
      }

      res.json(contract);
    } catch (error) {
      captureRequestError(error);
      console.error("Contract update error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Failed to update contract: ${msg}` });
    }
  });

  // Evaluations routes
  app.get("/api/evaluations", async (req, res) => {
    try {
      const { studentId } = req.query;
      if (studentId) {
        const evaluations = await storage.getEvaluationsByStudent(
          Number(studentId),
        );
        res.json(evaluations);
      } else {
        const evaluations = await storage.getEvaluations();
        res.json(evaluations);
      }
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch evaluations" });
    }
  });

  app.get("/api/evaluations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const evaluation = await storage.getEvaluation(id);
      if (!evaluation) {
        return res.status(404).json({ message: "Evaluation not found" });
      }
      res.json(evaluation);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch evaluation" });
    }
  });

  app.get("/api/evaluations/student/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const evaluations = await storage.getEvaluationsByStudent(studentId);
      res.json(evaluations);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch student evaluations" });
    }
  });

  app.post("/api/evaluations", async (req, res) => {
    try {
      const evaluationData = insertEvaluationSchema.parse(req.body);
      const evaluation = await storage.createEvaluation(evaluationData);
      res.status(201).json(evaluation);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Invalid evaluation data" });
    }
  });

  app.put("/api/evaluations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const evaluation = await storage.updateEvaluation(id, updateData);
      res.json(evaluation);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Failed to update evaluation" });
    }
  });

  // Notes routes
  app.get("/api/notes", async (req, res) => {
    try {
      const notes = await storage.getNotes();
      res.json(notes);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  app.get("/api/notes/student/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const notes = await storage.getNotesByStudent(studentId);
      res.json(notes);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch student notes" });
    }
  });

  app.post("/api/notes", async (req, res) => {
    try {
      const noteData = insertNoteSchema.parse(req.body);
      const note = await storage.createNote(noteData);
      res.status(201).json(note);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Invalid note data" });
    }
  });

  app.put("/api/notes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const note = await storage.updateNote(id, updateData);
      res.json(note);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Failed to update note" });
    }
  });

  app.delete("/api/notes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteNote(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to delete note" });
    }
  });

  // Communications routes
  app.get("/api/communications", async (req, res) => {
    try {
      const communications = await storage.getCommunications();
      res.json(communications);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch communications" });
    }
  });

  app.get("/api/communications/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const communication = await storage.getCommunication(id);
      if (!communication) {
        return res.status(404).json({ message: "Communication not found" });
      }
      res.json(communication);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch communication" });
    }
  });

  app.post("/api/communications", async (req, res) => {
    try {
      const communicationData = insertCommunicationSchema.parse(req.body);
      const communication =
        await storage.createCommunication(communicationData);
      res.status(201).json(communication);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Invalid communication data" });
    }
  });

  app.put("/api/communications/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const communication = await storage.updateCommunication(id, updateData);
      res.json(communication);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Failed to update communication" });
    }
  });

  // Dashboard stats endpoint
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const [totalRow] = await db.select({ value: count() }).from(students);
      const [activeRow] = await db.select({ value: count() }).from(students).where(eq(students.status, "active"));
      const [completedRow] = await db.select({ value: count() }).from(students).where(eq(students.status, "completed"));

      const instructors = await storage.getInstructors();
      const allClasses = await storage.getClasses();
      const contracts = await storage.getContracts();

      const stats = {
        totalStudents: Number(totalRow?.value ?? 0),
        activeStudents: Number(activeRow?.value ?? 0),
        completedStudents: Number(completedRow?.value ?? 0),
        activeInstructors: instructors.filter((i) => i.status === "active").length,
        classesThisWeek: allClasses.filter((c) => c.status === "scheduled").length,
        pendingContracts: contracts.filter((c) => c.status === "pending").length,
        totalContracts: contracts.length,
      };

      res.json(stats);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Class scheduling overview endpoint
  app.get("/api/dashboard/class-overview", async (req, res) => {
    try {
      const { view = "week" } = req.query;
      const classes = await storage.getClasses();
      const now = new Date();
      
      // Calculate date ranges
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);
      
      const startOfWeek = new Date(startOfToday);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 7);
      
      // Filter classes based on view - only scheduled classes
      const filteredClasses = classes.filter((c) => {
        if (c.status !== "scheduled") return false;
        if (!c.date) return false;
        const classDate = new Date(c.date);
        if (view === "day") {
          return classDate >= startOfToday && classDate < endOfToday;
        } else {
          return classDate >= startOfWeek && classDate < endOfWeek;
        }
      });
      
      // Count by class type using classType field, fallback to classNumber if not set
      const theoryClasses = filteredClasses.filter((c) => isTheoryClass(c.classType, c.classNumber));
      const drivingClasses = filteredClasses.filter((c) => !isTheoryClass(c.classType, c.classNumber));
      
      res.json({
        total: filteredClasses.length,
        theory: theoryClasses.length,
        driving: drivingClasses.length,
        view: view as string,
      });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch class overview" });
    }
  });

  // Dashboard: instructors who haven't set any availability
  app.get("/api/admin/instructors-missing-availability", authMiddleware, async (req, res) => {
    try {
      const allInstructors = await storage.getInstructors();
      const activeInstructors = allInstructors.filter(i => i.status === "active");
      const missing: { id: number; firstName: string; lastName: string; email: string }[] = [];
      for (const instructor of activeInstructors) {
        const avail = await storage.getInstructorAvailability(instructor.id);
        if (!avail || avail.length === 0) {
          missing.push({ id: instructor.id, firstName: instructor.firstName, lastName: instructor.lastName, email: instructor.email });
        }
      }
      res.json(missing);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch availability data" });
    }
  });

  // Dashboard: registration summary (this week + this month breakdown)
  app.get("/api/admin/registration-summary", authMiddleware, async (req, res) => {
    try {
      const students = await storage.getStudents();
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);

      // This week (Mon–Sun)
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const weekStartStr = weekStart.toISOString().slice(0, 10);

      // This month
      const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      const thisWeek = students.filter(s => s.enrollmentDate && s.enrollmentDate >= weekStartStr && s.enrollmentDate <= todayStr);
      const thisMonth = students.filter(s => s.enrollmentDate && s.enrollmentDate >= monthStartStr && s.enrollmentDate <= todayStr);

      const byType = (list: typeof students) => ({
        auto: list.filter(s => s.courseType === 'auto').length,
        moto: list.filter(s => s.courseType === 'moto').length,
        scooter: list.filter(s => s.courseType === 'scooter').length,
      });

      res.json({
        total: students.filter(s => s.status === 'active').length,
        thisWeek: { count: thisWeek.length, ...byType(thisWeek) },
        thisMonth: { count: thisMonth.length, ...byType(thisMonth) },
      });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch registration summary" });
    }
  });

  // Dashboard: latest nightly scrape outcome (reads scrape_failure notifications)
  app.get("/api/admin/scrape-status", authMiddleware, async (_req, res) => {
    try {
      const latest = await notificationService.getLatestScrapeFailure();
      if (!latest) {
        return res.json({ status: "ok", runDate: null, reason: null, lastFailureAt: null });
      }
      res.json({
        status: "failed",
        runDate: latest.runDate,
        reason: latest.reason,
        lastFailureAt: latest.createdAt,
      });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch scrape status" });
    }
  });

  // Dashboard: theory class attendance for a specific date
  app.get("/api/admin/theory-attendance", authMiddleware, async (req, res) => {
    try {
      const { date } = req.query;
      const targetDate = (date as string) || new Date().toISOString().slice(0, 10);
      const allClasses = await storage.getClasses();
      const instructors = await storage.getInstructors();

      const theoryClasses = allClasses.filter(c => c.classType === "theory" && c.date === targetDate);

      const result = await Promise.all(theoryClasses.map(async cls => {
        const enrollments = await storage.getClassEnrollmentsByClass(cls.id);
        const allStudents = await storage.getStudents();
        const instructor = instructors.find(i => i.id === cls.instructorId);
        const enrolledStudents = enrollments.map(e => {
          const student = allStudents.find(s => s.id === e.studentId);
          return {
            enrollmentId: e.id,
            studentId: e.studentId,
            studentName: student ? `${student.firstName} ${student.lastName}` : 'Unknown',
            attendanceStatus: e.attendanceStatus || 'pending',
          };
        });
        return {
          classId: cls.id,
          classNumber: cls.classNumber,
          courseType: cls.courseType,
          time: cls.time,
          room: cls.room,
          instructorName: instructor ? `${instructor.firstName} ${instructor.lastName}` : 'TBD',
          status: cls.status,
          enrolledCount: enrollments.length,
          students: enrolledStudents,
        };
      }));

      res.json({ date: targetDate, classes: result });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch theory attendance" });
    }
  });

  // Student completion analytics endpoint
  app.get(
    "/api/students/completion-analytics",
    authMiddleware,
    async (req, res) => {
      try {
        const { enrollmentYear, completionYear } = req.query;
        const analytics = await storage.getStudentCompletionAnalytics(
          enrollmentYear ? parseInt(enrollmentYear as string) : undefined,
          completionYear ? parseInt(completionYear as string) : undefined,
        );
        res.json(analytics);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching student completion analytics:", error);
        res.status(500).json({ message: "Failed to fetch analytics data" });
      }
    },
  );

  // Student registration analytics by location and time period
  app.get(
    "/api/students/registration-analytics",
    authMiddleware,
    async (req, res) => {
      try {
        const { period, startDate, endDate, locationId } = req.query;
        const analytics = await storage.getStudentRegistrationAnalytics({
          period: (period as "day" | "month" | "year") || "month",
          startDate: startDate as string,
          endDate: endDate as string,
          locationId: locationId ? parseInt(locationId as string) : undefined,
        });
        res.json(analytics);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching student registration analytics:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch registration analytics" });
      }
    },
  );

  // Summary analytics dashboard endpoint
  app.get("/api/analytics/summary", authMiddleware, async (req, res) => {
    try {
      const { startDate, endDate, period } = req.query;
      
      const students = await storage.getStudents();
      const classes = await storage.getClasses();
      const enrollments = await storage.getClassEnrollments();
      const instructors = await storage.getInstructors();
      
      // Filter by date range if provided
      let filteredClasses = classes;
      if (startDate) {
        filteredClasses = filteredClasses.filter(c => c.date >= (startDate as string));
      }
      if (endDate) {
        filteredClasses = filteredClasses.filter(c => c.date <= (endDate as string));
      }
      
      // Get enrollment counts for filtered classes
      const classIds = new Set(filteredClasses.map(c => c.id));
      const filteredEnrollments = enrollments.filter(e => e.classId && classIds.has(e.classId) && !e.cancelledAt);
      
      // Calculate statistics
      const completedClasses = filteredClasses.filter(c => c.status === 'completed');
      const noShows = filteredEnrollments.filter(e => e.attendanceStatus === 'no-show').length;
      const absences = filteredEnrollments.filter(e => e.attendanceStatus === 'absent').length;
      const totalAttendances = filteredEnrollments.filter(e => e.attendanceStatus === 'attended').length;
      
      // Calculate instructor hours from completed classes
      const instructorHoursMap: Record<number, { theoryHours: number; drivingHours: number; name: string }> = {};
      for (const cls of completedClasses) {
        if (cls.instructorId) {
          if (!instructorHoursMap[cls.instructorId]) {
            const instructor = instructors.find(i => i.id === cls.instructorId);
            instructorHoursMap[cls.instructorId] = {
              theoryHours: 0,
              drivingHours: 0,
              name: instructor ? `${instructor.firstName} ${instructor.lastName}` : 'Unknown'
            };
          }
          const hours = (cls.duration || 120) / 60;
          if (isTheoryClass(cls.classType, cls.classNumber)) {
            instructorHoursMap[cls.instructorId].theoryHours += hours;
          } else {
            instructorHoursMap[cls.instructorId].drivingHours += hours;
          }
        }
      }
      
      const totalTheoryHours = Object.values(instructorHoursMap).reduce((sum, i) => sum + i.theoryHours, 0);
      const totalDrivingHours = Object.values(instructorHoursMap).reduce((sum, i) => sum + i.drivingHours, 0);
      
      // Students by status
      const activeStudents = students.filter(s => s.status === 'active').length;
      const completedStudents = students.filter(s => s.status === 'completed').length;
      const onHoldStudents = students.filter(s => s.status === 'on-hold').length;
      
      // Students by course type
      const studentsByCourse = {
        auto: students.filter(s => s.courseType === 'auto').length,
        moto: students.filter(s => s.courseType === 'moto').length,
        scooter: students.filter(s => s.courseType === 'scooter').length
      };
      
      // Classes by type
      const theoryClasses = filteredClasses.filter(c => isTheoryClass(c.classType, c.classNumber)).length;
      const drivingClasses = filteredClasses.filter(c => !isTheoryClass(c.classType, c.classNumber)).length;
      const completedTheoryClasses = completedClasses.filter(c => isTheoryClass(c.classType, c.classNumber)).length;
      const completedDrivingClasses = completedClasses.filter(c => !isTheoryClass(c.classType, c.classNumber)).length;
      
      res.json({
        students: {
          total: students.length,
          active: activeStudents,
          completed: completedStudents,
          onHold: onHoldStudents,
          byCourse: studentsByCourse
        },
        classes: {
          total: filteredClasses.length,
          completed: completedClasses.length,
          scheduled: filteredClasses.filter(c => c.status === 'scheduled').length,
          cancelled: filteredClasses.filter(c => c.status === 'cancelled').length,
          theory: theoryClasses,
          driving: drivingClasses,
          completedTheory: completedTheoryClasses,
          completedDriving: completedDrivingClasses
        },
        attendance: {
          totalEnrollments: filteredEnrollments.length,
          attended: totalAttendances,
          noShows: noShows,
          absences: absences,
          attendanceRate: filteredEnrollments.length > 0 ? Math.round((totalAttendances / filteredEnrollments.length) * 100) : 0,
          noShowRate: filteredEnrollments.length > 0 ? Math.round((noShows / filteredEnrollments.length) * 100) : 0
        },
        instructorHours: {
          totalTheory: Math.round(totalTheoryHours * 10) / 10,
          totalDriving: Math.round(totalDrivingHours * 10) / 10,
          total: Math.round((totalTheoryHours + totalDrivingHours) * 10) / 10,
          byInstructor: Object.entries(instructorHoursMap).map(([id, data]) => ({
            instructorId: parseInt(id),
            instructorName: data.name,
            theoryHours: Math.round(data.theoryHours * 10) / 10,
            drivingHours: Math.round(data.drivingHours * 10) / 10,
            totalHours: Math.round((data.theoryHours + data.drivingHours) * 10) / 10
          }))
        }
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching summary analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  // Attendance report endpoint with export support
  app.get("/api/reports/attendance", authMiddleware, async (req, res) => {
    try {
      const { startDate, endDate, instructorId, studentId, status, format } = req.query;
      
      const classes = await storage.getClasses();
      const enrollments = await storage.getClassEnrollments();
      const students = await storage.getStudents();
      const instructors = await storage.getInstructors();
      
      // Build attendance records
      let records = enrollments
        .filter(e => !e.cancelledAt)
        .map(enrollment => {
          const cls = classes.find(c => c.id === enrollment.classId);
          const student = students.find(s => s.id === enrollment.studentId);
          const instructor = cls?.instructorId ? instructors.find(i => i.id === cls.instructorId) : null;
          
          return {
            enrollmentId: enrollment.id,
            classId: enrollment.classId,
            classDate: cls?.date || '',
            classTime: cls?.time || '',
            classNumber: cls?.classNumber || 0,
            classType: cls && isTheoryClass(cls.classType, cls.classNumber) ? 'Theory' : 'Driving',
            courseType: cls?.courseType || '',
            studentId: enrollment.studentId,
            studentName: student ? `${student.firstName} ${student.lastName}` : 'Unknown',
            studentEmail: student?.email || '',
            instructorId: cls?.instructorId,
            instructorName: instructor ? `${instructor.firstName} ${instructor.lastName}` : 'Unassigned',
            attendanceStatus: enrollment.attendanceStatus || 'registered',
            testScore: enrollment.testScore
          };
        });
      
      // Apply filters
      if (startDate) {
        records = records.filter(r => r.classDate >= (startDate as string));
      }
      if (endDate) {
        records = records.filter(r => r.classDate <= (endDate as string));
      }
      if (instructorId) {
        records = records.filter(r => r.instructorId === parseInt(instructorId as string));
      }
      if (studentId) {
        records = records.filter(r => r.studentId === parseInt(studentId as string));
      }
      if (status && status !== 'all') {
        records = records.filter(r => r.attendanceStatus === status);
      }
      
      // Sort by date descending
      records.sort((a, b) => b.classDate.localeCompare(a.classDate));
      
      // Export as CSV if requested
      if (format === 'csv') {
        const headers = ['Date', 'Time', 'Class Type', 'Class #', 'Course', 'Student', 'Email', 'Instructor', 'Status', 'Test Score'];
        const rows = records.map(r => [
          r.classDate,
          r.classTime,
          r.classType,
          r.classNumber,
          r.courseType,
          r.studentName,
          r.studentEmail,
          r.instructorName,
          r.attendanceStatus,
          r.testScore || ''
        ]);
        
        const csv = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance-report-${new Date().toISOString().split('T')[0]}.csv`);
        return res.send(csv);
      }
      
      res.json(records);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching attendance report:", error);
      res.status(500).json({ message: "Failed to fetch attendance report" });
    }
  });

  // Instructor payroll/hours report - restricted to owner role only
  app.get("/api/reports/payroll", authMiddleware, async (req, res) => {
    try {
      const { startDate, endDate, instructorId, format } = req.query;
      const user = req.user;
      
      // Check if user has permission to view payroll (owner role only)
      const allowedRoles = ['owner', 'admin'];
      if (!user || !allowedRoles.includes(user.role || '')) {
        // Log access denied
        await storage.createPayrollAccessLog({
          userId: user?.id || null,
          userEmail: user?.email || 'unknown',
          userRole: user?.role || 'unknown',
          action: 'access_denied',
          filters: { startDate, endDate, instructorId },
          ipAddress: req.ip || req.headers['x-forwarded-for']?.toString() || null,
          userAgent: req.headers['user-agent'] || null,
          success: false,
        });
        return res.status(403).json({ message: "Access denied. Only owners can view payroll data." });
      }
      
      // Log successful access
      await storage.createPayrollAccessLog({
        userId: user.id,
        userEmail: user.email || null,
        userRole: user.role || null,
        action: format === 'csv' ? 'export_csv' : 'view',
        filters: { startDate, endDate, instructorId },
        ipAddress: req.ip || req.headers['x-forwarded-for']?.toString() || null,
        userAgent: req.headers['user-agent'] || null,
        success: true,
      });
      
      const classes = await storage.getClasses();
      const instructors = await storage.getInstructors();
      
      // Filter completed classes
      let completedClasses = classes.filter(c => c.status === 'completed');
      
      if (startDate) {
        completedClasses = completedClasses.filter(c => c.date >= (startDate as string));
      }
      if (endDate) {
        completedClasses = completedClasses.filter(c => c.date <= (endDate as string));
      }
      if (instructorId) {
        completedClasses = completedClasses.filter(c => c.instructorId === parseInt(instructorId as string));
      }
      
      // Group by instructor
      const payrollData: Record<number, {
        instructorId: number;
        instructorName: string;
        email: string;
        theoryClasses: number;
        drivingClasses: number;
        theoryHours: number;
        drivingHours: number;
        totalHours: number;
        classDates: string[];
      }> = {};
      
      for (const cls of completedClasses) {
        if (cls.instructorId) {
          if (!payrollData[cls.instructorId]) {
            const instructor = instructors.find(i => i.id === cls.instructorId);
            payrollData[cls.instructorId] = {
              instructorId: cls.instructorId,
              instructorName: instructor ? `${instructor.firstName} ${instructor.lastName}` : 'Unknown',
              email: instructor?.email || '',
              theoryClasses: 0,
              drivingClasses: 0,
              theoryHours: 0,
              drivingHours: 0,
              totalHours: 0,
              classDates: []
            };
          }
          
          const hours = (cls.duration || 120) / 60;
          payrollData[cls.instructorId].classDates.push(cls.date);
          
          if (isTheoryClass(cls.classType, cls.classNumber)) {
            payrollData[cls.instructorId].theoryClasses++;
            payrollData[cls.instructorId].theoryHours += hours;
          } else {
            payrollData[cls.instructorId].drivingClasses++;
            payrollData[cls.instructorId].drivingHours += hours;
          }
          payrollData[cls.instructorId].totalHours += hours;
        }
      }
      
      const records = Object.values(payrollData).map(p => ({
        ...p,
        theoryHours: Math.round(p.theoryHours * 10) / 10,
        drivingHours: Math.round(p.drivingHours * 10) / 10,
        totalHours: Math.round(p.totalHours * 10) / 10,
        classDates: undefined // Don't include in final output
      }));
      
      if (format === 'csv') {
        const headers = ['Instructor', 'Email', 'Theory Classes', 'Driving Classes', 'Theory Hours', 'Driving Hours', 'Total Hours'];
        const rows = records.map(r => [
          r.instructorName,
          r.email,
          r.theoryClasses,
          r.drivingClasses,
          r.theoryHours,
          r.drivingHours,
          r.totalHours
        ]);
        
        const csv = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=payroll-report-${new Date().toISOString().split('T')[0]}.csv`);
        return res.send(csv);
      }
      
      res.json(records);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching payroll report:", error);
      res.status(500).json({ message: "Failed to fetch payroll report" });
    }
  });

  // Student credits report
  app.get("/api/reports/student-credits", authMiddleware, async (req, res) => {
    try {
      const { studentId, courseType, format } = req.query;
      
      const students = await storage.getStudents();
      const enrollments = await storage.getClassEnrollments();
      const classes = await storage.getClasses();
      
      let filteredStudents = students;
      if (studentId) {
        filteredStudents = filteredStudents.filter(s => s.id === parseInt(studentId as string));
      }
      if (courseType && courseType !== 'all') {
        filteredStudents = filteredStudents.filter(s => s.courseType === courseType);
      }
      
      const attendedHoursMap = await storage.getStudentsAttendedHours(filteredStudents.map(s => s.id));
      
      const records = filteredStudents.map(student => {
        const studentEnrollments = enrollments.filter(e => e.studentId === student.id && !e.cancelledAt);
        const attendedEnrollments = studentEnrollments.filter(e => e.attendanceStatus === 'attended');
        const attendedHours = attendedHoursMap.get(student.id);
        
        // Count by class type
        let theoryClassesAttended = 0;
        let drivingClassesAttended = 0;
        
        for (const enrollment of attendedEnrollments) {
          const cls = classes.find(c => c.id === enrollment.classId);
          if (cls) {
            if (isTheoryClass(cls.classType, cls.classNumber)) {
              theoryClassesAttended++;
            } else {
              drivingClassesAttended++;
            }
          }
        }
        
        return {
          studentId: student.id,
          studentName: `${student.firstName} ${student.lastName}`,
          email: student.email,
          phone: student.phone,
          courseType: student.courseType,
          status: student.status,
          totalEnrollments: studentEnrollments.length,
          totalAttended: attendedEnrollments.length,
          theoryClassesAttended,
          drivingClassesAttended,
          theoryHoursCompleted: attendedHours ? Math.round(attendedHours.theoryHours * 10) / 10 : 0,
          practicalHoursCompleted: attendedHours ? Math.round(attendedHours.drivingHours * 10) / 10 : 0,
          progress: student.progress || 0
        };
      });
      
      if (format === 'csv') {
        const headers = ['Student', 'Email', 'Phone', 'Course', 'Status', 'Theory Classes', 'Driving Classes', 'Theory Hours', 'Practical Hours', 'Progress'];
        const rows = records.map(r => [
          r.studentName,
          r.email,
          r.phone,
          r.courseType,
          r.status,
          r.theoryClassesAttended,
          r.drivingClassesAttended,
          r.theoryHoursCompleted,
          r.practicalHoursCompleted,
          `${r.progress}%`
        ]);
        
        const csv = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=student-credits-report-${new Date().toISOString().split('T')[0]}.csv`);
        return res.send(csv);
      }
      
      res.json(records);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student credits report:", error);
      res.status(500).json({ message: "Failed to fetch student credits report" });
    }
  });

  // Registration report with CSV export
  app.get("/api/reports/registrations", authMiddleware, async (req, res) => {
    try {
      const { startDate, endDate, locationId, courseType, format } = req.query;
      
      const students = await storage.getStudents();
      const locations = await storage.getLocations();
      
      let filteredStudents = students;
      
      if (startDate) {
        filteredStudents = filteredStudents.filter(s => {
          const enrollDate = s.enrollmentDate ? new Date(s.enrollmentDate) : null;
          return enrollDate && enrollDate >= new Date(startDate as string);
        });
      }
      
      if (endDate) {
        filteredStudents = filteredStudents.filter(s => {
          const enrollDate = s.enrollmentDate ? new Date(s.enrollmentDate) : null;
          return enrollDate && enrollDate <= new Date(endDate as string);
        });
      }
      
      if (locationId && locationId !== 'all') {
        filteredStudents = filteredStudents.filter(s => s.locationId?.toString() === locationId);
      }
      
      if (courseType && courseType !== 'all') {
        filteredStudents = filteredStudents.filter(s => s.courseType === courseType);
      }
      
      const records = filteredStudents.map(student => {
        const location = locations.find(l => l.id === student.locationId);
        return {
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          phone: student.phone,
          courseType: student.courseType,
          status: student.status,
          location: location?.name || 'N/A',
          enrollmentDate: student.enrollmentDate || 'N/A',
          phase: student.phase || 'N/A',
          progress: student.progress
        };
      });
      
      // Sort by enrollment date descending
      records.sort((a, b) => {
        if (a.enrollmentDate === 'N/A') return 1;
        if (b.enrollmentDate === 'N/A') return -1;
        return new Date(b.enrollmentDate).getTime() - new Date(a.enrollmentDate).getTime();
      });
      
      if (format === 'csv') {
        const headers = ['ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Course Type', 'Status', 'Location', 'Enrollment Date', 'Phase', 'Progress'];
        const rows = records.map(r => [
          r.id,
          r.firstName,
          r.lastName,
          r.email,
          r.phone,
          r.courseType,
          r.status,
          r.location,
          r.enrollmentDate,
          r.phase,
          `${r.progress}%`
        ]);
        
        const csv = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=registration-report-${new Date().toISOString().split('T')[0]}.csv`);
        return res.send(csv);
      }
      
      res.json(records);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching registration report:", error);
      res.status(500).json({ message: "Failed to fetch registration report" });
    }
  });

  // Student documents routes
  app.get("/api/students/:studentId/documents", authMiddleware, async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const documents = await storage.getStudentDocuments(studentId);
      res.json(documents);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post("/api/students/:studentId/documents", authMiddleware, async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const { documentType, documentName, documentData, mimeType, fileSize } = req.body;

      // Create record first to get the document ID for S3 key generation
      const document = await storage.createStudentDocument({
        studentId,
        documentType,
        documentName,
        documentData: "__pending__",
        mimeType,
        fileSize,
        uploadDate: new Date().toISOString().split('T')[0],
        verificationStatus: 'pending'
      });

      // Upload to S3 if configured, then update the stored key
      const storedData = await storeDocument(documentData, studentId, document.id, documentName, mimeType || "application/octet-stream");
      if (storedData !== documentData || storedData === "__pending__") {
        await storage.updateStudentDocument(document.id, { documentData: storedData });
        document.documentData = storedData;
      } else {
        await storage.updateStudentDocument(document.id, { documentData });
        document.documentData = documentData;
      }

      res.status(201).json(document);
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating student document:", error);
      res.status(400).json({ message: "Failed to upload document" });
    }
  });

  app.put("/api/student-documents/:id/verify", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { verificationStatus, rejectionReason, folderName, expiryDate, notes } = req.body;
      const userId = (req as any).user?.id;
      
      const updateData: Record<string, any> = {};
      
      if (verificationStatus !== undefined) {
        updateData.verificationStatus = verificationStatus;
        updateData.verifiedBy = userId;
        updateData.verifiedAt = new Date();
        updateData.rejectionReason = verificationStatus === 'rejected' ? rejectionReason : null;
      }
      
      if (folderName !== undefined) updateData.folderName = folderName || null;
      if (expiryDate !== undefined) updateData.expiryDate = expiryDate || null;
      if (notes !== undefined) updateData.notes = notes || null;
      
      const document = await storage.updateStudentDocument(id, updateData);
      res.json(document);
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating document:", error);
      res.status(400).json({ message: "Failed to update document" });
    }
  });
  
  app.put("/api/student-documents/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { folderName, expiryDate, notes, documentName } = req.body;
      
      const updateData: Record<string, any> = {};
      if (folderName !== undefined) updateData.folderName = folderName || null;
      if (expiryDate !== undefined) updateData.expiryDate = expiryDate || null;
      if (notes !== undefined) updateData.notes = notes || null;
      if (documentName !== undefined) updateData.documentName = documentName;
      
      const document = await storage.updateStudentDocument(id, updateData);
      res.json(document);
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating document metadata:", error);
      res.status(400).json({ message: "Failed to update document" });
    }
  });

  app.delete("/api/student-documents/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // Fetch the document to get its S3 key before deleting
      const [doc] = await db.select().from(studentDocuments).where(eq(studentDocuments.id, id)).limit(1);
      if (doc?.documentData && isS3Key(doc.documentData)) {
        await deleteFromS3(doc.documentData);
      }
      await storage.deleteStudentDocument(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      console.error("Error deleting document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // Download/view a document file (fetches from S3 or returns base64 data)
  app.get("/api/student-documents/:id/file", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [doc] = await db.select().from(studentDocuments).where(eq(studentDocuments.id, id)).limit(1);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      if (isS3Key(doc.documentData)) {
        const { buffer, contentType } = await downloadFromS3(doc.documentData!);
        res.set("Content-Type", contentType);
        res.set("Content-Disposition", `inline; filename="${doc.documentName}"`);
        return res.send(buffer);
      }

      if (doc.documentData?.startsWith("data:")) {
        const [header, base64] = doc.documentData.split(",");
        const mimeType = header.match(/data:([^;]+)/)?.[1] || "application/octet-stream";
        const buffer = Buffer.from(base64, "base64");
        res.set("Content-Type", mimeType);
        res.set("Content-Disposition", `inline; filename="${doc.documentName}"`);
        return res.send(buffer);
      }

      res.status(404).json({ message: "No file data available" });
    } catch (error) {
      captureRequestError(error);
      console.error("Error downloading document:", error);
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  // Instructor Availability routes
  app.get("/api/instructors/:instructorId/availability", async (req, res) => {
    try {
      const instructorId = parseInt(req.params.instructorId);
      const availability =
        await storage.getInstructorAvailability(instructorId);
      res.json(availability);
    } catch (error) {
      captureRequestError(error);
      res
        .status(500)
        .json({ message: "Failed to fetch instructor availability" });
    }
  });

  app.post("/api/instructors/:instructorId/availability", async (req, res) => {
    try {
      const instructorId = parseInt(req.params.instructorId);
      const availabilityData = insertInstructorAvailabilitySchema.parse({
        ...req.body,
        instructorId,
      });
      const availability =
        await storage.createInstructorAvailability(availabilityData);
      res.status(201).json(availability);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Invalid availability data" });
    }
  });

  app.put("/api/instructors/availability/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const availability = await storage.updateInstructorAvailability(
        id,
        updateData,
      );
      res.json(availability);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Failed to update availability" });
    }
  });

  app.delete("/api/instructors/availability/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteInstructorAvailability(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to delete availability" });
    }
  });

  // Zoom Integration routes
  app.get("/api/zoom/settings", async (req, res) => {
    try {
      const settings = await storage.getZoomSettings();
      res.json(settings);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch Zoom settings" });
    }
  });

  app.put("/api/zoom/settings", async (req, res) => {
    try {
      const settingsData = insertZoomSettingsSchema.parse(req.body);
      const settings = await storage.updateZoomSettings(settingsData);
      res.json(settings);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Invalid settings data" });
    }
  });

  app.get("/api/classes/:classId/zoom-meetings", async (req, res) => {
    try {
      const classId = parseInt(req.params.classId);
      const meetings = await storage.getZoomMeetingsByClass(classId);
      res.json(meetings);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch Zoom meetings" });
    }
  });

  app.post("/api/classes/:classId/zoom-meetings", async (req, res) => {
    try {
      const classId = parseInt(req.params.classId);
      const meetingData = insertZoomMeetingSchema.parse({
        ...req.body,
        classId,
      });
      const meeting = await storage.createZoomMeeting(meetingData);
      res.status(201).json(meeting);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Invalid meeting data" });
    }
  });

  app.get("/api/zoom/meetings/:meetingId/attendance", async (req, res) => {
    try {
      const meetingId = parseInt(req.params.meetingId);
      const attendance = await storage.getZoomAttendanceByMeeting(meetingId);
      res.json(attendance);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch attendance data" });
    }
  });

  app.put("/api/zoom/attendance/:attendanceId/adjust", async (req, res) => {
    try {
      const attendanceId = parseInt(req.params.attendanceId);
      const { status, reason, adjustedBy } = req.body;

      await storage.updateZoomAttendance(attendanceId, {
        attendanceStatus: status,
        isManuallyAdjusted: true,
        adjustedBy,
        adjustmentReason: reason,
      });

      res.json({ message: "Attendance adjusted successfully" });
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Failed to adjust attendance" });
    }
  });

  app.get("/api/students/:studentId/zoom-attendance", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const attendance = await storage.getZoomAttendanceByStudent(studentId);
      res.json(attendance);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch student attendance" });
    }
  });

  // Webhook endpoint for Zoom
  app.post("/api/zoom/webhook", async (req, res) => {
    try {
      // Zoom webhook verification and processing would go here
      // For now, just acknowledge receipt
      res.status(200).json({ message: "Webhook received" });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Webhook processing failed" });
    }
  });

  // School Permits routes
  app.get("/api/school-permits", async (req, res) => {
    try {
      const permits = await storage.getSchoolPermits();
      res.json(permits);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch school permits" });
    }
  });

  app.get("/api/school-permits/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const permit = await storage.getSchoolPermit(id);
      if (!permit) {
        return res.status(404).json({ message: "School permit not found" });
      }
      res.json(permit);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch school permit" });
    }
  });

  app.post("/api/school-permits", async (req, res) => {
    try {
      const permitData = insertSchoolPermitSchema.parse(req.body);
      const permit = await storage.createSchoolPermit(permitData);
      res.status(201).json(permit);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Invalid school permit data" });
    }
  });

  app.put("/api/school-permits/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const permit = await storage.updateSchoolPermit(id, updateData);
      res.json(permit);
    } catch (error) {
      captureRequestError(error);
      res.status(400).json({ message: "Failed to update school permit" });
    }
  });

  app.delete("/api/school-permits/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSchoolPermit(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to delete school permit" });
    }
  });

  // Permit Numbers routes
  app.get("/api/school-permits/:permitId/numbers", async (req, res) => {
    try {
      const permitId = parseInt(req.params.permitId);
      const numbers = await storage.getPermitNumbers(permitId);
      res.json(numbers);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch permit numbers" });
    }
  });

  app.post("/api/students/:studentId/assign-permit", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const { courseType } = req.body;

      // Find available permits for this course type
      const permits = await storage.getSchoolPermits();
      const availablePermit = permits.find((p) => {
        const courseTypes = JSON.parse(p.courseTypes);
        return (
          courseTypes.includes(courseType) &&
          p.availableNumbers > 0 &&
          p.isActive
        );
      });

      if (!availablePermit) {
        return res
          .status(404)
          .json({ message: "No available permits for this course type" });
      }

      const availableNumber = await storage.getAvailablePermitNumber(
        availablePermit.id,
        courseType,
      );
      if (!availableNumber) {
        return res.status(404).json({ message: "No available permit numbers" });
      }

      const assignedNumber = await storage.assignPermitNumber(
        availableNumber.id,
        studentId,
      );
      res.json(assignedNumber);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to assign permit number" });
    }
  });

  app.get("/api/students/:studentId/permits", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const permits = await storage.getAssignedPermitNumbers(studentId);
      res.json(permits);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch student permits" });
    }
  });

  // Data Migration endpoints
  app.post("/api/migration/start", async (req, res) => {
    try {
      if (migrationInProgress) {
        return res.status(409).json({ error: "Migration already in progress" });
      }

      const { username, password } = req.body;

      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "Username and password are required" });
      }

      migrationInProgress = true;
      scraper = new LegacyScraper({ username, password });

      // Start migration in background
      scraper
        .scrapeAllStudents()
        .then(() => {
          console.log("Migration completed successfully");
          migrationInProgress = false;
        })
        .catch((error) => {
          console.error("Migration failed:", error);
          migrationInProgress = false;
        })
        .finally(() => {
          if (scraper) {
            scraper.cleanup();
            scraper = null;
          }
        });

      res.json({ message: "Migration started successfully" });
    } catch (error) {
      captureRequestError(error);
      console.error("Failed to start migration:", error);
      migrationInProgress = false;
      res.status(500).json({ error: "Failed to start migration" });
    }
  });

  app.get("/api/migration/progress", (req, res) => {
    if (!scraper || !migrationInProgress) {
      return res.json({
        inProgress: false,
        totalStudents: 0,
        processedStudents: 0,
        currentLetter: "",
        errors: [],
        estimatedTimeRemaining: null,
      });
    }

    const progress = scraper.getProgress();
    res.json({
      inProgress: migrationInProgress,
      ...progress,
    });
  });

  app.post("/api/migration/stop", async (req, res) => {
    try {
      if (scraper) {
        await scraper.cleanup();
        scraper = null;
      }
      migrationInProgress = false;

      res.json({ message: "Migration stopped successfully" });
    } catch (error) {
      captureRequestError(error);
      console.error("Failed to stop migration:", error);
      res.status(500).json({ error: "Failed to stop migration" });
    }
  });

  // ---------------------------------------------------------------------
  // Legacy data import (walks scraped page-level JSON into the database)
  // ---------------------------------------------------------------------

  // Counts of available scraped pages by type + how many already imported.
  app.get("/api/import/manifest", requireAdmin, async (_req, res) => {
    try {
      const manifest = await getImportManifest();
      res.json(manifest);
    } catch (error: any) {
      captureRequestError(error);
      console.error("Failed to read import manifest:", error);
      res.status(500).json({ error: error?.message || "Failed to read manifest" });
    }
  });

  // Kick off the import in the background. Returns immediately.
  app.post("/api/import/start", requireAdmin, async (req, res) => {
    try {
      if (isImportRunning()) {
        return res.status(409).json({ error: "Import already in progress" });
      }
      const reimportAll = req.body?.reimportAll === true;
      // Fire and forget — progress is polled via /api/import/status.
      runImport({ reimportAll }).catch((err) => {
        console.error("Import run failed:", err);
      });
      res.json({ message: "Import started", reimportAll });
    } catch (error: any) {
      captureRequestError(error);
      console.error("Failed to start import:", error);
      res.status(500).json({ error: error?.message || "Failed to start import" });
    }
  });

  // Live status: logs, progress, and created/updated/skipped/error summary.
  app.get("/api/import/status", requireAdmin, (_req, res) => {
    res.json(getImportState());
  });

  // Read-only view of the nightly registration scrape log (cron-driven) so the
  // operator can confirm scrapes ran and spot failures without SSH access.
  app.get("/api/import/nightly-log", requireAdmin, async (_req, res) => {
    try {
      const log = await getNightlyScrapeLog();
      res.json(log);
    } catch (error: any) {
      captureRequestError(error);
      console.error("Failed to read nightly scrape log:", error);
      res
        .status(500)
        .json({ error: error?.message || "Failed to read nightly scrape log" });
    }
  });

  // Read-only gap analysis over the scraped files: what data is in the files
  // that the importer is NOT putting into the database. Reuses the cached
  // `_gap_analysis.json` when fresh (pass ?refresh=1 to force a recompute).
  // NEVER writes to the database and never mutates the import files.
  app.get("/api/import/gap-analysis", requireAdmin, async (req, res) => {
    try {
      const forceRefresh =
        req.query.refresh === "1" || req.query.refresh === "true";
      const { result, cached, cacheAgeMs } = await loadOrAnalyzeImportGaps({
        forceRefresh,
      });
      res.json({ ...result, cached, cacheAgeMs });
    } catch (error: any) {
      captureRequestError(error);
      console.error("Failed to run import gap analysis:", error);
      res
        .status(500)
        .json({ error: error?.message || "Failed to run gap analysis" });
    }
  });

  // Internal alert hook for the nightly scrape cron job (runs inside the same
  // container and posts to localhost). Secured by a shared token so it cannot be
  // triggered externally. Disabled (503) until INTERNAL_ALERT_TOKEN is set.
  app.post("/api/internal/scrape-alert", async (req, res) => {
    try {
      const expected = process.env.INTERNAL_ALERT_TOKEN;
      if (!expected) {
        return res
          .status(503)
          .json({ error: "Internal alerts disabled (INTERNAL_ALERT_TOKEN not set)" });
      }
      const provided = req.get("x-internal-token");
      if (!provided || provided !== expected) {
        return res.status(401).json({ error: "Invalid internal token" });
      }

      const runDate =
        typeof req.body?.runDate === "string" && req.body.runDate.trim()
          ? req.body.runDate.trim()
          : new Date().toISOString().slice(0, 10);

      const parseCount = (value: unknown): number | undefined => {
        const n =
          typeof value === "number"
            ? value
            : typeof value === "string"
              ? parseInt(value, 10)
              : NaN;
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };

      // A success-after-failure run reports `recovered: true` so the office gets
      // a one-time "all clear" instead of yet another failure alert.
      const recovered =
        req.body?.recovered === true || req.body?.recovered === "true";

      if (recovered) {
        const notificationId = await notificationService.notifyScrapeRecovered({
          runDate,
          failedRuns: parseCount(req.body?.consecutiveFailures),
        });
        return res.json({ ok: true, recovered: true, notificationId });
      }

      const reason =
        typeof req.body?.reason === "string" && req.body.reason.trim()
          ? req.body.reason.trim()
          : "Nightly scrape exited with an error";
      const logTail =
        typeof req.body?.logTail === "string" ? req.body.logTail : undefined;

      const notificationId = await notificationService.notifyScrapeFailure({
        runDate,
        reason,
        logTail,
        consecutiveFailures: parseCount(req.body?.consecutiveFailures),
        skippedPages: parseCount(req.body?.skippedPages),
        abandonedPages: parseCount(req.body?.abandonedPages),
        skippedOnly:
          req.body?.skippedOnly === true || req.body?.skippedOnly === "true",
      });
      res.json({ ok: true, notificationId });
    } catch (error: any) {
      captureRequestError(error);
      console.error("Failed to send scrape-failure alert:", error);
      res.status(500).json({ error: error?.message || "Failed to send alert" });
    }
  });

  app.post("/api/migration/test-connection", async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "Username and password are required" });
      }

      const testScraper = new LegacyScraper({ username, password });

      await testScraper.initialize();
      const loginSuccess = await testScraper.login();

      if (loginSuccess) {
        const navigationSuccess = await testScraper.navigateToStudentFiles();
        await testScraper.cleanup();

        if (navigationSuccess) {
          res.json({
            success: true,
            message:
              "Successfully connected to legacy system and accessed student files",
          });
        } else {
          res.json({
            success: false,
            message: "Connected but could not access student files section",
          });
        }
      } else {
        await testScraper.cleanup();
        res.json({
          success: false,
          message: "Failed to login - please check credentials",
        });
      }
    } catch (error) {
      captureRequestError(error);
      console.error("Connection test failed:", error);
      res.status(500).json({
        success: false,
        message: `Connection test failed: ${error}`,
      });
    }
  });

  app.get("/api/migration/stats", async (req, res) => {
    try {
      const students = await storage.getStudents();
      res.json({
        totalMigratedStudents: students.length,
        migrationDate: null,
        errors: [],
        duration: null,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Failed to get migration stats:", error);
      res.status(500).json({ error: "Failed to get migration statistics" });
    }
  });

  // Student Transactions endpoints
  app.get("/api/student-transactions/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const transactions = await storage.getStudentTransactions(studentId);
      res.json(transactions);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student transactions:", error);
      res.status(500).json({ error: "Failed to fetch student transactions" });
    }
  });

  app.post("/api/student-transactions", async (req, res) => {
    try {
      const insertTransactionData = insertStudentTransactionSchema.parse(
        req.body,
      );
      const transaction = await storage.createStudentTransaction(
        insertTransactionData,
      );
      res.json(transaction);
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating student transaction:", error);
      res.status(500).json({ error: "Failed to create student transaction" });
    }
  });

  // Transfer Credits endpoints
  app.get("/api/transfer-credits", async (req, res) => {
    try {
      const transferCredits = await storage.getTransferCredits();
      res.json(transferCredits);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching transfer credits:", error);
      res.status(500).json({ error: "Failed to fetch transfer credits" });
    }
  });

  app.get("/api/transfer-credits/student/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const transferCredits =
        await storage.getTransferCreditsByStudent(studentId);
      res.json(transferCredits);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student transfer credits:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch student transfer credits" });
    }
  });

  app.get("/api/transfer-credits/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const transferCredit = await storage.getTransferCredit(id);
      if (!transferCredit) {
        return res.status(404).json({ message: "Transfer credit not found" });
      }
      res.json(transferCredit);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch transfer credit" });
    }
  });

  app.post("/api/transfer-credits", async (req, res) => {
    try {
      console.log(
        "Received transfer credit data:",
        JSON.stringify(req.body, null, 2),
      );

      const transferCreditData = insertTransferCreditSchema.parse(req.body);

      // Ensure completedCourses is properly formatted as JSON array
      const formattedData = {
        ...transferCreditData,
        completedCourses: Array.isArray(transferCreditData.completedCourses)
          ? transferCreditData.completedCourses
          : [],
        transferDate:
          transferCreditData.transferDate ||
          new Date().toISOString().split("T")[0],
      };

      console.log(
        "Creating transfer credit with formatted data:",
        JSON.stringify(formattedData, null, 2),
      );

      const transferCredit = await storage.createTransferCredit(formattedData);

      console.log("Transfer credit created successfully:", transferCredit.id);

      res.status(201).json(transferCredit);
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating transfer credit:", error);

      // Check if it's a Zod validation error
      if (error instanceof z.ZodError) {
        const formattedErrors = error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));
        console.error("Validation errors:", formattedErrors);
        return res.status(400).json({
          message: "Validation failed",
          errors: formattedErrors,
          details: error.errors,
        });
      }

      // Log detailed error server-side but return generic message to client
      console.error(
        "Detailed error:",
        error instanceof Error ? error.message : error,
      );
      res.status(400).json({
        message:
          "Failed to create transfer credit. Please check all fields and try again.",
      });
    }
  });

  app.put("/api/transfer-credits/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;

      // If status is being changed to approved, update student's transferred credits
      if (updateData.status === "approved") {
        const transferCredit = await storage.getTransferCredit(id);
        if (transferCredit) {
          // Calculate transferred credits based on completed courses
          const transferredCredits = Array.isArray(
            transferCredit.completedCourses,
          )
            ? transferCredit.completedCourses.length
            : 0;

          await storage.updateStudent(transferCredit.studentId, {
            transferredCredits: transferredCredits,
            transferredFrom: transferCredit.previousSchool,
          });
        }
      }

      const updatedTransferCredit = await storage.updateTransferCredit(
        id,
        updateData,
      );
      res.json(updatedTransferCredit);
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating transfer credit:", error);
      res.status(400).json({ message: "Failed to update transfer credit" });
    }
  });

  app.delete("/api/transfer-credits/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTransferCredit(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      console.error("Error deleting transfer credit:", error);
      res.status(500).json({ message: "Failed to delete transfer credit" });
    }
  });

  // Credit calculation endpoint
  app.post("/api/transfer-credits/calculate", async (req, res) => {
    try {
      const { theoryHours, practicalHours, courseType, previousSchool } =
        req.body;

      // Credit calculation logic based on course requirements
      const courseRequirements = {
        auto: { theory: 30, practical: 15, totalCredits: 100 },
        moto: { theory: 25, practical: 10, totalCredits: 80 },
        scooter: { theory: 20, practical: 8, totalCredits: 60 },
      };

      const requirements =
        courseRequirements[courseType] || courseRequirements.auto;
      const baseRatePerHour = 50;

      // Calculate credit percentage
      const theoryPercentage = Math.min(theoryHours / requirements.theory, 1);
      const practicalPercentage = Math.min(
        practicalHours / requirements.practical,
        1,
      );

      const creditsEarned = Math.floor(
        (theoryPercentage * 0.6 + practicalPercentage * 0.4) *
          requirements.totalCredits,
      );

      const creditValue = (theoryHours + practicalHours) * baseRatePerHour;
      const adjustmentAmount = creditValue * 0.1; // 10% processing fee

      res.json({
        creditsEarned,
        totalCreditsRequired: requirements.totalCredits,
        creditValue: creditValue.toFixed(2),
        adjustmentAmount: adjustmentAmount.toFixed(2),
        equivalencyNotes: `Based on ${theoryHours} theory hours and ${practicalHours} practical hours from ${previousSchool}`,
        theoryPercentage: Math.round(theoryPercentage * 100),
        practicalPercentage: Math.round(practicalPercentage * 100),
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error calculating transfer credits:", error);
      res.status(400).json({ message: "Failed to calculate transfer credits" });
    }
  });

  // Locations routes
  app.get("/api/locations", async (req, res) => {
    try {
      const locations = await storage.getLocations();
      res.json(locations);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.get("/api/locations/active", async (req, res) => {
    try {
      const locations = await storage.getActiveLocations();
      res.json(locations);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching active locations:", error);
      res.status(500).json({ message: "Failed to fetch active locations" });
    }
  });

  app.get("/api/locations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const location = await storage.getLocation(id);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.json(location);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch location" });
    }
  });

  app.post("/api/locations", async (req, res) => {
    try {
      const body = {
        ...req.body,
        locationCode: req.body.locationCode?.trim() || null,
      };
      const locationData = insertLocationSchema.parse(body);
      const location = await storage.createLocation(locationData);
      res.status(201).json(location);
    } catch (error) {
      captureRequestError(error);
      console.error("Location creation error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      if (error.code === "23505") {
        return res.status(400).json({ message: "A location with this location code already exists. Please use a different code." });
      }
      res.status(500).json({ message: error.message || "Failed to create location" });
    }
  });

  app.put("/api/locations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const location = await storage.updateLocation(id, updateData);
      res.json(location);
    } catch (error) {
      captureRequestError(error);
      console.error("Location update error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      res.status(400).json({ message: "Failed to update location" });
    }
  });

  app.delete("/api/locations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const assignedStudents = await storage.getStudentsByLocationId(id);
      if (assignedStudents.length > 0) {
        return res.status(400).json({
          message: `${assignedStudents.length} student(s) are still assigned to this location. Please reassign them before deleting.`,
        });
      }
      await storage.deleteLocation(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      console.error("Error deleting location:", error);
      res.status(500).json({ message: "Failed to delete location" });
    }
  });

  // Vehicle routes
  app.get("/api/vehicles", authMiddleware, async (req, res) => {
    try {
      const vehicles = await storage.getVehicles();
      res.json(vehicles);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching vehicles:", error);
      res.status(500).json({ message: "Failed to fetch vehicles" });
    }
  });

  app.get("/api/vehicles/active", authMiddleware, async (req, res) => {
    try {
      const vehicles = await storage.getActiveVehicles();
      res.json(vehicles);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching active vehicles:", error);
      res.status(500).json({ message: "Failed to fetch active vehicles" });
    }
  });

  app.get("/api/vehicles/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const vehicle = await storage.getVehicle(id);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }
      res.json(vehicle);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch vehicle" });
    }
  });

  app.post("/api/vehicles", authMiddleware, async (req, res) => {
    try {
      const vehicleData = insertVehicleSchema.parse(req.body);

      // Convert empty optional fields to null
      if (vehicleData.vehicleNumber === undefined || vehicleData.vehicleNumber === null || isNaN(vehicleData.vehicleNumber as any)) vehicleData.vehicleNumber = null;
      if (!vehicleData.vin) vehicleData.vin = null;
      if (!vehicleData.registrationExpiry) vehicleData.registrationExpiry = null;
      if (!vehicleData.insuranceExpiry) vehicleData.insuranceExpiry = null;
      if (!vehicleData.lastMaintenanceDate) vehicleData.lastMaintenanceDate = null;
      if (!vehicleData.color) vehicleData.color = null;
      if (!vehicleData.maintenanceNotes) vehicleData.maintenanceNotes = null;
      if (!vehicleData.fuelType) vehicleData.fuelType = null;
      if (!vehicleData.transmission) vehicleData.transmission = null;
      if (!vehicleData.notes) vehicleData.notes = null;

      const vehicle = await storage.createVehicle(vehicleData);
      res.status(201).json(vehicle);
    } catch (error: any) {
      captureRequestError(error);
      console.error("Vehicle creation error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err: any) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      if (error.code === "23505") {
        const detail = (error.detail || "").toLowerCase();
        const constraint = (error.constraint || "").toLowerCase();
        if (detail.includes("license_plate") || detail.includes("licenseplate")) {
          return res.status(409).json({ message: "A vehicle with this license plate already exists. Please use a different license plate." });
        }
        if (detail.includes("vin")) {
          return res.status(409).json({ message: "A vehicle with this VIN already exists. Please check the VIN number." });
        }
        if (detail.includes("vehicle_number") || constraint.includes("type_number")) {
          return res.status(409).json({ message: "This vehicle number is already used by another vehicle of the same type. Each Auto or Moto vehicle must have a unique number." });
        }
        return res.status(409).json({ message: "A vehicle with these details already exists. Please check the license plate and VIN." });
      }
      res.status(500).json({ message: "Failed to create vehicle. Please try again." });
    }
  });

  app.put("/api/vehicles/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;

      // Convert empty optional strings to null
      if (updateData.vehicleNumber === "" || updateData.vehicleNumber === undefined) updateData.vehicleNumber = null;
      if (updateData.vin === "") updateData.vin = null;
      if (updateData.registrationExpiry === "") updateData.registrationExpiry = null;
      if (updateData.insuranceExpiry === "") updateData.insuranceExpiry = null;
      if (updateData.lastMaintenanceDate === "") updateData.lastMaintenanceDate = null;
      if (updateData.color === "") updateData.color = null;
      if (updateData.maintenanceNotes === "") updateData.maintenanceNotes = null;
      if (updateData.fuelType === "") updateData.fuelType = null;
      if (updateData.transmission === "") updateData.transmission = null;
      if (updateData.notes === "") updateData.notes = null;

      const vehicle = await storage.updateVehicle(id, updateData);
      res.json(vehicle);
    } catch (error: any) {
      captureRequestError(error);
      console.error("Vehicle update error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err: any) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      if (error.code === "23505") {
        const detail = (error.detail || "").toLowerCase();
        const constraint = (error.constraint || "").toLowerCase();
        if (detail.includes("license_plate") || detail.includes("licenseplate")) {
          return res.status(409).json({ message: "A vehicle with this license plate already exists. Please use a different license plate." });
        }
        if (detail.includes("vin")) {
          return res.status(409).json({ message: "A vehicle with this VIN already exists. Please check the VIN number." });
        }
        if (detail.includes("vehicle_number") || constraint.includes("type_number")) {
          return res.status(409).json({ message: "This vehicle number is already used by another vehicle of the same type. Each Auto or Moto vehicle must have a unique number." });
        }
        return res.status(409).json({ message: "A vehicle with these details already exists. Please check the license plate and VIN." });
      }
      res.status(500).json({ message: "Failed to update vehicle. Please try again." });
    }
  });

  app.delete("/api/vehicles/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteVehicle(id);
      res.status(204).send();
    } catch (error) {
      captureRequestError(error);
      console.error("Error deleting vehicle:", error);
      res.status(500).json({ message: "Failed to delete vehicle" });
    }
  });

  // Student Invite Routes
  app.get("/api/student-invite/:token", async (req, res) => {
    try {
      console.log(
        `[STUDENT-INVITE] Validating invite token: ${req.params.token}`,
      );
      const { token } = req.params;
      const student = await storage.getStudentByInviteToken(token);

      console.log(
        `[STUDENT-INVITE] Student found:`,
        student
          ? `ID ${student.id}, status: ${student.accountStatus}`
          : "not found",
      );

      if (!student) {
        console.log(`[STUDENT-INVITE] Invalid token: ${token}`);
        return res.status(404).json({ message: "Invalid invite token" });
      }

      if (student.inviteExpiry && new Date() > new Date(student.inviteExpiry)) {
        console.log(
          `[STUDENT-INVITE] Expired token: ${token}, expiry: ${student.inviteExpiry}`,
        );
        return res.status(410).json({ message: "Invite link has expired" });
      }

      if (student.accountStatus !== "pending_invite") {
        console.log(
          `[STUDENT-INVITE] Token already used: ${token}, status: ${student.accountStatus}`,
        );
        return res.status(400).json({ message: "Invite already accepted" });
      }

      console.log(`[STUDENT-INVITE] Valid token, returning student info`);
      // Return student info without sensitive data
      res.json({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        courseType: student.courseType,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[STUDENT-INVITE] Error:", error);
      console.error("[STUDENT-INVITE] Error stack:", error.stack);
      res.status(500).json({ message: "Failed to validate invite" });
    }
  });

  app.post("/api/student-invite/:token/accept", async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.body;

      if (!password || password.length < 8) {
        return res
          .status(400)
          .json({ message: "Password must be at least 8 characters" });
      }

      const student = await storage.getStudentByInviteToken(token);

      if (!student) {
        return res.status(404).json({ message: "Invalid invite token" });
      }

      if (student.inviteExpiry && new Date() > new Date(student.inviteExpiry)) {
        return res.status(410).json({ message: "Invite link has expired" });
      }

      if (student.accountStatus !== "pending_invite") {
        return res.status(400).json({ message: "Invite already accepted" });
      }

      // Hash password
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update student with password and status
      const updatedStudent = await storage.updateStudent(student.id, {
        password: hashedPassword,
        accountStatus: "active",
        inviteAcceptedAt: new Date(),
        inviteToken: null, // Clear the token
      });

      console.log(
        `[STUDENT-INVITE] Student ${updatedStudent.id} account activated successfully`,
      );

      res.json({
        success: true,
        student: {
          id: updatedStudent.id,
          firstName: updatedStudent.firstName,
          lastName: updatedStudent.lastName,
          email: updatedStudent.email,
        },
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[STUDENT-INVITE] Error accepting invite:", error);
      res.status(500).json({ message: "Failed to accept invite" });
    }
  });

  // Student Self-Registration Routes
  app.post("/api/student/register", async (req, res) => {
    try {
      const { email, courseType, selectedStartDateId } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      // Check if email already exists in students table
      const existingStudent = await storage.getStudentByEmail(email);
      if (existingStudent) {
        return res.status(400).json({ message: "An account with this email already exists. Please log in instead." });
      }
      
      // Check if registration already exists
      const existingRegistration = await db.select().from(studentRegistrations).where(eq(studentRegistrations.email, email)).limit(1);
      if (existingRegistration.length > 0) {
        // If verified but not completed onboarding, let them continue
        if (existingRegistration[0].emailVerified && !existingRegistration[0].onboardingCompleted) {
          return res.json({ 
            message: "Please continue with your onboarding",
            registrationId: existingRegistration[0].id,
            step: "onboarding",
            onboardingStep: existingRegistration[0].onboardingStep
          });
        }
        // If not verified, resend verification
        if (!existingRegistration[0].emailVerified) {
          // Generate new verification code
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
          
          const [token] = await db.insert(emailVerificationTokens).values({
            email,
            code,
            expiresAt,
          }).returning();
          
          await db.update(studentRegistrations)
            .set({ verificationTokenId: token.id })
            .where(eq(studentRegistrations.id, existingRegistration[0].id));
          
          // Send verification email
          const { sendEmail: sendVerifyEmail1 } = await import("./services/sendgrid");
          await sendVerifyEmail1({
            to: [email],
            from: process.env.SENDGRID_FROM_EMAIL || "info@mortysdrivingschool.com",
            subject: "Verify your email - Morty's Driving School",
          uatBypass: true,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #111111 0%, #2d2d2d 100%); padding: 30px; text-align: center;">
                    <h1 style="color: #ECC462; margin: 0; font-size: 28px;">Morty's Driving School</h1>
                  </div>
                  <div style="background: #ffffff; padding: 40px; border-left: 4px solid #ECC462;">
                    <h2 style="color: #111111; margin-top: 0;">Verify Your Email</h2>
                    <p style="color: #333333; line-height: 1.6;">
                      Your verification code is:
                    </p>
                    <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                      <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111111;">${code}</span>
                    </div>
                    <p style="color: #666666; font-size: 14px;">
                      This code expires in 2 minutes.
                    </p>
                  </div>
                </div>
              `,
          });
          
          return res.json({
            message: "Verification code sent to your email",
            registrationId: existingRegistration[0].id,
            step: "verify",
            expiresAt: expiresAt.toISOString()
          });
        }
        return res.status(400).json({ message: "An account with this email already exists" });
      }
      
      // The real password is set later via the activation email link.
      // Store a random placeholder hash to satisfy the not-null column.
      const bcrypt = await import("bcryptjs");
      const crypto = await import("crypto");
      const hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      
      // Generate verification code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
      
      // Create verification token
      const [token] = await db.insert(emailVerificationTokens).values({
        email,
        code,
        expiresAt,
      }).returning();
      
      // Create registration (seed course selection made before account creation)
      const seedData: Record<string, any> = {};
      if (courseType) seedData.courseType = courseType;
      if (selectedStartDateId) seedData.selectedStartDateId = String(selectedStartDateId);

      // High-entropy capability token: required by the pre-verification card
      // endpoints so a numeric registration ID alone can't be used to attach
      // or poison a card on someone else's registration.
      const cardCaptureToken = crypto.randomBytes(24).toString("hex");
      seedData.cardCaptureToken = cardCaptureToken;

      const [registration] = await db.insert(studentRegistrations).values({
        email,
        passwordHash: hashedPassword,
        verificationTokenId: token.id,
        onboardingData: seedData,
      }).returning();
      
      // Send verification email
      const { sendEmail: sendVerifyEmail2 } = await import("./services/sendgrid");
      await sendVerifyEmail2({
        to: [email],
        from: process.env.SENDGRID_FROM_EMAIL || "info@mortysdrivingschool.com",
        subject: "Verify your email - Morty's Driving School",
          uatBypass: true,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #111111 0%, #2d2d2d 100%); padding: 30px; text-align: center;">
                <h1 style="color: #ECC462; margin: 0; font-size: 28px;">Morty's Driving School</h1>
              </div>
              <div style="background: #ffffff; padding: 40px; border-left: 4px solid #ECC462;">
                <h2 style="color: #111111; margin-top: 0;">Welcome to Morty's Driving School!</h2>
                <p style="color: #333333; line-height: 1.6;">
                  Thank you for registering. Your verification code is:
                </p>
                <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                  <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111111;">${code}</span>
                </div>
                <p style="color: #666666; font-size: 14px;">
                  This code expires in 2 minutes. Enter it to verify your email and continue with your registration.
                </p>
              </div>
            </div>
          `,
      });
      
      res.json({
        message: "Verification code sent to your email",
        registrationId: registration.id,
        cardToken: cardCaptureToken,
        step: "verify",
        expiresAt: expiresAt.toISOString()
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[STUDENT-REGISTER] Error:", error);
      res.status(500).json({ message: "Failed to register" });
    }
  });
  
  // Verify email with code
  app.post("/api/student/verify-email", async (req, res) => {
    try {
      const { registrationId, code } = req.body;
      
      if (!registrationId || !code) {
        return res.status(400).json({ message: "Registration ID and code are required" });
      }
      
      const [registration] = await db.select().from(studentRegistrations).where(eq(studentRegistrations.id, registrationId)).limit(1);
      
      if (!registration) {
        return res.status(404).json({ message: "Registration not found" });
      }
      
      if (registration.emailVerified) {
        return res.json({
          message: "Email already verified",
          step: "onboarding",
          onboardingStep: registration.onboardingStep
        });
      }
      
      // Check verification token
      if (!registration.verificationTokenId) {
        return res.status(400).json({ message: "No verification token found. Please register again." });
      }
      
      const [token] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.id, registration.verificationTokenId)).limit(1);
      
      if (!token) {
        return res.status(400).json({ message: "Verification token not found" });
      }
      
      if (token.code !== code) {
        return res.status(400).json({ message: "Invalid verification code" });
      }
      
      if (new Date() > token.expiresAt) {
        return res.status(400).json({ message: "Verification code has expired. Please request a new one." });
      }
      
      // Mark as verified
      await db.update(emailVerificationTokens).set({ verified: true }).where(eq(emailVerificationTokens.id, token.id));
      await db.update(studentRegistrations).set({ emailVerified: true }).where(eq(studentRegistrations.id, registrationId));
      
      res.json({
        message: "Email verified successfully",
        step: "onboarding",
        onboardingStep: 1
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[STUDENT-VERIFY] Error:", error);
      res.status(500).json({ message: "Failed to verify email" });
    }
  });
  
  // Resend verification code
  app.post("/api/student/resend-verification", async (req, res) => {
    try {
      const { registrationId } = req.body;
      
      if (!registrationId) {
        return res.status(400).json({ message: "Registration ID is required" });
      }
      
      const [registration] = await db.select().from(studentRegistrations).where(eq(studentRegistrations.id, registrationId)).limit(1);
      
      if (!registration) {
        return res.status(404).json({ message: "Registration not found" });
      }
      
      if (registration.emailVerified) {
        return res.json({ message: "Email already verified" });
      }
      
      // Generate new verification code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
      
      const [token] = await db.insert(emailVerificationTokens).values({
        email: registration.email,
        code,
        expiresAt,
      }).returning();
      
      await db.update(studentRegistrations).set({ verificationTokenId: token.id }).where(eq(studentRegistrations.id, registrationId));
      
      // Send verification email
      const { sendEmail: sendVerifyEmail3 } = await import("./services/sendgrid");
      await sendVerifyEmail3({
        to: [registration.email],
        from: process.env.SENDGRID_FROM_EMAIL || "info@mortysdrivingschool.com",
        subject: "Your new verification code - Morty's Driving School",
          uatBypass: true,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #111111 0%, #2d2d2d 100%); padding: 30px; text-align: center;">
                <h1 style="color: #ECC462; margin: 0; font-size: 28px;">Morty's Driving School</h1>
              </div>
              <div style="background: #ffffff; padding: 40px; border-left: 4px solid #ECC462;">
                <h2 style="color: #111111; margin-top: 0;">New Verification Code</h2>
                <p style="color: #333333; line-height: 1.6;">
                  Your new verification code is:
                </p>
                <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                  <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111111;">${code}</span>
                </div>
                <p style="color: #666666; font-size: 14px;">
                  This code expires in 2 minutes.
                </p>
              </div>
            </div>
          `,
      });
      
      res.json({ message: "New verification code sent to your email", expiresAt: expiresAt.toISOString() });
    } catch (error) {
      captureRequestError(error);
      console.error("[STUDENT-RESEND] Error:", error);
      res.status(500).json({ message: "Failed to resend verification code" });
    }
  });
  
  // Get onboarding status
  app.get("/api/student/onboarding/:registrationId", async (req, res) => {
    try {
      const registrationId = parseInt(req.params.registrationId);
      
      const [registration] = await db.select().from(studentRegistrations).where(eq(studentRegistrations.id, registrationId)).limit(1);
      
      if (!registration) {
        return res.status(404).json({ message: "Registration not found" });
      }
      
      res.json({
        id: registration.id,
        email: registration.email,
        emailVerified: registration.emailVerified,
        onboardingCompleted: registration.onboardingCompleted,
        onboardingStep: registration.onboardingStep,
        onboardingData: registration.onboardingData || {},
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[STUDENT-ONBOARDING] Error:", error);
      res.status(500).json({ message: "Failed to get onboarding status" });
    }
  });
  
  // Update onboarding step data
  app.patch("/api/student/onboarding/:registrationId", async (req, res) => {
    try {
      const registrationId = parseInt(req.params.registrationId);
      const { step, data } = req.body;
      
      const [registration] = await db.select().from(studentRegistrations).where(eq(studentRegistrations.id, registrationId)).limit(1);
      
      if (!registration) {
        return res.status(404).json({ message: "Registration not found" });
      }
      
      if (!registration.emailVerified) {
        return res.status(400).json({ message: "Please verify your email first" });
      }
      
      // Merge new data with existing onboarding data
      const existingData = registration.onboardingData || {};
      const updatedData = { ...existingData, ...data };
      
      await db.update(studentRegistrations)
        .set({
          onboardingStep: step,
          onboardingData: updatedData,
          updatedAt: new Date(),
        })
        .where(eq(studentRegistrations.id, registrationId));
      
      res.json({
        message: "Onboarding progress saved",
        step,
        onboardingData: updatedData,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[STUDENT-ONBOARDING] Error:", error);
      res.status(500).json({ message: "Failed to update onboarding" });
    }
  });
  
  // Complete onboarding and create student account
  app.post("/api/student/complete-onboarding/:registrationId", async (req, res) => {
    try {
      const registrationId = parseInt(req.params.registrationId);
      
      const [registration] = await db.select().from(studentRegistrations).where(eq(studentRegistrations.id, registrationId)).limit(1);
      
      if (!registration) {
        return res.status(404).json({ message: "Registration not found" });
      }
      
      if (!registration.emailVerified) {
        return res.status(400).json({ message: "Please verify your email first" });
      }
      
      if (registration.onboardingCompleted) {
        return res.status(400).json({ message: "Onboarding already completed" });
      }
      
      const data = registration.onboardingData;
      
      if (!data) {
        return res.status(400).json({ message: "Onboarding data is missing" });
      }
      
      // Validate required fields
      const requiredFields = ['firstName', 'lastName', 'phone', 'dateOfBirth', 'address', 'emergencyContact', 'emergencyPhone', 'courseType'];
      const missingFields = requiredFields.filter(field => !data[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({ message: `Missing required fields: ${missingFields.join(', ')}` });
      }
      
      // Create the student record
      const newStudent = await storage.createStudent({
        firstName: data.firstName,
        lastName: data.lastName,
        email: registration.email,
        phone: data.phone,
        homePhone: data.homePhone || null,
        dateOfBirth: data.dateOfBirth,
        primaryLanguage: data.primaryLanguage || 'English',
        address: data.address,
        city: data.city || null,
        postalCode: data.postalCode || null,
        province: data.province || 'Quebec',
        country: data.country || 'Canada',
        courseType: data.courseType,
        emergencyContact: data.emergencyContact,
        emergencyPhone: data.emergencyPhone,
        driverLicenseNumber: data.permitNumber || null,
        licenseExpiryDate: data.permitExpiryDate || null,
        governmentId: data.driverLicenseNumber || null,
        password: registration.passwordHash,
        accountStatus: 'active',
        status: 'active',
        progress: 0,
        referralSource: data.referralSource || null,
        referralDetail: data.referralDetail || null,
        selectedStartDateId: data.selectedStartDateId || null,
      });

      // Optionally create/link a parent or guardian if provided during onboarding
      if (data.parentEmail && data.parentFirstName && data.parentLastName) {
        try {
          let parent = await storage.getParentByEmail(data.parentEmail);
          if (!parent) {
            parent = await storage.createParent({
              firstName: data.parentFirstName,
              lastName: data.parentLastName,
              email: data.parentEmail,
              phone: data.parentPhone || null,
              relationship: data.parentRelationship || 'Parent',
              accountStatus: 'pending_invite',
            });
          }
          await storage.createStudentParent({
            studentId: newStudent.id,
            parentId: parent.id,
            permissionLevel: data.parentPermissionLevel || 'view_only',
          });
        } catch (parentErr) {
          captureRequestError(parentErr);
          console.error("[STUDENT-COMPLETE] Failed to link parent:", parentErr);
        }
      }
      
      // Carry the card captured during sign-up onto the real student record:
      // the registration's Stripe customer becomes the student's customer and
      // the saved payment method becomes their default card. Never blocks
      // registration — failures are logged for the office to reconcile.
      try {
        const regData: any = data;
        if (regData.stripeCustomerId) {
          // Atomic DB transfer: customer id + card row land together or not at
          // all, so a partial failure can't leave a student with a customer but
          // no bookable card. If it does fail, booking enforcement still holds —
          // the student is prompted to add a card in the booking drawer.
          await db.transaction(async (tx) => {
            await tx.update(students)
              .set({ stripeCustomerId: regData.stripeCustomerId })
              .where(eq(students.id, newStudent.id));
            if (regData.pendingCard?.stripePaymentMethodId) {
              const { studentPaymentMethods: spmTable } = await import("@shared/schema");
              await tx.insert(spmTable).values({
                studentId: newStudent.id,
                stripePaymentMethodId: regData.pendingCard.stripePaymentMethodId,
                cardBrand: regData.pendingCard.cardBrand ?? null,
                last4: regData.pendingCard.last4 ?? null,
                expiryMonth: regData.pendingCard.expiryMonth ?? null,
                expiryYear: regData.pendingCard.expiryYear ?? null,
                isDefault: true,
              });
            }
          });
          // Cosmetic Stripe update — never blocks the transfer.
          if (stripe) {
            try {
              await stripe.customers.update(regData.stripeCustomerId, {
                name: `${newStudent.firstName} ${newStudent.lastName}`,
                metadata: { studentId: String(newStudent.id) },
              });
            } catch (stripeErr) {
              captureRequestError(stripeErr);
              console.error("[STUDENT-COMPLETE] Stripe customer update failed (non-blocking):", stripeErr);
            }
          }
        }
      } catch (cardErr) {
        captureRequestError(cardErr);
        console.error("[STUDENT-COMPLETE] Failed to attach sign-up card to student:", cardErr);
      }

      // Update registration as completed
      await db.update(studentRegistrations)
        .set({
          onboardingCompleted: true,
          updatedAt: new Date(),
        })
        .where(eq(studentRegistrations.id, registrationId));
      
      // Transfer any documents uploaded during registration
      await db.update(studentDocuments)
        .set({ studentId: newStudent.id })
        .where(eq(studentDocuments.registrationId, registrationId));

      // Enroll the student in the Theory 1 class matching the start date they
      // picked during registration so it shows on their calendar right away.
      // Never blocks registration — failures notify the office instead.
      if (newStudent.selectedStartDateId) {
        const { autoEnrollStudentFromStartDate } = await import("./services/auto-enroll");
        await autoEnrollStudentFromStartDate(newStudent.id, newStudent.selectedStartDateId);
      }

      // Account starts as pending_invite — the student sets their password
      // via the activation email before they can log in.
      res.json({
        message: "Profile complete! Check your email for an activation link to set your password.",
        studentId: newStudent.id,
        email: newStudent.email,
        activationRequired: true,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[STUDENT-COMPLETE] Error:", error);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });

  // ---------------------------------------------------------------------
  // Registration card capture (sign-up card step, before email verification)
  // Card is saved via a SetupIntent against a Stripe customer created for the
  // registration; the customer + payment method are attached to the real
  // student record when onboarding completes.
  // ---------------------------------------------------------------------

  // Capability check for the pre-verification card endpoints: numeric
  // registration IDs are guessable, so callers must present the high-entropy
  // token issued only in the register response. Constant-time comparison.
  const hasValidCardCaptureToken = (onboardingData: any, provided: unknown): boolean => {
    const expected = onboardingData?.cardCaptureToken;
    if (typeof expected !== "string" || typeof provided !== "string") return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  };

  // Create (or reuse) a Stripe customer for the registration and return a
  // SetupIntent client secret for the branded in-app card form.
  app.post("/api/student/registration/:registrationId/setup-intent", async (req, res) => {
    try {
      if (!stripe) return res.status(500).json({ message: "Payment system is not configured" });
      const registrationId = parseInt(req.params.registrationId);
      const [registration] = await db.select().from(studentRegistrations)
        .where(eq(studentRegistrations.id, registrationId)).limit(1);
      if (!registration) return res.status(404).json({ message: "Registration not found" });
      if (registration.onboardingCompleted) return res.status(400).json({ message: "Registration already completed" });

      const data: any = registration.onboardingData || {};
      if (!hasValidCardCaptureToken(data, req.body?.cardToken)) {
        return res.status(403).json({ message: "Not authorized for this registration" });
      }
      let stripeCustomerId: string | undefined = data.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: registration.email,
          metadata: { registrationId: String(registrationId) },
        });
        stripeCustomerId = customer.id;
        await db.update(studentRegistrations)
          .set({ onboardingData: { ...data, stripeCustomerId }, updatedAt: new Date() })
          .where(eq(studentRegistrations.id, registrationId));
      }

      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { registrationId: String(registrationId) },
      });
      res.json({ clientSecret: setupIntent.client_secret, setupIntentId: setupIntent.id });
    } catch (error: any) {
      captureRequestError(error);
      console.error("Error creating registration setup intent:", error);
      res.status(500).json({ message: error.message || "Failed to prepare card form" });
    }
  });

  // After the client confirms the SetupIntent, verify it and stash the saved
  // card on the registration so it can be carried onto the student record.
  app.post("/api/student/registration/:registrationId/save-card", async (req, res) => {
    try {
      if (!stripe) return res.status(500).json({ message: "Payment system is not configured" });
      const registrationId = parseInt(req.params.registrationId);
      const { setupIntentId } = req.body;
      if (!setupIntentId) return res.status(400).json({ message: "setupIntentId is required" });

      const [registration] = await db.select().from(studentRegistrations)
        .where(eq(studentRegistrations.id, registrationId)).limit(1);
      if (!registration) return res.status(404).json({ message: "Registration not found" });
      if (registration.onboardingCompleted) return res.status(400).json({ message: "Registration already completed" });

      const data: any = registration.onboardingData || {};
      if (!hasValidCardCaptureToken(data, req.body?.cardToken)) {
        return res.status(403).json({ message: "Not authorized for this registration" });
      }
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      if (setupIntent.metadata?.registrationId !== String(registrationId) || setupIntent.customer !== data.stripeCustomerId) {
        return res.status(403).json({ message: "Card setup does not belong to this registration" });
      }
      if (setupIntent.status !== "succeeded" || !setupIntent.payment_method) {
        return res.status(400).json({ message: "Card setup is not complete yet" });
      }

      const pmId = typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method.id;
      const paymentMethod = await stripe.paymentMethods.retrieve(pmId);
      const pendingCard = {
        stripePaymentMethodId: pmId,
        cardBrand: paymentMethod.card?.brand || null,
        last4: paymentMethod.card?.last4 || null,
        expiryMonth: paymentMethod.card?.exp_month || null,
        expiryYear: paymentMethod.card?.exp_year || null,
      };
      await db.update(studentRegistrations)
        .set({ onboardingData: { ...data, pendingCard }, updatedAt: new Date() })
        .where(eq(studentRegistrations.id, registrationId));
      res.json({ saved: true, cardBrand: pendingCard.cardBrand, last4: pendingCard.last4 });
    } catch (error: any) {
      captureRequestError(error);
      console.error("Error saving registration card:", error);
      res.status(500).json({ message: error.message || "Failed to save card" });
    }
  });
  
  // Document upload for onboarding
  app.post("/api/student/upload-document/:registrationId", async (req, res) => {
    try {
      const registrationId = parseInt(req.params.registrationId);
      const { documentType, documentName, documentData, mimeType, fileSize } = req.body;
      
      if (!documentType || !documentName || !documentData) {
        return res.status(400).json({ message: "Document type, name, and data are required" });
      }
      
      const [registration] = await db.select().from(studentRegistrations).where(eq(studentRegistrations.id, registrationId)).limit(1);
      
      if (!registration) {
        return res.status(404).json({ message: "Registration not found" });
      }
      
      // Create document record first, then upload to S3 if configured
      const [document] = await db.insert(studentDocuments).values({
        registrationId,
        documentType,
        documentName,
        documentData: "__pending__",
        mimeType: mimeType || 'image/jpeg',
        fileSize: fileSize || 0,
        uploadDate: new Date().toISOString().split('T')[0],
        verificationStatus: 'pending',
      }).returning();

      const storedData = await storeDocument(
        documentData,
        registration.studentId || 0,
        document.id,
        documentName,
        mimeType || "image/jpeg"
      );
      await db.update(studentDocuments).set({ documentData: storedData }).where(eq(studentDocuments.id, document.id));
      
      res.json({
        message: "Document uploaded successfully",
        documentId: document.id,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[STUDENT-UPLOAD] Error:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  // ------------------------------------------------------------
  // Module 1 Start Dates (admin-managed, chosen during registration)
  // ------------------------------------------------------------

  // Public: available upcoming start dates (used on the registration page)
  app.get("/api/course-start-dates", async (req, res) => {
    try {
      const courseType = req.query.courseType as string | undefined;
      await storage.syncCourseStartDatesFromClasses(courseType);
      const dates = await storage.getCourseStartDates({
        courseType,
        status: "active",
        upcomingOnly: true,
      });
      res.json(dates);
    } catch (error) {
      captureRequestError(error);
      console.error("[START-DATES] Error fetching public start dates:", error);
      res.status(500).json({ message: "Failed to fetch start dates" });
    }
  });

  // Admin: list all start dates (optionally filtered)
  app.get("/api/admin/course-start-dates", requireAdmin, async (req, res) => {
    try {
      const courseType = req.query.courseType as string | undefined;
      const status = req.query.status as string | undefined;
      await storage.syncCourseStartDatesFromClasses(courseType);
      const dates = await storage.getCourseStartDates({ courseType, status });
      res.json(dates);
    } catch (error) {
      captureRequestError(error);
      console.error("[START-DATES] Error listing start dates:", error);
      res.status(500).json({ message: "Failed to fetch start dates" });
    }
  });

  // Admin: create a start date
  app.post("/api/admin/course-start-dates", requireAdmin, async (req, res) => {
    try {
      const parsed = insertCourseStartDateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid start date data", errors: parsed.error.flatten() });
      }

      // Guard: warn before creating a duplicate cohort. If an ACTIVE start
      // date already exists for the same course type on the same day, the new
      // row would create a second cohort matching the same Theory 1 class.
      // Require explicit confirmation (confirmDuplicate: true), mirroring the
      // merge guard on the PATCH route below.
      const newStatus = parsed.data.status ?? "active";
      if (newStatus === "active" && req.body?.confirmDuplicate !== true) {
        const sameDay = (await storage.getCourseStartDates({
          courseType: parsed.data.courseType,
          status: "active",
        })).filter((d) => d.startDate === parsed.data.startDate);
        if (sameDay.length > 0) {
          return res.status(409).json({
            conflict: "start_date_duplicate",
            message:
              "An active start date already exists for this course type on the selected date. " +
              "Adding another will create two cohorts that both match the same Theory 1 class.",
            conflictingStartDates: sameDay,
          });
        }
      }

      const created = await storage.createCourseStartDate(parsed.data);
      res.status(201).json(created);
    } catch (error) {
      captureRequestError(error);
      console.error("[START-DATES] Error creating start date:", error);
      res.status(500).json({ message: "Failed to create start date" });
    }
  });

  // Admin: update a start date (change date/time, cancel, etc.)
  app.patch("/api/admin/course-start-dates/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = insertCourseStartDateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid start date data", errors: parsed.error.flatten() });
      }
      const before = await storage.getCourseStartDate(id);
      if (!before) return res.status(404).json({ message: "Start date not found" });

      // Guard: warn before merging two cohorts. If the edit moves this start
      // date onto a date that already has another ACTIVE start date for the
      // same course type, enrolled students would be moved into that other
      // cohort's class. Require explicit confirmation (confirmMerge: true).
      const targetDate = parsed.data.startDate ?? before.startDate;
      const targetCourseType = parsed.data.courseType ?? before.courseType;
      const targetStatus = parsed.data.status ?? before.status;
      const dateOrCourseChanged =
        targetDate !== before.startDate || targetCourseType !== before.courseType;
      const reactivating = before.status !== "active" && targetStatus === "active";
      if (
        (dateOrCourseChanged || reactivating) &&
        targetStatus === "active" &&
        req.body?.confirmMerge !== true
      ) {
        const sameDay = (await storage.getCourseStartDates({
          courseType: targetCourseType,
          status: "active",
        })).filter((d) => d.id !== id && d.startDate === targetDate);
        if (sameDay.length > 0) {
          return res.status(409).json({
            conflict: "start_date_merge",
            message:
              "Another active start date already exists for this course type on the selected date. " +
              "Saving will merge the two cohorts into the same Theory 1 class and may fill its capacity.",
            conflictingStartDates: sameDay,
          });
        }
      }

      const updated = await storage.updateCourseStartDate(id, parsed.data);
      if (!updated) return res.status(404).json({ message: "Start date not found" });

      // Reconcile enrolled students' calendars (move to the new class or alert
      // the office). Never blocks or fails the admin's edit.
      const { handleStartDateChange } = await import("./services/auto-enroll");
      const enrollmentReport = await handleStartDateChange(
        before,
        updated,
        (req.session as any)?.username || String((req.session as any)?.userId || "admin"),
      );

      res.json({ ...updated, enrollmentReport });
    } catch (error) {
      captureRequestError(error);
      console.error("[START-DATES] Error updating start date:", error);
      res.status(500).json({ message: "Failed to update start date" });
    }
  });

  // Admin: delete a start date
  app.delete("/api/admin/course-start-dates/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const before = await storage.getCourseStartDate(id);
      await storage.deleteCourseStartDate(id);

      // Alert enrolled students + office that the start date is gone. Never
      // blocks or fails the delete.
      let enrollmentReport = null;
      if (before) {
        const { handleStartDateChange } = await import("./services/auto-enroll");
        enrollmentReport = await handleStartDateChange(
          before,
          null,
          (req.session as any)?.username || String((req.session as any)?.userId || "admin"),
        );
      }

      res.json({ message: "Start date deleted", enrollmentReport });
    } catch (error) {
      captureRequestError(error);
      console.error("[START-DATES] Error deleting start date:", error);
      res.status(500).json({ message: "Failed to delete start date" });
    }
  });

  // Admin: one-time backfill — enroll active students who picked a start date
  // during registration but have no class enrollments into their matching
  // Theory 1 class. Returns a report of who was enrolled/failed/skipped.
  app.post("/api/admin/backfill-start-date-enrollments", requireAdmin, async (req, res) => {
    try {
      const { backfillStartDateEnrollments } = await import("./services/auto-enroll");
      const report = await backfillStartDateEnrollments();
      res.json(report);
    } catch (error) {
      captureRequestError(error);
      console.error("[START-DATES] Error running enrollment backfill:", error);
      res.status(500).json({ message: "Failed to run enrollment backfill" });
    }
  });

  // Admin: bulk list of student IDs that still need manual enrollment (active
  // students with a registration-selected start date but zero active class
  // enrollments). Lets the students list flag every affected student in one
  // request instead of one per row.
  app.get("/api/admin/students-needing-enrollment", requireAdmin, async (req, res) => {
    try {
      const { getStudentIdsNeedingManualEnrollment } = await import("./services/auto-enroll");
      const studentIds = await getStudentIdsNeedingManualEnrollment();
      res.json({ studentIds });
    } catch (error) {
      captureRequestError(error);
      console.error("[START-DATES] Error listing students needing enrollment:", error);
      res.status(500).json({ message: "Failed to list students needing enrollment" });
    }
  });

  // Admin: does this student still need to be manually enrolled? True when an
  // active student picked a start date during registration but has zero active
  // class enrollments (i.e. auto-enrollment failed). Also suggests the matching
  // Theory 1 class when one exists so the office can enroll in one click.
  app.get("/api/students/:id/enrollment-suggestion", requireAdmin, async (req, res) => {
    try {
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });

      const none = { needsManualEnrollment: false, startDate: null, suggestedClass: null, reason: null };
      if (!student.selectedStartDateId || student.status !== "active") {
        return res.json(none);
      }

      const enrollments = await storage.getClassEnrollmentsByStudent(studentId);
      if (enrollments.length > 0) return res.json(none);

      const startDate = await storage.getCourseStartDate(student.selectedStartDateId);
      if (!startDate) {
        return res.json({
          needsManualEnrollment: true,
          startDate: null,
          suggestedClass: null,
          reason: "The start date selected during registration no longer exists.",
        });
      }

      const { findMatchingTheory1Class } = await import("./services/auto-enroll");
      const suggestedClass =
        startDate.status === "active" ? await findMatchingTheory1Class(startDate) : undefined;

      res.json({
        needsManualEnrollment: true,
        startDate,
        suggestedClass: suggestedClass ?? null,
        reason: suggestedClass
          ? null
          : startDate.status !== "active"
            ? `The selected start date (${startDate.startDate}) is ${startDate.status}.`
            : `No scheduled Theory 1 class matches ${startDate.courseType} on ${startDate.startDate}${startDate.startTime ? ` at ${startDate.startTime}` : ""}.`,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[START-DATES] Error building enrollment suggestion:", error);
      res.status(500).json({ message: "Failed to check enrollment status" });
    }
  });

  // Admin: one-click enroll a student into the Theory 1 class matching their
  // registration-selected start date (same logic as registration auto-enroll,
  // capacity/duplicate checks included). No office notification on failure —
  // the admin sees the reason directly.
  app.post("/api/students/:id/auto-enroll", requireAdmin, async (req, res) => {
    try {
      const studentId = parseInt(req.params.id);
      const student = await storage.getStudent(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });
      if (!student.selectedStartDateId) {
        return res.status(400).json({ message: "This student did not select a course start date during registration." });
      }

      const { autoEnrollStudentFromStartDate } = await import("./services/auto-enroll");
      const result = await autoEnrollStudentFromStartDate(studentId, student.selectedStartDateId, {
        notifyOfficeOnFailure: false,
      });

      if (!result.enrolled) {
        return res.status(409).json({ message: result.reason || "Enrollment failed" });
      }
      res.json({ message: "Student enrolled in Theory 1", classId: result.classId });
    } catch (error) {
      captureRequestError(error);
      console.error("[START-DATES] Error auto-enrolling student:", error);
      res.status(500).json({ message: "Failed to enroll student" });
    }
  });

  // ------------------------------------------------------------
  // Module 5 Online Exam Engine
  // Camera/monitoring is handled via Zoom only (no in-app proctoring).
  // ------------------------------------------------------------

  // Parse a class date ("YYYY-MM-DD") + time ("HH:MM") into a real instant,
  // interpreting the stored wall-clock values in the school timezone (the
  // server runs in UTC — server-local parsing shifted exam windows by hours).
  const parseClassDateTime = (date: string, time: string): Date | null => {
    if (!date) return null;
    const t = time && /^\d{1,2}:\d{2}/.test(time) ? time.slice(0, 5) : "00:00";
    return getClassStartTime({ date, time: t });
  };

  // Find the student's Theory 5 (Module 5) class enrollment.
  const findTheory5Class = async (studentId: number) => {
    const enrollments = await storage.getClassEnrollmentsByStudent(studentId);
    const active = enrollments.filter((e: any) => !e.cancelledAt && e.classId);
    const classRows = await Promise.all(active.map((e: any) => storage.getClass(e.classId as number)));
    const matches = classRows.filter(
      (c: any) => c && c.classType === "theory" && c.classNumber === 5 && c.status !== "cancelled",
    ) as any[];
    if (matches.length === 0) return null;
    // Attach the enrollment's attendance status so we can prefer the class the
    // student actually attended over a merely-upcoming enrollment.
    const attendanceByClassId = new Map<number, string | null>(
      active.map((e: any) => [e.classId as number, e.attendanceStatus ?? null]),
    );
    matches.sort((a, b) => {
      const da = parseClassDateTime(a.date, a.time)?.getTime() ?? 0;
      const db2 = parseClassDateTime(b.date, b.time)?.getTime() ?? 0;
      return da - db2;
    });
    const now = Date.now();
    const started = matches.filter((c) => (parseClassDateTime(c.date, c.time)?.getTime() ?? Infinity) <= now);
    // 1) Most recent started class the student attended — its exam window governs.
    const attendedStarted = started.filter((c) => attendanceByClassId.get(c.id) === "attended");
    if (attendedStarted.length > 0) return attendedStarted[attendedStarted.length - 1];
    // 2) Otherwise the soonest upcoming class (student is waiting for it).
    const upcoming = matches.find((c) => (parseClassDateTime(c.date, c.time)?.getTime() ?? 0) >= now);
    if (upcoming) return upcoming;
    // 3) Otherwise the most recent past class (even if attendance wasn't recorded).
    return matches[matches.length - 1];
  };

  // Build the client-safe question list for a test (image paths + option labels, NO answers).
  const buildExamQuestions = (testCode: string) => {
    const def = EXAM_TESTS[testCode];
    if (!def) return [];
    const questions = [];
    for (let n = 1; n <= def.questionCount; n++) {
      questions.push({
        questionNumber: n,
        imagePath: questionImagePath(testCode, n),
        options: EXAM_OPTIONS,
      });
    }
    return questions;
  };

  // Grade an attempt's answers against the server-authoritative key.
  const gradeAttempt = (testCode: string, answers: Record<string, string>) => {
    const def = EXAM_TESTS[testCode];
    const total = def.questionCount;
    let correct = 0;
    for (let n = 1; n <= total; n++) {
      if (answers && answers[String(n)] === def.answerKey[n]) correct++;
    }
    const score = Math.round((correct / total) * 100);
    return { correctCount: correct, totalQuestions: total, score, passed: score >= EXAM_PASS_PERCENT };
  };

  // Re-grade an attempt's stored answers and self-heal any stale stored score.
  // Returns the attempt with fresh, authoritative grading values.
  const reconcileAttemptGrade = async (attempt: any): Promise<any> => {
    const graded = gradeAttempt(attempt.testCode, (attempt.answers || {}) as Record<string, string>);
    const stale =
      attempt.score !== graded.score ||
      attempt.passed !== graded.passed ||
      attempt.correctCount !== graded.correctCount ||
      attempt.totalQuestions !== graded.totalQuestions;
    if (stale) {
      console.log(
        `[EXAM] Reconciled stale grade for attempt #${attempt.id} (student #${attempt.studentId}): ` +
          `score ${attempt.score} -> ${graded.score}, passed ${attempt.passed} -> ${graded.passed}`,
      );
      await storage.updateExamAttempt(attempt.id, {
        status: "submitted",
        score: graded.score,
        passed: graded.passed,
        correctCount: graded.correctCount,
        totalQuestions: graded.totalQuestions,
        submittedAt: attempt.submittedAt || new Date(),
      } as any);
    }
    return {
      ...attempt,
      status: "submitted",
      score: graded.score,
      passed: graded.passed,
      correctCount: graded.correctCount,
      totalQuestions: graded.totalQuestions,
      submittedAt: attempt.submittedAt || new Date(),
    };
  };

  // Student: current exam status for their Theory 5 class.
  app.get("/api/student/exam/status", async (req: any, res) => {
    try {
      const studentId = req.session?.studentId;
      if (!studentId) return res.status(401).json({ message: "Unauthorized" });

      const theory5 = await findTheory5Class(studentId);
      if (!theory5) {
        return res.json({ hasClass: false });
      }

      const classStart = parseClassDateTime(theory5.date, theory5.time);
      const now = new Date();
      const unlockAt = classStart ? new Date(classStart.getTime() + 60 * 60 * 1000) : null; // start + 60 min
      const duration = theory5.duration || 120;
      const resultsVisibleAt = classStart ? new Date(classStart.getTime() + duration * 60 * 1000) : null;

      const attempts = await storage.getExamAttemptsByStudent(studentId);
      let classAttempts = attempts
        .filter((a: any) => a.classId === theory5.id)
        .sort((a: any, b: any) => a.attemptNumber - b.attemptNumber);

      const resultsVisible = !!resultsVisibleAt && now >= resultsVisibleAt;

      // Once results are visible, always serve a fresh grading of the stored
      // answers (self-healing any stale stored score) for submitted attempts.
      if (resultsVisible) {
        classAttempts = await Promise.all(
          classAttempts.map((a: any) => (a.status === "submitted" ? reconcileAttemptGrade(a) : a)),
        );
      }
      const latest = classAttempts[classAttempts.length - 1] || null;
      const unlocked = !!unlockAt && now >= unlockAt;

      // Determine whether a (free) retake is available: latest was graded, results visible, and failed.
      const passedAny = classAttempts.some((a: any) => a.passed === true);
      const canRetake =
        !passedAny &&
        resultsVisible &&
        latest &&
        latest.passed === false &&
        classAttempts.length < 2;

      res.json({
        hasClass: true,
        classId: theory5.id,
        classDate: theory5.date,
        classTime: theory5.time,
        zoomLink: theory5.zoomLink || null,
        unlockAt: unlockAt?.toISOString() || null,
        resultsVisibleAt: resultsVisibleAt?.toISOString() || null,
        unlocked,
        resultsVisible,
        passedAny,
        canRetake,
        attempt: latest
          ? {
              id: latest.id,
              attemptNumber: latest.attemptNumber,
              status: latest.status,
              testCode: latest.testCode,
              // Score/pass hidden until results are visible.
              score: resultsVisible ? latest.score : null,
              passed: resultsVisible ? latest.passed : null,
              submittedAt: latest.submittedAt,
            }
          : null,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error fetching status:", error);
      res.status(500).json({ message: "Failed to fetch exam status" });
    }
  });

  // Student: start (or resume) an exam attempt.
  app.post("/api/student/exam/start", async (req: any, res) => {
    try {
      const studentId = req.session?.studentId;
      if (!studentId) return res.status(401).json({ message: "Unauthorized" });

      const { integrityAgreed, integritySignature, integrityName } = req.body || {};

      const theory5 = await findTheory5Class(studentId);
      if (!theory5) return res.status(404).json({ message: "No Module 5 class found for your account" });

      const classStart = parseClassDateTime(theory5.date, theory5.time);
      const now = new Date();
      const unlockAt = classStart ? new Date(classStart.getTime() + 60 * 60 * 1000) : null;
      if (!unlockAt || now < unlockAt) {
        return res.status(403).json({
          message: "The test is not open yet. It unlocks one hour after your class starts.",
          unlockAt: unlockAt?.toISOString() || null,
        });
      }

      const duration = theory5.duration || 120;
      const resultsVisibleAt = classStart ? new Date(classStart.getTime() + duration * 60 * 1000) : null;

      const attempts = await storage.getExamAttemptsByStudent(studentId);
      const classAttempts = attempts
        .filter((a: any) => a.classId === theory5.id)
        .sort((a: any, b: any) => a.attemptNumber - b.attemptNumber);

      // If already passed, nothing more to do.
      if (classAttempts.some((a: any) => a.passed === true)) {
        return res.status(400).json({ message: "You have already passed this exam." });
      }

      // Resume an existing in-progress attempt if present.
      const resumable = classAttempts.find((a: any) => a.status === "in_progress");
      if (resumable) {
        return res.json({
          attemptId: resumable.id,
          testCode: resumable.testCode,
          attemptNumber: resumable.attemptNumber,
          answers: resumable.answers || {},
          flaggedQuestions: resumable.flaggedQuestions || [],
          resultsVisibleAt: resumable.resultsVisibleAt,
          questions: buildExamQuestions(resumable.testCode),
        });
      }

      // A retake requires the previous attempt to be graded (results visible) and failed.
      if (classAttempts.length >= 1) {
        if (classAttempts.length >= 2) {
          return res.status(400).json({ message: "No further attempts are available." });
        }
        const prev = classAttempts[classAttempts.length - 1];
        const resultsVisible = !!resultsVisibleAt && now >= resultsVisibleAt;
        if (!(prev.passed === false && resultsVisible)) {
          return res.status(400).json({ message: "A retake is not available yet." });
        }
      }

      // Integrity declaration required to begin a fresh attempt.
      if (!integrityAgreed || !integrityName) {
        return res.status(400).json({ message: "You must complete the integrity declaration before starting." });
      }

      const attemptNumber = classAttempts.length + 1;
      const testCode = testCodeForAttempt(attemptNumber);

      const created = await storage.createExamAttempt({
        studentId,
        classId: theory5.id,
        testCode,
        attemptNumber,
        status: "in_progress",
        answers: {},
        flaggedQuestions: [],
        integrityAgreed: true,
        integritySignature: integritySignature || null,
        integrityName,
        integrityDeclaredAt: new Date(),
        startedAt: new Date(),
        resultsVisibleAt: resultsVisibleAt || null,
      } as any);

      res.status(201).json({
        attemptId: created.id,
        testCode: created.testCode,
        attemptNumber: created.attemptNumber,
        answers: {},
        flaggedQuestions: [],
        resultsVisibleAt: created.resultsVisibleAt,
        questions: buildExamQuestions(created.testCode),
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error starting attempt:", error);
      res.status(500).json({ message: "Failed to start exam" });
    }
  });

  // Helper: load an attempt and confirm it belongs to the logged-in student.
  const loadOwnedAttempt = async (req: any, res: any) => {
    const studentId = req.session?.studentId;
    if (!studentId) {
      res.status(401).json({ message: "Unauthorized" });
      return null;
    }
    const attempt = await storage.getExamAttempt(parseInt(req.params.id));
    if (!attempt || attempt.studentId !== studentId) {
      res.status(404).json({ message: "Attempt not found" });
      return null;
    }
    return attempt;
  };

  // Student: fetch an attempt (with questions, without answer key).
  app.get("/api/student/exam/attempt/:id", async (req: any, res) => {
    try {
      const attempt = await loadOwnedAttempt(req, res);
      if (!attempt) return;
      const now = new Date();
      const resultsVisible = !!attempt.resultsVisibleAt && now >= new Date(attempt.resultsVisibleAt);
      res.json({
        attemptId: attempt.id,
        testCode: attempt.testCode,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        answers: attempt.answers || {},
        flaggedQuestions: attempt.flaggedQuestions || [],
        resultsVisibleAt: attempt.resultsVisibleAt,
        resultsVisible,
        score: resultsVisible ? attempt.score : null,
        passed: resultsVisible ? attempt.passed : null,
        questions: buildExamQuestions(attempt.testCode),
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error fetching attempt:", error);
      res.status(500).json({ message: "Failed to fetch attempt" });
    }
  });

  // Student: save a single answer.
  app.patch("/api/student/exam/attempt/:id/answer", async (req: any, res) => {
    try {
      const attempt = await loadOwnedAttempt(req, res);
      if (!attempt) return;
      const now = new Date();
      if (attempt.resultsVisibleAt && now >= new Date(attempt.resultsVisibleAt)) {
        return res.status(403).json({ message: "The test window has closed." });
      }
      const { questionNumber, option } = req.body || {};
      const qn = parseInt(questionNumber);
      const def = EXAM_TESTS[attempt.testCode];
      if (!def || qn < 1 || qn > def.questionCount) {
        return res.status(400).json({ message: "Invalid question number" });
      }
      if (option !== null && !EXAM_OPTIONS.includes(option)) {
        return res.status(400).json({ message: "Invalid option" });
      }
      const answers = { ...(attempt.answers || {}) } as Record<string, string>;
      if (option === null) {
        delete answers[String(qn)];
      } else {
        answers[String(qn)] = option;
      }
      // Changing an answer invalidates any previously written grade — clear it
      // so a stale score can never be served later.
      const updated = await storage.updateExamAttempt(attempt.id, {
        answers,
        status: "in_progress",
        score: null,
        passed: null,
        correctCount: null,
      } as any);
      res.json({ answers: updated?.answers || answers });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error saving answer:", error);
      res.status(500).json({ message: "Failed to save answer" });
    }
  });

  // Student: submit an attempt (grades server-side; results stay hidden until end of 2nd hour).
  app.post("/api/student/exam/attempt/:id/submit", async (req: any, res) => {
    try {
      const attempt = await loadOwnedAttempt(req, res);
      if (!attempt) return;
      const now = new Date();
      // Submit is always allowed: even if the window has closed, grade the
      // already-saved answers so the attempt is never left stuck un-graded.
      const graded = gradeAttempt(attempt.testCode, (attempt.answers || {}) as Record<string, string>);
      await storage.updateExamAttempt(attempt.id, {
        status: "submitted",
        submittedAt: new Date(),
        score: graded.score,
        correctCount: graded.correctCount,
        totalQuestions: graded.totalQuestions,
        passed: graded.passed,
      } as any);
      const resultsVisible = !!attempt.resultsVisibleAt && now >= new Date(attempt.resultsVisibleAt);
      res.json({
        status: "submitted",
        resultsVisible,
        resultsVisibleAt: attempt.resultsVisibleAt,
        // Hide the outcome until results become visible.
        score: resultsVisible ? graded.score : null,
        passed: resultsVisible ? graded.passed : null,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error submitting attempt:", error);
      res.status(500).json({ message: "Failed to submit exam" });
    }
  });

  // Student: reopen a submitted attempt to change answers (allowed until the window closes).
  app.post("/api/student/exam/attempt/:id/reopen", async (req: any, res) => {
    try {
      const attempt = await loadOwnedAttempt(req, res);
      if (!attempt) return;
      const now = new Date();
      if (attempt.resultsVisibleAt && now >= new Date(attempt.resultsVisibleAt)) {
        return res.status(403).json({ message: "The test window has closed." });
      }
      // Reopening for edits invalidates the previously written grade.
      await storage.updateExamAttempt(attempt.id, {
        status: "in_progress",
        score: null,
        passed: null,
        correctCount: null,
      } as any);
      res.json({ status: "in_progress" });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error reopening attempt:", error);
      res.status(500).json({ message: "Failed to reopen exam" });
    }
  });

  // Student: flag a question for help (emails exam support at info@mortysdrivingschool.com).
  app.post("/api/student/exam/attempt/:id/flag", async (req: any, res) => {
    try {
      const attempt = await loadOwnedAttempt(req, res);
      if (!attempt) return;
      const { questionNumber } = req.body || {};
      const qn = parseInt(questionNumber);
      const def = EXAM_TESTS[attempt.testCode];
      if (!def || qn < 1 || qn > def.questionCount) {
        return res.status(400).json({ message: "Invalid question number" });
      }
      const flagged = Array.from(new Set([...(attempt.flaggedQuestions || []), qn]));
      await storage.updateExamAttempt(attempt.id, { flaggedQuestions: flagged } as any);

      // Email exam support.
      try {
        const student = await storage.getStudent(attempt.studentId);
        const baseUrl =
          process.env.APP_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:5000");
        const imageUrl = `${baseUrl}${questionImagePath(attempt.testCode, qn)}`;
        const { sendEmail: sendFlagEmail } = await import("./services/sendgrid");
        await sendFlagEmail({
          to: ["info@mortysdrivingschool.com"],
          from: process.env.SENDGRID_FROM_EMAIL || "info@mortysdrivingschool.com",
          subject: `Exam question flagged for review — Q${qn} (${attempt.testCode})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #111111; padding: 20px; text-align: center;">
                <h1 style="color: #ECC462; margin: 0; font-size: 22px;">Morty's Driving School — Exam Support</h1>
              </div>
              <div style="background: #ffffff; padding: 24px; border-left: 4px solid #ECC462;">
                <p style="color: #333;">A student flagged a question during the Module 5 online exam.</p>
                <ul style="color: #333; line-height: 1.6;">
                  <li><strong>Student:</strong> ${student ? `${student.firstName} ${student.lastName} (#${student.id})` : `#${attempt.studentId}`}</li>
                  <li><strong>Test:</strong> ${attempt.testCode}</li>
                  <li><strong>Question:</strong> ${qn}</li>
                  <li><strong>Attempt:</strong> #${attempt.attemptNumber}</li>
                </ul>
                <p style="color: #333;">Question image: <a href="${imageUrl}">${imageUrl}</a></p>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        captureRequestError(emailErr);
        console.error("[EXAM] Flag email failed:", emailErr);
      }

      res.json({ flaggedQuestions: flagged });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error flagging question:", error);
      res.status(500).json({ message: "Failed to flag question" });
    }
  });

  // Student: view results (only after results become visible).
  app.get("/api/student/exam/attempt/:id/result", async (req: any, res) => {
    try {
      const attempt = await loadOwnedAttempt(req, res);
      if (!attempt) return;
      const now = new Date();
      const resultsVisible = !!attempt.resultsVisibleAt && now >= new Date(attempt.resultsVisibleAt);
      if (!resultsVisible) {
        return res.status(403).json({
          message: "Results are available at the end of the second hour of your class.",
          resultsVisibleAt: attempt.resultsVisibleAt,
        });
      }
      // Always re-grade the stored answers against the answer key so a stale
      // stored score (e.g. written before answers were finalized) can never be
      // shown; the stored row is self-healed if it disagrees.
      const fresh = await reconcileAttemptGrade(attempt);
      res.json({
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        testCode: attempt.testCode,
        score: fresh.score,
        passed: fresh.passed,
        correctCount: fresh.correctCount,
        totalQuestions: fresh.totalQuestions,
        passPercent: EXAM_PASS_PERCENT,
        canRetake: fresh.passed === false && attempt.attemptNumber < 2,
        supportEmail: "info@mortysdrivingschool.com",
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error fetching result:", error);
      res.status(500).json({ message: "Failed to fetch result" });
    }
  });

  // Admin: reconcile all submitted exam attempts whose stored score disagrees
  // with a fresh grading of their stored answers (one-time backfill / repair).
  app.post("/api/admin/exam-attempts/recalculate", requireAdmin, async (req: any, res) => {
    try {
      const all = await storage.getAllExamAttempts();
      const changes: any[] = [];
      const pendingUpdates: { id: number; data: any }[] = [];
      let checked = 0;
      // Phase 1: read-only pass — grade every submitted attempt and collect the
      // corrections without applying anything yet.
      for (const attempt of all as any[]) {
        if (attempt.status !== "submitted") continue;
        checked++;
        const graded = gradeAttempt(attempt.testCode, (attempt.answers || {}) as Record<string, string>);
        const stale =
          attempt.score !== graded.score ||
          attempt.passed !== graded.passed ||
          attempt.correctCount !== graded.correctCount ||
          attempt.totalQuestions !== graded.totalQuestions;
        if (!stale) continue;
        pendingUpdates.push({
          id: attempt.id,
          data: {
            score: graded.score,
            passed: graded.passed,
            correctCount: graded.correctCount,
            totalQuestions: graded.totalQuestions,
          },
        });
        changes.push({
          attemptId: attempt.id,
          studentId: attempt.studentId,
          classId: attempt.classId,
          testCode: attempt.testCode,
          attemptNumber: attempt.attemptNumber,
          before: { score: attempt.score, passed: attempt.passed, correctCount: attempt.correctCount },
          after: { score: graded.score, passed: graded.passed, correctCount: graded.correctCount },
        });
      }
      // Enrich changed attempts with student names for the admin UI + audit log.
      const uniqueStudentIds = Array.from(new Set(changes.map((c) => c.studentId).filter(Boolean)));
      const nameById = new Map<number, string>();
      for (const sid of uniqueStudentIds) {
        try {
          const student = await storage.getStudent(sid);
          if (student) nameById.set(sid, `${student.firstName} ${student.lastName}`.trim());
        } catch {
          // name lookup is best-effort only
        }
      }
      for (const c of changes) {
        c.studentName = nameById.get(c.studentId) || null;
      }
      // Phase 2: apply all corrections AND write the audit record (who, when,
      // what changed) in a single transaction — if the audit log cannot be
      // written, no scores change and the request fails loudly.
      const admin = req.user;
      const adminName = [admin?.firstName, admin?.lastName].filter(Boolean).join(" ").trim() || null;
      await storage.applyExamRecalcWithAudit(pendingUpdates, {
        adminId: String(admin?.id ?? "unknown"),
        adminEmail: admin?.email ?? null,
        adminName,
        checkedCount: checked,
        correctedCount: changes.length,
        changes: JSON.stringify(changes),
      });
      for (const c of changes) {
        console.log(
          `[EXAM] Recalculate: attempt #${c.attemptId} (student #${c.studentId}) ` +
            `score ${c.before.score} -> ${c.after.score}, passed ${c.before.passed} -> ${c.after.passed}`,
        );
        // Pass/fail flips are communicated to the student (email + in-app);
        // score-only changes stay silent. Notifications go out only after the
        // corrections + audit log have been committed, and a notification
        // failure never breaks the recalculation itself.
        if (c.before.passed !== c.after.passed && c.studentId) {
          try {
            await notificationService.notifyExamResultCorrected({
              studentId: c.studentId,
              attemptId: c.attemptId,
              testCode: c.testCode,
              oldScore: c.before.score,
              newScore: c.after.score,
              oldPassed: c.before.passed,
              newPassed: c.after.passed,
              passPercent: EXAM_PASS_PERCENT,
              canRetake: c.after.passed === false && c.attemptNumber < 2,
            }, req.user?.id);
            c.studentNotified = true;
          } catch (notifyError) {
            captureRequestError(notifyError);
            console.error(
              `[EXAM] Failed to notify student #${c.studentId} about corrected result for attempt #${c.attemptId}:`,
              notifyError,
            );
            c.studentNotified = false;
          }
        }
      }
      res.json({ checked, corrected: changes.length, changes });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error recalculating attempts:", error);
      res.status(500).json({ message: "Failed to recalculate exam attempts" });
    }
  });

  // Admin: resend a failed exam-correction notice for one attempt. The
  // client supplies the pre-correction values (from the recalc results dialog);
  // the current attempt row in the DB is the authoritative "after" state.
  app.post("/api/admin/exam-attempts/:attemptId/resend-correction-notice", requireAdmin, async (req: any, res) => {
    try {
      const attemptId = parseInt(req.params.attemptId);
      if (isNaN(attemptId)) {
        return res.status(400).json({ message: "Invalid attempt id" });
      }
      const attempt = await storage.getExamAttempt(attemptId);
      if (!attempt) {
        return res.status(404).json({ message: "Exam attempt not found" });
      }
      if (attempt.passed === null || attempt.passed === undefined) {
        return res.status(400).json({ message: "This attempt has no graded result to notify about" });
      }
      const { oldScore, oldPassed } = req.body || {};
      if (typeof oldPassed !== "boolean") {
        return res.status(400).json({ message: "Missing pre-correction result (oldPassed)" });
      }
      await notificationService.notifyExamResultCorrected({
        studentId: attempt.studentId,
        attemptId: attempt.id,
        testCode: attempt.testCode,
        oldScore: typeof oldScore === "number" ? oldScore : null,
        newScore: attempt.score,
        oldPassed,
        newPassed: attempt.passed,
        passPercent: EXAM_PASS_PERCENT,
        canRetake: attempt.passed === false && attempt.attemptNumber < 2,
      }, req.user?.id);
      console.log(`[EXAM] Resent corrected-result notice for attempt #${attempt.id} (student #${attempt.studentId})`);
      res.json({ success: true, attemptId: attempt.id, studentNotified: true });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error resending corrected-result notice:", error);
      res.status(500).json({ message: "Failed to resend the notification — please try again" });
    }
  });

  // Admin: history of past exam score recalculation runs (audit trail).
  app.get("/api/admin/exam-recalc-logs", requireAdmin, async (req: any, res) => {
    try {
      const logs = await storage.getExamRecalcLogs(50);
      res.json(logs.map((log) => {
        let changes: any[] = [];
        try {
          changes = log.changes ? JSON.parse(log.changes) : [];
        } catch {
          // ignore malformed JSON, keep empty list
        }
        return { ...log, changes };
      }));
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error fetching recalc logs:", error);
      res.status(500).json({ message: "Failed to fetch recalculation history" });
    }
  });

  // Instructor/Admin: list Theory 5 (Module 5) classes that have online exams.
  // Instructors only see classes assigned to them; admins see all.
  app.get("/api/exam/classes", isAdminOrInstructor, async (req: any, res) => {
    try {
      const all = await storage.getClasses();
      let theory5 = all.filter(
        (c: any) => c.classType === "theory" && c.classNumber === 5 && c.status !== "cancelled",
      );
      if (req.instructor && !req.user) {
        theory5 = theory5.filter((c: any) => c.instructorId === req.instructor.id);
      }
      // Sort most recent first.
      theory5.sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
      res.json(theory5);
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error listing exam classes:", error);
      res.status(500).json({ message: "Failed to fetch exam classes" });
    }
  });

  // Instructor/Admin: live status of exam attempts for a class.
  app.get("/api/exam/class/:classId/attempts", isAdminOrInstructor, async (req: any, res) => {
    try {
      const classId = parseInt(req.params.classId);
      // Instructors may only view attempts for classes assigned to them.
      if (req.instructor && !req.user) {
        const cls = await storage.getClass(classId);
        if (!cls || cls.instructorId !== req.instructor.id) {
          return res.status(403).json({ message: "You can only view your own classes." });
        }
      }
      const attempts = await storage.getExamAttemptsByClass(classId);
      const enriched = await Promise.all(
        attempts.map(async (a: any) => {
          const student = await storage.getStudent(a.studentId);
          const def = EXAM_TESTS[a.testCode];
          const answered = a.answers ? Object.keys(a.answers).length : 0;
          return {
            id: a.id,
            studentId: a.studentId,
            studentName: student ? `${student.firstName} ${student.lastName}` : `#${a.studentId}`,
            attemptNumber: a.attemptNumber,
            testCode: a.testCode,
            status: a.status,
            answeredCount: answered,
            totalQuestions: def ? def.questionCount : null,
            flaggedCount: (a.flaggedQuestions || []).length,
            score: a.score,
            passed: a.passed,
            startedAt: a.startedAt,
            submittedAt: a.submittedAt,
          };
        }),
      );
      res.json(enriched);
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error fetching class attempts:", error);
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });

  // Instructor/Admin: full attempt detail (includes per-question correctness + integrity declaration).
  app.get("/api/exam/attempt/:id/review", isAdminOrInstructor, async (req: any, res) => {
    try {
      const attempt = await storage.getExamAttempt(parseInt(req.params.id));
      if (!attempt) return res.status(404).json({ message: "Attempt not found" });
      // Instructors may only review attempts belonging to their own classes.
      if (req.instructor && !req.user) {
        const cls = attempt.classId ? await storage.getClass(attempt.classId) : null;
        if (!cls || cls.instructorId !== req.instructor.id) {
          return res.status(403).json({ message: "You can only review your own classes." });
        }
      }
      const student = await storage.getStudent(attempt.studentId);
      const def = EXAM_TESTS[attempt.testCode];
      const answers = (attempt.answers || {}) as Record<string, string>;
      const questions = [];
      for (let n = 1; n <= def.questionCount; n++) {
        questions.push({
          questionNumber: n,
          imagePath: questionImagePath(attempt.testCode, n),
          studentAnswer: answers[String(n)] || null,
          correctAnswer: def.answerKey[n],
          correct: answers[String(n)] === def.answerKey[n],
          flagged: (attempt.flaggedQuestions || []).includes(n),
        });
      }
      const graded = gradeAttempt(attempt.testCode, answers);
      res.json({
        id: attempt.id,
        student: student ? { id: student.id, name: `${student.firstName} ${student.lastName}`, email: student.email } : null,
        classId: attempt.classId,
        testCode: attempt.testCode,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        // Always report the fresh grading so admin review and the student
        // result view can never disagree.
        score: graded.score,
        passed: graded.passed,
        correctCount: graded.correctCount,
        totalQuestions: graded.totalQuestions,
        passPercent: EXAM_PASS_PERCENT,
        integrity: {
          agreed: attempt.integrityAgreed,
          name: attempt.integrityName,
          signature: attempt.integritySignature,
          declaredAt: attempt.integrityDeclaredAt,
        },
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        resultsVisibleAt: attempt.resultsVisibleAt,
        questions,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[EXAM] Error fetching attempt review:", error);
      res.status(500).json({ message: "Failed to fetch attempt review" });
    }
  });

  // Instructor Invite Routes
  app.get("/api/instructor-invite/:token", async (req, res) => {
    try {
      console.log(`[INVITE] Validating invite token: ${req.params.token}`);
      const { token } = req.params;
      const instructor = await storage.getInstructorByInviteToken(token);

      console.log(
        `[INVITE] Instructor found:`,
        instructor
          ? `ID ${instructor.id}, status: ${instructor.accountStatus}`
          : "not found",
      );

      if (!instructor) {
        console.log(`[INVITE] Invalid token: ${token}`);
        return res.status(404).json({ message: "Invalid invite token" });
      }

      if (
        instructor.inviteExpiry &&
        new Date() > new Date(instructor.inviteExpiry)
      ) {
        console.log(
          `[INVITE] Expired token: ${token}, expiry: ${instructor.inviteExpiry}`,
        );
        return res.status(410).json({ message: "Invite link has expired" });
      }

      if (instructor.accountStatus !== "pending_invite") {
        console.log(
          `[INVITE] Token already used: ${token}, status: ${instructor.accountStatus}`,
        );
        return res.status(400).json({ message: "Invite already accepted" });
      }

      console.log(`[INVITE] Valid token, returning instructor info`);
      // Return instructor info without sensitive data
      res.json({
        id: instructor.id,
        firstName: instructor.firstName,
        lastName: instructor.lastName,
        email: instructor.email,
        phone: instructor.phone,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[INVITE] Error validating invite token:", error);
      console.error("[INVITE] Error stack:", error.stack);
      res.status(500).json({ message: "Failed to validate invite" });
    }
  });

  app.post("/api/instructor-invite/:token/accept", async (req, res) => {
    try {
      const { token } = req.params;
      const { password, termsAccepted, profileData } = req.body;

      if (!password || password.length < 8) {
        return res
          .status(400)
          .json({ message: "Password must be at least 8 characters" });
      }

      if (!termsAccepted) {
        return res
          .status(400)
          .json({ message: "You must accept the terms and conditions" });
      }

      const instructor = await storage.getInstructorByInviteToken(token);

      if (!instructor) {
        return res.status(404).json({ message: "Invalid invite token" });
      }

      if (
        instructor.inviteExpiry &&
        new Date() > new Date(instructor.inviteExpiry)
      ) {
        return res.status(410).json({ message: "Invite link has expired" });
      }

      if (instructor.accountStatus !== "pending_invite") {
        return res.status(400).json({ message: "Invite already accepted" });
      }

      // Hash password
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update instructor with password and status
      const updatedInstructor = await storage.updateInstructor(instructor.id, {
        password: hashedPassword,
        accountStatus: "active",
        inviteAcceptedAt: new Date(),
        termsAcceptedAt: new Date(),
        inviteToken: null, // Clear the token
        ...profileData, // Additional profile fields
      });

      // Auto-login the instructor
      (req.session as any).instructorId = updatedInstructor.id;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.json({
        success: true,
        instructor: {
          id: updatedInstructor.id,
          firstName: updatedInstructor.firstName,
          lastName: updatedInstructor.lastName,
          email: updatedInstructor.email,
        },
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error accepting invite:", error);
      res.status(500).json({ message: "Failed to accept invite" });
    }
  });

  // Instructor Authentication Routes
  app.post("/api/instructor/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .json({ success: false, message: "Email and password required" });
      }

      const result = await loginInstructor(email, password);

      if (result.success && result.instructor) {
        (req.session as any).instructorId = result.instructor.id;

        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        res.json({ success: true, instructor: result.instructor });
      } else {
        res.status(401).json({ success: false, message: result.message });
      }
    } catch (error) {
      captureRequestError(error);
      console.error("Instructor login error:", error);
      res.status(500).json({ success: false, message: "Login failed" });
    }
  });

  app.get(
    "/api/instructor/me",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        res.json(req.instructor);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching instructor profile:", error);
        res.status(500).json({ message: "Failed to fetch profile" });
      }
    },
  );

  app.post("/api/instructor/logout", (req, res) => {
    req.session?.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  // Student Authentication Routes
  app.post("/api/student/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .json({ success: false, message: "Email and password required" });
      }

      const result = await loginStudent(email, password);

      if (result.success && result.student) {
        (req.session as any).studentId = result.student.id;

        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        return res.json({
          success: true,
          token: generateStudentToken(result.student.id),
          student: {
            id: result.student.id,
            firstName: result.student.firstName,
            lastName: result.student.lastName,
            email: result.student.email,
            phone: result.student.phone,
            courseType: result.student.courseType,
            status: result.student.status,
            progress: result.student.progress,
            phase: result.student.phase,
            instructorId: result.student.instructorId,
            attestationNumber: result.student.attestationNumber,
            learnerPermitValidDate: result.student.learnerPermitValidDate,
          },
        });
      }

      return res.status(401).json({ 
        success: false, 
        message: result.message,
        errorType: (result as any).errorType || undefined,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Student login error:", error);
      res.status(500).json({ success: false, message: "Login failed" });
    }
  });

  app.post("/api/student/logout", (req, res) => {
    req.session?.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  // Resend student activation invite
  app.post("/api/student/resend-activation", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const student = await storage.getStudentByEmail(email);
      if (!student || student.accountStatus === 'active') {
        return res.json({ success: true, message: "If an account with this email needs activation, a link has been sent." });
      }

      const { generateInviteToken, getInviteExpiry, sendStudentInviteEmail } = await import('./inviteService.js');
      const inviteToken = generateInviteToken();
      const inviteExpiry = getInviteExpiry();

      await storage.updateStudent(student.id, {
        inviteToken,
        inviteExpiry,
        accountStatus: 'pending_invite',
      });

      try {
        await sendStudentInviteEmail(student.email, student.firstName, inviteToken);
        console.log(`[RESEND-ACTIVATION] Activation email re-sent to ${student.email}`);
      } catch (emailError) {
        captureRequestError(emailError);
        console.error(`[RESEND-ACTIVATION] Failed to send email to ${student.email}:`, emailError);
      }

      res.json({ success: true, message: "If an account with this email needs activation, a link has been sent." });
    } catch (error) {
      captureRequestError(error);
      console.error("[RESEND-ACTIVATION] Error:", error);
      res.status(500).json({ message: "Failed to resend activation link" });
    }
  });

  // Parent Invite Routes
  app.get("/api/parent-invite/:token", async (req, res) => {
    try {
      console.log(`[PARENT-INVITE] Validating invite token: ${req.params.token}`);
      const { token } = req.params;
      const parent = await storage.getParentByInviteToken(token);

      console.log(
        `[PARENT-INVITE] Parent found:`,
        parent
          ? `ID ${parent.id}, status: ${parent.accountStatus}`
          : "not found",
      );

      if (!parent) {
        console.log(`[PARENT-INVITE] Invalid token: ${token}`);
        return res.status(404).json({ message: "Invalid invite token" });
      }

      if (parent.inviteExpiry && new Date() > new Date(parent.inviteExpiry)) {
        console.log(
          `[PARENT-INVITE] Expired token: ${token}, expiry: ${parent.inviteExpiry}`,
        );
        return res.status(410).json({ message: "Invite link has expired" });
      }

      if (parent.accountStatus !== "pending_invite") {
        console.log(
          `[PARENT-INVITE] Token already used: ${token}, status: ${parent.accountStatus}`,
        );
        return res.status(400).json({ message: "Invite already accepted" });
      }

      console.log(`[PARENT-INVITE] Valid token, returning parent info`);
      // Return parent info without sensitive data
      res.json({
        id: parent.id,
        firstName: parent.firstName,
        lastName: parent.lastName,
        email: parent.email,
        phone: parent.phone,
        relationship: parent.relationship,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[PARENT-INVITE] Error validating invite token:", error);
      res.status(500).json({ message: "Failed to validate invite" });
    }
  });

  app.post("/api/parent-invite/:token/accept", async (req, res) => {
    try {
      const { token } = req.params;
      const { password, termsAccepted } = req.body;

      if (!password || password.length < 8) {
        return res
          .status(400)
          .json({ message: "Password must be at least 8 characters" });
      }

      if (!termsAccepted) {
        return res
          .status(400)
          .json({ message: "You must accept the terms and conditions" });
      }

      const parent = await storage.getParentByInviteToken(token);

      if (!parent) {
        return res.status(404).json({ message: "Invalid invite token" });
      }

      if (parent.inviteExpiry && new Date() > new Date(parent.inviteExpiry)) {
        return res.status(410).json({ message: "Invite link has expired" });
      }

      if (parent.accountStatus !== "pending_invite") {
        return res.status(400).json({ message: "Invite already accepted" });
      }

      // Hash password
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update parent with password and status
      const updatedParent = await storage.updateParent(parent.id, {
        password: hashedPassword,
        accountStatus: "active",
        inviteToken: null, // Clear the token
      });

      // Auto-login the parent
      (req.session as any).parentId = parent.id;

      res.json({
        success: true,
        parent: {
          id: updatedParent.id,
          firstName: updatedParent.firstName,
          lastName: updatedParent.lastName,
          email: updatedParent.email,
        },
      });
    } catch (error) {
      captureRequestError(error);
      console.error("[PARENT-INVITE] Error accepting invite:", error);
      res.status(500).json({ message: "Failed to accept invitation" });
    }
  });

  // Parent Portal Authentication Routes
  app.post("/api/parent/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .json({ success: false, message: "Email and password required" });
      }

      const result = await loginParent(email, password);

      if (result.success && result.parent) {
        (req.session as any).parentId = result.parent.id;

        // Get full student details for each linked student
        const linkedStudentsWithDetails = await Promise.all(
          (result.linkedStudents || []).map(async (rel) => {
            const student = await storage.getStudent(rel.studentId);
            return {
              ...rel,
              student: student ? {
                id: student.id,
                firstName: student.firstName,
                lastName: student.lastName,
                email: student.email,
                courseType: student.courseType,
                status: student.status,
                progress: student.progress,
              } : null
            };
          })
        );

        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        return res.json({
          success: true,
          parent: {
            id: result.parent.id,
            firstName: result.parent.firstName,
            lastName: result.parent.lastName,
            email: result.parent.email,
            relationship: result.parent.relationship,
          },
          linkedStudents: linkedStudentsWithDetails,
          requiresStudentSelection: linkedStudentsWithDetails.length > 1,
        });
      }

      return res.status(401).json({ success: false, message: result.message });
    } catch (error) {
      captureRequestError(error);
      console.error("Parent login error:", error);
      res.status(500).json({ success: false, message: "Login failed" });
    }
  });

  app.post("/api/parent/logout", (req, res) => {
    req.session?.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  app.post("/api/parent/select-student", isParentAuthenticated, async (req: any, res) => {
    try {
      const { studentId } = req.body;
      const parentId = req.parent.id;

      // Verify parent has access to this student
      const linkedStudents = await storage.getParentStudents(parentId);
      const hasAccess = linkedStudents.some(rel => rel.studentId === studentId);

      if (!hasAccess) {
        return res.status(403).json({ message: "You don't have access to this student" });
      }

      const student = await storage.getStudent(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      // Store selected student in session and persist to database
      (req.session as any).selectedStudentId = studentId;
      
      // Persist to database for cross-session persistence
      await storage.updateParentSelectedStudent(parentId, studentId);
      
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.json({
        success: true,
        student: {
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          courseType: student.courseType,
          status: student.status,
          progress: student.progress,
          phase: student.phase,
        }
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Select student error:", error);
      res.status(500).json({ message: "Failed to select student" });
    }
  });

  app.get("/api/parent/me", isParentAuthenticated, async (req: any, res) => {
    try {
      const parent = req.parent;
      const linkedStudents = await storage.getParentStudents(parent.id);
      
      const linkedStudentsWithDetails = await Promise.all(
        linkedStudents.map(async (rel) => {
          const student = await storage.getStudent(rel.studentId);
          return {
            ...rel,
            student: student ? {
              id: student.id,
              firstName: student.firstName,
              lastName: student.lastName,
              email: student.email,
              courseType: student.courseType,
              status: student.status,
              progress: student.progress,
            } : null
          };
        })
      );

      res.json({
        id: parent.id,
        firstName: parent.firstName,
        lastName: parent.lastName,
        email: parent.email,
        phone: parent.phone,
        relationship: parent.relationship,
        linkedStudents: linkedStudentsWithDetails,
        selectedStudentId: (req.session as any)?.selectedStudentId || null,
        selectedStudent: req.selectedStudent || null,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching parent info:", error);
      res.status(500).json({ message: "Failed to fetch parent information" });
    }
  });

  app.get("/api/parent/linked-students", isParentAuthenticated, async (req: any, res) => {
    try {
      const parentId = req.parent.id;
      const linkedStudents = await storage.getParentStudents(parentId);
      
      const studentsWithDetails = await Promise.all(
        linkedStudents.map(async (rel) => {
          const student = await storage.getStudent(rel.studentId);
          const courses = student ? await storage.getStudentCourses(student.id) : [];
          return {
            ...rel,
            student: student ? {
              id: student.id,
              firstName: student.firstName,
              lastName: student.lastName,
              email: student.email,
              courseType: student.courseType,
              status: student.status,
              progress: student.progress,
              phase: student.phase,
            } : null,
            courses: courses
          };
        })
      );

      res.json(studentsWithDetails);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching linked students:", error);
      res.status(500).json({ message: "Failed to fetch linked students" });
    }
  });

  // Student Password Reset Routes
  app.post("/api/student/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const student = await storage.getStudentByEmail(email);

      if (!student) {
        return res.status(404).json({ message: "No account found with this email address." });
      }

      // Generate reset token and expiry (1 hour)
      const resetToken = generateInviteToken();
      const resetExpiry = new Date();
      resetExpiry.setHours(resetExpiry.getHours() + 1);

      // Update student with reset token
      await storage.updateStudent(student.id, {
        resetPasswordToken: resetToken,
        resetPasswordExpiry: resetExpiry,
      });

      // Send reset email asynchronously
      sendPasswordResetEmail(student.email, student.firstName, resetToken).catch((error) => {
        console.error("Failed to send password reset email:", error);
      });

      res.json({ success: true, message: "If that email is registered, a reset link has been sent" });
    } catch (error) {
      captureRequestError(error);
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  app.get("/api/student/reset-password/:token/validate", async (req, res) => {
    try {
      const { token } = req.params;

      const student = await storage.getStudentByResetToken(token);

      if (!student) {
        return res.status(404).json({ message: "Invalid reset token" });
      }

      if (student.resetPasswordExpiry && new Date() > new Date(student.resetPasswordExpiry)) {
        return res.status(410).json({ message: "Reset link has expired" });
      }

      res.json({
        valid: true,
        firstName: student.firstName,
        email: student.email,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Reset token validation error:", error);
      res.status(500).json({ message: "Failed to validate token" });
    }
  });

  app.post("/api/student/reset-password/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.body;

      if (!password || password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const student = await storage.getStudentByResetToken(token);

      if (!student) {
        return res.status(404).json({ message: "Invalid reset token" });
      }

      if (student.resetPasswordExpiry && new Date() > new Date(student.resetPasswordExpiry)) {
        return res.status(410).json({ message: "Reset link has expired" });
      }

      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update password and clear reset token
      await storage.updateStudent(student.id, {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpiry: null,
      });

      res.json({ success: true, message: "Password reset successful" });
    } catch (error) {
      captureRequestError(error);
      console.error("Password reset error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // ─── Admin Impersonation Endpoints ───────────────────────────────────────────

  app.get("/api/admin/impersonation-status", authMiddleware, async (req: any, res) => {
    try {
      const session = req.session as any;
      const impersonatingStudentId = session?.impersonatingStudentId ?? null;
      const impersonatingInstructorId = session?.impersonatingInstructorId ?? null;

      let studentName: string | null = null;
      let instructorName: string | null = null;

      if (impersonatingStudentId) {
        const student = await storage.getStudent(impersonatingStudentId);
        if (student) studentName = `${student.firstName} ${student.lastName}`;
      }

      if (impersonatingInstructorId) {
        const instructor = await storage.getInstructor(impersonatingInstructorId);
        if (instructor) instructorName = `${instructor.firstName} ${instructor.lastName}`;
      }

      res.json({ impersonatingStudentId, impersonatingInstructorId, studentName, instructorName });
    } catch (error) {
      captureRequestError(error);
      console.error("Impersonation status error:", error);
      res.status(500).json({ message: "Failed to get impersonation status" });
    }
  });

  app.post("/api/admin/impersonate/student/:studentId", authMiddleware, async (req: any, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      if (isNaN(studentId)) return res.status(400).json({ message: "Invalid student ID" });

      const student = await storage.getStudent(studentId);
      if (!student || student.accountStatus !== 'active') {
        return res.status(404).json({ message: "Student not found or inactive" });
      }

      (req.session as any).impersonatingStudentId = studentId;
      (req.session as any).impersonatingInstructorId = undefined;

      req.session.save((err: any) => {
        if (err) return res.status(500).json({ message: "Session save failed" });
        res.json({ success: true, studentId, studentName: `${student.firstName} ${student.lastName}` });
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Impersonate student error:", error);
      res.status(500).json({ message: "Failed to start impersonation" });
    }
  });

  app.post("/api/admin/impersonate/instructor/:instructorId", authMiddleware, async (req: any, res) => {
    try {
      const instructorId = parseInt(req.params.instructorId);
      if (isNaN(instructorId)) return res.status(400).json({ message: "Invalid instructor ID" });

      const instructor = await storage.getInstructor(instructorId);
      if (!instructor || instructor.status !== 'active') {
        return res.status(404).json({ message: "Instructor not found or inactive" });
      }

      (req.session as any).impersonatingInstructorId = instructorId;
      (req.session as any).impersonatingStudentId = undefined;

      req.session.save((err: any) => {
        if (err) return res.status(500).json({ message: "Session save failed" });
        res.json({ success: true, instructorId, instructorName: `${instructor.firstName} ${instructor.lastName}` });
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Impersonate instructor error:", error);
      res.status(500).json({ message: "Failed to start impersonation" });
    }
  });

  app.post("/api/admin/impersonate/stop", authMiddleware, async (req: any, res) => {
    try {
      const session = req.session as any;
      const studentId = session?.impersonatingStudentId ?? null;
      const instructorId = session?.impersonatingInstructorId ?? null;

      session.impersonatingStudentId = undefined;
      session.impersonatingInstructorId = undefined;

      req.session.save((err: any) => {
        if (err) return res.status(500).json({ message: "Session save failed" });
        res.json({ success: true, returnToStudentId: studentId, returnToInstructorId: instructorId });
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Stop impersonation error:", error);
      res.status(500).json({ message: "Failed to stop impersonation" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────

  app.get("/api/student/me", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      res.json({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        phone: student.phone,
        courseType: student.courseType,
        status: student.status,
        progress: student.progress,
        phase: student.phase,
        instructorId: student.instructorId,
        attestationNumber: student.attestationNumber,
        learnerPermitNumber: student.learnerPermitNumber,
        learnerPermitValidDate: student.learnerPermitValidDate,
        learnerPermitExpiryDate: student.learnerPermitExpiryDate,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student info:", error);
      res.status(500).json({ message: "Failed to fetch student information" });
    }
  });

  app.get("/api/student/phase-progress", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const phaseProgress = await buildPhaseProgress(student.id);
      res.json(phaseProgress);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching phase progress:", error);
      res.status(500).json({ message: "Failed to fetch phase progress" });
    }
  });

  // Student Course Enrollments - For students to view their own courses
  app.get("/api/student/courses", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const courses = await storage.getStudentCourses(student.id);
      res.json(courses);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student courses:", error);
      res.status(500).json({ message: "Failed to fetch courses" });
    }
  });

  // Student Profile Routes
  app.get("/api/student/profile", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      res.json({
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        phone: student.phone,
        homePhone: student.homePhone,
        primaryLanguage: student.primaryLanguage || "English",
        address: student.address,
        city: student.city,
        postalCode: student.postalCode,
        province: student.province,
        emergencyContact: student.emergencyContact,
        emergencyPhone: student.emergencyPhone,
        profilePhoto: student.profilePhoto,
        specialNeeds: student.specialNeeds,
        accommodations: student.accommodations,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.post("/api/student/profile", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const {
        firstName,
        lastName,
        email,
        phone,
        homePhone,
        primaryLanguage,
        address,
        city,
        postalCode,
        province,
        emergencyContact,
        emergencyPhone,
        profilePhoto,
        specialNeeds,
        accommodations,
      } = req.body;

      // Update student profile
      const updatedStudent = await storage.updateStudent(student.id, {
        firstName,
        lastName,
        email,
        phone,
        homePhone,
        primaryLanguage,
        address,
        city,
        postalCode,
        province,
        emergencyContact,
        emergencyPhone,
        profilePhoto,
        specialNeeds,
        accommodations,
      });

      res.json({
        success: true,
        message: "Profile updated successfully",
        student: {
          firstName: updatedStudent.firstName,
          lastName: updatedStudent.lastName,
          email: updatedStudent.email,
          phone: updatedStudent.phone,
          homePhone: updatedStudent.homePhone,
          primaryLanguage: updatedStudent.primaryLanguage,
          address: updatedStudent.address,
          city: updatedStudent.city,
          postalCode: updatedStudent.postalCode,
          province: updatedStudent.province,
          emergencyContact: updatedStudent.emergencyContact,
          emergencyPhone: updatedStudent.emergencyPhone,
          profilePhoto: updatedStudent.profilePhoto,
          specialNeeds: updatedStudent.specialNeeds,
          accommodations: updatedStudent.accommodations,
        },
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating student profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Student Parent Management Routes
  app.get("/api/student/parents", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      
      // Get all parent links for this student
      const parentLinks = await storage.getStudentParents(student.id);
      
      // Fetch parent details for each link
      const parentLinksWithDetails = await Promise.all(
        parentLinks.map(async (link) => {
          const parent = await storage.getParent(link.parentId);
          return {
            ...link,
            parent,
          };
        })
      );
      
      res.json(parentLinksWithDetails);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student parents:", error);
      res.status(500).json({ message: "Failed to fetch linked parents" });
    }
  });

  app.post("/api/student/parents", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const { firstName, lastName, email, phone, relationship, permissionLevel } = req.body;
      
      // Check if parent with this email already exists
      let parent = await storage.getParentByEmail(email);
      
      if (!parent) {
        // Create new parent with invite
        const crypto = await import("crypto");
        const inviteToken = crypto.randomBytes(32).toString("hex");
        const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        
        parent = await storage.createParent({
          firstName,
          lastName,
          email,
          phone,
          relationship,
          inviteToken,
          inviteExpiry,
          accountStatus: "pending_invite",
          inviteSentAt: new Date(),
        });
        
        // Send invitation email
        try {
          await sendParentInviteEmail(parent.email, parent.firstName, inviteToken, student.firstName, student.lastName);
          console.log(`Parent invitation email sent to ${parent.email}`);
        } catch (error) {
          captureRequestError(error);
          console.error(`Failed to send parent invitation email to ${parent.email}:`, error);
          // Continue even if email fails
        }
      } else {
        // Parent exists - update their details with the new information provided
        // This handles cases where a parent was previously deleted and is being re-added
        const updatedParent = await storage.updateParent(parent.id, {
          firstName,
          lastName,
          phone,
          relationship,
        });
        if (updatedParent) {
          parent = updatedParent;
        }
      }
      
      // Check if this parent is already linked to this student
      const existingLink = await storage.getStudentParents(student.id);
      const alreadyLinked = existingLink.some(link => link.parentId === parent.id);
      
      if (alreadyLinked) {
        return res.status(400).json({ message: "This parent is already linked to your account" });
      }
      
      // Create the link
      const link = await storage.createStudentParent({
        studentId: student.id,
        parentId: parent.id,
        permissionLevel,
      });
      
      res.json({
        success: true,
        message: "Parent invited successfully",
        link: {
          ...link,
          parent,
        },
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error inviting parent:", error);
      res.status(500).json({ message: "Failed to invite parent" });
    }
  });

  app.patch("/api/student/parents/:id", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const linkId = parseInt(req.params.id);
      const { permissionLevel } = req.body;
      
      // Verify this link belongs to the student
      const link = await storage.getStudentParents(student.id);
      const studentLink = link.find(l => l.id === linkId);
      
      if (!studentLink) {
        return res.status(404).json({ message: "Parent link not found" });
      }
      
      // Update permission level
      const updatedLink = await storage.updateStudentParent(linkId, { permissionLevel });
      
      res.json({
        success: true,
        message: "Permission level updated",
        link: updatedLink,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating parent permission:", error);
      res.status(500).json({ message: "Failed to update permission level" });
    }
  });

  app.delete("/api/student/parents/:id", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const linkId = parseInt(req.params.id);
      
      // Verify this link belongs to the student
      const links = await storage.getStudentParents(student.id);
      const studentLink = links.find(l => l.id === linkId);
      
      if (!studentLink) {
        return res.status(404).json({ message: "Parent link not found" });
      }
      
      // Delete the link
      await storage.deleteStudentParent(linkId);
      
      res.json({
        success: true,
        message: "Parent access removed",
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error removing parent:", error);
      res.status(500).json({ message: "Failed to remove parent access" });
    }
  });

  // Student Evaluations Route
  app.get("/api/student/evaluations", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      
      // Get all evaluations for this student
      const evaluations = await storage.getEvaluationsByStudent(student.id);
      
      // Get all instructors to populate instructor names
      const instructors = await storage.getInstructors();
      const instructorMap = new Map(instructors.map(i => [i.id, i]));
      
      // Enrich evaluations with instructor details
      const enrichedEvaluations = evaluations.map(evaluation => ({
        ...evaluation,
        instructor: evaluation.instructorId ? instructorMap.get(evaluation.instructorId) : null,
      }));
      
      res.json(enrichedEvaluations);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student evaluations:", error);
      res.status(500).json({ message: "Failed to fetch evaluations" });
    }
  });

  // Student History Route - comprehensive view of lessons, evaluations, and attendance
  app.get("/api/student/history", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const { type, status, startDate, endDate, limit = '50', offset = '0' } = req.query;

      // Get all enrollments for the student
      const enrollments = await storage.getClassEnrollmentsByStudent(student.id);
      const classIds = enrollments.map((e) => e.classId);
      
      // Get all classes the student is enrolled in
      const allClasses = await storage.getClasses();
      const studentClasses = allClasses.filter((c) => classIds.includes(c.id));
      
      // Get evaluations
      const evaluations = await storage.getEvaluationsByStudent(student.id);
      
      // Get instructors for enrichment
      const instructors = await storage.getInstructors();
      const instructorMap = new Map(instructors.map(i => [i.id, i]));

      // Build unified history entries
      const historyEntries: any[] = [];

      // Add lesson entries (classes with enrollment data)
      for (const classItem of studentClasses) {
        const enrollment = enrollments.find((e) => e.classId === classItem.id);
        if (!enrollment) continue;

        const instructor = classItem.instructorId ? instructorMap.get(classItem.instructorId) : null;
        // School-timezone start instant; null when the stored schedule is malformed.
        const classStart = getClassStartTime(classItem);
        const isTheory = isTheoryClass(classItem.classType, classItem.classNumber);
        
        // Determine lesson status
        let lessonStatus = 'upcoming';
        if (enrollment.cancelledAt) {
          lessonStatus = 'cancelled';
        } else if (enrollment.attendanceStatus === 'attended') {
          lessonStatus = 'completed';
        } else if (enrollment.attendanceStatus === 'absent' || enrollment.attendanceStatus === 'no-show') {
          lessonStatus = 'missed';
        } else if (classStart && classStart < new Date()) {
          lessonStatus = 'past';
        }

        historyEntries.push({
          id: `lesson-${classItem.id}`,
          type: 'lesson',
          date: classItem.date,
          time: classItem.time,
          timestamp: classStart ? classStart.toISOString() : `${classItem.date}T${classItem.time || "00:00"}`,
          title: `${classItem.courseType || 'Auto'} - Class ${classItem.classNumber || 'N/A'}`,
          description: classItem.topic || (isTheory ? 'Theory Class' : 'Driving Class'),
          classType: isTheory ? 'theory' : 'driving',
          status: lessonStatus,
          attendanceStatus: enrollment.attendanceStatus,
          checkInAt: enrollment.checkInAt,
          checkOutAt: enrollment.checkOutAt,
          checkInSignature: !!enrollment.checkInSignature,
          checkOutSignature: !!enrollment.checkOutSignature,
          instructor: instructor ? {
            id: instructor.id,
            firstName: instructor.firstName,
            lastName: instructor.lastName
          } : null,
          room: classItem.room,
          classId: classItem.id,
          enrollmentId: enrollment.id,
          classNumber: classItem.classNumber,
          courseType: classItem.courseType
        });
      }

      // Add evaluation entries
      for (const evaluation of evaluations) {
        const instructor = evaluation.instructorId ? instructorMap.get(evaluation.instructorId) : null;
        
        historyEntries.push({
          id: `evaluation-${evaluation.id}`,
          type: 'evaluation',
          date: evaluation.evaluationDate,
          timestamp: new Date(evaluation.evaluationDate).toISOString(),
          title: evaluation.sessionType === 'in-car' ? 'In-Car Evaluation' : 'Theory Evaluation',
          description: `Overall rating: ${evaluation.overallRating || 'N/A'}/5`,
          sessionType: evaluation.sessionType,
          status: evaluation.signedOff ? 'signed' : 'pending',
          overallRating: evaluation.overallRating,
          strengths: evaluation.strengths,
          weaknesses: evaluation.weaknesses,
          notes: evaluation.notes,
          signedOff: evaluation.signedOff,
          instructor: instructor ? {
            id: instructor.id,
            firstName: instructor.firstName,
            lastName: instructor.lastName
          } : null,
          evaluationId: evaluation.id
        });
      }

      // Sort by timestamp (newest first)
      historyEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply filters
      let filteredEntries = historyEntries;

      if (type && type !== 'all') {
        filteredEntries = filteredEntries.filter(e => e.type === type);
      }

      if (status && status !== 'all') {
        filteredEntries = filteredEntries.filter(e => e.status === status);
      }

      if (startDate) {
        filteredEntries = filteredEntries.filter(e => e.date >= startDate);
      }

      if (endDate) {
        filteredEntries = filteredEntries.filter(e => e.date <= endDate);
      }

      // Calculate totals before pagination
      const total = filteredEntries.length;
      const lessonCount = filteredEntries.filter(e => e.type === 'lesson').length;
      const evaluationCount = filteredEntries.filter(e => e.type === 'evaluation').length;

      // Apply pagination
      const limitNum = parseInt(limit as string) || 50;
      const offsetNum = parseInt(offset as string) || 0;
      const paginatedEntries = filteredEntries.slice(offsetNum, offsetNum + limitNum);

      res.json({
        entries: paginatedEntries,
        total,
        lessonCount,
        evaluationCount,
        hasMore: offsetNum + limitNum < total
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student history:", error);
      res.status(500).json({ message: "Failed to fetch history" });
    }
  });

  // Student Notification Preferences Routes
  app.get("/api/student/notifications/preferences", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      
      res.json({
        emailNotificationsEnabled: student.emailNotificationsEnabled ?? true,
        smsNotificationsEnabled: student.smsNotificationsEnabled ?? false,
        notifyUpcomingClasses: student.notifyUpcomingClasses ?? true,
        upcomingClassReminderTime: student.upcomingClassReminderTime ?? "24h",
        notifyScheduleChanges: student.notifyScheduleChanges ?? true,
        notifyScheduleOpenings: student.notifyScheduleOpenings ?? true,
        notifyPaymentReceipts: student.notifyPaymentReceipts ?? true,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching notification preferences:", error);
      res.status(500).json({ message: "Failed to fetch notification preferences" });
    }
  });

  app.patch("/api/student/notifications/preferences", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const updates = req.body;

      const allowedBooleanFields = [
        'emailNotificationsEnabled',
        'smsNotificationsEnabled',
        'notifyUpcomingClasses',
        'notifyScheduleChanges',
        'notifyScheduleOpenings',
        'notifyPaymentReceipts',
      ];

      const allowedStringFields = [
        'upcomingClassReminderTime',
      ];

      const validReminderTimes = ['30m', '1h', '2h', '4h', '12h', '24h', '48h'];

      const validUpdates: any = {};
      for (const field of allowedBooleanFields) {
        if (field in updates && typeof updates[field] === 'boolean') {
          validUpdates[field] = updates[field];
        }
      }
      for (const field of allowedStringFields) {
        if (field in updates && typeof updates[field] === 'string' && validReminderTimes.includes(updates[field])) {
          validUpdates[field] = updates[field];
        }
      }

      if (Object.keys(validUpdates).length === 0) {
        return res.status(400).json({ message: "No valid updates provided" });
      }

      await storage.updateStudent(student.id, validUpdates);

      const updatedStudent = await storage.getStudent(student.id);
      if (!updatedStudent) {
        return res.status(404).json({ message: "Student not found" });
      }

      res.json({
        success: true,
        message: "Notification preferences updated",
        preferences: {
          emailNotificationsEnabled: updatedStudent.emailNotificationsEnabled ?? true,
          smsNotificationsEnabled: updatedStudent.smsNotificationsEnabled ?? false,
          notifyUpcomingClasses: updatedStudent.notifyUpcomingClasses ?? true,
          upcomingClassReminderTime: updatedStudent.upcomingClassReminderTime ?? "24h",
          notifyScheduleChanges: updatedStudent.notifyScheduleChanges ?? true,
          notifyScheduleOpenings: updatedStudent.notifyScheduleOpenings ?? true,
          notifyPaymentReceipts: updatedStudent.notifyPaymentReceipts ?? true,
        },
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ message: "Failed to update notification preferences" });
    }
  });

  // Student Learner's Permit Routes
  app.get("/api/student/permit", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      
      res.json({
        learnerPermitNumber: student.learnerPermitNumber || '',
        learnerPermitValidDate: student.learnerPermitValidDate || '',
        learnerPermitExpiryDate: student.learnerPermitExpiryDate || '',
        learnerPermitPhoto: student.learnerPermitPhoto || null,
        driverLicenseNumber: student.driverLicenseNumber || '',
        licenseExpiryDate: student.licenseExpiryDate || '',
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching permit info:", error);
      res.status(500).json({ message: "Failed to fetch permit information" });
    }
  });

  app.patch("/api/student/permit", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const { learnerPermitNumber, learnerPermitValidDate, learnerPermitExpiryDate, learnerPermitPhoto, driverLicenseNumber, licenseExpiryDate } = req.body;

      const updates: any = {};
      
      if (learnerPermitNumber !== undefined) updates.learnerPermitNumber = learnerPermitNumber;
      if (learnerPermitValidDate !== undefined) updates.learnerPermitValidDate = learnerPermitValidDate;
      if (learnerPermitExpiryDate !== undefined) updates.learnerPermitExpiryDate = learnerPermitExpiryDate;
      if (learnerPermitPhoto !== undefined) updates.learnerPermitPhoto = learnerPermitPhoto;
      if (driverLicenseNumber !== undefined) updates.driverLicenseNumber = driverLicenseNumber;
      if (licenseExpiryDate !== undefined) updates.licenseExpiryDate = licenseExpiryDate;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No updates provided" });
      }

      await storage.updateStudent(student.id, updates);

      const updatedStudent = await storage.getStudent(student.id);
      if (!updatedStudent) {
        return res.status(404).json({ message: "Student not found" });
      }

      res.json({
        success: true,
        message: "Permit information updated",
        permit: {
          learnerPermitNumber: updatedStudent.learnerPermitNumber || '',
          learnerPermitValidDate: updatedStudent.learnerPermitValidDate || '',
          learnerPermitExpiryDate: updatedStudent.learnerPermitExpiryDate || '',
          learnerPermitPhoto: updatedStudent.learnerPermitPhoto || null,
          driverLicenseNumber: updatedStudent.driverLicenseNumber || '',
          licenseExpiryDate: updatedStudent.licenseExpiryDate || '',
        },
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating permit info:", error);
      res.status(500).json({ message: "Failed to update permit information" });
    }
  });

  // Student Documents Routes
  app.get("/api/student/documents", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const documents = await storage.getStudentDocuments(student.id);
      res.json(documents);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post("/api/student/documents", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const { documentType, documentName, documentData, mimeType, fileSize } = req.body;

      if (!documentType || !documentName || !documentData) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Create record first to get the document ID for S3 key generation
      const newDocument = await storage.createStudentDocument({
        studentId: student.id,
        documentType,
        documentName,
        documentData: "__pending__",
        mimeType: mimeType || 'application/pdf',
        fileSize: fileSize || 0,
        uploadDate: new Date().toISOString().split('T')[0],
        verificationStatus: 'pending',
      });

      // Upload to S3 if configured
      const storedData = await storeDocument(documentData, student.id, newDocument.id, documentName, mimeType || "application/octet-stream");
      await storage.updateStudentDocument(newDocument.id, { documentData: storedData });
      newDocument.documentData = storedData;

      res.json({
        success: true,
        message: "Document uploaded successfully",
        document: newDocument,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  // Student file download endpoint (for their own documents)
  app.get("/api/student/documents/:id/file", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const id = parseInt(req.params.id);
      const [doc] = await db.select().from(studentDocuments).where(eq(studentDocuments.id, id)).limit(1);
      if (!doc || doc.studentId !== student.id) return res.status(404).json({ message: "Document not found" });

      if (isS3Key(doc.documentData)) {
        const { buffer, contentType } = await downloadFromS3(doc.documentData!);
        res.set("Content-Type", contentType);
        res.set("Content-Disposition", `inline; filename="${doc.documentName}"`);
        return res.send(buffer);
      }
      if (doc.documentData?.startsWith("data:")) {
        const [header, base64] = doc.documentData.split(",");
        const mimeType = header.match(/data:([^;]+)/)?.[1] || "application/octet-stream";
        res.set("Content-Type", mimeType);
        res.set("Content-Disposition", `inline; filename="${doc.documentName}"`);
        return res.send(Buffer.from(base64, "base64"));
      }
      res.status(404).json({ message: "No file data available" });
    } catch (error) {
      captureRequestError(error);
      console.error("Error downloading document:", error);
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  app.delete("/api/student/documents/:id", isStudentAuthenticated, async (req: any, res) => {
    try {
      const student = req.student;
      const documentId = parseInt(req.params.id);

      // Verify document belongs to student
      const documents = await storage.getStudentDocuments(student.id);
      const document = documents.find(d => d.id === documentId);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      if (document.documentData && isS3Key(document.documentData)) {
        await deleteFromS3(document.documentData);
      }

      await storage.deleteStudentDocument(documentId);

      res.json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error deleting document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // Student Dashboard Routes
  app.get(
    "/api/student/dashboard",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;

        // Get student's enrolled classes
        const enrollments = await storage.getClassEnrollmentsByStudent(
          student.id,
        );
        const classIds = enrollments.map((e) => e.classId);
        const allClasses = await storage.getClasses();
        const studentClasses = allClasses.filter((c) =>
          classIds.includes(c.id),
        );

        // Get upcoming classes (school-timezone aware)
        const upcomingClasses = studentClasses
          .filter((c) => !hasClassStarted(c) && c.status === "scheduled")
          .slice(0, 5);

        // Get student's evaluations
        const evaluations = await storage.getEvaluationsByStudent(student.id);

        const completedDashboard = mergeScooterTransferCredits(
          buildCompletedClasses(studentClasses.map((classItem) => {
            const enrollment = enrollments.find((item) => item.classId === classItem.id);
            return {
              attendanceStatus: enrollment?.attendanceStatus ?? null,
              classType: classItem.classType,
              classNumber: classItem.classNumber,
              date: classItem.date,
              duration: classItem.duration,
              maxStudents: classItem.maxStudents,
              courseType: classItem.courseType,
            };
          })),
          student,
        );
        const completedTheoryClasses = completedDashboard.filter((item) => item.classType === "theory").length;
        const completedInCarSessions = completedDashboard.filter((item) => item.classType === "driving").length;
        
        const totalHoursCompleted =
          student.totalHoursCompleted || completedInCarSessions * 1; // Estimate 1 hour per session
        const classesAttended = enrollments.filter(
          (e) => e.attendanceStatus === "attended",
        ).length;

        // Calculate phase progress
        const phaseProgress = calculatePhaseProgress(student, completedTheoryClasses, completedInCarSessions, enrollments);

        res.json({
          student,
          stats: {
            progress: student.progress || 0,
            phase: student.phase || "Phase 1",
            completedTheoryClasses,
            completedInCarSessions,
            totalHoursCompleted,
            classesAttended,
            upcomingClasses: upcomingClasses.length,
          },
          phaseProgress,
          upcomingClasses,
          recentEvaluations: evaluations.slice(0, 3),
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching student dashboard:", error);
        res.status(500).json({ message: "Failed to fetch dashboard data" });
      }
    },
  );

  // Student Phase Progress endpoint
  app.get(
    "/api/student/phase-progress",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const enrollments = await storage.getClassEnrollmentsByStudent(student.id);
        
        // Get actual class data to determine theory vs in-car sessions
        const classIds = enrollments.map((e) => e.classId);
        const allClasses = await storage.getClasses();
        const studentClasses = allClasses.filter((c) => classIds.includes(c.id));
        
        // Calculate completed counts based on class type and attendance
        // Classified via classType (fallback to classNumber heuristic when missing)
        // Only count classes where the STUDENT actually attended (not just class marked complete)
        const completedForProgress = mergeScooterTransferCredits(
          buildCompletedClasses(studentClasses.map((classItem) => {
            const enrollment = enrollments.find((item) => item.classId === classItem.id);
            return {
              attendanceStatus: enrollment?.attendanceStatus ?? null,
              classType: classItem.classType,
              classNumber: classItem.classNumber,
              date: classItem.date,
              duration: classItem.duration,
              maxStudents: classItem.maxStudents,
              courseType: classItem.courseType,
            };
          })),
          student,
        );
        const completedTheoryClasses = completedForProgress.filter((item) => item.classType === "theory").length;
        const completedInCarSessions = completedForProgress.filter((item) => item.classType === "driving").length;
        
        const phaseProgress = calculatePhaseProgress(student, completedTheoryClasses, completedInCarSessions, enrollments);
        res.json(phaseProgress);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching phase progress:", error);
        res.status(500).json({ message: "Failed to fetch phase progress" });
      }
    },
  );

  app.get(
    "/api/student/classes",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;

        // Get student's enrolled classes
        const enrollments = await storage.getClassEnrollmentsByStudent(
          student.id,
        );
        const classIds = enrollments.map((e) => e.classId);
        const allClasses = await storage.getClasses();
        const studentClasses = allClasses.filter((c) =>
          classIds.includes(c.id),
        );

        // Filter out past classes - only show upcoming classes.
        // Class date/time are school-local wall-clock strings and MUST be
        // interpreted in SCHOOL_TIMEZONE (the server runs in UTC): parsing
        // them as server-local made classes vanish from the student's
        // calendar hours before they actually started.
        const now = new Date();
        const upcomingClasses = studentClasses.filter((c) => {
          const start = getClassStartTime(c);
          // Keep classes with unparseable schedules visible rather than
          // silently hiding a booked class.
          if (!start) return true;
          return start >= now;
        });

        // Get all instructors to populate instructor names
        const allInstructors = await storage.getInstructors();

        // Combine class data with enrollment data
        const classesWithDetails = upcomingClasses.map((classItem) => {
          const enrollment = enrollments.find(
            (e) => e.classId === classItem.id,
          );
          const instructor = allInstructors.find(
            (i) => i.id === classItem.instructorId,
          );

          return {
            ...classItem,
            enrollmentId: enrollment?.id,
            attendanceStatus: enrollment?.attendanceStatus,
            testScore: enrollment?.testScore,
            paymentStatus: enrollment?.paymentStatus,
            paidAmount: enrollment?.paidAmount,
            instructorName: instructor
              ? `${instructor.firstName} ${instructor.lastName}`
              : "TBD",
          };
        });

        res.json(classesWithDetails);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching student classes:", error);
        res.status(500).json({ message: "Failed to fetch classes" });
      }
    },
  );

  // Get available classes for booking (filtered by student's current phase)
  app.get(
    "/api/student/classes/available",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const { instructorId, startDate, endDate } = req.query;

        // Students only ever see classes for their own course type — the
        // client cannot widen this via query params.
        const filters: any = {
          courseType: (student.courseType || 'auto').toLowerCase(),
        };
        if (instructorId) filters.instructorId = parseInt(instructorId);
        if (startDate) filters.startDate = startDate;
        if (endDate) filters.endDate = endDate;

        // Build completed class list for the phase-based filter
        const enrollments = await storage.getClassEnrollmentsByStudent(student.id);
        const allClasses = await storage.getClasses();

        const enrollmentDetailsAvail = enrollments
          .filter(e => !e.cancelledAt)
          .map(e => {
            const cls = allClasses.find(c => c.id === e.classId);
            return {
              attendanceStatus: e.attendanceStatus,
              classType: cls?.classType ?? null,
              classNumber: cls?.classNumber ?? null,
              date: cls?.date ?? null,
              duration: cls?.duration ?? null,
              maxStudents: cls?.maxStudents ?? null,
              courseType: cls?.courseType ?? null,
              classStatus: cls?.status ?? null,
            };
          });

        const completedClassesAvail = mergeScooterTransferCredits(
          buildCompletedClasses(enrollmentDetailsAvail),
          student,
        );
        const studentCourseTypeAvail = (student.courseType || 'auto').toLowerCase();

        // Upcoming (held) bookings for the strict-progression layer.
        const upcomingBookingsAvail = computeUpcomingBookings(enrollments, allClasses);

        // Count for legacy phase display info
        const completedTheoryClasses = completedClassesAvail.filter(c => c.classType === 'theory').length;
        const completedInCarSessions = completedClassesAvail.filter(c => c.classType === 'driving').length;

        // Build a map of date → number of booked classes for the daily 2-class
        // limit. Only classes that are still scheduled count — enrollments in
        // cancelled classes must not consume a daily slot.
        const sameDayCountMapAvail: Record<string, number> = {};
        const sameDayMinutesMapAvail: Record<string, number> = {};
        const sameDayDrivingMapAvail: Record<string, boolean> = {};
        for (const detail of enrollmentDetailsAvail) {
          if (detail.date && detail.classStatus === 'scheduled') {
            sameDayCountMapAvail[detail.date] = (sameDayCountMapAvail[detail.date] ?? 0) + 1;
            sameDayMinutesMapAvail[detail.date] = (sameDayMinutesMapAvail[detail.date] ?? 0)
              + (detail.duration ?? (detail.classType === 'theory' ? 120 : 60));
            if (detail.classType === 'driving') sameDayDrivingMapAvail[detail.date] = true;
          }
        }

        const availableClasses = await storage.getAvailableClasses(
          student.id,
          filters,
        );

        // Daily limit: an active max_bookings_per_day policy overrides the
        // built-in default of MAX_CLASSES_PER_DAY. Policies may be scoped by
        // course/class type, so resolve the limit per class below.
        const allPoliciesAvail = (await storage.getBookingPolicies()).filter(p => p.isActive);

        // Annotate every class with booking eligibility — show all classes but mark
        // blocked ones so the UI can grey them out with an explanation.
        const today = new Date().toISOString().slice(0, 10);
        // Existing bookings snapshot for the weekly/notice/pending policy
        // checks — same shape/counting rules as the booking route.
        const wnpExistingAvail = enrollments
          .filter(e => !e.cancelledAt)
          .map(e => {
            const cls = allClasses.find(c => c.id === e.classId);
            return {
              date: cls?.date ?? null,
              classStatus: cls?.status ?? null,
              attendanceStatus: e.attendanceStatus ?? null,
            };
          });
        const filteredClasses = availableClasses
          .filter((classItem: any) => classItem.classType && classItem.classNumber)
          .map((classItem: any) => {
            const classDate = classItem.date || today;
            // Past time slots are never bookable — check school-local start time.
            if (hasClassStarted({ date: classDate, time: classItem.time || "00:00" })) {
              return {
                ...classItem,
                bookingAllowed: false,
                blockingReason: "This class has already started and can no longer be booked.",
                blockingRule: "class_already_started",
              };
            }
            const target = {
              classType: classItem.classType as "theory" | "driving",
              classNumber: classItem.classNumber,
              date: classDate,
              duration: classItem.duration ?? undefined,
              maxStudents: classItem.maxStudents ?? undefined,
              sameDayAlreadyBookedCount: sameDayCountMapAvail[classDate] ?? 0,
              sameDayAlreadyBookedMinutes: sameDayMinutesMapAvail[classDate] ?? 0,
              sameDayAlreadyBookedHasDriving: sameDayDrivingMapAvail[classDate] ?? false,
              maxClassesPerDay: effectiveDailyLimit(allPoliciesAvail, {
                courseType: classItem.courseType ?? undefined,
                classType: classItem.classType ?? undefined,
              }),
              saaq6rKnowledgePassed: !!student.saaqKnowledgeTestDate,
              phase1TimingAdvanceDays: student.phase1TimingAdvanceDays ?? 0,
              phase2TimingAdvanceDays: student.phase2TimingAdvanceDays ?? 0,
              phase3TimingAdvanceDays: student.phase3TimingAdvanceDays ?? 0,
              phase4TimingAdvanceDays: student.phase4TimingAdvanceDays ?? 0,
              upcomingBookings: upcomingBookingsAvail,
            };
            const validation = validateClassBooking(target, completedClassesAvail, studentCourseTypeAvail);
            if (!validation.allowed) {
              return {
                ...classItem,
                bookingAllowed: false,
                blockingReason: validation.reason,
                blockingRule: validation.blockingRule,
              };
            }
            // Weekly/notice/pending policies — same scoping as the booking
            // route (policy applies when its course/class type is unset or
            // matches the class).
            const scopedPoliciesAvail = allPoliciesAvail.filter(p =>
              (!p.courseType || p.courseType === classItem.courseType) &&
              (!p.classType || p.classType === classItem.classType)
            );
            const wnpViolation = checkWeeklyNoticePendingPolicies(
              scopedPoliciesAvail,
              { date: classItem.date, time: classItem.time },
              wnpExistingAvail,
            );
            return {
              ...classItem,
              bookingAllowed: !wnpViolation,
              blockingReason: wnpViolation ? wnpViolation.message : undefined,
              blockingRule: wnpViolation ? wnpViolation.policyType : undefined,
            };
          });

        // Phase info for UI display
        const phaseProgress = calculatePhaseProgress(student, completedTheoryClasses, completedInCarSessions, enrollments);
        const currentPhase = phaseProgress.currentPhase;
        const phases = COURSE_PHASES[studentCourseTypeAvail] || COURSE_PHASES.auto;
        const theoryPhase = phases[0];
        const requiredTheoryForDriving = theoryPhase.requiredTheoryClasses;
        const hasCompletedTheoryRequirements = completedTheoryClasses >= requiredTheoryForDriving;

        // ── Task 272: In-Car 12/13 combined-session handling ────────────────
        // Direct In-Car #13 is never bookable on its own — it is awarded as
        // part of the combined 12/13 session. Drop it from the listing. The
        // canonical #12 slot IS bookable (booking it enters the pairing flow),
        // so annotate it as a paired lesson.
        const finalClasses = filteredClasses
          .filter((c: any) => !(c.classType === 'driving' && c.classNumber === 13))
          .map((c: any) => {
            if (
              isCombined1213Class({
                classType: c.classType,
                classNumber: c.classNumber,
                duration: c.duration,
                maxStudents: c.maxStudents,
                courseType: c.courseType,
              })
            ) {
              return {
                ...c,
                classNumber: 12,
                duration: 120,
                pairedLesson: true,
                pairedLabel: 'In-Car 12/13',
              };
            }
            return c;
          });

        res.json({
          classes: finalClasses,
          // date → number of classes already booked that day (scheduled only,
          // cancelled classes never consume a daily slot). Same counting rule
          // as the server-side 2-classes-per-day booking limit.
          dailyBookings: sameDayCountMapAvail,
          phaseInfo: {
            currentPhase: currentPhase.name,
            phaseOrder: currentPhase.order,
            allowedClassTypes: hasCompletedTheoryRequirements ? ['theory', 'driving'] : ['theory'],
            completedTheory: completedTheoryClasses,
            completedDriving: completedInCarSessions,
            theoryRequired: requiredTheoryForDriving,
            drivingRequired: currentPhase.requiredInCarSessions,
            theoryComplete: hasCompletedTheoryRequirements,
          }
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching available classes:", error);
        res.status(500).json({ message: "Failed to fetch available classes" });
      }
    },
  );

  // Get available extra lessons (ad-hoc lessons that require payment)
  app.get(
    "/api/student/extra-lessons",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const { courseType, classType } = req.query;
        
        // Get all extra lessons
        const allClasses = await storage.getClasses();
        const now = new Date();
        
        // Filter to only extra lessons that are:
        // - Marked as isExtra = true
        // - In the future
        // - Not cancelled
        // - Match the student's course type (if specified)
        // - Have available spots
        let extraLessons = allClasses.filter((c: any) => {
          if (!c.isExtra) return false;
          if (c.status === 'cancelled') return false;
          
          // Exclude extras with malformed schedules from the bookable list.
          const classStart = getClassStartTime(c);
          if (!classStart || classStart <= now) return false;
          
          if (courseType && c.courseType !== courseType) return false;
          
          return true;
        });

        // Get enrollment counts for each class
        const allEnrollments = await storage.getClassEnrollments();
        const enrollmentCounts = new Map<number, number>();
        allEnrollments.forEach((e: any) => {
          if (!e.cancelledAt) {
            enrollmentCounts.set(e.classId, (enrollmentCounts.get(e.classId) || 0) + 1);
          }
        });

        // Filter to classes with available spots and add enrichment
        const instructors = await storage.getInstructors();
        const instructorMap = new Map(instructors.map((i: any) => [i.id, i]));
        
        // Get student's existing enrollments to check if already booked
        const studentEnrollments = await storage.getClassEnrollmentsByStudent(student.id);
        const studentEnrolledClassIds = new Set(
          studentEnrollments
            .filter((e: any) => !e.cancelledAt)
            .map((e: any) => e.classId)
        );

        const enrichedLessons = extraLessons
          .filter((c: any) => {
            const enrolled = enrollmentCounts.get(c.id) || 0;
            return enrolled < (c.maxStudents || 1);
          })
          .map((c: any) => {
            const instructor = c.instructorId ? instructorMap.get(c.instructorId) : null;
            const enrolled = enrollmentCounts.get(c.id) || 0;
            const isTheory = isTheoryClass(c.classType, c.classNumber);
            
            return {
              ...c,
              instructorName: instructor ? `${instructor.firstName} ${instructor.lastName}` : 'TBD',
              spotsAvailable: (c.maxStudents || 1) - enrolled,
              classType: isTheory ? 'theory' : 'driving',
              alreadyBooked: studentEnrolledClassIds.has(c.id),
              priceDisplay: c.price ? `$${(c.price / 100).toFixed(2)}` : 'Free'
            };
          })
          .sort((a: any, b: any) => {
            const dateA = getClassStartTime(a);
            const dateB = getClassStartTime(b);
            return (dateA?.getTime() ?? 0) - (dateB?.getTime() ?? 0);
          });

        res.json(enrichedLessons);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching extra lessons:", error);
        res.status(500).json({ message: "Failed to fetch extra lessons" });
      }
    }
  );

  // Book and pay for an extra lesson
  app.post(
    "/api/student/extra-lessons/:classId/book",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const classId = parseInt(req.params.classId);
        
        // Get the extra lesson
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Lesson not found" });
        }
        
        if (!classData.isExtra) {
          return res.status(400).json({ message: "This is not an extra lesson. Use the regular booking flow." });
        }

        // Extra lessons are excluded from numbered progression (authoritative
        // predicate: isExtra), but duplicate/capacity checks and enrollment
        // creation still run under the per-student lock so concurrent
        // requests cannot double-book or oversubscribe the lesson.
        return await withStudentBookingLock(student.id, async (bookingTx) => {

        // Check if already booked
        const existingEnrollments = await storage.getClassEnrollmentsByStudent(student.id);
        const alreadyBooked = existingEnrollments.some(
          (e: any) => e.classId === classId && !e.cancelledAt
        );
        
        if (alreadyBooked) {
          return res.status(400).json({ message: "You have already booked this lesson" });
        }
        
        // Check availability
        const classEnrollments = await storage.getClassEnrollmentsByClass(classId);
        const activeEnrollments = classEnrollments.filter((e: any) => !e.cancelledAt);
        if (activeEnrollments.length >= (classData.maxStudents || 1)) {
          return res.status(400).json({ message: "This lesson is fully booked" });
        }
        
        // Check if class is in the future
        const classDateTime = getClassStartTime(classData);
        if (!classDateTime) {
          // Malformed schedule data must fail closed for actions/policy —
          // never fall back to a server-local or Invalid Date comparison.
          console.error(`[CLASS-TIME] Invalid schedule on class #${classData.id}: date="${classData.date}" time="${classData.time}"`);
          return res.status(400).json({ message: "This class has an invalid schedule. Please contact the office." });
        }
        if (classDateTime <= new Date()) {
          return res.status(400).json({ message: "This lesson has already started or passed" });
        }
        
        const price = classData.price || 0;
        
        if (price > 0) {
          // Create a payment intent for the extra lesson
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-10-29.clover' });
          
          const paymentIntent = await stripe.paymentIntents.create({
            amount: price,
            currency: 'cad',
            metadata: {
              type: 'extra_lesson',
              classId: classId.toString(),
              studentId: student.id.toString(),
              studentName: `${student.firstName} ${student.lastName}`,
              lessonTopic: classData.topic || 'Extra Lesson',
              lessonDate: classData.date,
            }
          }, { idempotencyKey: `extra-lesson-${student.id}-${classId}-${Date.now()}` });
          
          // Create enrollment with pending payment status
          const enrollment = await storage.createClassEnrollment({
            classId: classId,
            studentId: student.id,
            attendanceStatus: 'registered',
            paymentStatus: 'pending',
            lastPaymentIntentId: paymentIntent.id
          }, bookingTx);
          
          res.json({
            enrollmentId: enrollment.id,
            paymentRequired: true,
            clientSecret: paymentIntent.client_secret,
            amount: price,
            amountDisplay: `$${(price / 100).toFixed(2)}`
          });
        } else {
          // Free extra lesson - just create the enrollment
          const enrollment = await storage.createClassEnrollment({
            classId: classId,
            studentId: student.id,
            attendanceStatus: 'registered',
            paymentStatus: 'not_required'
          }, bookingTx);
          
          res.json({
            enrollmentId: enrollment.id,
            paymentRequired: false,
            message: 'Successfully booked the free extra lesson'
          });
        }
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error booking extra lesson:", error);
        res.status(500).json({ message: "Failed to book extra lesson" });
      }
    }
  );

  // Confirm payment for extra lesson
  app.post(
    "/api/student/extra-lessons/:enrollmentId/confirm-payment",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const enrollmentId = parseInt(req.params.enrollmentId);
        const { paymentIntentId } = req.body;
        
        // Get the enrollment
        const enrollment = await storage.getClassEnrollment(enrollmentId);
        if (!enrollment || enrollment.studentId !== student.id) {
          return res.status(404).json({ message: "Enrollment not found" });
        }
        
        if (enrollment.paymentStatus === 'paid') {
          // Already confirmed (webhook may have beaten us) — return success idempotently
          const classData = await storage.getClass(enrollment.classId!);
          return res.json({
            success: true,
            message: 'Payment confirmed! Your extra lesson is now booked.',
            lessonDetails: {
              date: classData?.date,
              time: classData?.time,
              topic: classData?.topic
            }
          });
        }
        
        // Verify payment with Stripe
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-10-29.clover' });
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status !== 'succeeded') {
          return res.status(400).json({ message: "Payment not yet successful" });
        }

        // Verify this payment belongs to the requesting student
        if (paymentIntent.metadata.studentId !== String(student.id)) {
          return res.status(403).json({ message: "Payment does not belong to this student" });
        }
        
        // Update enrollment with paid status
        await storage.updateClassEnrollment(enrollmentId, {
          paymentStatus: 'paid',
          paidAmount: paymentIntent.amount,
          lastPaymentIntentId: paymentIntentId
        });
        
        // Get class details for response
        const classData = await storage.getClass(enrollment.classId!);
        
        res.json({
          success: true,
          message: 'Payment confirmed! Your extra lesson is now booked.',
          lessonDetails: {
            date: classData?.date,
            time: classData?.time,
            topic: classData?.topic
          }
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error confirming extra lesson payment:", error);
        res.status(500).json({ message: "Failed to confirm payment" });
      }
    }
  );

  // Book a class
  app.post(
    "/api/student/classes/:classId/book",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        // All validation + booking runs under a per-student lock so parallel
        // requests can't both pass the progression/concurrency checks.
        return await withStudentBookingLock(req.student.id, async (bookingTx) => {
        const student = req.student;
        const classId = parseInt(req.params.classId);

        // Get the class to check details
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Extra lessons have their own booking (and payment) flow — they are
        // excluded from numbered progression and must not enter it here.
        if (classData.isExtra) {
          return res.status(400).json({ message: "Extra lessons must be booked through the extra-lessons flow." });
        }

        // Students may only book classes for their own course type — mirrors
        // the server-side filter on the available-classes listing.
        const studentCourseTypeCheck = (student.courseType || 'auto').toLowerCase();
        if ((classData.courseType || '').toLowerCase() !== studentCourseTypeCheck) {
          return res.status(403).json({
            message: "This class is for a different course type than yours.",
            policyViolation: "course_type_mismatch",
          });
        }

        // Reject bookings for classes whose scheduled start time has already
        // passed (school-local time, not server time).
        if (classData.date && hasClassStarted({ date: classData.date, time: classData.time || "00:00" })) {
          return res.status(400).json({
            message: "This class has already started and can no longer be booked. Please choose an upcoming time slot.",
            policyViolation: "class_already_started",
          });
        }

        // ── Phase ordering & prerequisite validation ──────────────────────────
        // Fetch all attended classes for this student and run the full rules engine
        const studentEnrollmentsForRules = await storage.getClassEnrollmentsByStudent(student.id);
        const allClassesForRules = await storage.getClasses();

        const enrollmentDetails = studentEnrollmentsForRules
          .filter(e => !e.cancelledAt)
          .map(e => {
            const cls = allClassesForRules.find(c => c.id === e.classId);
            return {
              attendanceStatus: e.attendanceStatus,
              classType: cls?.classType ?? null,
              classNumber: cls?.classNumber ?? null,
              date: cls?.date ?? null,
              duration: cls?.duration ?? null,
              maxStudents: cls?.maxStudents ?? null,
              courseType: cls?.courseType ?? null,
              classStatus: cls?.status ?? null,
            };
          });

        const completedClassesForRules = mergeScooterTransferCredits(
          buildCompletedClasses(enrollmentDetails),
          student,
        );
        const studentCourseType = (student.courseType || 'auto').toLowerCase();

        // Count same-day booked classes for the daily 2-class limit. Only
        // classes that are still scheduled count — enrollments in cancelled
        // classes must not consume a daily slot.
        const classDateForBook = classData.date ?? new Date().toISOString().slice(0, 10);
        const sameDayDetailsBook = enrollmentDetails.filter(
          d => d.date === classDateForBook && d.classStatus === 'scheduled'
        );
        const sameDayAlreadyBookedBook = sameDayDetailsBook.length;
        const sameDayMinutesBook = sameDayDetailsBook.reduce(
          (sum: number, d: any) => sum + (d.duration ?? (d.classType === 'theory' ? 120 : 60)), 0);
        const sameDayHasDrivingBook = sameDayDetailsBook.some((d: any) => d.classType === 'driving');

        // Get active booking policies for this class type. Daily limit
        // precedence rule: an active max_bookings_per_day policy OVERRIDES
        // the built-in default of MAX_CLASSES_PER_DAY (2); the rules engine
        // below is the single enforcement point.
        const policies = await storage.getActiveBookingPolicies(classData.courseType || undefined, classData.classType || undefined);
        const dailyLimit = resolveDailyLimit(policies);

        // Booking decision log context — enough to explain, after the fact,
        // why any booking attempt was allowed or denied.
        const bookingLogCtx =
          `[booking] student=${student.id} class=${classId} ` +
          `classType=${classData.classType}#${classData.classNumber ?? '?'} date=${classDateForBook} ` +
          `sameDayBooked=${sameDayAlreadyBookedBook} dailyLimit=${dailyLimit.limit} ` +
          `limitSource=${dailyLimit.policy ? `policy#${dailyLimit.policy.id}(${dailyLimit.policy.name ?? 'unnamed'})` : `default(${MAX_CLASSES_PER_DAY})`}`;
        const logBookingDecision = (outcome: string, reason?: string) => {
          console.log(`${bookingLogCtx} outcome=${outcome}${reason ? ` reason="${reason}"` : ''}`);
        };

        const bookingTarget = {
          classType: classData.classType as "theory" | "driving",
          classNumber: classData.classNumber ?? 0,
          date: classDateForBook,
          duration: classData.duration ?? undefined,
          currentEnrollmentCount: undefined as number | undefined,
          maxStudents: classData.maxStudents ?? undefined,
          sameDayAlreadyBookedCount: sameDayAlreadyBookedBook,
          sameDayAlreadyBookedMinutes: sameDayMinutesBook,
          sameDayAlreadyBookedHasDriving: sameDayHasDrivingBook,
          maxClassesPerDay: dailyLimit.limit,
          saaq6rKnowledgePassed: !!student.saaqKnowledgeTestDate,
          phase1TimingAdvanceDays: student.phase1TimingAdvanceDays ?? 0,
          phase2TimingAdvanceDays: student.phase2TimingAdvanceDays ?? 0,
          phase3TimingAdvanceDays: student.phase3TimingAdvanceDays ?? 0,
          phase4TimingAdvanceDays: student.phase4TimingAdvanceDays ?? 0,
          upcomingBookings: computeUpcomingBookings(studentEnrollmentsForRules, allClassesForRules),
        };

        // For shared session check on In-Car 12/13, count current non-cancelled enrollments
        if (classData.classType === 'driving' && (classData.classNumber === 12 || classData.classNumber === 13)) {
          const existingEnrollments = await storage.getClassEnrollmentsByClass(classData.id);
          bookingTarget.currentEnrollmentCount = existingEnrollments.filter(e => !e.cancelledAt).length;
        }

        const phaseValidation = validateClassBooking(bookingTarget, completedClassesForRules, studentCourseType);
        if (!phaseValidation.allowed) {
          logBookingDecision(
            `deny rule=${phaseValidation.blockingRule ?? 'phase_ordering'}`,
            phaseValidation.reason ?? undefined,
          );
          return res.status(400).json({
            message: phaseValidation.reason ?? "Booking not allowed at this stage of your training.",
            policyViolation: phaseValidation.blockingRule ?? 'phase_ordering',
            detail: phaseValidation.detail,
          });
        }

        const isDrivingClass = classData.classType === 'driving';

        // Validate learner's permit for driving (in-car) classes
        if (isDrivingClass) {
          if (!student.learnerPermitNumber) {
            logBookingDecision('deny rule=permit_required', "No learner's permit on file");
            return res.status(400).json({
              message: "You need a valid learner's permit on file to book driving classes. Please update your permit information in your profile.",
              policyViolation: 'permit_required'
            });
          }
          
          if (!student.learnerPermitExpiryDate) {
            logBookingDecision('deny rule=permit_expiry_missing', "Permit expiry date not on file");
            return res.status(400).json({
              message: "Your learner's permit expiration date is not on file. Please update your permit information in your profile.",
              policyViolation: 'permit_expiry_missing'
            });
          }
          
          const permitExpiry = new Date(student.learnerPermitExpiryDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          if (permitExpiry < today) {
            logBookingDecision('deny rule=permit_expired', "Learner's permit has expired");
            return res.status(400).json({
              message: "Your learner's permit has expired. Please renew your permit and update your profile before booking driving classes.",
              policyViolation: 'permit_expired'
            });
          }
          
          if (classData.date) {
            const classDate = new Date(classData.date);
            if (classDate > permitExpiry) {
              logBookingDecision('deny rule=permit_expires_before_class', "Permit expires before class date");
              return res.status(400).json({
                message: `Your learner's permit expires on ${permitExpiry.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. You cannot book a driving class after that date.`,
                policyViolation: 'permit_expires_before_class'
              });
            }
          }
        }

        // Check max_duration policy
        const maxDurationPolicy = policies.find(p => p.policyType === 'max_duration');
        if (maxDurationPolicy && classData.duration) {
          if (classData.duration > maxDurationPolicy.value) {
            logBookingDecision(
              `deny rule=max_duration policy#${maxDurationPolicy.id}`,
              `Duration ${classData.duration}min exceeds max ${maxDurationPolicy.value}min`,
            );
            return res.status(400).json({ 
              message: `Class duration (${classData.duration} minutes) exceeds the maximum allowed (${maxDurationPolicy.value} minutes)`,
              policyViolation: 'max_duration'
            });
          }
        }

        // NOTE: the max_bookings_per_day limit is enforced by the rules
        // engine above (validateClassBooking) using the effective daily
        // limit, so it is not re-checked here.

        // Check advance_booking_days policy
        const advanceBookingPolicy = policies.find(p => p.policyType === 'advance_booking_days');
        if (advanceBookingPolicy && classData.date) {
          const classDate = new Date(classData.date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const diffTime = classDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          if (diffDays > advanceBookingPolicy.value) {
            logBookingDecision(
              `deny rule=advance_booking_days policy#${advanceBookingPolicy.id}`,
              `Class is ${diffDays} days out, max ${advanceBookingPolicy.value}`,
            );
            return res.status(400).json({ 
              message: `Cannot book classes more than ${advanceBookingPolicy.value} days in advance`,
              policyViolation: 'advance_booking_days'
            });
          }
        }

        // Check max_bookings_per_week / min_booking_notice /
        // max_pending_bookings policies
        const wnpViolation = checkWeeklyNoticePendingPolicies(
          policies,
          { date: classData.date, time: classData.time },
          enrollmentDetails.map(d => ({
            date: d.date,
            classStatus: d.classStatus,
            attendanceStatus: d.attendanceStatus ?? null,
          })),
        );
        if (wnpViolation) {
          logBookingDecision(`deny rule=${wnpViolation.policyType}`, wnpViolation.message);
          return res.status(400).json({
            message: wnpViolation.message,
            policyViolation: wnpViolation.policyType,
          });
        }

        // Card-on-file requirement: any class past #1 needs a saved payment
        // method. Class #1 stays bookable without a card. Server-side so the
        // client cannot bypass; the UI maps `card_required` to the card drawer.
        if ((classData.classNumber ?? 0) > 1) {
          const savedCards = await storage.getStudentPaymentMethods(student.id);
          if (savedCards.length === 0) {
            logBookingDecision('deny rule=card_required', 'no saved payment method');
            return res.status(400).json({
              message: "A payment card on file is required to book classes beyond Class #1. Please add a card to continue.",
              policyViolation: "card_required",
            });
          }
        }

        // ── Task 272: the canonical combined In-Car 12/13 slot (auto driving,
        // classNumber=12, duration=120, maxStudents=2) is booked through the
        // pairing service, not the generic storage.bookClass path. Direct #13
        // is already blocked earlier by the booking-rules engine
        // (phase4_incar13_not_directly_bookable). All existing validation,
        // permit, card, and policy gates above have passed at this point.
        if (
          (classData.courseType || '').toLowerCase() === 'auto' &&
          isCombined1213Class({
            classType: classData.classType,
            classNumber: classData.classNumber,
            duration: classData.duration,
            maxStudents: classData.maxStudents,
            courseType: classData.courseType,
          })
        ) {
          const combinedResult = await bookCombinedSlot({
            studentId: student.id,
            classId,
          });
          if (combinedResult.success) {
            logBookingDecision('allow rule=combined_12_13');
            return res.json({
              message: "You are booked into the In-Car 12/13 shared session. A second student will be matched with you.",
              enrollmentId: combinedResult.enrollmentId,
              queueEntryId: combinedResult.queueEntryId,
              pairedLesson: true,
            });
          }
          logBookingDecision('deny rule=combined_12_13', combinedResult.reason);
          return res.status(400).json({ message: combinedResult.reason ?? "Unable to book combined In-Car 12/13 session." });
        }

        const result = await storage.bookClass(student.id, classId, bookingTx);

        if (result.success) {
          logBookingDecision('allow');
          res.json({
            message: "Class booked successfully",
            enrollment: result.enrollment,
          });
        } else {
          logBookingDecision('deny rule=book_class', result.message);
          res.status(400).json({ message: result.message });
        }
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error booking class:", error);
        res.status(500).json({ message: "Failed to book class" });
      }
    },
  );

  // Check reschedule policy and get available slots
  app.get(
    "/api/student/classes/:enrollmentId/reschedule-check",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const enrollmentId = parseInt(req.params.enrollmentId);

        // Get the enrollment
        const enrollment = await storage.getClassEnrollment(enrollmentId);
        if (!enrollment || enrollment.studentId !== student.id) {
          return res.status(404).json({ message: "Enrollment not found" });
        }

        // Get the class
        const classData = await storage.getClass(enrollment.classId!);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Check if class is in the future
        const classDateTime = getClassStartTime(classData);
        if (!classDateTime) {
          // Malformed schedule data must fail closed for actions/policy —
          // never fall back to a server-local or Invalid Date comparison.
          console.error(`[CLASS-TIME] Invalid schedule on class #${classData.id}: date="${classData.date}" time="${classData.time}"`);
          return res.status(400).json({ message: "This class has an invalid schedule. Please contact the office." });
        }
        const now = new Date();
        if (classDateTime <= now) {
          return res.status(400).json({ message: "Cannot reschedule past classes" });
        }

        const rescheduleWindowHours = parseInt(await storage.getSetting('rescheduleWindowHours') || '24');
        const rescheduleFee = parseFloat(await storage.getSetting('rescheduleFee') || '25.00');

        // Check if within restricted window
        const hoursUntilClass = (classDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const withinRestrictedWindow = hoursUntilClass < rescheduleWindowHours;
        const feeRequired = withinRestrictedWindow;

        // Get available slots, then keep only targets the booking rules
        // would actually accept (strict progression, duplicate numbers,
        // in-car concurrency, daily limit) — so the picker never offers a
        // slot that the reschedule endpoint would reject after payment.
        const allSlots = await storage.getAvailableClasses(student.id, {
          courseType: classData.courseType,
        });
        const rescheduleCtx = await buildRescheduleContext(student.id, enrollmentId);
        const dailyLimitCache = new Map<string, number>();
        const availableClasses = [];
        for (const slot of allSlots) {
          const scopeKey = `${slot.courseType ?? ''}|${slot.classType ?? ''}`;
          let dailyLimit = dailyLimitCache.get(scopeKey);
          if (dailyLimit === undefined) {
            const policies = await storage.getActiveBookingPolicies(slot.courseType || undefined, slot.classType || undefined);
            dailyLimit = resolveDailyLimit(policies).limit;
            dailyLimitCache.set(scopeKey, dailyLimit);
          }
          const slotValidation = validateRescheduleTargetWithContext(rescheduleCtx, student.courseType, slot, dailyLimit);
          if (slotValidation.allowed) availableClasses.push(slot);
        }

        res.json({
          currentClass: classData,
          availableSlots: availableClasses,
          policy: {
            withinRestrictedWindow,
            feeRequired,
            feeAmount: feeRequired ? rescheduleFee : 0,
            restrictedWindowHours: rescheduleWindowHours,
            hoursUntilClass: Math.floor(hoursUntilClass),
          },
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error checking reschedule policy:", error);
        res.status(500).json({ message: "Failed to check reschedule policy" });
      }
    },
  );

  // Create payment intent for reschedule fee
  app.post(
    "/api/student/classes/:enrollmentId/create-reschedule-payment",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        if (!stripe) {
          return res.status(500).json({ message: "Payment system is not configured" });
        }

        const student = req.student;
        const enrollmentId = parseInt(req.params.enrollmentId);
        const { newClassId } = req.body; // Student has already selected the new class

        // Get the enrollment and class
        const enrollment = await storage.getClassEnrollment(enrollmentId);
        if (!enrollment || enrollment.studentId !== student.id) {
          return res.status(404).json({ message: "Enrollment not found" });
        }

        const classData = await storage.getClass(enrollment.classId!);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Check policy
        const classDateTime = getClassStartTime(classData);
        if (!classDateTime) {
          // Malformed schedule data must fail closed for actions/policy —
          // never fall back to a server-local or Invalid Date comparison.
          console.error(`[CLASS-TIME] Invalid schedule on class #${classData.id}: date="${classData.date}" time="${classData.time}"`);
          return res.status(400).json({ message: "This class has an invalid schedule. Please contact the office." });
        }
        const now = new Date();
        const hoursUntilClass = (classDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const rescheduleWindowHours = parseInt(await storage.getSetting('rescheduleWindowHours') || '24');
        const rescheduleFee = parseFloat(await storage.getSetting('rescheduleFee') || '25.00');
        const feeRequired = hoursUntilClass < rescheduleWindowHours;

        if (!feeRequired) {
          return res.status(400).json({ message: "No fee required for this reschedule" });
        }

        // Never charge a fee for a target the booking rules would reject.
        if (newClassId) {
          const targetClass = await storage.getClass(parseInt(newClassId));
          if (!targetClass) {
            return res.status(404).json({ message: "New class not found" });
          }
          const feeValidation = await validateRescheduleTarget(student.id, student.courseType, enrollmentId, targetClass);
          if (!feeValidation.allowed) {
            return res.status(400).json({
              message: feeValidation.reason ?? "This class cannot be selected at this stage of your training.",
              policyViolation: feeValidation.blockingRule ?? 'phase_ordering',
              detail: feeValidation.detail,
            });
          }
        }

        // Create payment intent — include newClassId so the webhook can execute the reschedule
        // autonomously if the browser crashes before calling /reschedule
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(rescheduleFee * 100), // Convert to cents
          currency: "cad",
          metadata: {
            enrollmentId: String(enrollmentId),
            studentId: String(student.id),
            purpose: 'reschedule',
            ...(newClassId ? { newClassId: String(newClassId) } : {}),
          },
        }, { idempotencyKey: `reschedule-fee-${enrollmentId}` });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        captureRequestError(error);
        console.error("Error creating reschedule payment:", error);
        res.status(500).json({ message: "Failed to create payment" });
      }
    },
  );

  // Process reschedule
  app.post(
    "/api/student/classes/:enrollmentId/reschedule",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const enrollmentId = parseInt(req.params.enrollmentId);
        const { newClassId, paymentIntentId } = req.body;

        if (!newClassId) {
          return res.status(400).json({ message: "New class ID is required" });
        }

        // Get the enrollment
        const enrollment = await storage.getClassEnrollment(enrollmentId);
        if (!enrollment || enrollment.studentId !== student.id) {
          return res.status(404).json({ message: "Enrollment not found" });
        }

        // Check if already cancelled
        if (enrollment.cancelledAt) {
          return res.status(400).json({ message: "Cannot reschedule a cancelled class" });
        }

        // Get the old and new classes
        const oldClass = await storage.getClass(enrollment.classId!);
        const newClass = await storage.getClass(newClassId);
        
        if (!oldClass || !newClass) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Check if class has already started or is in the past
        const classDateTime = getClassStartTime(oldClass);
        if (!classDateTime) {
          console.error(`[CLASS-TIME] Invalid schedule on class #${oldClass.id}: date="${oldClass.date}" time="${oldClass.time}"`);
          return res.status(400).json({ message: "This class has an invalid schedule. Please contact the office." });
        }
        const now = new Date();
        if (classDateTime < now) {
          return res.status(400).json({ message: "Cannot reschedule a class that has already started" });
        }

        // The target class must pass the same booking rules as a direct
        // booking (strict progression, duplicate numbers, in-car concurrency,
        // daily limit) — excluding the enrollment being moved. Validate
        // BEFORE any fee is charged. The remainder of the handler runs under
        // the per-student lock so parallel moves can't race the validation.
        return await withStudentBookingLock(student.id, async (bookingTx) => {
        const rescheduleValidation = await validateRescheduleTarget(student.id, student.courseType, enrollmentId, newClass);
        if (!rescheduleValidation.allowed) {
          return res.status(400).json({
            message: rescheduleValidation.reason ?? "This class cannot be selected at this stage of your training.",
            policyViolation: rescheduleValidation.blockingRule ?? 'phase_ordering',
            detail: rescheduleValidation.detail,
          });
        }

        // Enforce policy - check if within restricted window
        const hoursUntilClass = (classDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const rescheduleWindowHours = parseInt(await storage.getSetting('rescheduleWindowHours') || '24');
        const rescheduleFee = parseFloat(await storage.getSetting('rescheduleFee') || '25.00');
        const feeRequired = hoursUntilClass < rescheduleWindowHours;
        
        if (feeRequired && !paymentIntentId) {
          return res.status(400).json({ 
            message: "Payment required for rescheduling within restricted window",
            feeRequired: true,
            fee: rescheduleFee,
          });
        }

        // Verify payment with Stripe if fee was required
        if (feeRequired && paymentIntentId) {
          if (!stripe) {
            return res.status(500).json({ message: "Payment system is not configured" });
          }

          try {
            // Check global payment ledger to prevent cross-enrollment reuse
            const { policyFeePayments } = await import("@shared/schema");
            const existingPayment = await db.select().from(policyFeePayments).where(eq(policyFeePayments.paymentIntentId, paymentIntentId)).limit(1);
            if (existingPayment.length > 0) {
              // Fee was previously recorded. Two sub-cases:
              if (existingPayment[0].enrollmentId !== enrollmentId) {
                // Payment was used for a completely different enrollment — reject.
                return res.status(400).json({ message: "This payment has already been used for a different enrollment" });
              }
              if (enrollment.lastPaymentIntentId === paymentIntentId) {
                // Reschedule already applied (webhook or prior browser call completed it).
                // Return idempotent success — do NOT execute again or allow a new class change.
                return res.json({ success: true, message: "Class rescheduled successfully", newClass });
              }
              // Fee recorded but reschedule not yet applied (webhook recorded fee but
              // class update hasn't gone through yet) — fall through and execute it now.
            } else {
              // Fee not yet recorded — verify with Stripe and record it now
              const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
              
              if (paymentIntent.status !== 'succeeded') {
                return res.status(400).json({ message: "Payment was not successful" });
              }
              
              const expectedCurrency = 'cad';
              if (paymentIntent.currency.toLowerCase() !== expectedCurrency) {
                return res.status(400).json({ message: `Payment must be in ${expectedCurrency.toUpperCase()}` });
              }
              
              const expectedAmount = Math.round(rescheduleFee * 100);
              if (paymentIntent.amount !== expectedAmount) {
                return res.status(400).json({ 
                  message: "Payment amount does not match the required fee",
                  expected: expectedAmount,
                  received: paymentIntent.amount,
                });
              }

              if (paymentIntent.metadata.enrollmentId !== String(enrollmentId)) {
                return res.status(400).json({ message: "Payment does not match this enrollment" });
              }

              await db.insert(policyFeePayments).values({
                paymentIntentId,
                enrollmentId,
                status: 'reschedule',
                amount: expectedAmount,
                currency: expectedCurrency,
              });
            }
          } catch (error) {
            captureRequestError(error);
            console.error("Error verifying payment:", error);
            return res.status(400).json({ message: "Failed to verify payment" });
          }
        }

        // Verify new class is available
        const availableClasses = await storage.getAvailableClasses(student.id, {});
        if (!availableClasses.find(c => c.id === newClassId)) {
          return res.status(400).json({ message: "Selected class is not available" });
        }

        // Update the enrollment to the new class and record payment intent if used
        await storage.updateClassEnrollment(enrollmentId, {
          classId: newClassId,
          ...(paymentIntentId ? { lastPaymentIntentId: paymentIntentId } : {}),
        }, bookingTx);

        res.json({
          success: true,
          message: "Class rescheduled successfully",
          newClass,
        });
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error rescheduling class:", error);
        res.status(error instanceof Error && error.message === "Class is full" ? 409 : 500).json({
          message: error instanceof Error && error.message === "Class is full"
            ? "The selected class is full"
            : "Failed to reschedule class",
        });
      }
    },
  );

  // Policy settings for student-facing copy (cancellation/reschedule windows
  // and fees) — keeps UI text in sync with the enforced values.
  app.get(
    "/api/student/policy-settings",
    isStudentAuthenticated,
    async (_req: any, res) => {
      try {
        const [cancelWindowHours, cancelFee, rescheduleWindowHours, rescheduleFee] = await Promise.all([
          storage.getSetting('cancelWindowHours'),
          storage.getSetting('cancelFee'),
          storage.getSetting('rescheduleWindowHours'),
          storage.getSetting('rescheduleFee'),
        ]);
        res.json({
          cancelWindowHours: parseInt(cancelWindowHours || '24'),
          cancelFee: parseFloat(cancelFee || '25.00'),
          rescheduleWindowHours: parseInt(rescheduleWindowHours || '24'),
          rescheduleFee: parseFloat(rescheduleFee || '25.00'),
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching policy settings:", error);
        res.status(500).json({ message: "Failed to fetch policy settings" });
      }
    },
  );

  // Check cancel policy
  app.get(
    "/api/student/classes/:enrollmentId/cancel-check",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const enrollmentId = parseInt(req.params.enrollmentId);

        // Get the enrollment
        const enrollment = await storage.getClassEnrollment(enrollmentId);
        if (!enrollment || enrollment.studentId !== student.id) {
          return res.status(404).json({ message: "Enrollment not found" });
        }

        // Get the class
        const classData = await storage.getClass(enrollment.classId!);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Check if class is in the future
        const classDateTime = getClassStartTime(classData);
        if (!classDateTime) {
          // Malformed schedule data must fail closed for actions/policy —
          // never fall back to a server-local or Invalid Date comparison.
          console.error(`[CLASS-TIME] Invalid schedule on class #${classData.id}: date="${classData.date}" time="${classData.time}"`);
          return res.status(400).json({ message: "This class has an invalid schedule. Please contact the office." });
        }
        const now = new Date();
        if (classDateTime <= now) {
          return res.status(400).json({ message: "Cannot cancel past classes" });
        }

        const cancelWindowHours = parseInt(await storage.getSetting('cancelWindowHours') || '24');
        const cancelFee = parseFloat(await storage.getSetting('cancelFee') || '25.00');

        // Check if within restricted window
        const hoursUntilClass = (classDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const withinRestrictedWindow = hoursUntilClass < cancelWindowHours;
        const feeRequired = withinRestrictedWindow;

        res.json({
          class: classData,
          policy: {
            withinRestrictedWindow,
            feeRequired,
            feeAmount: feeRequired ? cancelFee : 0,
            restrictedWindowHours: cancelWindowHours,
            hoursUntilClass: Math.floor(hoursUntilClass),
          },
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error checking cancel policy:", error);
        res.status(500).json({ message: "Failed to check cancel policy" });
      }
    },
  );

  // Create payment intent for cancel fee
  app.post(
    "/api/student/classes/:enrollmentId/create-cancel-payment",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        if (!stripe) {
          return res.status(500).json({ message: "Payment system is not configured" });
        }

        const student = req.student;
        const enrollmentId = parseInt(req.params.enrollmentId);

        // Get the enrollment and class
        const enrollment = await storage.getClassEnrollment(enrollmentId);
        if (!enrollment || enrollment.studentId !== student.id) {
          return res.status(404).json({ message: "Enrollment not found" });
        }

        const classData = await storage.getClass(enrollment.classId!);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Check policy
        const classDateTime = getClassStartTime(classData);
        if (!classDateTime) {
          // Malformed schedule data must fail closed for actions/policy —
          // never fall back to a server-local or Invalid Date comparison.
          console.error(`[CLASS-TIME] Invalid schedule on class #${classData.id}: date="${classData.date}" time="${classData.time}"`);
          return res.status(400).json({ message: "This class has an invalid schedule. Please contact the office." });
        }
        const now = new Date();
        const hoursUntilClass = (classDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const cancelWindowHours = parseInt(await storage.getSetting('cancelWindowHours') || '24');
        const cancelFee = parseFloat(await storage.getSetting('cancelFee') || '25.00');
        const feeRequired = hoursUntilClass < cancelWindowHours;

        if (!feeRequired) {
          return res.status(400).json({ message: "No fee required for this cancellation" });
        }

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(cancelFee * 100), // Convert to cents
          currency: "cad",
          metadata: {
            enrollmentId: String(enrollmentId),
            studentId: String(student.id),
            purpose: 'cancel',
          },
        }, { idempotencyKey: `cancel-fee-${enrollmentId}` });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        captureRequestError(error);
        console.error("Error creating cancel payment:", error);
        res.status(500).json({ message: "Failed to create payment" });
      }
    },
  );

  // Process cancellation
  app.post(
    "/api/student/classes/:enrollmentId/cancel",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const enrollmentId = parseInt(req.params.enrollmentId);
        const { paymentIntentId } = req.body; // Present if fee was paid

        // Get the enrollment
        const enrollment = await storage.getClassEnrollment(enrollmentId);
        if (!enrollment || enrollment.studentId !== student.id) {
          return res.status(404).json({ message: "Enrollment not found" });
        }

        // Check if already cancelled — webhook may have beaten browser; return success idempotently
        if (enrollment.cancelledAt) {
          return res.json({ success: true, message: "Class cancelled successfully" });
        }

        // Get the class
        const classData = await storage.getClass(enrollment.classId!);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Check if class has already started or is in the past
        const classDateTime = getClassStartTime(classData);
        if (!classDateTime) {
          // Malformed schedule data must fail closed for actions/policy —
          // never fall back to a server-local or Invalid Date comparison.
          console.error(`[CLASS-TIME] Invalid schedule on class #${classData.id}: date="${classData.date}" time="${classData.time}"`);
          return res.status(400).json({ message: "This class has an invalid schedule. Please contact the office." });
        }
        const now = new Date();
        if (classDateTime < now) {
          return res.status(400).json({ message: "Cannot cancel a class that has already started" });
        }

        // Enforce policy - check if within restricted window
        const hoursUntilClass = (classDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const cancelWindowHours = parseInt(await storage.getSetting('cancelWindowHours') || '24');
        const cancelFee = parseFloat(await storage.getSetting('cancelFee') || '25.00');
        const feeRequired = hoursUntilClass < cancelWindowHours;
        
        if (feeRequired && !paymentIntentId) {
          return res.status(400).json({ 
            message: "Payment required for cancellation within restricted window",
            feeRequired: true,
            fee: cancelFee,
          });
        }

        // Verify payment with Stripe if fee was required
        if (feeRequired && paymentIntentId) {
          if (!stripe) {
            return res.status(500).json({ message: "Payment system is not configured" });
          }

          try {
            // Check global payment ledger to prevent cross-enrollment reuse
            const { policyFeePayments } = await import("@shared/schema");
            const existingPayment = await db.select().from(policyFeePayments).where(eq(policyFeePayments.paymentIntentId, paymentIntentId)).limit(1);
            if (existingPayment.length > 0) {
              // Fee was already recorded (by webhook or prior browser call).
              // Verify it belongs to this enrollment to prevent cross-enrollment reuse.
              if (existingPayment[0].enrollmentId !== enrollmentId) {
                return res.status(400).json({ message: "This payment has already been used for a different enrollment" });
              }
              // Fee confirmed — fall through and execute the cancellation
            } else {
              const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
              
              if (paymentIntent.status !== 'succeeded') {
                return res.status(400).json({ message: "Payment was not successful" });
              }
              
              const expectedCurrency = 'cad';
              if (paymentIntent.currency.toLowerCase() !== expectedCurrency) {
                return res.status(400).json({ message: `Payment must be in ${expectedCurrency.toUpperCase()}` });
              }
              
              const expectedAmount = Math.round(cancelFee * 100);
              if (paymentIntent.amount !== expectedAmount) {
                return res.status(400).json({ 
                  message: "Payment amount does not match the required fee",
                  expected: expectedAmount,
                  received: paymentIntent.amount,
                });
              }

              if (paymentIntent.metadata.enrollmentId !== String(enrollmentId)) {
                return res.status(400).json({ message: "Payment does not match this enrollment" });
              }

              await db.insert(policyFeePayments).values({
                paymentIntentId,
                enrollmentId,
                status: 'cancel',
                amount: expectedAmount,
                currency: expectedCurrency,
              });
            }
          } catch (error) {
            captureRequestError(error);
            console.error("Error verifying payment:", error);
            return res.status(400).json({ message: "Failed to verify payment" });
          }
        }

        // Soft delete the enrollment and record payment intent if used
        await storage.updateClassEnrollment(enrollmentId, {
          cancelledAt: new Date(),
          ...(paymentIntentId ? { lastPaymentIntentId: paymentIntentId } : {}),
        });

        // If an in-car booking was cancelled and the student still holds
        // another upcoming in-car booking, that booking becomes their next
        // lesson (slot #1) — notify them so they can keep or cancel it.
        if (classData.classType === 'driving') {
          notifyInCarSlotPromotion(student.id).catch(err => {
            captureRequestError(err);
            console.error("In-car slot promotion email failed (non-critical):", err);
          });
        }

        res.json({
          success: true,
          message: "Class cancelled successfully",
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error cancelling class:", error);
        res.status(500).json({ message: "Failed to cancel class" });
      }
    },
  );


  // Student Billing & Checkout Routes
  
  // Get billing overview
  app.get(
    "/api/student/billing/overview",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;

        // Get unpaid invoices
        const unpaidInvoices = await storage.getUnpaidInvoices(student.id);
        const outstandingBalance = unpaidInvoices.reduce(
          (sum, inv) => sum + parseFloat(inv.amount?.toString() || '0'),
          0
        );

        // Get available lesson packages for student's course type
        const packages = await storage.getActiveLessonPackages(student.courseType);

        // Get available credits
        const creditBalance = await storage.getAvailableCredits(student.id);

        // Calculate total paid from student transactions
        const transactions = await storage.getStudentPaymentHistory(student.id);
        const totalPaid = transactions.reduce(
          (sum, tx) => sum + parseFloat(tx.total?.toString() || '0'),
          0
        );

        // Get payment allocations for this student (includes parent/third-party payments)
        const allocations = await db.select().from(paymentAllocations)
          .where(eq(paymentAllocations.studentId, student.id));
        
        const allocatedFromOthers = allocations.reduce(
          (sum, alloc) => sum + parseFloat(alloc.amount?.toString() || '0'),
          0
        );

        res.json({
          outstandingBalance,
          unpaidInvoices: unpaidInvoices.length,
          packages,
          creditBalance,
          totalPaid: totalPaid + allocatedFromOthers,
          studentPayments: totalPaid,
          otherPayments: allocatedFromOthers,
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching billing overview:", error);
        res.status(500).json({ message: "Failed to fetch billing overview" });
      }
    }
  );

  // Get payment methods
  app.get(
    "/api/student/billing/methods",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const methods = await storage.getStudentPaymentMethods(student.id);
        res.json(methods);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching payment methods:", error);
        res.status(500).json({ message: "Failed to fetch payment methods" });
      }
    }
  );

  // Add new payment method
  app.post(
    "/api/student/billing/methods/add",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        if (!stripe) {
          return res.status(500).json({ message: "Payment system is not configured" });
        }

        const student = req.student;
        const { paymentMethodId } = req.body;

        if (!paymentMethodId) {
          return res.status(400).json({ message: "Payment method ID is required" });
        }

        // Create or get Stripe customer
        let stripeCustomerId = student.stripeCustomerId;
        if (!stripeCustomerId) {
          const customer = await stripe.customers.create({
            email: student.email,
            name: `${student.firstName} ${student.lastName}`,
            metadata: { studentId: String(student.id) },
          });
          stripeCustomerId = customer.id;
          await storage.updateStudent(student.id, { stripeCustomerId });
        }

        // Attach payment method to customer
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: stripeCustomerId,
        });

        // Get payment method details
        const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

        // Save to database
        const isFirst = (await storage.getStudentPaymentMethods(student.id)).length === 0;
        const method = await storage.createStudentPaymentMethod({
          studentId: student.id,
          stripePaymentMethodId: paymentMethodId,
          cardBrand: paymentMethod.card?.brand || null,
          last4: paymentMethod.card?.last4 || null,
          expiryMonth: paymentMethod.card?.exp_month || null,
          expiryYear: paymentMethod.card?.exp_year || null,
          isDefault: isFirst, // First card is default
        });

        res.json(method);
      } catch (error: any) {
        captureRequestError(error);
        console.error("Error adding payment method:", error);
        res.status(500).json({ message: error.message || "Failed to add payment method" });
      }
    }
  );

  // Set default payment method
  app.post(
    "/api/student/billing/methods/default",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const { methodId } = req.body;

        if (!methodId) {
          return res.status(400).json({ message: "Method ID is required" });
        }

        await storage.setDefaultPaymentMethod(student.id, methodId);
        res.json({ success: true });
      } catch (error) {
        captureRequestError(error);
        console.error("Error setting default payment method:", error);
        res.status(500).json({ message: "Failed to set default payment method" });
      }
    }
  );

  // Delete payment method
  app.delete(
    "/api/student/billing/methods/:id",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        if (!stripe) {
          return res.status(500).json({ message: "Payment system is not configured" });
        }

        const student = req.student;
        const methodId = parseInt(req.params.id);

        if (isNaN(methodId)) {
          return res.status(400).json({ message: "Invalid method ID" });
        }

        // Get the method to verify ownership and get Stripe ID
        const methods = await storage.getStudentPaymentMethods(student.id);
        const method = methods.find(m => m.id === methodId);

        if (!method) {
          return res.status(404).json({ message: "Payment method not found" });
        }

        // Detach from Stripe FIRST - if this fails, don't delete from DB
        await stripe.paymentMethods.detach(method.stripePaymentMethodId);

        // Only delete from database after successful Stripe detachment
        await storage.deleteStudentPaymentMethod(methodId);

        res.json({ success: true });
      } catch (error: any) {
        captureRequestError(error);
        console.error("Error deleting payment method:", error);
        if (error.type === 'StripeInvalidRequestError') {
          return res.status(400).json({ message: "Payment method could not be removed from Stripe" });
        }
        res.status(500).json({ message: "Failed to delete payment method" });
      }
    }
  );

  // Checkout - purchase lessons, packages, or pay balance
  app.post(
    "/api/student/billing/checkout",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        if (!stripe) {
          return res.status(500).json({ message: "Payment system is not configured" });
        }

        const student = req.student;
        
        // Validate request body
        const checkoutSchema = z.object({
          type: z.enum(["package", "lesson", "balance"]),
          packageId: z.number().optional(),
          amount: z.number().positive().optional(),
          paymentMethodId: z.number().positive(),
          description: z.string().optional(),
        });

        const validationResult = checkoutSchema.safeParse(req.body);
        if (!validationResult.success) {
          return res.status(400).json({ 
            message: "Invalid request data",
            errors: validationResult.error.errors 
          });
        }

        const { type, packageId, amount, paymentMethodId, description } = validationResult.data;

        // Validate payment method belongs to student
        const methods = await storage.getStudentPaymentMethods(student.id);
        const method = methods.find(m => m.id === paymentMethodId);

        if (!method) {
          return res.status(400).json({ message: "Invalid payment method" });
        }

        // Determine amount and description BEFORE charging
        let finalAmount = 0;
        let finalDescription = description || "";
        // Tax breakdown (only applied when a taxable pricing-catalog override
        // drives the price; legacy package prices remain tax-inclusive as before)
        let checkoutBase = 0;
        let checkoutGst = 0;
        let checkoutQst = 0;

        if (type === "package") {
          if (!packageId) {
            return res.status(400).json({ message: "Package ID required for package purchase" });
          }
          const packages = await storage.getLessonPackages();
          const pkg = packages.find(p => p.id === packageId);
          if (!pkg || !pkg.isActive) {
            return res.status(404).json({ message: "Package not found or inactive" });
          }
          // Pricing catalog override: if an active, effective pricing item is
          // linked to this package, its amount + tax flags win over the package's price.
          const priceOverride = await getEffectivePackagePrice(pkg.id);
          if (priceOverride) {
            const rates = await getTaxRates();
            checkoutBase = priceOverride.amount;
            checkoutGst = priceOverride.gstApplicable ? Math.round(checkoutBase * rates.gstRate) / 100 : 0;
            checkoutQst = priceOverride.qstApplicable ? Math.round(checkoutBase * rates.qstRate) / 100 : 0;
            finalAmount = Math.round((checkoutBase + checkoutGst + checkoutQst) * 100) / 100;
          } else {
            finalAmount = parseFloat(pkg.price?.toString() || '0');
            checkoutBase = finalAmount;
          }
          finalDescription = `${pkg.name} - ${pkg.lessonCount} lessons`;
        } else if (type === "balance" || type === "lesson") {
          if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Valid amount required" });
          }
          finalAmount = amount;
          finalDescription = description || (type === "balance" ? "Balance payment" : "Single lesson purchase");
        }

        if (finalAmount <= 0 || finalAmount > 100000) {
          return res.status(400).json({ message: "Invalid amount (must be between $0 and $100,000)" });
        }

        const appUrl = process.env.APP_URL
          || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000');

        // Create payment intent and confirm atomically
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(finalAmount * 100), // Convert to cents
          currency: "cad",
          customer: student.stripeCustomerId || undefined,
          payment_method: method.stripePaymentMethodId,
          confirm: true,
          description: finalDescription,
          metadata: {
            studentId: String(student.id),
            type,
            packageId: packageId ? String(packageId) : '',
            finalAmount: String(finalAmount),
            finalDescription,
            checkoutBase: String(checkoutBase),
            checkoutGst: String(checkoutGst),
            checkoutQst: String(checkoutQst),
            paymentMethodId: String(paymentMethodId),
            cardBrand: method.cardBrand || "card",
          },
          return_url: `${appUrl}/student/billing`,
        }, { idempotencyKey: `checkout-${student.id}-${Date.now()}` });

        // 3DS authentication required — client must call handleNextAction
        if (paymentIntent.status === "requires_action") {
          return res.status(202).json({
            status: "requires_action",
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
          });
        }

        if (paymentIntent.status !== "succeeded") {
          return res.status(400).json({ 
            message: "Payment failed", 
            status: paymentIntent.status,
            details: paymentIntent.last_payment_error?.message 
          });
        }

        // Only create records after successful payment
        const transaction = await storage.createStudentTransaction({
          studentId: student.id,
          date: new Date().toISOString().split('T')[0],
          description: finalDescription,
          amount: String(checkoutBase || finalAmount),
          gst: checkoutGst.toFixed(2),
          pst: checkoutQst.toFixed(2),
          total: String(finalAmount),
          transactionType: "payment",
          paymentMethod: method.cardBrand || "card",
          referenceNumber: paymentIntent.id,
        });

        // Generate receipt
        const receiptNumber = `REC-${Date.now()}-${student.id}`;
        await storage.createBillingReceipt({
          transactionId: transaction.id!,
          receiptNumber,
          pdfPath: null,
        });

        res.json({
          status: "paid",
          receiptUrl: `/api/student/billing/receipt/${transaction.id}`,
          transaction,
        });
      } catch (error: any) {
        captureRequestError(error);
        console.error("Error processing checkout:", error);
        
        // Handle Stripe-specific errors
        if (error.type === 'StripeCardError') {
          return res.status(400).json({ message: error.message || "Card declined" });
        }
        if (error.type === 'StripeInvalidRequestError') {
          return res.status(400).json({ message: "Invalid payment request" });
        }
        
        res.status(500).json({ message: error.message || "Failed to process payment" });
      }
    }
  );

  // Confirm checkout after 3D Secure authentication
  app.post(
    "/api/student/billing/checkout/confirm",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        if (!stripe) {
          return res.status(500).json({ message: "Payment system is not configured" });
        }

        const student = req.student;
        const { paymentIntentId } = req.body;

        if (!paymentIntentId) {
          return res.status(400).json({ message: "paymentIntentId is required" });
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        // Verify ownership
        if (paymentIntent.metadata.studentId !== String(student.id)) {
          return res.status(403).json({ message: "Payment does not belong to this student" });
        }

        if (paymentIntent.status !== "succeeded") {
          return res.status(400).json({
            message: "Payment not yet completed",
            status: paymentIntent.status,
          });
        }

        // Idempotency: check if transaction was already recorded for this PaymentIntent
        const { studentTransactions: studentTxTable } = await import("@shared/schema");
        const [existingTx] = await db.select().from(studentTxTable)
          .where(eq(studentTxTable.referenceNumber, paymentIntentId))
          .limit(1);

        if (existingTx) {
          return res.json({
            status: "paid",
            receiptUrl: `/api/student/billing/receipt/${existingTx.id}`,
            transaction: existingTx,
          });
        }

        const finalAmount = parseFloat(paymentIntent.metadata.finalAmount || "0");
        const finalDescription = paymentIntent.metadata.finalDescription || "Payment";
        const cardBrand = paymentIntent.metadata.cardBrand || "card";
        const metaBase = parseFloat(paymentIntent.metadata.checkoutBase || "0") || finalAmount;
        const metaGst = parseFloat(paymentIntent.metadata.checkoutGst || "0") || 0;
        const metaQst = parseFloat(paymentIntent.metadata.checkoutQst || "0") || 0;

        const transaction = await storage.createStudentTransaction({
          studentId: student.id,
          date: new Date().toISOString().split('T')[0],
          description: finalDescription,
          amount: String(metaBase),
          gst: metaGst.toFixed(2),
          pst: metaQst.toFixed(2),
          total: String(finalAmount),
          transactionType: "payment",
          paymentMethod: cardBrand,
          referenceNumber: paymentIntentId,
        });

        const receiptNumber = `REC-${Date.now()}-${student.id}`;
        await storage.createBillingReceipt({
          transactionId: transaction.id!,
          receiptNumber,
          pdfPath: null,
        });

        res.json({
          status: "paid",
          receiptUrl: `/api/student/billing/receipt/${transaction.id}`,
          transaction,
        });
      } catch (error: any) {
        captureRequestError(error);
        console.error("Error confirming checkout:", error);
        res.status(500).json({ message: error.message || "Failed to confirm payment" });
      }
    }
  );

  // Get payment history (includes parent/guardian payments with invoice linkage)
  app.get(
    "/api/student/billing/history",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        
        // Get student's own transactions
        const transactions = await storage.getStudentPaymentHistory(student.id);
        
        // Format student transactions
        const studentPayments = transactions.map(tx => ({
          id: tx.id,
          date: tx.createdAt ? new Date(tx.createdAt).toISOString().split('T')[0] : null,
          description: tx.description,
          amount: tx.amount,
          gst: tx.gst,
          pst: tx.pst,
          total: tx.total,
          paymentMethod: tx.paymentMethod,
          referenceNumber: tx.referenceNumber,
          paidBy: 'self',
          payerName: `${student.firstName} ${student.lastName}`,
          type: 'student_payment',
          linkedTo: null,
          coveredItems: null,
          refundStatus: (tx as any).refundStatus || null,
          refundRequestNote: (tx as any).refundRequestNote || null,
          refundAdminNote: (tx as any).refundAdminNote || null,
          refundAmount: (tx as any).refundAmount || null,
        }));

        // Get payment allocations from parents/guardians with linked transaction details
        const allocations = await db.select({
          allocation: paymentAllocations,
          intake: paymentIntakes,
          transaction: studentTransactions
        })
          .from(paymentAllocations)
          .innerJoin(paymentIntakes, eq(paymentAllocations.paymentIntakeId, paymentIntakes.id))
          .leftJoin(studentTransactions, eq(paymentAllocations.studentTransactionId, studentTransactions.id))
          .where(eq(paymentAllocations.studentId, student.id));

        // Format parent/guardian payments with linked invoice details
        const otherPayments = allocations.map(({ allocation, intake, transaction }) => ({
          id: `alloc-${allocation.id}`,
          date: intake.receivedDate,
          description: allocation.notes || `Payment from ${intake.payerName || 'Parent/Guardian'}`,
          amount: allocation.amount,
          gst: null,
          pst: null,
          total: allocation.amount,
          paymentMethod: intake.paymentMethod,
          referenceNumber: intake.referenceNumber,
          paidBy: 'other',
          payerName: intake.payerName || 'Parent/Guardian',
          payerRelationship: intake.payerEmail ? 'Family Member' : 'Third Party',
          type: 'parent_payment',
          linkedTo: transaction ? {
            id: transaction.id,
            description: transaction.description,
            originalAmount: transaction.total,
            date: transaction.createdAt
          } : null,
          coveredItems: transaction?.description || 'General account credit'
        }));

        // Combine and sort by date (newest first)
        const allPayments = [...studentPayments, ...otherPayments].sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateB - dateA;
        });

        res.json(allPayments);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching payment history:", error);
        res.status(500).json({ message: "Failed to fetch payment history" });
      }
    }
  );

  // View/download receipt (HTML printable page)
  app.get(
    "/api/student/billing/receipt/:id",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const transactionId = parseInt(req.params.id);

        const transactions = await storage.getStudentPaymentHistory(student.id);
        const transaction = transactions.find(t => t.id === transactionId);

        if (!transaction) {
          return res.status(404).json({ message: "Receipt not found" });
        }

        const receipt = await storage.getBillingReceipt(transactionId);
        const receiptNumber = receipt?.receiptNumber || `REC-${transactionId}`;
        const dateStr = transaction.createdAt
          ? new Date(transaction.createdAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })
          : transaction.date;

        const total = parseFloat(transaction.total?.toString() || "0");
        const gst = parseFloat(transaction.gst?.toString() || "0");
        const pst = parseFloat(transaction.pst?.toString() || "0");
        const subtotal = total - gst - pst;

        const escHtml = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        const safeReceiptNumber = escHtml(receiptNumber);
        const safeDateStr = escHtml(dateStr);
        const safeFirstName = escHtml(student.firstName || '');
        const safeLastName = escHtml(student.lastName || '');
        const safeEmail = escHtml(student.email || '');
        const safeDescription = escHtml(transaction.description || 'Payment');
        const safePaymentMethod = transaction.paymentMethod
          ? escHtml(transaction.paymentMethod.charAt(0).toUpperCase() + transaction.paymentMethod.slice(1))
          : 'N/A';
        const safeReference = transaction.referenceNumber ? escHtml(transaction.referenceNumber) : null;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Receipt ${safeReceiptNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; background: #fff; padding: 40px 20px; }
    .receipt { max-width: 560px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    .header { background: #111111; color: #ECC462; padding: 28px 32px; }
    .header h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { font-size: 13px; color: #d4af56; margin-top: 2px; }
    .receipt-number { background: #ECC462; color: #111; padding: 10px 32px; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; }
    .body { padding: 28px 32px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7280; margin-bottom: 8px; font-weight: 600; }
    .field { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 0; border-bottom: 1px dashed #f3f4f6; }
    .field:last-child { border-bottom: none; }
    .field-label { font-size: 14px; color: #374151; }
    .field-value { font-size: 14px; color: #111; font-weight: 500; text-align: right; }
    .total-row { display: flex; justify-content: space-between; padding: 14px 0 0; border-top: 2px solid #111; margin-top: 8px; }
    .total-label { font-size: 16px; font-weight: 700; }
    .total-value { font-size: 18px; font-weight: 800; color: #111; }
    .footer { background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px 32px; text-align: center; font-size: 12px; color: #9ca3af; }
    @media print { body { padding: 0; } .receipt { border: none; border-radius: 0; } .no-print { display: none !important; } }
    .print-btn { display: block; text-align: center; margin: 24px auto 0; padding: 10px 32px; background: #111; color: #ECC462; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>Morty's Driving School</h1>
      <p>Payment Receipt</p>
    </div>
    <div class="receipt-number">
      <span>Receipt #${safeReceiptNumber}</span>
      <span>${safeDateStr}</span>
    </div>
    <div class="body">
      <div class="section">
        <div class="section-title">Billed To</div>
        <div class="field">
          <span class="field-label">Student Name</span>
          <span class="field-value">${safeFirstName} ${safeLastName}</span>
        </div>
        <div class="field">
          <span class="field-label">Email</span>
          <span class="field-value">${safeEmail}</span>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Payment Details</div>
        <div class="field">
          <span class="field-label">Description</span>
          <span class="field-value">${safeDescription}</span>
        </div>
        <div class="field">
          <span class="field-label">Payment Method</span>
          <span class="field-value">${safePaymentMethod}</span>
        </div>
        ${safeReference ? `<div class="field"><span class="field-label">Reference #</span><span class="field-value" style="font-size:12px;word-break:break-all">${safeReference}</span></div>` : ''}
      </div>
      <div class="section">
        <div class="section-title">Summary</div>
        <div class="field">
          <span class="field-label">Subtotal</span>
          <span class="field-value">$${subtotal.toFixed(2)}</span>
        </div>
        ${gst > 0 ? `<div class="field"><span class="field-label">GST</span><span class="field-value">$${gst.toFixed(2)}</span></div>` : ''}
        ${pst > 0 ? `<div class="field"><span class="field-label">PST</span><span class="field-value">$${pst.toFixed(2)}</span></div>` : ''}
        <div class="total-row">
          <span class="total-label">Total Paid</span>
          <span class="total-value">$${total.toFixed(2)} CAD</span>
        </div>
      </div>
    </div>
    <div class="footer">
      Thank you for your payment. Keep this receipt for your records.
    </div>
  </div>
  <button class="print-btn no-print" onclick="window.print()">Print Receipt</button>
</body>
</html>`;

        res.setHeader("Content-Type", "text/html");
        res.send(html);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching receipt:", error);
        res.status(500).json({ message: "Failed to fetch receipt" });
      }
    }
  );

  // Student requests a refund on a transaction
  app.post(
    "/api/student/billing/transactions/:transactionId/request-refund",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const transactionId = parseInt(req.params.transactionId);
        const { reason } = req.body;

        if (!reason || !reason.trim()) {
          return res.status(400).json({ message: "A reason is required for the refund request." });
        }

        const transaction = await storage.getStudentTransaction(transactionId);
        if (!transaction || transaction.studentId !== student.id) {
          return res.status(404).json({ message: "Transaction not found." });
        }
        if (transaction.transactionType !== "payment") {
          return res.status(400).json({ message: "Only payments can be refunded." });
        }
        if (transaction.refundStatus && transaction.refundStatus !== "none") {
          return res.status(400).json({ message: "A refund request already exists for this transaction." });
        }

        const updated = await storage.updateStudentTransaction(transactionId, {
          refundStatus: "requested",
          refundRequestNote: reason.trim(),
        });

        res.json({ success: true, transaction: updated });
      } catch (error) {
        captureRequestError(error);
        console.error("Error submitting refund request:", error);
        res.status(500).json({ message: "Failed to submit refund request." });
      }
    }
  );

  // --------------------------------------------
  // Admin Refund Routes
  // --------------------------------------------

  // List all refund requests (pending and resolved)
  app.get("/api/admin/refund-requests", authMiddleware, async (req: any, res) => {
    try {
      const callerRole = req.user?.role;
      if (!callerRole || !['owner', 'admin', 'manager'].includes(callerRole)) {
        return res.status(403).json({ message: "Insufficient permissions to view refund requests." });
      }
      const rows = await db.select({
        id: studentTransactions.id,
        studentId: studentTransactions.studentId,
        date: studentTransactions.date,
        description: studentTransactions.description,
        amount: studentTransactions.amount,
        total: studentTransactions.total,
        paymentMethod: studentTransactions.paymentMethod,
        referenceNumber: studentTransactions.referenceNumber,
        refundStatus: studentTransactions.refundStatus,
        refundRequestNote: studentTransactions.refundRequestNote,
        refundAdminNote: studentTransactions.refundAdminNote,
        refundAmount: studentTransactions.refundAmount,
        refundedAt: studentTransactions.refundedAt,
        createdAt: studentTransactions.createdAt,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        studentEmail: students.email,
      })
        .from(studentTransactions)
        .leftJoin(students, eq(studentTransactions.studentId, students.id))
        .where(and(isNotNull(studentTransactions.refundStatus), ne(studentTransactions.refundStatus as any, 'none')))
        .orderBy(studentTransactions.createdAt);
      res.json(rows);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching refund requests:", error);
      res.status(500).json({ message: "Failed to fetch refund requests." });
    }
  });

  // Approve a refund request (executes Stripe refund if applicable)
  app.post("/api/admin/refund-requests/:id/approve", authMiddleware, async (req: any, res) => {
    try {
      const callerRole = req.user?.role;
      if (!callerRole || !['owner', 'admin', 'manager'].includes(callerRole)) {
        return res.status(403).json({ message: "Insufficient permissions to approve refunds." });
      }
      const transactionId = parseInt(req.params.id);
      const { adminNote, amount } = req.body;

      const transaction = await storage.getStudentTransaction(transactionId);
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found." });
      }
      if (transaction.refundStatus !== "requested") {
        return res.status(400).json({ message: "This transaction does not have a pending refund request." });
      }

      const maxAmount = parseFloat(transaction.total?.toString() || "0");
      const refundAmount = amount ? parseFloat(amount) : maxAmount;
      if (isNaN(refundAmount) || refundAmount <= 0) {
        return res.status(400).json({ message: "Refund amount must be a positive number." });
      }
      if (refundAmount > maxAmount) {
        return res.status(400).json({ message: `Refund amount cannot exceed the original transaction total of $${maxAmount.toFixed(2)}.` });
      }

      let stripeRefundId: string | undefined;

      // Attempt Stripe refund if there's a payment intent reference
      if (stripe && transaction.referenceNumber && transaction.referenceNumber.startsWith("pi_")) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: transaction.referenceNumber,
            amount: Math.round(refundAmount * 100),
            reason: "requested_by_customer",
          });
          stripeRefundId = refund.id;
        } catch (stripeError: any) {
          captureRequestError(stripeError);
          console.error("Stripe refund error:", stripeError.message);
          return res.status(400).json({ message: `Stripe refund failed: ${stripeError.message}` });
        }
      }

      const updated = await storage.updateStudentTransaction(transactionId, {
        refundStatus: "refunded",
        refundAdminNote: adminNote || null,
        stripeRefundId: stripeRefundId || null,
        refundAmount: String(refundAmount),
        refundedAt: new Date(),
      });

      res.json({ success: true, transaction: updated });
    } catch (error) {
      captureRequestError(error);
      console.error("Error approving refund:", error);
      res.status(500).json({ message: "Failed to approve refund." });
    }
  });

  // Deny a refund request
  app.post("/api/admin/refund-requests/:id/deny", authMiddleware, async (req: any, res) => {
    try {
      const callerRole = req.user?.role;
      if (!callerRole || !['owner', 'admin', 'manager'].includes(callerRole)) {
        return res.status(403).json({ message: "Insufficient permissions to deny refunds." });
      }
      const transactionId = parseInt(req.params.id);
      const { adminNote } = req.body;

      const transaction = await storage.getStudentTransaction(transactionId);
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found." });
      }
      if (transaction.refundStatus !== "requested") {
        return res.status(400).json({ message: "This transaction does not have a pending refund request." });
      }

      const updated = await storage.updateStudentTransaction(transactionId, {
        refundStatus: "denied",
        refundAdminNote: adminNote || null,
      });

      res.json({ success: true, transaction: updated });
    } catch (error) {
      captureRequestError(error);
      console.error("Error denying refund:", error);
      res.status(500).json({ message: "Failed to deny refund." });
    }
  });

  // Admin direct refund (no prior student request needed)
  app.post("/api/admin/transactions/:transactionId/refund", authMiddleware, async (req: any, res) => {
    try {
      const callerRole = req.user?.role;
      if (!callerRole || !['owner', 'admin', 'manager'].includes(callerRole)) {
        return res.status(403).json({ message: "Insufficient permissions to issue refunds." });
      }
      const transactionId = parseInt(req.params.transactionId);
      const { amount, reason } = req.body;

      if (!reason || !reason.trim()) {
        return res.status(400).json({ message: "A reason is required." });
      }

      const transaction = await storage.getStudentTransaction(transactionId);
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found." });
      }
      if (transaction.transactionType !== "payment") {
        return res.status(400).json({ message: "Only payments can be refunded." });
      }
      if (transaction.refundStatus === "refunded") {
        return res.status(400).json({ message: "This transaction has already been refunded." });
      }

      const maxAmount = parseFloat(transaction.total?.toString() || "0");
      const refundAmount = amount ? parseFloat(amount) : maxAmount;
      if (isNaN(refundAmount) || refundAmount <= 0) {
        return res.status(400).json({ message: "Refund amount must be a positive number." });
      }
      if (refundAmount > maxAmount) {
        return res.status(400).json({ message: `Refund amount cannot exceed the original transaction total of $${maxAmount.toFixed(2)}.` });
      }
      let stripeRefundId: string | undefined;

      if (stripe && transaction.referenceNumber && transaction.referenceNumber.startsWith("pi_")) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: transaction.referenceNumber,
            amount: Math.round(refundAmount * 100),
            reason: "requested_by_customer",
          });
          stripeRefundId = refund.id;
        } catch (stripeError: any) {
          captureRequestError(stripeError);
          console.error("Stripe refund error:", stripeError.message);
          return res.status(400).json({ message: `Stripe refund failed: ${stripeError.message}` });
        }
      }

      const updated = await storage.updateStudentTransaction(transactionId, {
        refundStatus: "refunded",
        refundAdminNote: reason.trim(),
        stripeRefundId: stripeRefundId || null,
        refundAmount: String(refundAmount),
        refundedAt: new Date(),
      });

      res.json({ success: true, transaction: updated });
    } catch (error) {
      captureRequestError(error);
      console.error("Error processing direct refund:", error);
      res.status(500).json({ message: "Failed to process refund." });
    }
  });

  // --------------------------------------------
  // Admin Payment Reconciliation Routes
  // --------------------------------------------

  // Get all payment intakes (pending queue)
  app.get("/api/admin/payments/intakes", authMiddleware, async (req, res) => {
    try {
      const { status, startDate, endDate, search } = req.query;
      const intakes = await storage.getPaymentIntakes({
        status: status as string,
        startDate: startDate as string,
        endDate: endDate as string,
        search: search as string,
      });
      res.json(intakes);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching payment intakes:", error);
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // Create a new payment intake (record incoming payment)
  app.post("/api/admin/payments/intakes", authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const body = req.body;
      // Validate required fields
      if (!body.payerName || !body.payerName.trim()) {
        return res.status(400).json({ message: "Payer name is required" });
      }
      if (!body.amount || isNaN(parseFloat(body.amount)) || parseFloat(body.amount) <= 0) {
        return res.status(400).json({ message: "A valid amount greater than 0 is required" });
      }
      if (!body.receivedDate) {
        return res.status(400).json({ message: "Received date is required" });
      }
      const data = {
        ...body,
        amount: String(body.amount),
        createdBy: userId,
        status: 'pending',
        allocatedAmount: '0.00',
      };
      const intake = await storage.createPaymentIntake(data);
      
      // Create audit log
      await storage.createPaymentAuditLog({
        paymentIntakeId: intake.id,
        action: 'created',
        actorId: userId,
        newData: intake,
        notes: 'Payment recorded',
      });
      
      res.status(201).json(intake);
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating payment intake:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Failed to record payment: ${msg}` });
    }
  });

  // Get a single payment intake with allocations
  app.get("/api/admin/payments/intakes/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const intake = await storage.getPaymentIntake(id);
      if (!intake) {
        return res.status(404).json({ message: "Payment not found" });
      }
      const allocations = await storage.getPaymentAllocations(id);
      const auditLogs = await storage.getPaymentAuditLogs(id);
      res.json({ ...intake, allocations, auditLogs });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching payment intake:", error);
      res.status(500).json({ message: "Failed to fetch payment" });
    }
  });

  // Allocate payment to student(s)
  app.post("/api/admin/payments/intakes/:id/allocate", authMiddleware, async (req, res) => {
    try {
      const paymentIntakeId = parseInt(req.params.id);
      const userId = (req as any).user?.id;
      const { studentId, amount, notes, description } = req.body;
      
      const intake = await storage.getPaymentIntake(paymentIntakeId);
      if (!intake) {
        return res.status(404).json({ message: "Payment not found" });
      }
      
      const previousData = { ...intake };
      
      // Calculate remaining amount
      const paymentAmount = parseFloat(intake.amount);
      const currentAllocated = parseFloat(intake.allocatedAmount || '0');
      const allocationAmount = parseFloat(amount);
      
      if (allocationAmount > paymentAmount - currentAllocated) {
        return res.status(400).json({ message: "Allocation amount exceeds remaining balance" });
      }
      
      // Create student transaction
      const transaction = await storage.createStudentTransaction({
        studentId,
        date: new Date().toISOString().split('T')[0],
        description: description || `Payment from ${intake.payerName}`,
        amount: amount,
        gst: '0.00',
        pst: '0.00',
        total: amount,
        transactionType: 'payment',
        paymentMethod: intake.paymentMethod,
        referenceNumber: intake.referenceNumber,
        notes: `Reconciled from payment intake #${paymentIntakeId}`,
      });
      
      // Create allocation record
      const allocation = await storage.createPaymentAllocation({
        paymentIntakeId,
        studentTransactionId: transaction.id,
        studentId,
        amount,
        allocatedBy: userId,
        notes,
      });
      
      // Update payment intake
      const newAllocated = currentAllocated + allocationAmount;
      const newStatus = newAllocated >= paymentAmount ? 'reconciled' : 'partially_allocated';
      
      const updatedIntake = await storage.updatePaymentIntake(paymentIntakeId, {
        studentId: intake.studentId || studentId, // Link to first allocated student
        allocatedAmount: newAllocated.toFixed(2),
        status: newStatus,
        reconciledBy: newStatus === 'reconciled' ? userId : intake.reconciledBy,
        reconciledAt: newStatus === 'reconciled' ? new Date() : intake.reconciledAt,
      });
      
      // Create audit log
      await storage.createPaymentAuditLog({
        paymentIntakeId,
        action: newStatus === 'reconciled' ? 'reconciled' : 'allocated',
        actorId: userId,
        previousData,
        newData: updatedIntake,
        notes: `Allocated $${amount} to student #${studentId}`,
      });
      
      // Send payment received notification to student and linked parents
      try {
        await notificationService.notifyPaymentReceived({
          studentId,
          amount: allocationAmount,
          paymentMethod: intake.paymentMethod,
          referenceNumber: intake.referenceNumber || undefined,
        });
      } catch (notifyError) {
        captureRequestError(notifyError);
        console.error("Failed to send payment received notification:", notifyError);
      }
      
      res.json({ intake: updatedIntake, allocation, transaction });
    } catch (error) {
      captureRequestError(error);
      console.error("Error allocating payment:", error);
      res.status(400).json({ message: "Failed to allocate payment" });
    }
  });

  // Update payment intake (edit details)
  app.put("/api/admin/payments/intakes/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = (req as any).user?.id;
      
      const previous = await storage.getPaymentIntake(id);
      if (!previous) {
        return res.status(404).json({ message: "Payment not found" });
      }
      
      const updated = await storage.updatePaymentIntake(id, req.body);
      
      await storage.createPaymentAuditLog({
        paymentIntakeId: id,
        action: 'updated',
        actorId: userId,
        previousData: previous,
        newData: updated,
      });
      
      res.json(updated);
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating payment intake:", error);
      res.status(400).json({ message: "Failed to update payment" });
    }
  });

  // Mark payment as returned (refund/bounce)
  app.post("/api/admin/payments/intakes/:id/return", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = (req as any).user?.id;
      const { reason } = req.body;
      
      const previous = await storage.getPaymentIntake(id);
      if (!previous) {
        return res.status(404).json({ message: "Payment not found" });
      }
      
      const updated = await storage.updatePaymentIntake(id, {
        status: 'returned',
        notes: `${previous.notes || ''}\nReturned: ${reason}`.trim(),
      });
      
      await storage.createPaymentAuditLog({
        paymentIntakeId: id,
        action: 'returned',
        actorId: userId,
        previousData: previous,
        newData: updated,
        notes: reason,
      });
      
      res.json(updated);
    } catch (error) {
      captureRequestError(error);
      console.error("Error returning payment:", error);
      res.status(400).json({ message: "Failed to return payment" });
    }
  });

  // Get payer profiles
  app.get("/api/admin/payers", authMiddleware, async (req, res) => {
    try {
      const { search, studentId } = req.query;
      const payers = await storage.getPayerProfiles({
        search: search as string,
        studentId: studentId ? parseInt(studentId as string) : undefined,
      });
      res.json(payers);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching payers:", error);
      res.status(500).json({ message: "Failed to fetch payers" });
    }
  });

  // Create payer profile
  app.post("/api/admin/payers", authMiddleware, async (req, res) => {
    try {
      const payer = await storage.createPayerProfile(req.body);
      res.status(201).json(payer);
    } catch (error) {
      captureRequestError(error);
      console.error("Error creating payer:", error);
      res.status(400).json({ message: "Failed to create payer" });
    }
  });

  // Update payer profile
  app.put("/api/admin/payers/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const payer = await storage.updatePayerProfile(id, req.body);
      res.json(payer);
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating payer:", error);
      res.status(400).json({ message: "Failed to update payer" });
    }
  });

  // Get payer profiles with linked students (for families with multiple students)
  app.get("/api/admin/payers/with-students", authMiddleware, async (req, res) => {
    try {
      const payersWithStudents = await storage.getPayerProfilesWithStudents();
      res.json(payersWithStudents);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching payers with students:", error);
      res.status(500).json({ message: "Failed to fetch payers" });
    }
  });

  // Get students linked to a payer
  app.get("/api/admin/payers/:id/students", authMiddleware, async (req, res) => {
    try {
      const payerProfileId = parseInt(req.params.id);
      const links = await storage.getPayerProfileStudents(payerProfileId);
      res.json(links);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching payer students:", error);
      res.status(500).json({ message: "Failed to fetch payer students" });
    }
  });

  // Link a student to a payer
  app.post("/api/admin/payers/:id/students", authMiddleware, async (req, res) => {
    try {
      const payerProfileId = parseInt(req.params.id);
      const { studentId, isPrimary, notes } = req.body;
      const link = await storage.addPayerProfileStudent({
        payerProfileId,
        studentId,
        isPrimary: isPrimary || false,
        notes,
      });
      res.status(201).json(link);
    } catch (error) {
      captureRequestError(error);
      console.error("Error linking student to payer:", error);
      res.status(400).json({ message: "Failed to link student" });
    }
  });

  // Unlink a student from a payer
  app.delete("/api/admin/payers/:id/students/:studentId", authMiddleware, async (req, res) => {
    try {
      const payerProfileId = parseInt(req.params.id);
      const studentId = parseInt(req.params.studentId);
      await storage.removePayerProfileStudent(payerProfileId, studentId);
      res.json({ success: true });
    } catch (error) {
      captureRequestError(error);
      console.error("Error unlinking student from payer:", error);
      res.status(400).json({ message: "Failed to unlink student" });
    }
  });

  // Student search for reconciliation
  app.get("/api/admin/students/search", authMiddleware, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || (q as string).length < 2) {
        return res.json([]);
      }
      const result = await storage.searchStudents({ searchTerm: q as string, limit: 20 });
      res.json(result.students);
    } catch (error) {
      captureRequestError(error);
      console.error("Error searching students:", error);
      res.status(500).json({ message: "Failed to search students" });
    }
  });

  // CSV Import - Import student data from CSV
  app.post("/api/admin/students/import-csv", authMiddleware, async (req, res) => {
    try {
      const { csvData } = req.body;
      
      if (!csvData || typeof csvData !== 'string') {
        return res.status(400).json({ message: "CSV data is required" });
      }

      // Parse CSV - skip header row
      const lines = csvData.trim().split('\n');
      const header = lines[0];
      const dataLines = lines.slice(1);

      // Validate header
      if (!header.includes('ID') || !header.includes('First Name') || !header.includes('Last Name')) {
        return res.status(400).json({ message: "Invalid CSV format. Expected columns: ID, First Name, Last Name, Date of Birth, Vehicle" });
      }

      // Map vehicle code to course type
      const vehicleToCourseType = (vehicle: string): string => {
        switch (vehicle.trim()) {
          case '1': return 'auto';
          case '2': return 'moto';
          case '3': return 'scooter';
          default: return 'auto';
        }
      };

      // Convert date from DD/MM/YYYY to YYYY-MM-DD
      const convertDate = (dateStr: string): string => {
        if (!dateStr || dateStr.trim() === '') return '';
        const parts = dateStr.trim().split('/');
        if (parts.length === 3) {
          const [day, month, year] = parts;
          // Handle 2-digit years
          let fullYear = year;
          if (year.length === 2) {
            const yearNum = parseInt(year);
            fullYear = yearNum > 50 ? `19${year}` : `20${year}`;
          }
          return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        return dateStr;
      };

      const results = {
        updated: 0,
        created: 0,
        skipped: 0,
        errors: [] as string[],
      };

      // Parse CSV line (handle commas in quoted fields)
      const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current);
        return result;
      };

      // Build legacy ID map ONCE upfront for O(1) lookups
      const existingStudents = await storage.getStudents();
      const legacyIdMap = new Map(existingStudents.filter(s => s.legacyId).map(s => [s.legacyId, s]));

      // Process each line
      for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i];
        if (!line.trim()) continue;

        const fields = parseCSVLine(line);
        
        if (fields.length < 5) {
          results.errors.push(`Line ${i + 2}: Not enough fields`);
          results.skipped++;
          continue;
        }

        const [legacyId, firstName, lastName, dateOfBirth, vehicle] = fields;

        // Skip rows with empty required fields
        if (!legacyId || !firstName.trim() || !lastName.trim()) {
          results.skipped++;
          continue;
        }

        try {
          // O(1) lookup from pre-built map
          const existingStudent = legacyIdMap.get(legacyId.trim());

          if (existingStudent) {
            // Update existing student
            await storage.updateStudent(existingStudent.id, {
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              dateOfBirth: convertDate(dateOfBirth) || existingStudent.dateOfBirth,
              courseType: vehicleToCourseType(vehicle),
            });
            results.updated++;
          } else {
            // Create new student with placeholder data for required fields
            const newStudent = {
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: `import_${legacyId.trim()}@placeholder.local`,
              phone: '0000000000',
              dateOfBirth: convertDate(dateOfBirth) || '1990-01-01',
              address: 'To be updated',
              courseType: vehicleToCourseType(vehicle),
              emergencyContact: 'To be updated',
              emergencyPhone: '0000000000',
              legacyId: legacyId.trim(),
              status: 'active',
              progress: 0,
            };
            await storage.createStudent(newStudent);
            results.created++;
          }
        } catch (err) {
          captureRequestError(err);
          const error = err as Error;
          results.errors.push(`Line ${i + 2} (ID ${legacyId}): ${error.message}`);
          results.skipped++;
        }
      }

      res.json({
        success: true,
        message: `Import completed. Created: ${results.created}, Updated: ${results.updated}, Skipped: ${results.skipped}`,
        results,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error importing CSV:", error);
      res.status(500).json({ message: "Failed to import CSV data" });
    }
  });

  // Transaction Audit - Get all transactions with filtering
  app.get("/api/admin/transactions/audit", authMiddleware, async (req, res) => {
    try {
      const { startDate, endDate, paymentMethod, transactionType, search } = req.query;
      
      // Fetch all transaction sources
      const [studentTransactionsData, paymentIntakesData, paymentTransactionsData] = await Promise.all([
        storage.getStudentTransactions(),
        storage.getPaymentIntakes({ status: undefined }),
        storage.getPaymentTransactions(),
      ]);
      
      // Get all students for name lookup
      const studentsData = await storage.getStudents();
      const studentMap = new Map(studentsData.map(s => [s.id, s]));
      
      // Normalize payment method to canonical keys
      const normalizePaymentMethod = (method: string | null): string => {
        if (!method) return 'unknown';
        const normalized = method.toLowerCase().trim();
        const mappings: Record<string, string> = {
          'credit card': 'credit',
          'creditcard': 'credit',
          'credit': 'credit',
          'card': 'credit',
          'debit card': 'debit',
          'debitcard': 'debit',
          'debit': 'debit',
          'e-transfer': 'e_transfer',
          'etransfer': 'e_transfer',
          'e_transfer': 'e_transfer',
          'interac e-transfer': 'e_transfer',
          'cash': 'cash',
          'cheque': 'cheque',
          'check': 'cheque',
          'bank_transfer': 'bank_transfer',
          'bank transfer': 'bank_transfer',
        };
        return mappings[normalized] || 'unknown';
      };
      
      // Parse amount safely
      const parseAmount = (value: string | number | null | undefined): number => {
        if (value === null || value === undefined) return 0;
        const parsed = typeof value === 'number' ? value : parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
      };
      
      // Normalize date to YYYY-MM-DD format for consistent comparison
      // Returns null for invalid/missing dates so we can filter them out
      const normalizeDateToYYYYMMDD = (dateValue: string | Date | null | undefined): string | null => {
        if (!dateValue) return null;
        try {
          // If it's already in YYYY-MM-DD format, return as is
          if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
            return dateValue;
          }
          // Parse and format to YYYY-MM-DD
          const date = new Date(dateValue);
          if (isNaN(date.getTime())) return null;
          return date.toISOString().split('T')[0];
        } catch {
          return null;
        }
      };
      
      // Normalize all transactions into unified format
      interface UnifiedTransaction {
        id: string;
        source: 'student_transaction' | 'payment_intake' | 'payment_transaction';
        date: string;
        amount: number;
        paymentMethod: string;
        transactionType: string;
        description: string;
        studentId: number | null;
        studentName: string | null;
        referenceNumber: string | null;
        status: string;
        notes: string | null;
        createdAt: Date | null;
      }
      
      const unifiedTransactions: UnifiedTransaction[] = [];
      
      // Add student transactions (use date field, fallback to createdAt)
      for (const tx of studentTransactionsData) {
        const normalizedDate = normalizeDateToYYYYMMDD(tx.date) || normalizeDateToYYYYMMDD(tx.createdAt);
        if (!normalizedDate) continue; // Skip only if both date and createdAt are invalid
        
        const student = tx.studentId ? studentMap.get(tx.studentId) : null;
        unifiedTransactions.push({
          id: `st-${tx.id}`,
          source: 'student_transaction',
          date: normalizedDate,
          amount: parseAmount(tx.amount),
          paymentMethod: normalizePaymentMethod(tx.paymentMethod),
          transactionType: tx.transactionType,
          description: tx.description || '',
          studentId: tx.studentId,
          studentName: student ? `${student.firstName} ${student.lastName}` : null,
          referenceNumber: tx.referenceNumber,
          status: 'completed',
          notes: tx.notes,
          createdAt: tx.createdAt,
        });
      }
      
      // Add payment intakes (use receivedDate, fallback to createdAt)
      for (const pi of paymentIntakesData) {
        const normalizedDate = normalizeDateToYYYYMMDD(pi.receivedDate) || normalizeDateToYYYYMMDD(pi.createdAt);
        if (!normalizedDate) continue; // Skip only if both receivedDate and createdAt are invalid
        
        const student = pi.studentId ? studentMap.get(pi.studentId) : null;
        unifiedTransactions.push({
          id: `pi-${pi.id}`,
          source: 'payment_intake',
          date: normalizedDate,
          amount: parseAmount(pi.amount),
          paymentMethod: normalizePaymentMethod(pi.paymentMethod),
          transactionType: 'payment',
          description: `Manual payment from ${pi.payerName}`,
          studentId: pi.studentId,
          studentName: student ? `${student.firstName} ${student.lastName}` : pi.payerName,
          referenceNumber: pi.referenceNumber,
          status: pi.status,
          notes: pi.notes,
          createdAt: pi.createdAt,
        });
      }
      
      // Add legacy payment transactions (use transactionDate, fallback to createdAt)
      for (const pt of paymentTransactionsData) {
        const normalizedDate = normalizeDateToYYYYMMDD(pt.transactionDate) || normalizeDateToYYYYMMDD(pt.createdAt);
        if (!normalizedDate) continue; // Skip only if both transactionDate and createdAt are invalid
        
        const student = pt.studentId ? studentMap.get(pt.studentId) : null;
        unifiedTransactions.push({
          id: `pt-${pt.id}`,
          source: 'payment_transaction',
          date: normalizedDate,
          amount: parseAmount(pt.amount),
          paymentMethod: normalizePaymentMethod(pt.paymentMethod),
          transactionType: pt.transactionType,
          description: pt.notes || `${pt.transactionType} transaction`,
          studentId: pt.studentId,
          studentName: student ? `${student.firstName} ${student.lastName}` : null,
          referenceNumber: pt.receiptNumber,
          status: 'completed',
          notes: pt.notes,
          createdAt: pt.createdAt,
        });
      }
      
      // Apply filters
      let filtered = unifiedTransactions;
      
      if (startDate) {
        filtered = filtered.filter(tx => tx.date >= (startDate as string));
      }
      if (endDate) {
        filtered = filtered.filter(tx => tx.date <= (endDate as string));
      }
      if (paymentMethod && paymentMethod !== 'all') {
        const normalizedFilter = normalizePaymentMethod(paymentMethod as string);
        filtered = filtered.filter(tx => tx.paymentMethod === normalizedFilter);
      }
      if (transactionType && transactionType !== 'all') {
        filtered = filtered.filter(tx => tx.transactionType === transactionType);
      }
      if (search) {
        const searchLower = (search as string).toLowerCase();
        filtered = filtered.filter(tx => 
          (tx.description || '').toLowerCase().includes(searchLower) ||
          tx.studentName?.toLowerCase().includes(searchLower) ||
          tx.referenceNumber?.toLowerCase().includes(searchLower)
        );
      }
      
      // Sort by date descending
      filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      // Calculate summary statistics
      const summary = {
        totalTransactions: filtered.length,
        totalAmount: filtered.filter(tx => tx.transactionType === 'payment').reduce((sum, tx) => sum + tx.amount, 0),
        totalRefunds: filtered.filter(tx => tx.transactionType === 'refund').reduce((sum, tx) => sum + Math.abs(tx.amount), 0),
        byMethod: {} as Record<string, { count: number; amount: number }>,
        byType: {} as Record<string, { count: number; amount: number }>,
      };
      
      for (const tx of filtered) {
        const method = tx.paymentMethod || 'unknown';
        if (!summary.byMethod[method]) {
          summary.byMethod[method] = { count: 0, amount: 0 };
        }
        summary.byMethod[method].count++;
        summary.byMethod[method].amount += tx.amount;
        
        const type = tx.transactionType;
        if (!summary.byType[type]) {
          summary.byType[type] = { count: 0, amount: 0 };
        }
        summary.byType[type].count++;
        summary.byType[type].amount += tx.amount;
      }
      
      res.json({
        transactions: filtered,
        summary,
      });
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching transaction audit:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // Instructor Dashboard Routes
  app.get(
    "/api/instructor/dashboard",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;

        // Get instructor's classes
        const classes = await storage.getInstructorClasses(instructor.id);

        // Get students assigned to instructor
        const students = await storage.getInstructorStudents(instructor.id);

        // Get instructor's evaluations
        const evaluations = await storage.getInstructorEvaluations(
          instructor.id,
        );

        // Calculate today's date range
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        // Calculate week boundaries (Monday to Sunday)
        const dayOfWeek = today.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() + mondayOffset);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const weekEndStr = weekEnd.toISOString().split('T')[0];

        // Today's classes
        const todaysClasses = classes.filter((c) => c.date === todayStr);
        
        // Get enrollments for today's classes
        const allEnrollments = await storage.getClassEnrollments();
        const todayClassIds = new Set(todaysClasses.map((c) => c.id));
        const todayEnrollments = allEnrollments.filter((e) => 
          e.classId && todayClassIds.has(e.classId) && !e.cancelledAt
        );
        
        // Get unique student IDs for today's classes
        const todayStudentIds = new Set<number>();
        todayEnrollments.forEach((e) => {
          if (e.studentId) todayStudentIds.add(e.studentId);
        });
        
        // Today's students with their class info
        const todaysStudents = students
          .filter((s) => todayStudentIds.has(s.id))
          .map((s) => {
            const studentEnrollments = todayEnrollments.filter((e) => e.studentId === s.id);
            const studentClasses = studentEnrollments
              .map((e) => todaysClasses.find((c) => c.id === e.classId))
              .filter((c): c is typeof todaysClasses[0] => c !== undefined);
            return {
              ...s,
              todaysClasses: studentClasses,
            };
          });

        // Weekly hours calculation (sum of class durations this week, converted from minutes to hours)
        const weeklyClasses = classes.filter((c) => 
          c.date >= weekStartStr && c.date <= weekEndStr && 
          (c.status === 'scheduled' || c.status === 'completed')
        );
        const weeklyMinutes = weeklyClasses.reduce((sum, c) => sum + (c.duration || 60), 0);
        const weeklyHours = Math.round(weeklyMinutes / 60 * 10) / 10; // Round to 1 decimal

        // Weekly no-shows (from class enrollments with no-show attendance status)
        const weeklyClassIds = new Set(weeklyClasses.map((c) => c.id));
        const weeklyNoShows = allEnrollments.filter((e) => 
          e.classId && weeklyClassIds.has(e.classId) && 
          e.attendanceStatus === 'no-show'
        ).length;

        // Housekeeping tasks
        const pendingConfirmations = classes.filter((c) => 
          c.confirmationStatus === 'pending' && 
          (getClassStartTime(c) ?? new Date(`${c.date}T${c.time}`)) > new Date()
        ).length;
        
        const pendingEvaluations = evaluations.filter(
          (e) => !e.signedOff,
        ).length;
        
        const pendingVehicleConfirmations = classes.filter((c) => 
          c.vehicleId && !c.vehicleConfirmed && 
          (getClassStartTime(c) ?? new Date(`${c.date}T${c.time}`)) > new Date()
        ).length;

        const housekeepingTasks = [];
        if (pendingConfirmations > 0) {
          housekeepingTasks.push({
            id: 'confirm-classes',
            type: 'warning',
            title: 'Confirm Classes',
            description: `${pendingConfirmations} class${pendingConfirmations > 1 ? 'es' : ''} awaiting confirmation`,
            count: pendingConfirmations,
            link: '/instructor/schedule',
          });
        }
        if (pendingEvaluations > 0) {
          housekeepingTasks.push({
            id: 'complete-evaluations',
            type: 'info',
            title: 'Complete Evaluations',
            description: `${pendingEvaluations} evaluation${pendingEvaluations > 1 ? 's' : ''} to complete`,
            count: pendingEvaluations,
            link: '/instructor/evaluations',
          });
        }
        if (pendingVehicleConfirmations > 0) {
          housekeepingTasks.push({
            id: 'confirm-vehicles',
            type: 'warning',
            title: 'Confirm Vehicles',
            description: `${pendingVehicleConfirmations} vehicle${pendingVehicleConfirmations > 1 ? 's' : ''} need confirmation`,
            count: pendingVehicleConfirmations,
            link: '/instructor/schedule',
          });
        }

        // Calculate stats (school-timezone aware)
        const upcomingClasses = classes.filter(
          (c) => !hasClassStarted(c) && c.status === "scheduled",
        );

        const completedEvaluations = evaluations.filter(
          (e) => e.signedOff,
        ).length;

        res.json({
          instructor,
          stats: {
            totalStudents: students.length,
            upcomingClasses: upcomingClasses.length,
            completedEvaluations,
            pendingEvaluations,
            totalClasses: classes.length,
            weeklyHours,
            weeklyNoShows,
            todaysStudentCount: todaysStudents.length,
          },
          todaysStudents,
          todaysClasses,
          housekeepingTasks,
          upcomingClasses: upcomingClasses.slice(0, 5),
          recentEvaluations: evaluations.slice(0, 5),
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching instructor dashboard:", error);
        res.status(500).json({ message: "Failed to fetch dashboard data" });
      }
    },
  );

  // Instructor's students
  app.get(
    "/api/instructor/students",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const students = await storage.getInstructorStudents(req.instructor.id);
        const hoursMap = await storage.getStudentsAttendedHours(students.map(s => s.id));
        const enriched = students.map(s => {
          const hours = hoursMap.get(s.id);
          return {
            ...s,
            theoryHoursCompleted: hours ? Math.round(hours.theoryHours * 10) / 10 : 0,
            practicalHoursCompleted: hours ? Math.round(hours.drivingHours * 10) / 10 : 0,
          };
        });
        res.json(enriched);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching instructor students:", error);
        res.status(500).json({ message: "Failed to fetch students" });
      }
    },
  );

  // Instructor's classes
  app.get(
    "/api/instructor/classes",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const classes = await storage.getInstructorClasses(req.instructor.id);
        res.json(classes);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching instructor classes:", error);
        res.status(500).json({ message: "Failed to fetch classes" });
      }
    },
  );

  // Instructor's evaluations
  app.get(
    "/api/instructor/evaluations",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const evaluations = await storage.getInstructorEvaluations(
          req.instructor.id,
        );
        res.json(evaluations);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching instructor evaluations:", error);
        res.status(500).json({ message: "Failed to fetch evaluations" });
      }
    },
  );

  // Get classes needing evaluation for instructor
  app.get(
    "/api/instructor/classes-needing-evaluation",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const classesNeedingEval = await storage.getInstructorClassesNeedingEvaluation(
          req.instructor.id,
        );
        res.json(classesNeedingEval);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching classes needing evaluation:", error);
        res.status(500).json({ message: "Failed to fetch classes" });
      }
    },
  );

  // Create evaluation by instructor
  app.post(
    "/api/instructor/evaluations",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;
        
        const evaluationData = {
          ...req.body,
          instructorId: instructor.id, // Ensure instructor ID is set
          // Automatically append instructor's signature from profile
          instructorSignature: instructor.digitalSignature || req.body.instructorSignature,
          signatureDate: new Date().toISOString().split('T')[0],
          signedOff: true,
        };

        // Validate required fields
        if (!evaluationData.studentId || !evaluationData.sessionType) {
          return res
            .status(400)
            .json({ message: "Student ID and session type are required" });
        }

        // Validate classId is provided
        if (!evaluationData.classId) {
          return res
            .status(400)
            .json({ message: "Class ID is required for evaluations" });
        }

        const evaluation = await storage.createEvaluation(evaluationData);
        res.json(evaluation);
      } catch (error) {
        captureRequestError(error);
        console.error("Error creating evaluation:", error);
        res.status(500).json({ message: "Failed to create evaluation" });
      }
    },
  );

  // Get specific student details for instructor
  app.get(
    "/api/instructor/students/:id",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const studentId = parseInt(req.params.id);
        const student = await storage.getStudent(studentId);

        if (!student) {
          return res.status(404).json({ message: "Student not found" });
        }

        // Check if this instructor is assigned to this student
        const instructorStudents = await storage.getInstructorStudents(
          req.instructor.id,
        );
        const isAssigned = instructorStudents.some((s) => s.id === studentId);

        if (!isAssigned) {
          return res.status(403).json({
            message: "Access denied - student not assigned to this instructor",
          });
        }

        // Get student evaluations
        const evaluations = await storage.getEvaluationsByStudent(studentId);

        res.json({
          student,
          evaluations: evaluations.filter(
            (e) => e.instructorId === req.instructor.id,
          ),
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching student details:", error);
        res.status(500).json({ message: "Failed to fetch student details" });
      }
    },
  );

  // Update instructor profile
  app.put(
    "/api/instructor/profile",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;
        const updateData = req.body;

        // Only allow instructors to update certain fields
        const allowedFields = [
          "phone",
          "emergencyContact",
          "emergencyPhone",
          "notes",
          "digitalSignature",
        ];
        const filteredData = Object.keys(updateData)
          .filter((key) => allowedFields.includes(key))
          .reduce((obj: any, key: string) => {
            obj[key] = updateData[key];
            return obj;
          }, {});

        const updated = await storage.updateInstructor(
          instructor.id,
          filteredData,
        );
        res.json(updated);
      } catch (error) {
        captureRequestError(error);
        console.error("Error updating instructor profile:", error);
        res.status(500).json({ message: "Failed to update profile" });
      }
    },
  );

  // Get instructor reminder settings
  app.get(
    "/api/instructor/reminder-settings",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;
        const settings = await storage.getInstructorReminderSettings(instructor.id);
        
        // Return default settings if none exist
        if (!settings) {
          return res.json({
            instructorId: instructor.id,
            availabilityReminderEnabled: true,
            reminderFrequency: "weekly",
            reminderDayOfWeek: 0,
            reminderTime: "09:00",
            emailEnabled: true,
            inAppEnabled: true,
          });
        }
        
        res.json(settings);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching reminder settings:", error);
        res.status(500).json({ message: "Failed to fetch reminder settings" });
      }
    },
  );

  // Update instructor reminder settings - uses insertInstructorReminderSettingsSchema from shared/schema.ts
  app.put(
    "/api/instructor/reminder-settings",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;
        
        // Validate with shared schema (partial update)
        const updateSchema = insertInstructorReminderSettingsSchema.partial().omit({ instructorId: true });
        const parseResult = updateSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({ 
            message: "Invalid reminder settings", 
            errors: parseResult.error.errors 
          });
        }
        
        const settings = parseResult.data;
        const updated = await storage.upsertInstructorReminderSettings(instructor.id, settings);
        res.json(updated);
      } catch (error) {
        captureRequestError(error);
        console.error("Error updating reminder settings:", error);
        res.status(500).json({ message: "Failed to update reminder settings" });
      }
    },
  );

  // Trigger availability reminder for testing (admin only)
  app.post(
    "/api/admin/trigger-availability-reminders",
    isAuthenticated,
    async (req: any, res) => {
      try {
        // Require admin or owner role
        const user = req.user;
        if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
          return res.status(403).json({ message: "Admin access required" });
        }
        
        const result = await notificationService.sendAvailabilityReminders();
        res.json(result);
      } catch (error) {
        captureRequestError(error);
        console.error("Error triggering reminders:", error);
        res.status(500).json({ message: "Failed to trigger reminders" });
      }
    },
  );

  // Confirm vehicle for a class
  app.post(
    "/api/instructor/classes/:classId/confirm-vehicle",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const classId = parseInt(req.params.classId);
        const instructor = req.instructor;

        // Get the class
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Verify instructor is assigned to this class
        if (classData.instructorId !== instructor.id) {
          return res.status(403).json({ message: "Access denied - not your class" });
        }

        // Confirm the vehicle
        await storage.confirmClassVehicle(classId);

        res.json({ success: true, message: "Vehicle confirmed successfully" });
      } catch (error) {
        captureRequestError(error);
        console.error("Error confirming vehicle:", error);
        res.status(500).json({ message: "Failed to confirm vehicle" });
      }
    },
  );

  // Confirm class assignment
  app.post(
    "/api/instructor/classes/:classId/confirm",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const classId = parseInt(req.params.classId);
        const instructor = req.instructor;

        // Get the class
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Verify instructor is assigned to this class
        if (classData.instructorId !== instructor.id) {
          return res.status(403).json({ message: "Access denied - not your class" });
        }

        // Confirm the class
        await storage.confirmClass(classId);

        res.json({ success: true, message: "Class confirmed successfully" });
      } catch (error) {
        captureRequestError(error);
        console.error("Error confirming class:", error);
        res.status(500).json({ message: "Failed to confirm class" });
      }
    },
  );

  // Mark class as completed (class was done)
  app.post(
    "/api/instructor/classes/:classId/complete",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const classId = parseInt(req.params.classId);
        const instructor = req.instructor;

        // Get the class
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Verify instructor is assigned to this class
        if (classData.instructorId !== instructor.id) {
          return res.status(403).json({ message: "Access denied - not your class" });
        }

        // Check that the class's scheduled start time has passed
        const completeBlock = attendanceStartGate(classData);
        if (completeBlock) {
          await logAttendanceAction({
            req, action: "mark_complete", outcome: "blocked",
            classId, instructorId: classData.instructorId,
            previousStatus: classData.status,
            blockReason: completeBlock.blockReason,
          });
          return res.status(400).json({ message: completeBlock.message });
        }

        // Update the class status to 'completed'
        await storage.updateClass(classId, { status: 'completed' });

        await logAttendanceAction({
          req, action: "mark_complete", outcome: "success",
          classId, instructorId: classData.instructorId,
          previousStatus: classData.status, newStatus: "completed",
        });

        res.json({ success: true, message: "Class marked as completed" });
      } catch (error) {
        captureRequestError(error);
        console.error("Error marking class as completed:", error);
        res.status(500).json({ message: "Failed to mark class as completed" });
      }
    },
  );

  // Get enrolled students for a class (for attendance)
  app.get(
    "/api/instructor/classes/:classId/students",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const classId = parseInt(req.params.classId);
        const instructor = req.instructor;

        // Get the class
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Verify instructor is assigned to this class
        if (classData.instructorId !== instructor.id) {
          return res.status(403).json({ message: "Access denied - not your class" });
        }

        // Get enrollments for this class
        const enrollments = await storage.getClassEnrollmentsByClass(classId);
        
        // Get student details for each enrollment
        const studentsWithAttendance = await Promise.all(
          enrollments.map(async (enrollment) => {
            const student = await storage.getStudent(enrollment.studentId!);
            return {
              enrollmentId: enrollment.id,
              studentId: enrollment.studentId,
              firstName: student?.firstName || 'Unknown',
              lastName: student?.lastName || 'Student',
              email: student?.email || '',
              attendanceStatus: enrollment.attendanceStatus || 'registered',
            };
          })
        );

        res.json({
          classData,
          students: studentsWithAttendance,
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error getting class students:", error);
        res.status(500).json({ message: "Failed to get class students" });
      }
    },
  );

  // Submit bulk attendance with instructor signature
  app.post(
    "/api/instructor/classes/:classId/attendance",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const classId = parseInt(req.params.classId);
        const instructor = req.instructor;
        const { attendance, signature } = req.body;

        // Validate input
        if (!attendance || !Array.isArray(attendance)) {
          return res.status(400).json({ message: "Attendance data is required" });
        }
        if (!signature) {
          return res.status(400).json({ message: "Instructor signature is required" });
        }

        // Get the class
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Verify instructor is assigned to this class
        if (classData.instructorId !== instructor.id) {
          return res.status(403).json({ message: "Access denied - not your class" });
        }

        // Check that the class's scheduled start time has passed
        const bulkBlock = attendanceStartGate(classData);
        if (bulkBlock) {
          await logAttendanceAction({
            req, action: "bulk_attendance", outcome: "blocked",
            classId, instructorId: classData.instructorId,
            previousStatus: classData.status,
            blockReason: bulkBlock.blockReason,
          });
          return res.status(400).json({ message: bulkBlock.message });
        }

        // Update attendance for each student
        for (const record of attendance) {
          const prevEnrollment = await storage.getClassEnrollment(record.enrollmentId);
          const newStatus = record.attended ? 'attended' : 'absent';
          await storage.updateClassEnrollment(record.enrollmentId, {
            attendanceStatus: newStatus,
          });
          await logAttendanceAction({
            req, action: "bulk_attendance", outcome: "success",
            classId, enrollmentId: record.enrollmentId,
            studentId: prevEnrollment?.studentId ?? null,
            instructorId: classData.instructorId,
            previousStatus: prevEnrollment?.attendanceStatus ?? null, newStatus,
          });
          // A missed in-car lesson frees the student's slot #1 — notify them
          // their remaining upcoming in-car booking (if any) is now next.
          // Only on a transition INTO absent for a driving class.
          if (
            newStatus === 'absent' &&
            prevEnrollment?.attendanceStatus !== 'absent' &&
            classData.classType === 'driving' &&
            prevEnrollment?.studentId
          ) {
            notifyInCarSlotPromotion(prevEnrollment.studentId).catch((err) => {
              captureRequestError(err);
              console.error("[in-car slots] Failed to send promotion email after bulk-attendance absence:", err);
            });
          }
          // Charge the no-show fee on the first absent transition (any class type).
          if (newStatus === 'absent' && prevEnrollment?.attendanceStatus !== 'absent' && prevEnrollment?.studentId) {
            chargeNoShowFee(prevEnrollment.studentId, classData, record.enrollmentId).catch((err) => {
              captureRequestError(err);
              console.error("[no-show fee] Failed to charge fee after bulk-attendance absence:", err);
            });
          }
        }

        // Mark the class as completed with the attendance signature
        await storage.updateClass(classId, { 
          status: 'completed',
          attendanceSignature: signature,
          attendanceSignedAt: new Date().toISOString(),
          attendanceSignedBy: instructor.id,
        });

        await logAttendanceAction({
          req, action: "mark_complete", outcome: "success",
          classId, instructorId: classData.instructorId,
          previousStatus: classData.status, newStatus: "completed",
          details: `Bulk attendance: ${attendance.filter((a: any) => a.attended).length} present, ${attendance.filter((a: any) => !a.attended).length} absent`,
        });

        res.json({ 
          success: true, 
          message: "Attendance submitted successfully",
          attendedCount: attendance.filter((a: any) => a.attended).length,
          absentCount: attendance.filter((a: any) => !a.attended).length,
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error submitting attendance:", error);
        res.status(500).json({ message: "Failed to submit attendance" });
      }
    },
  );

  // Get instructor hours and payroll data
  app.get(
    "/api/instructor/hours",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;
        const { startDate, endDate } = req.query;

        // Get all completed classes for this instructor
        const allClasses = await storage.getInstructorClasses(instructor.id);
        
        // Filter by date range if provided
        let filteredClasses = allClasses;
        if (startDate && endDate) {
          filteredClasses = allClasses.filter((c: any) => {
            return c.date >= startDate && c.date <= endDate;
          });
        }

        // Calculate statistics
        const completedClasses = filteredClasses.filter((c: any) => c.status === 'completed');
        const totalHours = completedClasses.reduce((sum: number, c: any) => sum + (c.duration || 0), 0) / 60; // Convert minutes to hours

        // Collect no-show student details from enrollments
        const noShowStudents: Array<{ studentId: number; firstName: string; lastName: string; email: string; classNumber: number; courseType: string; date: string; time: string; classId: number }> = [];
        for (const classItem of filteredClasses) {
          const enrollments = await storage.getClassEnrollmentsByClass(classItem.id);
          const noShowEnrollments = enrollments.filter((e: any) => e.attendanceStatus === 'no-show' && !e.cancelledAt);
          for (const enrollment of noShowEnrollments) {
            if (!enrollment.studentId) continue;
            const student = await storage.getStudent(enrollment.studentId);
            if (student) {
              noShowStudents.push({
                studentId: student.id,
                firstName: student.firstName,
                lastName: student.lastName,
                email: student.email,
                classNumber: classItem.classNumber,
                courseType: classItem.courseType,
                date: classItem.date,
                time: classItem.time,
                classId: classItem.id,
              });
            }
          }
        }

        // Class type breakdown (classified via classType with classNumber fallback; One-Off: driving lessons with lessonType='one_off')
        const theoryClasses = completedClasses.filter((c: any) => isTheoryClass(c.classType, c.classNumber));
        const regularDrivingClasses = completedClasses.filter((c: any) => !isTheoryClass(c.classType, c.classNumber) && c.lessonType !== 'one_off');
        const oneOffClasses = completedClasses.filter((c: any) => c.lessonType === 'one_off');
        
        const theoryHours = theoryClasses.reduce((sum: number, c: any) => sum + (c.duration || 0), 0) / 60;
        const drivingHours = regularDrivingClasses.reduce((sum: number, c: any) => sum + (c.duration || 0), 0) / 60;
        const oneOffHours = oneOffClasses.reduce((sum: number, c: any) => sum + (c.duration || 0), 0) / 60;

        // Group by date for daily breakdown
        const dailyBreakdown: any = {};
        completedClasses.forEach((c: any) => {
          if (!dailyBreakdown[c.date]) {
            dailyBreakdown[c.date] = {
              date: c.date,
              classes: [],
              totalHours: 0,
              lessonCount: 0
            };
          }
          dailyBreakdown[c.date].classes.push(c);
          dailyBreakdown[c.date].totalHours += (c.duration || 0) / 60;
          dailyBreakdown[c.date].lessonCount += 1;
        });

        // Group by week (starting Monday)
        const weeklyBreakdown: any = {};
        completedClasses.forEach((c: any) => {
          // Parse date as local time: split YYYY-MM-DD and create Date with local timezone
          const [year, month, day] = c.date.split('-').map(Number);
          const date = new Date(year, month - 1, day); // month is 0-indexed
          const weekStart = new Date(date);
          const dayOfWeek = date.getDay();
          const daysToMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1); // Days to subtract to get to Monday
          weekStart.setDate(date.getDate() - daysToMonday);
          // Format as YYYY-MM-DD
          const weekKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
          
          if (!weeklyBreakdown[weekKey]) {
            weeklyBreakdown[weekKey] = {
              weekStart: weekKey,
              classes: [],
              totalHours: 0,
              lessonCount: 0
            };
          }
          weeklyBreakdown[weekKey].classes.push(c);
          weeklyBreakdown[weekKey].totalHours += (c.duration || 0) / 60;
          weeklyBreakdown[weekKey].lessonCount += 1;
        });

        res.json({
          summary: {
            totalHours,
            completedLessons: completedClasses.length,
            noShows: noShowStudents.length,
            totalClasses: filteredClasses.length,
            theoryHours,
            theoryClasses: theoryClasses.length,
            drivingHours,
            drivingClasses: regularDrivingClasses.length,
            oneOffHours,
            oneOffClasses: oneOffClasses.length
          },
          daily: Object.values(dailyBreakdown).sort((a: any, b: any) => b.date.localeCompare(a.date)),
          weekly: Object.values(weeklyBreakdown).sort((a: any, b: any) => b.weekStart.localeCompare(a.weekStart)),
          classes: completedClasses,
          noShowStudents: noShowStudents.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
        });
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching instructor hours:", error);
        res.status(500).json({ message: "Failed to fetch hours data" });
      }
    },
  );

  // Request change to class schedule
  app.post(
    "/api/instructor/classes/:classId/request-change",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const classId = parseInt(req.params.classId);
        const instructor = req.instructor;
        const { reason, suggestedTime } = req.body;

        if (!reason) {
          return res.status(400).json({ message: "Reason is required" });
        }

        // Get the class
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Verify instructor is assigned to this class
        if (classData.instructorId !== instructor.id) {
          return res.status(403).json({ message: "Access denied - not your class" });
        }

        // Request the change
        await storage.requestClassChange(classId, reason, suggestedTime);

        // TODO: Send notification to admin about the change request
        // This will be implemented in task 5

        res.json({ success: true, message: "Change request submitted successfully" });
      } catch (error) {
        captureRequestError(error);
        console.error("Error requesting class change:", error);
        res.status(500).json({ message: "Failed to request class change" });
      }
    },
  );

  // Submit student evaluation
  app.post(
    "/api/instructor/evaluations",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;
        const { studentId, classId, ratings, comments } = req.body;

        // Validate required fields
        if (!studentId || !classId || !ratings) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        // Get the class to verify instructor and get details
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Verify instructor is assigned to this class
        if (classData.instructorId !== instructor.id) {
          return res.status(403).json({ message: "Access denied - not your class" });
        }

        // Ensure class is completed before allowing evaluation
        if (classData.status !== 'completed') {
          return res.status(400).json({ message: "Evaluations can only be submitted for completed classes" });
        }

        // Check if evaluation already exists for this class/student combo
        const existingEvals = await storage.getEvaluationsByStudent(studentId);
        const existingEval = existingEvals.find(e => e.classId === classId);
        
        if (existingEval) {
          return res.status(400).json({ message: "Evaluation already submitted for this class" });
        }

        // Calculate overall rating as average of all ratings
        const ratingValues = Object.values(ratings) as number[];
        const overallRating = Math.round(
          ratingValues.reduce((sum, r) => sum + r, 0) / ratingValues.length
        );

        // Create evaluation
        const evaluation = await storage.createEvaluation({
          studentId,
          instructorId: instructor.id,
          classId,
          evaluationDate: new Date().toISOString().split('T')[0],
          sessionType: 'in-car', // Assuming practical session
          ratings: JSON.stringify(ratings),
          overallRating,
          comments: comments || '',
          submittedAt: new Date(),
        });

        res.json({ success: true, evaluation });
      } catch (error) {
        captureRequestError(error);
        console.error("Error submitting evaluation:", error);
        res.status(500).json({ message: "Failed to submit evaluation" });
      }
    },
  );

  // Lesson Notes - Instructor creates internal notes after lessons
  app.get(
    "/api/instructor/lesson-notes",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;
        const notes = await storage.getLessonNotesByInstructor(instructor.id);
        res.json(notes);
      } catch (error) {
        captureRequestError(error);
        console.error("Error fetching lesson notes:", error);
        res.status(500).json({ message: "Failed to fetch lesson notes" });
      }
    },
  );

  app.post(
    "/api/instructor/lesson-notes",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;
        const { studentId, classId, lessonDate, lessonType, duration, notes, instructorFeedback, status } = req.body;

        // Validate required fields
        if (!studentId || !lessonDate || !lessonType || !duration || !notes) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        // Create lesson note
        const lessonNote = await storage.createLessonNote({
          studentId,
          instructorId: instructor.id,
          classId,
          lessonDate,
          lessonType,
          duration: parseInt(duration),
          notes,
          instructorFeedback: instructorFeedback || '',
          status: status || 'completed',
        });

        res.json({ success: true, lessonNote });
      } catch (error) {
        captureRequestError(error);
        console.error("Error creating lesson note:", error);
        res.status(500).json({ message: "Failed to create lesson note" });
      }
    },
  );

  app.put(
    "/api/instructor/lesson-notes/:id",
    isInstructorAuthenticated,
    async (req: any, res) => {
      try {
        const instructor = req.instructor;
        const noteId = parseInt(req.params.id);
        const { notes, instructorFeedback } = req.body;

        // Get existing note to verify instructor owns it
        const existingNote = await storage.getLessonNote(noteId);
        if (!existingNote) {
          return res.status(404).json({ message: "Lesson note not found" });
        }

        if (existingNote.instructorId !== instructor.id) {
          return res.status(403).json({ message: "Access denied - not your note" });
        }

        // Update lesson note
        const updated = await storage.updateLessonNote(noteId, {
          notes,
          instructorFeedback,
        });

        res.json({ success: true, lessonNote: updated });
      } catch (error) {
        captureRequestError(error);
        console.error("Error updating lesson note:", error);
        res.status(500).json({ message: "Failed to update lesson note" });
      }
    },
  );

  // PDF Download endpoint for reports
  app.get("/api/reports/download-pdf", authMiddleware, async (req, res) => {
    try {
      const puppeteer = await import("puppeteer");
      const { execSync } = await import("child_process");

      // Get the base URL from the request
      const protocol = req.protocol;
      const host = req.get("host") || "localhost:5000";
      const baseUrl = `${protocol}://${host}`;

      // Build the reports URL with query parameters
      const queryParams = new URLSearchParams();
      if (req.query.period)
        queryParams.set("period", req.query.period as string);
      if (req.query.startDate)
        queryParams.set("startDate", req.query.startDate as string);
      if (req.query.endDate)
        queryParams.set("endDate", req.query.endDate as string);
      if (req.query.locationId)
        queryParams.set("locationId", req.query.locationId as string);

      const reportsUrl = `${baseUrl}/reports?${queryParams.toString()}`;

      console.log("Generating PDF from URL:", reportsUrl);

      // Resolve Chromium executable with fallback logic
      let chromiumPath: string | undefined = process.env.CHROMIUM_PATH;

      if (!chromiumPath) {
        // Try common executable names
        const candidates = [
          "chromium-browser",
          "chromium",
          "google-chrome-stable",
          "google-chrome",
        ];
        for (const candidate of candidates) {
          try {
            chromiumPath = execSync(`which ${candidate}`, {
              encoding: "utf8",
            }).trim();
            if (chromiumPath) {
              console.log(`Found Chromium at: ${chromiumPath}`);
              break;
            }
          } catch {
            // Continue to next candidate
          }
        }
      }

      // If no system Chromium found, try Puppeteer's bundled browser
      if (!chromiumPath) {
        try {
          chromiumPath = puppeteer.executablePath();
          console.log(`Using Puppeteer bundled Chromium at: ${chromiumPath}`);
        } catch (error) {
          captureRequestError(error);
          console.error("Could not resolve Chromium path:", error);
          throw new Error(
            "Could not find Chromium executable. Please install chromium or set CHROMIUM_PATH environment variable.",
          );
        }
      } else {
        console.log(`Using Chromium executable: ${chromiumPath}`);
      }

      // Launch browser
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: chromiumPath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      const page = await browser.newPage();

      // Forward cookies from the original request to maintain authentication
      const cookies = req.get("cookie");
      if (cookies) {
        const cookieArray = cookies.split(";").map((cookie) => {
          const [name, ...rest] = cookie.trim().split("=");
          return {
            name: name,
            value: rest.join("="),
            domain: host.split(":")[0],
            path: "/",
          };
        });
        await page.setCookie(...cookieArray);
      }

      // Set viewport for better rendering
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2,
      });

      // Navigate to reports page
      await page.goto(reportsUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Wait for animations/charts to render
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Generate PDF
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "20px",
          right: "20px",
          bottom: "20px",
          left: "20px",
        },
      });

      await browser.close();

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `morty-driving-school-report-${timestamp}.pdf`;

      // Set headers and send PDF
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(pdf);

      console.log("PDF generated successfully:", filename);
    } catch (error) {
      captureRequestError(error);
      console.error("Error generating PDF:", error);
      res.status(500).json({ message: "Failed to generate PDF report" });
    }
  });

  // --------------------------------------------
  // NOTIFICATION API ENDPOINTS
  // --------------------------------------------

  // Get notifications for a student
  app.get("/api/student/notifications", isStudentAuthenticated, async (req, res) => {
    try {
      const studentId = (req.session as any).studentId;
      if (!studentId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const notifications = await notificationService.getUnreadNotifications('student', String(studentId));
      res.json(notifications);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching student notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  // Mark all notifications as read for student (must be before :id route)
  app.post("/api/student/notifications/mark-all-read", isStudentAuthenticated, async (req, res) => {
    try {
      const studentId = (req.session as any).studentId;
      if (!studentId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const unreadDeliveries = await db.select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(and(
          eq(notificationDeliveries.recipientType, 'student'),
          eq(notificationDeliveries.recipientId, String(studentId)),
          eq(notificationDeliveries.channel, 'in_app'),
          not(eq(notificationDeliveries.status, 'read'))
        ));

      if (unreadDeliveries.length > 0) {
        await db.update(notificationDeliveries)
          .set({ status: 'read', readAt: new Date() })
          .where(and(
            eq(notificationDeliveries.recipientType, 'student'),
            eq(notificationDeliveries.recipientId, String(studentId)),
            eq(notificationDeliveries.channel, 'in_app'),
            not(eq(notificationDeliveries.status, 'read'))
          ));
      }

      res.json({ success: true, count: unreadDeliveries.length });
    } catch (error) {
      captureRequestError(error);
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ message: "Failed to mark all notifications as read" });
    }
  });

  // Mark notification as read for student
  app.post("/api/student/notifications/:id/read", isStudentAuthenticated, async (req, res) => {
    try {
      const studentId = (req.session as any).studentId;
      if (!studentId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const deliveryId = parseInt(req.params.id);
      if (isNaN(deliveryId)) {
        return res.status(400).json({ message: "Invalid notification ID" });
      }

      // Verify the notification belongs to this student
      const delivery = await db.select()
        .from(notificationDeliveries)
        .where(and(
          eq(notificationDeliveries.id, deliveryId),
          eq(notificationDeliveries.recipientType, 'student'),
          eq(notificationDeliveries.recipientId, String(studentId))
        ))
        .limit(1);

      if (delivery.length === 0) {
        return res.status(404).json({ message: "Notification not found" });
      }

      await notificationService.markNotificationRead(deliveryId);
      res.json({ success: true });
    } catch (error) {
      captureRequestError(error);
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  // Get notification preferences for student
  app.get("/api/student/notification-preferences", isStudentAuthenticated, async (req, res) => {
    try {
      const studentId = (req.session as any).studentId;
      if (!studentId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const notificationTypes = ['upcoming_class', 'schedule_change', 'payment_due', 'payment_received', 'policy_override'];
      const preferences = [];
      
      for (const type of notificationTypes) {
        const prefs = await db.select()
          .from(notificationPreferences)
          .where(and(
            eq(notificationPreferences.recipientType, 'student'),
            eq(notificationPreferences.recipientId, String(studentId)),
            eq(notificationPreferences.notificationType, type)
          ))
          .limit(1);
        
        preferences.push({
          notificationType: type,
          emailEnabled: prefs[0]?.emailEnabled ?? true,
          inAppEnabled: prefs[0]?.inAppEnabled ?? true,
        });
      }
      
      res.json(preferences);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching notification preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  // Update notification preferences for student
  app.put("/api/student/notification-preferences", isStudentAuthenticated, async (req, res) => {
    try {
      const studentId = (req.session as any).studentId;
      if (!studentId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const { preferences } = req.body;
      await notificationService.updateNotificationPreferences('student', String(studentId), preferences);
      res.json({ success: true });
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  // Get notifications for a parent
  app.get("/api/parent/notifications", isParentAuthenticated, async (req, res) => {
    try {
      const parentId = (req.session as any).parentId;
      if (!parentId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const notifications = await notificationService.getUnreadNotifications('parent', String(parentId));
      res.json(notifications);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching parent notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  // Mark notification as read for parent
  app.post("/api/parent/notifications/:id/read", isParentAuthenticated, async (req, res) => {
    try {
      const parentId = (req.session as any).parentId;
      if (!parentId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const deliveryId = parseInt(req.params.id);
      if (isNaN(deliveryId)) {
        return res.status(400).json({ message: "Invalid notification ID" });
      }

      // Verify the notification belongs to this parent
      const delivery = await db.select()
        .from(notificationDeliveries)
        .where(and(
          eq(notificationDeliveries.id, deliveryId),
          eq(notificationDeliveries.recipientType, 'parent'),
          eq(notificationDeliveries.recipientId, String(parentId))
        ))
        .limit(1);

      if (delivery.length === 0) {
        return res.status(404).json({ message: "Notification not found" });
      }

      await notificationService.markNotificationRead(deliveryId);
      res.json({ success: true });
    } catch (error) {
      captureRequestError(error);
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  // Get notification preferences for parent
  app.get("/api/parent/notification-preferences", isParentAuthenticated, async (req, res) => {
    try {
      const parentId = (req.session as any).parentId;
      if (!parentId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const notificationTypes = ['upcoming_class', 'schedule_change', 'payment_due', 'payment_received', 'policy_override'];
      const preferences = [];
      
      for (const type of notificationTypes) {
        const prefs = await db.select()
          .from(notificationPreferences)
          .where(and(
            eq(notificationPreferences.recipientType, 'parent'),
            eq(notificationPreferences.recipientId, String(parentId)),
            eq(notificationPreferences.notificationType, type)
          ))
          .limit(1);
        
        preferences.push({
          notificationType: type,
          emailEnabled: prefs[0]?.emailEnabled ?? true,
          inAppEnabled: prefs[0]?.inAppEnabled ?? true,
        });
      }
      
      res.json(preferences);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching notification preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  // Update notification preferences for parent
  app.put("/api/parent/notification-preferences", isParentAuthenticated, async (req, res) => {
    try {
      const parentId = (req.session as any).parentId;
      if (!parentId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const { preferences } = req.body;
      await notificationService.updateNotificationPreferences('parent', String(parentId), preferences);
      res.json({ success: true });
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  // Get notifications for staff/admin
  app.get("/api/admin/notifications", authMiddleware, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const notifications = await notificationService.getUnreadNotifications('staff', String(userId));
      res.json(notifications);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching admin notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  // Mark notification as read for staff/admin
  app.post("/api/admin/notifications/:id/read", authMiddleware, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const deliveryId = parseInt(req.params.id);
      if (isNaN(deliveryId)) {
        return res.status(400).json({ message: "Invalid notification ID" });
      }

      // Verify the notification belongs to this staff member
      const delivery = await db.select()
        .from(notificationDeliveries)
        .where(and(
          eq(notificationDeliveries.id, deliveryId),
          eq(notificationDeliveries.recipientType, 'staff'),
          eq(notificationDeliveries.recipientId, String(userId))
        ))
        .limit(1);

      if (delivery.length === 0) {
        return res.status(404).json({ message: "Notification not found" });
      }

      await notificationService.markNotificationRead(deliveryId);
      res.json({ success: true });
    } catch (error) {
      captureRequestError(error);
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  // Send test notification (admin only)
  app.post("/api/admin/notifications/test", authMiddleware, async (req, res) => {
    try {
      const { recipientType, recipientId, type, title, message } = req.body;
      
      let recipients: notificationService.NotificationRecipient[] = [];
      
      if (recipientType === 'student') {
        recipients = await notificationService.getStudentRecipients(parseInt(recipientId));
      } else {
        recipients = await notificationService.getAdminRecipients();
      }
      
      if (recipients.length === 0) {
        return res.status(400).json({ message: "No recipients found" });
      }
      
      const notificationId = await notificationService.enqueueNotification({
        type: type || 'upcoming_class',
        title: title || 'Test Notification',
        message: message || 'This is a test notification from the admin panel.',
        recipients,
        triggeredBy: (req.session as any).userId,
      });
      
      res.json({ success: true, notificationId });
    } catch (error) {
      captureRequestError(error);
      console.error("Error sending test notification:", error);
      res.status(500).json({ message: "Failed to send test notification" });
    }
  });

  // ─── Admin User Management ───────────────────────────────────────────────
  app.get("/api/admin/users", authMiddleware, async (req, res) => {
    try {
      const allUsers = await storage.getUsers();
      // Never return password hashes to the client
      const safe = allUsers.map(({ password: _, ...u }) => u);
      res.json(safe);
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/users", authMiddleware, async (req, res) => {
    try {
      const { email, firstName, lastName, role, password, canOverrideBookingPolicies } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: "A user with that email already exists" });
      const bcrypt = await import("bcryptjs");
      const hashed = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        email,
        firstName: firstName || "",
        lastName: lastName || "",
        role: role || "admin",
        password: hashed,
        canOverrideBookingPolicies: canOverrideBookingPolicies ?? false,
      } as any);
      const { password: _, ...safe } = user as any;
      res.status(201).json(safe);
    } catch (error) {
      captureRequestError(error);
      console.error("Create user error:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.put("/api/admin/users/:id", authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { firstName, lastName, email, role, password, canOverrideBookingPolicies } = req.body;
      const updateData: any = { firstName, lastName, email, role, canOverrideBookingPolicies };
      if (password) {
        const bcrypt = await import("bcryptjs");
        updateData.password = await bcrypt.hash(password, 10);
      }
      const updated = await storage.updateAdminUser(id, updateData);
      if (!updated) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safe } = updated as any;
      res.json(safe);
    } catch (error) {
      captureRequestError(error);
      console.error("Update user error:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const currentUserId = (req.session as any)?.userId;
      if (id === currentUserId) return res.status(400).json({ message: "You cannot delete your own account" });
      await storage.deleteAdminUser(id);
      res.json({ success: true });
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // ─── Server Error Logs (admin/owner only) ────────────────────────────────
  app.get("/api/admin/error-logs", requireAdmin, async (req, res) => {
    try {
      const isDownload = req.query.download === "true";
      // Downloads export the FULL filtered list; the list view stays paginated.
      const limit = isDownload
        ? undefined
        : Math.min(parseInt(String(req.query.limit)) || 50, 500);
      const offset = isDownload ? 0 : parseInt(String(req.query.offset)) || 0;
      const path = req.query.path ? String(req.query.path) : undefined;
      const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
      const endDate = req.query.endDate ? String(req.query.endDate) : undefined;

      const result = await storage.getErrorLogs({ path, startDate, endDate, limit, offset });

      if (req.query.download === "true") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="error-logs-${new Date().toISOString().slice(0, 10)}.json"`,
        );
        return res.send(JSON.stringify(result.logs, null, 2));
      }

      res.json(result);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching error logs:", error);
      res.status(500).json({ message: "Failed to fetch error logs" });
    }
  });

  app.get("/api/admin/error-logs/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid error log id" });
      const log = await storage.getErrorLog(id);
      if (!log) return res.status(404).json({ message: "Error log not found" });

      if (req.query.download === "true") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="error-log-${id}.json"`);
        return res.send(JSON.stringify(log, null, 2));
      }

      res.json(log);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching error log:", error);
      res.status(500).json({ message: "Failed to fetch error log" });
    }
  });

  // ─── AI Assistant Q&A Logs (admin/owner only) ─────────────────────────────
  app.get("/api/admin/assistant-logs", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit)) || 50, 500);
      const offset = parseInt(String(req.query.offset)) || 0;
      const role = req.query.role ? String(req.query.role) : undefined;
      const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
      const endDate = req.query.endDate ? String(req.query.endDate) : undefined;

      const result = await storage.getAssistantLogs({ role, startDate, endDate, limit, offset });
      res.json(result);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching assistant logs:", error);
      res.status(500).json({ message: "Failed to fetch assistant logs" });
    }
  });

  // AI process Q&A assistant (students, parents, instructors)
  app.post("/api/assistant/chat", isPortalUserAuthenticated, async (req, res) => {
    try {
      await handleAssistantChat(req, res);
    } catch (error) {
      captureRequestError(error);
      console.error("Assistant chat error:", error);
      res.status(500).json({ message: "The assistant ran into a problem. Please try again." });
    }
  });

  // ─── Bug Reports ──────────────────────────────────────────────────────────
  // Any logged-in user (staff, student, instructor, parent) can submit.
  // Resolves the submitter from whichever auth identity is present.
  const resolveAnyUser = async (req: any): Promise<{
    type: string;
    id: string;
    name: string;
    email: string;
    role: string;
  } | null> => {
    const session = req.session as any;

    // Staff (admin portal) session
    const staffId = session?.userId;
    if (staffId) {
      const user = await storage.getUser(staffId);
      if (user) {
        return {
          type: "staff",
          id: String(user.id),
          name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Staff",
          email: user.email || "",
          role: user.role || "staff",
        };
      }
    }

    // Instructor session
    const instructorId = session?.instructorId;
    if (instructorId) {
      const instructor = await storage.getInstructor(instructorId);
      if (instructor && instructor.status === "active") {
        return {
          type: "instructor",
          id: String(instructor.id),
          name: `${instructor.firstName} ${instructor.lastName}`,
          email: instructor.email,
          role: "instructor",
        };
      }
    }

    // Parent session
    const parentId = session?.parentId;
    if (parentId) {
      const parent = await storage.getParent(parentId);
      if (parent && parent.accountStatus === "active") {
        return {
          type: "parent",
          id: String(parent.id),
          name: `${parent.firstName} ${parent.lastName}`,
          email: parent.email,
          role: "parent",
        };
      }
    }

    // Student: session cookie or Bearer token
    let studentId: number | null = session?.studentId ?? null;
    if (!studentId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const { verifyStudentToken } = await import("./student-auth");
        studentId = verifyStudentToken(authHeader.substring(7));
      }
    }
    if (studentId) {
      const student = await storage.getStudent(studentId);
      if (student && student.accountStatus === "active") {
        return {
          type: "student",
          id: String(student.id),
          name: `${student.firstName} ${student.lastName}`,
          email: student.email,
          role: "student",
        };
      }
    }

    return null;
  };

  const bugReportBodySchema = z.object({
    category: z.enum(["technical_support", "billing"]),
    description: z.string().trim().min(1, "Description is required").max(5000),
    pageUrl: z.string().max(2000).optional(),
  });

  app.post("/api/bug-reports", async (req: any, res) => {
    try {
      const submitter = await resolveAnyUser(req);
      if (!submitter) {
        return res.status(401).json({ message: "You must be logged in to submit a bug report" });
      }

      const parsed = bugReportBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid bug report" });
      }
      const { category, description, pageUrl } = parsed.data;

      const report = await storage.createBugReport({
        category,
        description,
        submitterType: submitter.type,
        submitterId: submitter.id,
        submitterName: submitter.name,
        submitterEmail: submitter.email,
        submitterRole: submitter.role,
        pageUrl: pageUrl || null,
      });

      // Email failure must never fail the save — log it instead.
      try {
        const sent = await notificationService.sendBugReportEmail({
          category,
          description,
          submitterName: submitter.name,
          submitterEmail: submitter.email,
          submitterRole: submitter.role,
          pageUrl: pageUrl || "",
        });
        if (!sent) {
          console.error(`[bug-report] Email delivery failed for bug report #${report.id}`);
        }
      } catch (emailError) {
        console.error(`[bug-report] Email delivery error for bug report #${report.id}:`, emailError);
      }

      res.status(201).json({ success: true, id: report.id });
    } catch (error) {
      captureRequestError(error);
      console.error("Error submitting bug report:", error);
      res.status(500).json({ message: "Failed to submit bug report" });
    }
  });

  app.get("/api/admin/bug-reports", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit)) || 50, 500);
      const offset = parseInt(String(req.query.offset)) || 0;
      const statusParam = String(req.query.status || "");
      const status = statusParam === "open" || statusParam === "resolved" ? statusParam : undefined;
      const result = await storage.getBugReports({ limit, offset, status });
      res.json(result);
    } catch (error) {
      captureRequestError(error);
      console.error("Error fetching bug reports:", error);
      res.status(500).json({ message: "Failed to fetch bug reports" });
    }
  });

  app.patch("/api/admin/bug-reports/:id/status", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid bug report id" });
      }
      const status = String(req.body?.status || "");
      if (status !== "open" && status !== "resolved") {
        return res.status(400).json({ message: "Status must be 'open' or 'resolved'" });
      }
      const updated = await storage.updateBugReportStatus(id, status);
      if (!updated) {
        return res.status(404).json({ message: "Bug report not found" });
      }
      res.json(updated);
    } catch (error) {
      captureRequestError(error);
      console.error("Error updating bug report status:", error);
      res.status(500).json({ message: "Failed to update bug report status" });
    }
  });


  // ─────────────────────────────────────────────────────────────────────────
  // Task 272: In-Car #12/13 combined-session pairing routes.
  //
  // Students queue, respond to offers, and confirm attendance. Admins and
  // instructors view the queue overview, force pairings, requeue students,
  // and convert a session to solo when a partner does not show. All ownership
  // and eligibility checks live in the pairing service; these routes are thin.
  // ─────────────────────────────────────────────────────────────────────────

  // ── Student: current pairing status ───────────────────────────────────────
  app.get(
    "/api/student/lesson-pairing/status",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const status = await getStudentPairingStatus(req.student.id);
        res.json(status);
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error fetching status:", error);
        res.status(500).json({ message: "Failed to fetch lesson-pairing status" });
      }
    },
  );

  // ── Student: join the pairing queue ───────────────────────────────────────
  app.post(
    "/api/student/lesson-pairing/queue",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const result = await joinCombinedQueue({ studentId: req.student.id });
        if (!result.success) {
          return res.status(400).json({ message: result.reason ?? "Unable to join pairing queue." });
        }
        res.json(result);
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error joining queue:", error);
        res.status(500).json({ message: "Failed to join pairing queue" });
      }
    },
  );

  // ── Student: leave the pairing queue ──────────────────────────────────────
  app.delete(
    "/api/student/lesson-pairing/queue",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const result = await leaveCombinedQueue({ studentId: req.student.id });
        if (!result.success) {
          return res.status(400).json({ message: result.reason ?? "Unable to leave pairing queue." });
        }
        res.json(result);
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error leaving queue:", error);
        res.status(500).json({ message: "Failed to leave pairing queue" });
      }
    },
  );

  // ── Student: respond to a pairing offer (accept | decline) ────────────────
  app.post(
    "/api/student/lesson-pairing/offers/:offerId/respond",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const offerId = parseInt(req.params.offerId);
        if (!Number.isInteger(offerId) || offerId <= 0) {
          return res.status(400).json({ message: "Invalid offer id" });
        }
        const action = String(req.body?.action || "");
        if (action !== "accept" && action !== "decline") {
          return res.status(400).json({ message: "action must be 'accept' or 'decline'" });
        }
        const result = await respondToOffer({
          offerId,
          studentId: req.student.id,
          response: action,
        });
        if (!result.success) {
          return res.status(400).json({ message: result.reason ?? "Unable to respond to offer." });
        }
        res.json(result);
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error responding to offer:", error);
        res.status(500).json({ message: "Failed to respond to offer" });
      }
    },
  );

  // ── Student: respond to a session confirmation (confirm | decline) ────────
  app.post(
    "/api/student/lesson-pairing/confirmations/:confirmationId/respond",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const confirmationId = parseInt(req.params.confirmationId);
        if (!Number.isInteger(confirmationId) || confirmationId <= 0) {
          return res.status(400).json({ message: "Invalid confirmation id" });
        }
        const action = String(req.body?.action || "");
        if (action !== "confirm" && action !== "decline") {
          return res.status(400).json({ message: "action must be 'confirm' or 'decline'" });
        }
        const result = await respondToConfirmation({
          confirmationId,
          studentId: req.student.id,
          response: action,
        });
        if (!result.success) {
          return res.status(400).json({ message: result.reason ?? "Unable to respond to confirmation." });
        }
        res.json(result);
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error responding to confirmation:", error);
        res.status(500).json({ message: "Failed to respond to confirmation" });
      }
    },
  );

  // ── Admin/Instructor: pairing queue overview ──────────────────────────────
  app.get(
    "/api/lesson-pairing/admin",
    isAdminOrInstructor,
    async (_req: any, res) => {
      try {
        const overview = await getAdminPairingOverview();
        res.json(overview);
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error fetching admin overview:", error);
        res.status(500).json({ message: "Failed to fetch pairing overview" });
      }
    },
  );

  // ── Admin/Instructor: pairing audit history (per student or per class) ────
  app.get(
    "/api/lesson-pairing/admin/history",
    isAdminOrInstructor,
    async (req: any, res) => {
      try {
        const rawStudentId = req.query?.studentId;
        const rawClassId = req.query?.classId;
        const rawLimit = req.query?.limit;

        let studentId: number | undefined;
        if (rawStudentId != null && rawStudentId !== "") {
          studentId = parseInt(String(rawStudentId));
          if (!Number.isInteger(studentId) || studentId <= 0) {
            return res.status(400).json({ message: "Invalid studentId" });
          }
        }
        let classId: number | undefined;
        if (rawClassId != null && rawClassId !== "") {
          classId = parseInt(String(rawClassId));
          if (!Number.isInteger(classId) || classId <= 0) {
            return res.status(400).json({ message: "Invalid classId" });
          }
        }
        let limit: number | undefined;
        if (rawLimit != null && rawLimit !== "") {
          limit = parseInt(String(rawLimit));
          if (!Number.isInteger(limit) || limit <= 0) {
            return res.status(400).json({ message: "Invalid limit" });
          }
        }

        const events = await getPairingAuditHistory({ studentId, classId, limit });
        res.json({ events });
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error fetching pairing history:", error);
        res.status(500).json({ message: "Failed to fetch pairing history" });
      }
    },
  );

  // ── Admin/Instructor: manually pair a waiting student into a class slot ───
  app.post(
    "/api/lesson-pairing/admin/manual-pair",
    isAdminOrInstructor,
    async (req: any, res) => {
      try {
        // The service pairs a waiting student into a canonical combined class
        // slot: it needs the class id and the waiting student's id.
        const classId = parseInt(String(req.body?.classId ?? req.body?.pairedSessionId));
        const waitingStudentId = parseInt(String(req.body?.waitingStudentId ?? req.body?.studentId));
        if (!Number.isInteger(classId) || classId <= 0) {
          return res.status(400).json({ message: "Invalid classId" });
        }
        if (!Number.isInteger(waitingStudentId) || waitingStudentId <= 0) {
          return res.status(400).json({ message: "Invalid studentId" });
        }
        const actor = req.admin ?? req.instructor ?? req.user;
        const result = await manualPair({
          classId,
          waitingStudentId,
          actorId: actor?.id != null ? String(actor.id) : undefined,
          actorRole: req.instructor ? "instructor" : "admin",
        });
        if (!result.success) {
          return res.status(400).json({ message: result.reason ?? "Unable to pair students." });
        }
        res.json(result);
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error manually pairing students:", error);
        res.status(500).json({ message: "Failed to pair students" });
      }
    },
  );

  // ── Admin/Instructor: requeue a student's queue entry ─────────────────────
  app.post(
    "/api/lesson-pairing/admin/requeue",
    isAdminOrInstructor,
    async (req: any, res) => {
      try {
        const queueEntryId = parseInt(String(req.body?.queueEntryId));
        if (!Number.isInteger(queueEntryId) || queueEntryId <= 0) {
          return res.status(400).json({ message: "Invalid queueEntryId" });
        }
        const actor = req.admin ?? req.instructor ?? req.user;
        const result = await requeueStudent({
          queueEntryId,
          actorId: actor?.id != null ? String(actor.id) : undefined,
          actorRole: req.instructor ? "instructor" : "admin",
        });
        if (!result.success) {
          return res.status(400).json({ message: result.reason ?? "Unable to requeue student." });
        }
        res.json(result);
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error requeueing student:", error);
        res.status(500).json({ message: "Failed to requeue student" });
      }
    },
  );

  // ── Admin/Instructor: convert present student to a solo lesson ────────────
  app.post(
    "/api/lesson-pairing/sessions/:pairedSessionId/convert",
    isAdminOrInstructor,
    async (req: any, res) => {
      try {
        const pairedSessionId = parseInt(req.params.pairedSessionId);
        if (!Number.isInteger(pairedSessionId) || pairedSessionId <= 0) {
          return res.status(400).json({ message: "Invalid pairedSessionId" });
        }
        const presentEnrollmentId = parseInt(String(req.body?.presentEnrollmentId));
        if (!Number.isInteger(presentEnrollmentId) || presentEnrollmentId <= 0) {
          return res.status(400).json({ message: "Invalid presentEnrollmentId" });
        }
        const targetLessonNumber = parseInt(String(req.body?.targetLessonNumber));
        if (targetLessonNumber !== 11 && targetLessonNumber !== 14) {
          return res.status(400).json({ message: "targetLessonNumber must be 11 or 14" });
        }
        const actor = req.admin ?? req.instructor ?? req.user;
        const result = await convertPresentStudentToSolo({
          pairedSessionId,
          presentEnrollmentId,
          targetSessionNumber: targetLessonNumber,
          actorId: actor?.id != null ? String(actor.id) : undefined,
          actorRole: req.instructor ? "instructor" : "admin",
        });
        if (!result.success) {
          return res.status(400).json({ message: result.reason ?? "Unable to convert session." });
        }
        res.json(result);
      } catch (error) {
        captureRequestError(error);
        console.error("[lesson-pairing] Error converting to solo session:", error);
        res.status(500).json({ message: "Failed to convert to solo session" });
      }
    },
  );

  // Catch-all for unmatched API routes: return 404 JSON instead of falling
  // through to the SPA handler (which would return 200 with HTML and make
  // callers believe the request succeeded).
  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "API endpoint not found" });
  });

  const httpServer = createServer(app);
  return httpServer;
}
