/**
 * In-Car 12/13 Combined Auto-Pairing Queue Service  (Task 272 revised)
 *
 * ONE queue for the combined In-Car 12/13 session.
 *
 * Canonical class: auto / driving / classNumber=12 / duration=120 / maxStudents=2.
 * Direct booking of In-Car #13 is blocked in shared/bookingRules.ts.
 *
 * Lifecycle
 * ─────────
 *   bookCombinedSlot(studentId, classId)
 *     → student enrolled in the class (classEnrollments, status=registered)
 *     → queue entry status = booked_first
 *     → offer sent to next 'waiting' student in the queue
 *
 *   respondToOffer(offerId, 'accept')
 *     → student 2 enrolled in same class
 *     → incarPairedSessions row created (status=paired)
 *     → both queue entries → status=paired
 *
 *   respondToOffer(offerId, 'decline' | expired)
 *     → student 2 queue entry → back to 'waiting'
 *     → next waiting candidate is offered the seat (class_id unchanged)
 *     → student 1 queue entry stays 'booked_first'
 *
 *   No partner before confirmation horizon
 *     → booked student enrollment cancelled (soft-delete)
 *     → queue entry → status=deferred (retains priority / queue position)
 *     → notification to student + office
 *
 *   Confirmation window (~24 h before class, waking hours America/Toronto)
 *     → incarSessionConfirmations rows created
 *     → respondToConfirmation(id, 'confirm' | 'decline')
 *     → both confirmed → pairedSession.status = confirmed
 *     → decline → pair dissolved; declining student re-queued; remaining
 *       student's enrollment stays active, new offer sent to next candidate
 *
 *   completeSession (via processPairingLifecycle when class marked attended)
 *     → both queue entries → completed
 *     → pairedSession.status = completed
 *     → attendance counted as BOTH In-Car 12 AND 13 for both students
 *       (via isCombined1213Class in buildCompletedClasses — no extra rows)
 *
 *   Day-of solo conversion (convertPresentStudentToSolo)
 *     → creates NEW consecutive 60-min classes + enrollments for the present
 *       student (In-Car 11 followed by In-Car 14)
 *     → present student queue entry → converted_solo
 *     → absent student enrollment kept (no-show fee charged separately)
 *     → absent student queue entry → re-queued back to 'waiting'
 *
 * Concurrent safety
 * ─────────────────
 *   All mutations lock the involved student rows with pg_advisory_xact_lock
 *   using a stable namespace. Student IDs are always locked in sorted order
 *   to prevent deadlocks.
 *
 * Exported API (consumed by routes.ts — must not be renamed)
 * ─────────────────────────────────────────────────────────
 *   checkEligibility, bookCombinedSlot, joinCombinedQueue, leaveCombinedQueue,
 *   getStudentPairingStatus, getAdminPairingOverview,
 *   respondToOffer (replaces acceptOffer + declineOffer),
 *   respondToConfirmation (replaces confirmSession + declineConfirmation),
 *   manualPair, requeueStudent, convertPresentStudentToSolo,
 *   processPairingLifecycle,
 *   -- legacy aliases kept for routes.ts back-compat --
 *   enqueueStudent, getQueue, getPendingOffer, acceptOffer, declineOffer,
 *   confirmSession, declineConfirmation, pairStudents, convertToSoloLesson,
 *   getActivePairedSessions, getPendingConfirmations,
 */

import { db } from "../db";
import type { DbTx } from "../storage";
import { storage } from "../storage";
import {
  incarPairingQueue,
  incarPairedSessions,
  incarPairingOffers,
  incarSessionConfirmations,
  incarPairingAudit,
  students,
  classes,
  classEnrollments,
  attendanceAuditLogs,
} from "@shared/schema";
import type {
  IncarPairingQueue,
  IncarPairedSession,
  IncarPairingOffer,
  IncarSessionConfirmation,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  inArray,
  isNull,
  not,
  lt,
  sql,
  asc,
  desc,
} from "drizzle-orm";
import { SCHOOL_TIMEZONE, getClassStartTime } from "./class-time";
import {
  enqueueNotification,
  getStudentRecipients,
  getOfficeRecipients,
} from "./notifications";
import {
  enrollmentCountsAsCompleted,
  isCombined1213Class,
} from "@shared/bookingRules";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Student 2 has 24 h to respond to a pairing offer. */
export const OFFER_DEADLINE_HOURS = 24;

/** The combined 12/13 session is always represented as session number 12. */
export type SharedSessionNumber = 12;

/** Earliest waking hour (school-local, inclusive) for confirmation sends. */
const WAKING_HOUR_START = 8;
/** Latest waking hour (school-local, exclusive) for confirmation sends. */
const WAKING_HOUR_END = 21;

/** Hours before class at which confirmation requests are sent. */
export const CONFIRMATION_HOURS_BEFORE = 24;

/** Advisory lock namespace (arbitrary, must not collide with booking-validation). */
const LOCK_NS = 823002;
/** Shared with withStudentBookingLock; always acquired before LOCK_NS. */
const BOOKING_LOCK_NS = 823001;

async function acquireStudentMutationLocks(tx: DbTx, studentIds: number[]) {
  const sorted = Array.from(new Set(studentIds)).sort((a, b) => a - b);
  for (const sid of sorted) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NS}, ${sid})`);
  }
  for (const sid of sorted) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_NS}, ${sid})`);
  }
}

/**
 * One-query proof for the Auto Phase 4 #11/#14 gate. Only pending/accepted
 * offers tied to the strict canonical combined class count; terminal offers
 * and legacy/wrong-shape classes never unlock progression.
 */
export async function hasQualifyingPhase4IncarOffer(
  studentId: number,
  exec: typeof db | DbTx = db,
): Promise<boolean> {
  const [row] = await exec
    .select({ id: incarPairingOffers.id })
    .from(incarPairingOffers)
    .innerJoin(classes, eq(incarPairingOffers.classId, classes.id))
    .where(
      and(
        eq(incarPairingOffers.studentId, studentId),
        inArray(incarPairingOffers.status, ["pending", "accepted"]),
        eq(classes.courseType, "auto"),
        eq(classes.classType, "driving"),
        eq(classes.classNumber, 12),
        eq(classes.duration, 120),
        eq(classes.maxStudents, 2),
      ),
    )
    .limit(1);
  return !!row;
}

// ─── Advisory lock ─────────────────────────────────────────────────────────────

async function withLock<T>(
  studentIds: number[],
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const sorted = Array.from(new Set(studentIds)).sort((a, b) => a - b);
    for (const sid of sorted) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_NS}, ${sid})`);
    }
    return fn(tx);
  });
}

// ─── Audit helper ──────────────────────────────────────────────────────────────

interface AuditParams {
  eventType: string;
  queueEntryId?: number | null;
  pairedSessionId?: number | null;
  offerId?: number | null;
  confirmationId?: number | null;
  studentId?: number | null;
  classId?: number | null;
  actorId?: string;
  actorRole?: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  details?: Record<string, unknown>;
}

async function audit(tx: DbTx, p: AuditParams): Promise<void> {
  await tx.insert(incarPairingAudit).values({
    eventType: p.eventType,
    queueEntryId: p.queueEntryId ?? null,
    pairedSessionId: p.pairedSessionId ?? null,
    offerId: p.offerId ?? null,
    confirmationId: p.confirmationId ?? null,
    studentId: p.studentId ?? null,
    classId: p.classId ?? null,
    actorId: p.actorId ?? "system",
    actorRole: p.actorRole ?? "system",
    previousStatus: p.previousStatus ?? null,
    newStatus: p.newStatus ?? null,
    details: (p.details ?? null) as any,
  });
}

// ─── Atomic offer-state transition (optimistic conditional claim) ─────────────

/** Additional column writes applied atomically with an offer transition. */
export interface OfferTransitionExtras {
  respondedAt?: Date;
  declineReason?: string | null;
  pairedSessionId?: number;
}

/**
 * Atomically transition an offer from `from` → `to` using a conditional
 * `UPDATE ... WHERE id = ? AND status = ?` with `.returning()`.
 *
 * Returns `{ claimed: true }` only when THIS statement flipped the row (exactly
 * one row returned). If zero rows return, another transaction already
 * transitioned the offer concurrently — callers must abort their branch
 * WITHOUT mutating any queue/session/enrollment state.
 *
 * This closes the read-then-write race: prior code read `offer.status` and then
 * wrote unconditionally, so two concurrent actors (e.g. accept vs. expire, or
 * accept vs. manual-pair) could both proceed on the same stale "pending" read.
 */
export async function applyOfferTransition(
  tx: DbTx,
  offerId: number,
  from: string,
  to: string,
  extras: OfferTransitionExtras = {},
): Promise<{ claimed: boolean }> {
  const setValues: Record<string, unknown> = { status: to, updatedAt: new Date() };
  if (extras.respondedAt !== undefined) setValues.respondedAt = extras.respondedAt;
  if (extras.declineReason !== undefined) setValues.declineReason = extras.declineReason;
  if (extras.pairedSessionId !== undefined) setValues.pairedSessionId = extras.pairedSessionId;

  const rows = await tx
    .update(incarPairingOffers)
    .set(setValues as any)
    .where(
      and(
        eq(incarPairingOffers.id, offerId),
        eq(incarPairingOffers.status, from),
      ),
    )
    .returning({ id: incarPairingOffers.id });

  return { claimed: rows.length === 1 };
}

// ─── Eligibility ───────────────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Check whether a student may join the In-Car 12/13 combined pairing queue.
 *
 * Requirements:
 *  1. Auto-course student.
 *  2. Has attended Theory #11 (Phase 4 opener).
 *  3. Has NOT already completed In-Car #12 (the combined session).
 *  4. Is not currently in 'waiting' or 'booked_first' status in the queue.
 *  5. Is not part of an active paired session.
 */
/** Active (non-terminal) queue statuses that block a student from re-joining. */
const ACTIVE_QUEUE_STATUSES = [
  "waiting",
  "offered",
  "booked_first",
  "paired",
  "confirmed",
] as const;

// ─── Pure decision helpers (DB-free; exported for testing) ────────────────────

export interface ManualPairGuardInput {
  /** Canonical-slot check result for the target class (isCombined1213Class). */
  classIsCanonical: boolean;
  /** Class scheduling status, e.g. "scheduled". */
  classStatus: string;
  /** The waiting student the admin is pairing in. */
  waitingStudentId: number;
  /** Whether a waiting/offered queue entry exists for waitingStudentId. */
  waitingEntryExists: boolean;
  /** studentId of the distinct active booked_first entry for the class, if any. */
  bookedFirstStudentId: number | null;
  /** Current non-cancelled enrollment count on the class. */
  enrolledCount: number;
  /** Class maxStudents (defaults to 2 when null/undefined). */
  maxStudents: number | null | undefined;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * Pure guard logic for manualPair. Returns ok:true only when the admin may
 * pair the waiting student against a real, distinct booked_first student on a
 * canonical, scheduled 12/13 slot with exactly one free seat.
 *
 * Kept DB-free so the real decision path is unit-testable.
 */
export function evaluateManualPairGuards(i: ManualPairGuardInput): GuardResult {
  if (!i.waitingEntryExists) {
    return { ok: false, reason: "No active queue entry for waiting student." };
  }
  if (!i.classIsCanonical) {
    return {
      ok: false,
      reason:
        "This class is not a valid combined In-Car 12/13 slot (must be auto/driving/classNumber=12/duration=120/maxStudents=2).",
    };
  }
  if (i.classStatus !== "scheduled") {
    return { ok: false, reason: "Class is not scheduled." };
  }
  if (i.bookedFirstStudentId == null) {
    return {
      ok: false,
      reason:
        "No first-booker (booked_first) exists for this class. Book the slot first before manually pairing.",
    };
  }
  if (i.bookedFirstStudentId === i.waitingStudentId) {
    return { ok: false, reason: "Cannot pair a student with themselves." };
  }
  const cap = i.maxStudents ?? 2;
  // Exactly one seat must remain: the first-booker occupies one, leaving one
  // open for the waiting student.
  if (i.enrolledCount >= cap) {
    return { ok: false, reason: "Class is full." };
  }
  if (i.enrolledCount < cap - 1) {
    return {
      ok: false,
      reason:
        "Class does not have a first-booker seat filled; cannot manually pair yet.",
    };
  }
  return { ok: true };
}

export type RequeueAction =
  | { kind: "noop" } // already waiting
  | { kind: "reject"; reason: string } // terminal status
  | { kind: "from_offered" }
  | { kind: "from_booked_first" }
  | { kind: "dissolve_pair" }; // paired | confirmed

/**
 * Pure status → action mapping for requeueStudent. Kept DB-free so the real
 * per-status branching is unit-testable.
 */
export function decideRequeueAction(status: string): RequeueAction {
  switch (status) {
    case "waiting":
      return { kind: "noop" };
    case "offered":
      return { kind: "from_offered" };
    case "booked_first":
      return { kind: "from_booked_first" };
    case "paired":
    case "confirmed":
      return { kind: "dissolve_pair" };
    default:
      // completed, converted_solo, cancelled, or anything unknown/terminal.
      return {
        kind: "reject",
        reason: `Cannot re-queue an entry with status '${status}'.`,
      };
  }
}

// ─── Booked-first teardown race guard ─────────────────────────────────────────

/**
 * The three booked-first teardown paths (deferBookedStudent, leaveCombinedQueue
 * booked-first branch, requeueStudent from_booked_first branch) each mutate a
 * first-booker's enrollment/queue entry. They race with an offer ACCEPT on the
 * same class: an accept flips the first-booker's entry from 'booked_first' to
 * 'paired' and creates a paired session. To avoid tearing down a student who
 * was JUST paired, every such path must (1) lock the class row FOR UPDATE, then
 * (2) RE-READ the entry, then (3) call this pure guard on the re-read status.
 *
 * Contract: teardown proceeds ONLY when the re-read status is still
 * 'booked_first'. Any other status means another actor (usually an accept) won
 * the race — abort WITHOUT mutating.
 */
export type BookedFirstTeardownPath = "defer" | "leave" | "requeue";

export function decideBookedFirstTeardown(
  postLockStatus: string,
  path: BookedFirstTeardownPath,
): { proceed: true } | { proceed: false; reason?: string } {
  if (postLockStatus === "booked_first") {
    return { proceed: true };
  }
  // Lost the race. The scheduler-driven defer simply skips this entry this
  // cycle (no user-facing error); the admin/user-initiated leave & requeue
  // return a friendly retry message.
  if (path === "defer") {
    return { proceed: false };
  }
  return {
    proceed: false,
    reason: "Student was just paired; refresh and retry.",
  };
}

/**
 * Pure guard for the offer-ACCEPT path: given the receiving queue entry's
 * status re-read UNDER the class lock, decide whether the accept may proceed.
 *
 * Accept proceeds ONLY when the entry is still 'offered'. Any other status
 * means the offer is stale — e.g. a concurrent manualPair paired the candidate
 * on another class (entry now 'paired') and withdrew this offer, or the offer
 * was otherwise withdrawn/expired (entry back to 'waiting'). In those cases the
 * accept must NOT claim the offer or enroll.
 *
 * Exported so the transactional accept path and tests share identical logic.
 */
export function decideAcceptGuard(
  receivingEntryStatus: string | null | undefined,
): { proceed: true } | { proceed: false; reason: string } {
  if (receivingEntryStatus === "offered") {
    return { proceed: true };
  }
  return { proceed: false, reason: "Offer is no longer available." };
}

/**
 * Pure decision for the paired→confirmed session transition (round 7). Given
 * the statuses of BOTH confirmation rows (re-read under the both-student +
 * class-row locks) and the current session status, decide whether to attempt
 * the conditional session transition to 'confirmed'.
 *
 * Requires exactly two confirmations, BOTH 'confirmed', AND the session still
 * 'paired'. A session already 'confirmed' (someone else won) ⇒ do not attempt
 * again; a 'declined'/'expired' confirmation or a dissolved session ⇒ abort.
 *
 * The caller still performs a conditional UPDATE ... WHERE status='paired'
 * (.returning()) so that under true concurrency exactly one caller wins even
 * if two observe both-confirmed simultaneously; this helper decides whether the
 * attempt is warranted at all.
 *
 * Exported so the transactional path, the lifecycle repair, and tests share
 * identical logic.
 */
export function decideBothConfirmedTransition(
  confStatuses: string[],
  sessionStatus: string,
): { transition: boolean } {
  const bothConfirmed =
    confStatuses.length >= 2 && confStatuses.every((s) => s === "confirmed");
  return { transition: bothConfirmed && sessionStatus === "paired" };
}

/**
 * Acquire a FOR UPDATE lock on the classes row, matching the accept/manualPair
 * serialization protocol. Advisory (student) locks must already be held BEFORE
 * calling this so the global lock order is always: advisory locks → class row.
 * Returns the locked class row, or null when the class no longer exists.
 */
async function lockClassRow(tx: DbTx, classId: number) {
  const [cls] = await tx
    .select()
    .from(classes)
    .where(eq(classes.id, classId))
    .for("update")
    .limit(1);
  return cls ?? null;
}

/**
 * Check for an active queue entry for a student. Runs on the given executor
 * (db or a transaction handle) so callers can re-verify INSIDE a lock to
 * close the race between the pre-lock eligibility check and the mutation.
 * Returns the blocking status string, or null if the student is free to join.
 */
async function findActiveQueueStatus(
  exec: typeof db | DbTx,
  studentId: number,
): Promise<string | null> {
  const [existing] = await exec
    .select({ id: incarPairingQueue.id, status: incarPairingQueue.status })
    .from(incarPairingQueue)
    .where(
      and(
        eq(incarPairingQueue.studentId, studentId),
        inArray(incarPairingQueue.status, [...ACTIVE_QUEUE_STATUSES]),
      ),
    )
    .limit(1);
  return existing ? existing.status : null;
}

export async function checkEligibility(
  studentId: number,
  _sessionNumber: 12 | 13 = 12, // accept 12 or 13 for compat; always checks #12
  exec: typeof db | DbTx = db,
): Promise<EligibilityResult> {
  const [student] = await exec
    .select({ id: students.id, courseType: students.courseType })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);

  if (!student) return { eligible: false, reason: "Student not found." };

  if ((student.courseType ?? "").toLowerCase() !== "auto") {
    return {
      eligible: false,
      reason: "Only auto-course students may join the In-Car 12/13 pairing queue.",
    };
  }

  // Theory 11 attended
  const [t11] = await exec
    .select({ id: classEnrollments.id })
    .from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(
      and(
        eq(classEnrollments.studentId, studentId),
        eq(classes.classType, "theory"),
        eq(classes.classNumber, 11),
        eq(classEnrollments.attendanceStatus, "attended"),
        isNull(classEnrollments.cancelledAt),
      ),
    )
    .limit(1);

  if (!t11) {
    return {
      eligible: false,
      reason:
        "Theory #11 must be completed before joining the In-Car 12/13 pairing queue.",
    };
  }

  // Use the same authoritative pairing evidence as Course Progress. In
  // particular, a pre-start attended mark, one attended partner, or a
  // dissolved conversion never blocks the student from re-entering matching.
  const completionDetails =
    await storage.getEnrollmentCompletionDetailsByStudent(studentId);
  const doneCombined = completionDetails.some(
    (enrollment) =>
      isCombined1213Class(enrollment) &&
      enrollmentCountsAsCompleted(enrollment),
  );

  if (doneCombined) {
    return {
      eligible: false,
      reason: "The combined In-Car #12/13 session has already been completed.",
    };
  }

  // No active queue entry. A 'waiting' entry is NOT a blocker: a waiting
  // student (including one returned to the queue after a no-partner deferral)
  // is still eligible to book a concrete slot, which bookCombinedSlot converts
  // to 'booked_first'. Any other active status (offered/booked_first/paired/
  // confirmed) means they are already committed elsewhere.
  const activeStatus = await findActiveQueueStatus(exec, studentId);
  if (activeStatus && activeStatus !== "waiting") {
    return {
      eligible: false,
      reason: `Student is already in the pairing system (status: ${activeStatus}).`,
    };
  }

  return { eligible: true };
}

// ─── Internal: offer the next waiting student the open seat ────────────────────

async function offerNextCandidate(
  tx: DbTx,
  classId: number,
  actorId: string,
  actorRole: string,
): Promise<void> {
  // Guard: only one pending offer per class may exist at a time. If one is
  // already outstanding, do nothing (the DB unique partial index also enforces
  // this — we check first to avoid triggering avoidable uniqueness errors).
  const [existingPending] = await tx
    .select({ id: incarPairingOffers.id })
    .from(incarPairingOffers)
    .where(
      and(
        eq(incarPairingOffers.classId, classId),
        eq(incarPairingOffers.status, "pending"),
      ),
    )
    .limit(1);
  if (existingPending) return;

  // Verify there is still a booked_first/paired seat to fill for this class,
  // and that the class is not already full.
  const [cls] = await tx
    .select({ maxStudents: classes.maxStudents })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);
  if (!cls) return;

  // Students already enrolled in this class (occupy a seat).
  const enrolled = await tx
    .select({ studentId: classEnrollments.studentId })
    .from(classEnrollments)
    .where(
      and(
        eq(classEnrollments.classId, classId),
        isNull(classEnrollments.cancelledAt),
      ),
    );
  const enrolledIds = enrolled
    .map((e) => e.studentId)
    .filter((id): id is number => id != null);

  if (enrolledIds.length >= (cls.maxStudents ?? 2)) return; // class full

  // Students who already declined/expired/withdrew an offer for THIS class:
  // do not immediately re-offer the same seat to them.
  const priorNonPending = await tx
    .select({ studentId: incarPairingOffers.studentId })
    .from(incarPairingOffers)
    .where(
      and(
        eq(incarPairingOffers.classId, classId),
        inArray(incarPairingOffers.status, ["declined", "expired", "withdrawn"]),
      ),
    );
  const excludedIds = Array.from(
    new Set([
      ...enrolledIds,
      ...priorNonPending
        .map((o) => o.studentId)
        .filter((id): id is number => id != null),
    ]),
  );

  const candidates = await tx
    .select()
    .from(incarPairingQueue)
    .where(
      and(
        eq(incarPairingQueue.status, "waiting"),
        ...(excludedIds.length > 0
          ? [not(inArray(incarPairingQueue.studentId, excludedIds))]
          : []),
      ),
    )
    .orderBy(asc(incarPairingQueue.priority), asc(incarPairingQueue.queuedAt))
    .limit(1);

  if (candidates.length === 0) return;

  const candidate = candidates[0];
  const expiresAt = new Date(Date.now() + OFFER_DEADLINE_HOURS * 60 * 60 * 1000);

  let offer: IncarPairingOffer;
  try {
    const [inserted] = await tx
      .insert(incarPairingOffers)
      .values({
        queueEntryId: candidate.id,
        studentId: candidate.studentId,
        classId,
        status: "pending",
        expiresAt,
      })
      .returning();
    offer = inserted;
  } catch (err: any) {
    // Idempotent handling of the unique-partial-index race: another concurrent
    // path created a pending offer for this class/entry first. Treat as no-op.
    const msg = String(err?.message ?? err ?? "");
    if (/unique|duplicate/i.test(msg)) {
      console.warn(
        `[incar-pairing] offerNextCandidate: pending offer race for class ${classId}; skipping.`,
      );
      return;
    }
    throw err;
  }

  await tx
    .update(incarPairingQueue)
    .set({ status: "offered", updatedAt: new Date() })
    .where(eq(incarPairingQueue.id, candidate.id));

  await audit(tx, {
    eventType: "offer_sent",
    queueEntryId: candidate.id,
    offerId: offer.id,
    studentId: candidate.studentId,
    classId,
    actorId,
    actorRole,
    previousStatus: "waiting",
    newStatus: "offered",
    details: { expiresAt: expiresAt.toISOString() },
  });

  // Send notification (fire-and-forget; errors are non-fatal)
  sendOfferNotification(offer.id, classId, candidate.studentId).catch((err) =>
    console.error("[incar-pairing] offer notification error:", err),
  );
}

// ─── bookCombinedSlot ──────────────────────────────────────────────────────────

export interface BookCombinedSlotResult {
  success: boolean;
  queueEntryId?: number;
  enrollmentId?: number;
  reason?: string;
}

/**
 * Student 1 books the canonical In-Car 12/13 class slot.
 *
 * The student is enrolled in the class immediately (classEnrollments row with
 * attendanceStatus='registered'). Their queue entry moves to 'booked_first'.
 * An offer is then sent to the next 'waiting' candidate in the queue.
 */
export async function bookCombinedSlot(params: {
  studentId: number;
  classId: number;
  actorId?: string;
  actorRole?: string;
  /** Existing transaction whose caller already holds booking lock 823001. */
  tx?: DbTx;
}): Promise<BookCombinedSlotResult> {
  const {
    studentId,
    classId,
    actorId = String(params.studentId),
    actorRole = "student",
    tx: existingTx,
  } = params;

  // Cheap early rejection only. The authoritative result is checked again
  // after both mutation locks are established below.
  const eligibility = await checkEligibility(studentId);
  if (!eligibility.eligible) {
    return { success: false, reason: eligibility.reason };
  }

  const runLocked = async (tx: DbTx): Promise<BookCombinedSlotResult> => {
    const lockedEligibility = await checkEligibility(studentId, 12, tx);
    if (!lockedEligibility.eligible) {
      return { success: false, reason: lockedEligibility.reason };
    }
    // Re-check active queue state INSIDE the lock — the eligibility check above
    // ran outside the lock and is race-prone.
    //
    // A 'waiting' entry is NOT a blocker here: a waiting student (including one
    // returned to the queue after a no-partner deferral) is allowed to book a
    // concrete slot, which converts their existing waiting entry to
    // 'booked_first' below. Any non-waiting active status (offered,
    // booked_first, paired, confirmed) still blocks a new booking.
    const activeStatus = await findActiveQueueStatus(tx, studentId);
    if (activeStatus && activeStatus !== "waiting") {
      return {
        success: false,
        reason: `Student is already in the pairing system (status: ${activeStatus}).`,
      };
    }

    // Lock the class row FOR UPDATE so concurrent booked_first bookings for the
    // same class are serialized.
    const [cls] = await tx
      .select()
      .from(classes)
      .where(eq(classes.id, classId))
      .for("update")
      .limit(1);

    if (!cls) return { success: false, reason: "Class not found." };
    if (cls.status !== "scheduled") {
      return { success: false, reason: "Class is not available for booking." };
    }
    if (!isCombined1213Class({ classType: cls.classType, classNumber: cls.classNumber, duration: cls.duration, maxStudents: cls.maxStudents, courseType: cls.courseType })) {
      return {
        success: false,
        reason:
          "This class is not a valid combined In-Car 12/13 slot (must be auto/driving/classNumber=12/duration=120/maxStudents=2).",
      };
    }

    // Reject if this class already has an active queue entry (booked_first,
    // paired, or confirmed). Only ONE first-booker may own a given class slot.
    const [classOwner] = await tx
      .select({ id: incarPairingQueue.id, status: incarPairingQueue.status })
      .from(incarPairingQueue)
      .where(
        and(
          eq(incarPairingQueue.bookedClassId, classId),
          inArray(incarPairingQueue.status, ["booked_first", "paired", "confirmed"]),
        ),
      )
      .limit(1);
    if (classOwner) {
      return {
        success: false,
        reason:
          "This In-Car #12/13 slot is already reserved through the pairing queue. Please choose another available slot.",
      };
    }

    // Check capacity — one seat must remain
    const existing = await tx
      .select()
      .from(classEnrollments)
      .where(
        and(
          eq(classEnrollments.classId, classId),
          isNull(classEnrollments.cancelledAt),
        ),
      );
    if (existing.length >= (cls.maxStudents ?? 2)) {
      return { success: false, reason: "Class is full." };
    }

    // Enroll student
    const [enrollment] = await tx
      .insert(classEnrollments)
      .values({ classId, studentId, attendanceStatus: "registered" })
      .returning();

    // Create or update queue entry. A student returned to the queue after a
    // no-partner deferral (or any waiting student) has an existing 'waiting'
    // entry — restore it to 'booked_first' in place, retaining its original
    // queuedAt and (boosted) priority rather than creating a duplicate.
    const [existingEntry] = await tx
      .select()
      .from(incarPairingQueue)
      .where(
        and(
          eq(incarPairingQueue.studentId, studentId),
          eq(incarPairingQueue.status, "waiting"),
        ),
      )
      .limit(1);

    let queueEntry: IncarPairingQueue;
    if (existingEntry) {
      // Convert the waiting entry to booked_first (retains priority/position).
      const [updated] = await tx
        .update(incarPairingQueue)
        .set({
          status: "booked_first",
          bookedClassId: classId,
          enrollmentId: enrollment.id,
          updatedAt: new Date(),
        })
        .where(eq(incarPairingQueue.id, existingEntry.id))
        .returning();
      queueEntry = updated;
    } else {
      const [inserted] = await tx
        .insert(incarPairingQueue)
        .values({
          studentId,
          sessionNumber: 12,
          status: "booked_first",
          bookedClassId: classId,
          enrollmentId: enrollment.id,
        })
        .returning();
      queueEntry = inserted;
    }

    await audit(tx, {
      eventType: "booked_first",
      queueEntryId: queueEntry.id,
      studentId,
      classId,
      actorId,
      actorRole,
      previousStatus: existingEntry?.status ?? null,
      newStatus: "booked_first",
      details: { enrollmentId: enrollment.id },
    });

    // Offer next waiting candidate the second seat
    await offerNextCandidate(tx, classId, "system", "system");

    return {
      success: true,
      queueEntryId: queueEntry.id,
      enrollmentId: enrollment.id,
    };
  };
  if (existingTx) {
    // The route owns 823001 in this transaction. Acquiring it from a separate
    // transaction would self-deadlock; only add the pairing lock here.
    await existingTx.execute(
      sql`SELECT pg_advisory_xact_lock(${LOCK_NS}, ${studentId})`,
    );
    return runLocked(existingTx);
  }
  return db.transaction(async (tx) => {
    await acquireStudentMutationLocks(tx, [studentId]);
    return runLocked(tx);
  });
}

// ─── joinCombinedQueue (student 2 / waiting student) ───────────────────────────

export interface EnqueueResult {
  success: boolean;
  queueEntryId?: number;
  reason?: string;
}

/**
 * Join the pairing queue as a waiting student (student 2 path).
 * Idempotent — returns existing active entry if one exists.
 *
 * Also exported as `enqueueStudent` for back-compat with routes.ts.
 */
export async function joinCombinedQueue(params: {
  studentId: number;
  priority?: number;
  actorId?: string;
  actorRole?: string;
}): Promise<EnqueueResult> {
  const { studentId, priority = 100, actorId, actorRole = "student" } = params;

  const eligibility = await checkEligibility(studentId);
  if (!eligibility.eligible) return { success: false, reason: eligibility.reason };

  return db.transaction(async (tx) => {
    await acquireStudentMutationLocks(tx, [studentId]);
    const lockedEligibility = await checkEligibility(studentId, 12, tx);
    if (!lockedEligibility.eligible) {
      return { success: false, reason: lockedEligibility.reason };
    }
    // Re-check ALL active statuses INSIDE the lock — eligibility ran outside
    // the lock. Idempotent for waiting/offered entries; blocks otherwise.
    const [existing] = await tx
      .select()
      .from(incarPairingQueue)
      .where(
        and(
          eq(incarPairingQueue.studentId, studentId),
          inArray(incarPairingQueue.status, [...ACTIVE_QUEUE_STATUSES]),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.status === "waiting" || existing.status === "offered") {
        return { success: true, queueEntryId: existing.id };
      }
      return {
        success: false,
        reason: `Student is already in the pairing system (status: ${existing.status}).`,
      };
    }

    let entry: IncarPairingQueue;
    try {
      const [inserted] = await tx
        .insert(incarPairingQueue)
        .values({ studentId, sessionNumber: 12, priority, status: "waiting" })
        .returning();
      entry = inserted;
    } catch (err: any) {
      // Idempotent handling of the unique-partial-active-entry race.
      const msg = String(err?.message ?? err ?? "");
      if (/unique|duplicate/i.test(msg)) {
        const dup = await findActiveQueueStatus(tx, studentId);
        return {
          success: false,
          reason: `Student is already in the pairing system (status: ${dup ?? "active"}).`,
        };
      }
      throw err;
    }

    await audit(tx, {
      eventType: "enqueued",
      queueEntryId: entry.id,
      studentId,
      actorId: actorId ?? String(studentId),
      actorRole,
      newStatus: "waiting",
      details: { priority },
    });

    return { success: true, queueEntryId: entry.id };
  });
}

/** Alias for routes.ts back-compat */
export async function enqueueStudent(params: {
  studentId: number;
  sessionNumber?: 12 | 13;
  priority?: number;
  actorId?: string;
  actorRole?: string;
}): Promise<EnqueueResult> {
  return joinCombinedQueue(params);
}

// ─── leaveCombinedQueue ────────────────────────────────────────────────────────

/**
 * Student removes themselves from the queue.
 * Declines any pending offer first; if booked_first, cancels enrollment.
 */
export async function leaveCombinedQueue(params: {
  studentId: number;
  reason?: string;
  actorId?: string;
  actorRole?: string;
}): Promise<{ success: boolean; reason?: string; cancelledEnrollmentId?: number }> {
  const { studentId, reason, actorId, actorRole = "student" } = params;

  return withLock([studentId], async (tx) => {
    let cancelledEnrollmentId: number | undefined;
    const entries = await tx
      .select()
      .from(incarPairingQueue)
      .where(
        and(
          eq(incarPairingQueue.studentId, studentId),
          inArray(incarPairingQueue.status, [
            "waiting",
            "offered",
            "booked_first",
            "deferred",
          ]),
        ),
      );

    if (entries.length === 0) {
      return { success: false, reason: "No active queue entry found." };
    }

    for (const entry of entries) {
      let prev = entry.status;
      let liveEntry = entry;

      // For a booked_first entry, an ACCEPT on the same class could pair this
      // student concurrently. Lock the class row FOR UPDATE (advisory lock is
      // already held via withLock), re-read the entry, and guard: if it is no
      // longer booked_first, abort WITHOUT mutating and tell the caller to
      // retry. (waiting/offered/deferred entries do not hold a class seat, so
      // no class-row lock is required for them.)
      if (entry.status === "booked_first" && entry.bookedClassId != null) {
        const cls = await lockClassRow(tx, entry.bookedClassId);
        if (cls) {
          const [reread] = await tx
            .select()
            .from(incarPairingQueue)
            .where(eq(incarPairingQueue.id, entry.id))
            .limit(1);
          if (!reread) continue;
          const guard = decideBookedFirstTeardown(reread.status, "leave");
          if (!guard.proceed) {
            return { success: false, reason: guard.reason };
          }
          liveEntry = reread;
          prev = reread.status;
        }
      }

      // Cancel enrollment if booked_first (deferred entries no longer hold one).
      if (
        (liveEntry.status === "booked_first" || liveEntry.status === "deferred") &&
        liveEntry.enrollmentId
      ) {
        await tx
          .update(classEnrollments)
          .set({ cancelledAt: new Date() })
          .where(eq(classEnrollments.id, liveEntry.enrollmentId));
        if (liveEntry.status === "booked_first") cancelledEnrollmentId = liveEntry.enrollmentId;
      }

      // Withdraw any pending offer where this student is the RECEIVER (their
      // own offered entry) — via conditional claim so a concurrent
      // accept/decline/expire is respected.
      const ownOffers = await tx
        .select()
        .from(incarPairingOffers)
        .where(
          and(
            eq(incarPairingOffers.queueEntryId, liveEntry.id),
            eq(incarPairingOffers.status, "pending"),
          ),
        );
      for (const oo of ownOffers) {
        await applyOfferTransition(tx, oo.id, "pending", "withdrawn");
      }

      // If this was booked_first, the class's OUTSTANDING partner offer (sent
      // to some other student for THIS class) is now stale — the seat no longer
      // exists because we just cancelled the first-booker's enrollment. Withdraw
      // it and return that candidate to 'waiting'. Do NOT offer a new partner.
      if (liveEntry.status === "booked_first" && liveEntry.bookedClassId) {
        const staleOffers = await tx
          .select()
          .from(incarPairingOffers)
          .where(
            and(
              eq(incarPairingOffers.classId, liveEntry.bookedClassId),
              eq(incarPairingOffers.status, "pending"),
            ),
          );
        for (const so of staleOffers) {
          // Only move the candidate back to waiting if WE claimed the offer.
          const claim = await applyOfferTransition(tx, so.id, "pending", "withdrawn");
          if (!claim.claimed) continue;
          await tx
            .update(incarPairingQueue)
            .set({ status: "waiting", updatedAt: new Date() })
            .where(
              and(
                eq(incarPairingQueue.id, so.queueEntryId),
                eq(incarPairingQueue.status, "offered"),
              ),
            );
          await audit(tx, {
            eventType: "offer_withdrawn",
            queueEntryId: so.queueEntryId,
            offerId: so.id,
            studentId: so.studentId,
            classId: liveEntry.bookedClassId,
            actorId: "system",
            actorRole: "system",
            previousStatus: "pending",
            newStatus: "withdrawn",
            details: { reason: "First-booker left the queue" },
          });
        }
      }

      await tx
        .update(incarPairingQueue)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(incarPairingQueue.id, liveEntry.id));

      await audit(tx, {
        eventType: "left_queue",
        queueEntryId: liveEntry.id,
        studentId,
        actorId: actorId ?? String(studentId),
        actorRole,
        previousStatus: prev,
        newStatus: "cancelled",
        details: { reason },
      });
      // NOTE: no offerNextCandidate — the seat is gone once the first-booker
      // cancels; there is nothing to pair against.
    }

    return { success: true, cancelledEnrollmentId };
  });
}

// ─── respondToOffer ────────────────────────────────────────────────────────────

export interface OfferResponseResult {
  success: boolean;
  pairedSessionId?: number;
  reason?: string;
}

function logOfferRejection(input: {
  offerId: number;
  reason: string;
  offerStatus?: string | null;
  expiresAt?: Date | null;
  classStatus?: string | null;
  classStart?: Date | null;
  queueStatus?: string | null;
}): void {
  console.warn("[incar-pairing] offer response rejected", {
    offerId: input.offerId,
    reason: input.reason,
    offerStatus: input.offerStatus ?? null,
    expiresAt: input.expiresAt?.toISOString() ?? null,
    checkedAt: new Date().toISOString(),
    classStatus: input.classStatus ?? null,
    classStart: input.classStart?.toISOString() ?? null,
    queueStatus: input.queueStatus ?? null,
  });
}

/**
 * Student 2 responds to a pairing offer.
 * accept → enrolled in class, paired session created.
 * decline → student 2 back to 'waiting', next candidate offered seat.
 */
export async function respondToOffer(params: {
  offerId: number;
  studentId: number;
  response: "accept" | "decline";
  reason?: string;
  actorId?: string;
  actorRole?: string;
}): Promise<OfferResponseResult> {
  const { offerId, studentId, response, reason, actorId, actorRole = "student" } = params;

  return withLock([studentId], async (tx) => {
    // Initial (pre-lock) read only to validate ownership and discover the
    // target class. Ownership/expiry are checked here, but the AUTHORITATIVE
    // state transition below is a conditional claim, so a stale "pending" read
    // here cannot cause a double-transition.
    const [offer] = await tx
      .select()
      .from(incarPairingOffers)
      .where(eq(incarPairingOffers.id, offerId))
      .limit(1);

    if (!offer) {
      logOfferRejection({ offerId, reason: "not_found" });
      return { success: false, reason: "Offer not found." };
    }
    if (offer.studentId !== studentId) {
      logOfferRejection({
        offerId,
        reason: "wrong_student",
        offerStatus: offer.status,
        expiresAt: offer.expiresAt,
      });
      return { success: false, reason: "Offer does not belong to this student." };
    }

    // Serialize against concurrent claimers on the same slot: lock the class
    // row FOR UPDATE, then re-read the offer under that lock.
    const [cls] = await tx
      .select()
      .from(classes)
      .where(eq(classes.id, offer.classId))
      .for("update")
      .limit(1);

    if (!cls) {
      logOfferRejection({
        offerId,
        reason: "class_missing",
        offerStatus: offer.status,
        expiresAt: offer.expiresAt,
      });
      return { success: false, reason: "Class no longer exists." };
    }

    const [lockedOffer] = await tx
      .select()
      .from(incarPairingOffers)
      .where(eq(incarPairingOffers.id, offerId))
      .limit(1);

    if (!lockedOffer) {
      logOfferRejection({ offerId, reason: "offer_missing_after_lock", classStatus: cls.status });
      return { success: false, reason: "Offer is no longer available." };
    }
    const classStart = getClassStartTime({
      date: cls.date ?? "",
      time: cls.time ?? "",
    });

    // An accepted offer is idempotent only when the transaction completed all
    // of its durable effects. This handles notification-center duplicate POSTs
    // without treating a partially-written accepted offer as successful.
    if (response === "accept" && lockedOffer.status === "accepted" && lockedOffer.pairedSessionId) {
      const [completedAcceptance] = await tx
        .select({ sessionId: incarPairedSessions.id })
        .from(incarPairedSessions)
        .innerJoin(
          classEnrollments,
          eq(classEnrollments.id, incarPairedSessions.enrollmentIdB),
        )
        .where(
          and(
            eq(incarPairedSessions.id, lockedOffer.pairedSessionId),
            eq(incarPairedSessions.classId, lockedOffer.classId),
            eq(incarPairedSessions.studentIdB, studentId),
            eq(classEnrollments.studentId, studentId),
            eq(classEnrollments.classId, lockedOffer.classId),
            isNull(classEnrollments.cancelledAt),
          ),
        )
        .limit(1);
      if (completedAcceptance) {
        return { success: true, pairedSessionId: completedAcceptance.sessionId };
      }
    }

    if (lockedOffer.status !== "pending") {
      logOfferRejection({
        offerId,
        reason: "not_pending",
        offerStatus: lockedOffer.status,
        expiresAt: lockedOffer.expiresAt,
        classStatus: cls.status,
        classStart,
      });
      return { success: false, reason: "Offer is no longer available." };
    }
    if (Date.now() >= lockedOffer.expiresAt.getTime()) {
      // Expire it (guarded conditional inside) and abort.
      await _expireOffer(tx, lockedOffer, "system", "system");
      logOfferRejection({
        offerId,
        reason: "expired",
        offerStatus: lockedOffer.status,
        expiresAt: lockedOffer.expiresAt,
        classStatus: cls.status,
        classStart,
      });
      return { success: false, reason: "Offer has expired." };
    }

    if (response === "decline") {
      // Conditional claim: pending → declined. If not claimed, someone else
      // already transitioned it; abort WITHOUT touching queue state.
      const claim = await applyOfferTransition(tx, offerId, "pending", "declined", {
        respondedAt: new Date(),
        declineReason: reason ?? null,
      });
      if (!claim.claimed) {
        return { success: false, reason: "Offer is no longer available." };
      }

      await tx
        .update(incarPairingQueue)
        .set({ status: "waiting", updatedAt: new Date() })
        .where(eq(incarPairingQueue.id, lockedOffer.queueEntryId));

      await audit(tx, {
        eventType: "offer_declined",
        queueEntryId: lockedOffer.queueEntryId,
        offerId,
        studentId,
        classId: lockedOffer.classId,
        actorId: actorId ?? String(studentId),
        actorRole,
        previousStatus: "pending",
        newStatus: "declined",
        details: { reason },
      });

      // Offer next candidate the same seat
      await offerNextCandidate(tx, lockedOffer.classId, "system", "system");
      return { success: true };
    }

    // ── Accept ──────────────────────────────────────────────────────────────
    if (cls.status !== "scheduled") {
      logOfferRejection({
        offerId,
        reason: "class_not_scheduled",
        offerStatus: lockedOffer.status,
        expiresAt: lockedOffer.expiresAt,
        classStatus: cls.status,
        classStart,
      });
      return { success: false, reason: "Class is no longer available." };
    }
    if (!classStart || Date.now() >= classStart.getTime()) {
      logOfferRejection({
        offerId,
        reason: classStart ? "class_started" : "invalid_class_instant",
        offerStatus: lockedOffer.status,
        expiresAt: lockedOffer.expiresAt,
        classStatus: cls.status,
        classStart,
      });
      return {
        success: false,
        reason: classStart
          ? "The class has already started."
          : "Class schedule is invalid.",
      };
    }

    // Require the RECEIVING queue entry to still be 'offered' (checked under the
    // class lock, BEFORE claiming the offer). A concurrent manualPair may have
    // paired this candidate on another class and withdrawn this offer, or
    // otherwise moved the entry off 'offered'. If so, this offer is stale — do
    // NOT claim or enroll. (The conditional claim below would also fail once the
    // offer was withdrawn, but checking the entry status first is the
    // authoritative "this is still your live offer" guard.)
    const [receivingEntry] = await tx
      .select()
      .from(incarPairingQueue)
      .where(eq(incarPairingQueue.id, lockedOffer.queueEntryId))
      .limit(1);
    const acceptGuard = decideAcceptGuard(receivingEntry?.status);
    if (!acceptGuard.proceed) {
      logOfferRejection({
        offerId,
        reason: "stale_queue_state",
        offerStatus: lockedOffer.status,
        expiresAt: lockedOffer.expiresAt,
        classStatus: cls.status,
        classStart,
        queueStatus: receivingEntry?.status,
      });
      return { success: false, reason: acceptGuard.reason };
    }

    // Claim the offer FIRST (pending → accepted, pairedSessionId set below via a
    // follow-up write). If not claimed, another actor already transitioned it.
    const claim = await applyOfferTransition(tx, offerId, "pending", "accepted", {
      respondedAt: new Date(),
    });
    if (!claim.claimed) {
      return { success: false, reason: "Offer is no longer available." };
    }

    // We now exclusively own this offer. Re-check capacity and booked_first
    // inside the same tx (the class row is locked FOR UPDATE).
    const rollbackToWaiting = async () => {
      // The claim already flipped the offer to a terminal state; return the
      // accepting student to 'waiting' so they can be re-offered later.
      await tx
        .update(incarPairingQueue)
        .set({ status: "waiting", updatedAt: new Date() })
        .where(eq(incarPairingQueue.id, lockedOffer.queueEntryId));
    };

    const enrolled = await tx
      .select()
      .from(classEnrollments)
      .where(
        and(
          eq(classEnrollments.classId, lockedOffer.classId),
          isNull(classEnrollments.cancelledAt),
        ),
      );

    if (enrolled.length >= (cls.maxStudents ?? 2)) {
      await rollbackToWaiting();
      await audit(tx, {
        eventType: "offer_withdrawn",
        queueEntryId: lockedOffer.queueEntryId,
        offerId,
        studentId,
        classId: lockedOffer.classId,
        actorId: "system",
        actorRole: "system",
        previousStatus: "accepted",
        newStatus: "accepted",
        details: { reason: "Class became full before accept could complete" },
      });
      return { success: false, reason: "Class became full before you could accept." };
    }

    // Require a real, distinct booked_first entry for this class.
    const [entry1] = await tx
      .select()
      .from(incarPairingQueue)
      .where(
        and(
          eq(incarPairingQueue.bookedClassId, lockedOffer.classId),
          eq(incarPairingQueue.status, "booked_first"),
        ),
      )
      .limit(1);

    if (!entry1) {
      await rollbackToWaiting();
      await audit(tx, {
        eventType: "offer_withdrawn",
        queueEntryId: lockedOffer.queueEntryId,
        offerId,
        studentId,
        classId: lockedOffer.classId,
        actorId: "system",
        actorRole: "system",
        previousStatus: "accepted",
        newStatus: "accepted",
        details: { reason: "No first-booker for this class at accept time" },
      });
      return {
        success: false,
        reason: "This slot is no longer available. You remain in the queue.",
      };
    }

    if (entry1.studentId === studentId) {
      // Defensive: cannot pair a student with themselves.
      await rollbackToWaiting();
      return {
        success: false,
        reason: "Cannot pair a student with themselves.",
      };
    }

    const [enrollment2] = await tx
      .insert(classEnrollments)
      .values({ classId: lockedOffer.classId, studentId, attendanceStatus: "registered" })
      .returning();

    // Create paired session
    const [session] = await tx
      .insert(incarPairedSessions)
      .values({
        queueEntryIdA: entry1.id,
        queueEntryIdB: lockedOffer.queueEntryId,
        studentIdA: entry1.studentId,
        studentIdB: studentId,
        classId: lockedOffer.classId,
        enrollmentIdA: entry1.enrollmentId ?? null,
        enrollmentIdB: enrollment2.id,
        status: "paired",
      })
      .returning();

    // Link the claimed offer to the new paired session.
    await tx
      .update(incarPairingOffers)
      .set({ pairedSessionId: session.id, updatedAt: new Date() })
      .where(eq(incarPairingOffers.id, offerId));

    // Advance both queue entries
    await tx
      .update(incarPairingQueue)
      .set({ status: "paired", enrollmentId: enrollment2.id, updatedAt: new Date() })
      .where(eq(incarPairingQueue.id, lockedOffer.queueEntryId));

    await tx
      .update(incarPairingQueue)
      .set({ status: "paired", updatedAt: new Date() })
      .where(eq(incarPairingQueue.id, entry1.id));

    await audit(tx, {
      eventType: "offer_accepted",
      queueEntryId: lockedOffer.queueEntryId,
      pairedSessionId: session.id,
      offerId,
      studentId,
      classId: lockedOffer.classId,
      actorId: actorId ?? String(studentId),
      actorRole,
      previousStatus: "pending",
      newStatus: "accepted",
      details: { enrollmentId: enrollment2.id },
    });

    await audit(tx, {
      eventType: "pair_created",
      pairedSessionId: session.id,
      classId: lockedOffer.classId,
      actorId: "system",
      actorRole: "system",
      newStatus: "paired",
      details: {
        studentIdA: session.studentIdA,
        studentIdB: session.studentIdB,
      },
    });

    // Send notifications (fire-and-forget)
    notifyPairCreated(session.id).catch((err) =>
      console.error("[incar-pairing] pair notification error:", err),
    );

    return { success: true, pairedSessionId: session.id };
  });
}

/** Legacy alias for routes.ts */
export async function acceptOffer(params: {
  offerId: number;
  studentId: number;
  actorId?: string;
  actorRole?: string;
}): Promise<OfferResponseResult> {
  return respondToOffer({ ...params, response: "accept" });
}

/** Legacy alias for routes.ts */
export async function declineOffer(params: {
  offerId: number;
  studentId: number;
  reason?: string;
  actorId?: string;
  actorRole?: string;
}): Promise<OfferResponseResult> {
  return respondToOffer({ ...params, response: "decline" });
}

// ─── Offer expiry (internal) ───────────────────────────────────────────────────

async function _expireOffer(
  tx: DbTx,
  offer: IncarPairingOffer,
  actorId: string,
  actorRole: string,
): Promise<void> {
  // Conditional claim: pending → expired. If another actor already
  // transitioned this offer (accept/decline/withdraw), skip EVERYTHING —
  // do not touch queue state or re-offer.
  const claim = await applyOfferTransition(tx, offer.id, "pending", "expired");
  if (!claim.claimed) return;

  await tx
    .update(incarPairingQueue)
    .set({ status: "waiting", updatedAt: new Date() })
    .where(eq(incarPairingQueue.id, offer.queueEntryId));

  await audit(tx, {
    eventType: "offer_expired",
    queueEntryId: offer.queueEntryId,
    offerId: offer.id,
    studentId: offer.studentId,
    classId: offer.classId,
    actorId,
    actorRole,
    previousStatus: "pending",
    newStatus: "expired",
  });

  // Notify the student whose offer expired (fire-and-forget).
  notifyOfferExpired(offer.id, offer.classId, offer.studentId).catch((err) =>
    console.error("[incar-pairing] offer-expired notification error:", err),
  );

  // Offer next candidate the same seat (excludes this student — they just expired).
  await offerNextCandidate(tx, offer.classId, "system", "system");
}

// ─── respondToConfirmation ─────────────────────────────────────────────────────

export interface ConfirmationResponseResult {
  success: boolean;
  reason?: string;
  cancelledEnrollmentId?: number;
}

/**
 * Student confirms or declines attendance for the paired session (~24h before class).
 * Decline → pair dissolved; declining student re-queued; remaining seat re-offered.
 */
export async function respondToConfirmation(params: {
  confirmationId: number;
  studentId: number;
  response: "confirm" | "decline";
  reason?: string;
  actorId?: string;
  actorRole?: string;
}): Promise<ConfirmationResponseResult> {
  const { confirmationId, studentId, response, reason, actorId, actorRole = "student" } = params;

  // ── Pre-read (no lock) to discover the paired session and BOTH student IDs,
  //    so we can acquire advisory locks for both participants (sorted ascending
  //    by withLock) BEFORE mutating — the standard pattern used in
  //    deferBookedStudent/requeueStudent. Authoritative checks happen after the
  //    locks are held via a conditional claim + re-read.
  const [preConf] = await db
    .select()
    .from(incarSessionConfirmations)
    .where(eq(incarSessionConfirmations.id, confirmationId))
    .limit(1);

  if (!preConf) return { success: false, reason: "Confirmation not found." };
  if (preConf.studentId !== studentId) {
    return { success: false, reason: "Confirmation does not belong to this student." };
  }

  const [preSession] = await db
    .select()
    .from(incarPairedSessions)
    .where(eq(incarPairedSessions.id, preConf.pairedSessionId))
    .limit(1);

  if (!preSession) return { success: false, reason: "Paired session not found." };

  return withLock([preSession.studentIdA, preSession.studentIdB], async (tx) => {
    // Lock the class row FOR UPDATE (advisory locks already held) so the whole
    // confirmation flow serializes against pairing/dissolution on this class.
    const cls = await lockClassRow(tx, preSession.classId);
    if (!cls) return { success: false, reason: "Class no longer exists." };

    // Re-read the session under the locks; it must still be eligible.
    const [session] = await tx
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, preConf.pairedSessionId))
      .limit(1);
    if (!session) return { success: false, reason: "Paired session not found." };
    if (!["paired", "confirmed"].includes(session.status)) {
      return { success: false, reason: `Session is ${session.status}; cannot respond.` };
    }

    if (response === "confirm") {
      // Conditional claim of THIS confirmation: pending → confirmed. Zero rows
      // ⇒ already responded (or someone raced us); abort friendly.
      const [claimed] = await tx
        .update(incarSessionConfirmations)
        .set({ status: "confirmed", respondedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(incarSessionConfirmations.id, confirmationId),
            eq(incarSessionConfirmations.status, "pending"),
          ),
        )
        .returning();

      if (!claimed) {
        return { success: false, reason: "Confirmation is no longer pending." };
      }

      await audit(tx, {
        eventType: "attendance_confirmed",
        confirmationId,
        pairedSessionId: session.id,
        studentId,
        actorId: actorId ?? String(studentId),
        actorRole,
        previousStatus: "pending",
        newStatus: "confirmed",
      });

      // Re-read BOTH confirmation rows under the locks and, if both confirmed,
      // conditionally advance the session paired → confirmed (exactly one
      // winner even under concurrency).
      await _maybeMarkSessionConfirmed(tx, session.id);
      return { success: true };
    }

    // ── Decline ───────────────────────────────────────────────────────────
    // Conditional claim: pending → declined. Zero rows ⇒ already responded.
    const [declined] = await tx
      .update(incarSessionConfirmations)
      .set({
        status: "declined",
        respondedAt: new Date(),
        declineReason: reason ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(incarSessionConfirmations.id, confirmationId),
          eq(incarSessionConfirmations.status, "pending"),
        ),
      )
      .returning();

    if (!declined) {
      return { success: false, reason: "Confirmation is no longer pending." };
    }

    await audit(tx, {
      eventType: "confirmation_declined",
      confirmationId,
      pairedSessionId: session.id,
      studentId,
      actorId: actorId ?? String(studentId),
      actorRole,
      previousStatus: "pending",
      newStatus: "declined",
      details: { reason },
    });

    // _dissolvePair re-guards the session status and re-locks the class row.
    const cancelledEnrollmentId = session.studentIdA === studentId
      ? session.enrollmentIdA ?? undefined
      : session.enrollmentIdB ?? undefined;
    await _dissolvePair(tx, session.id, studentId, reason ?? "Confirmation declined", "system", "system");

    return { success: true, cancelledEnrollmentId };
  });
}

/** Legacy aliases for routes.ts */
export async function confirmSession(params: {
  confirmationId: number;
  studentId: number;
  actorId?: string;
  actorRole?: string;
}): Promise<ConfirmationResponseResult> {
  return respondToConfirmation({ ...params, response: "confirm" });
}

export async function declineConfirmation(params: {
  confirmationId: number;
  studentId: number;
  reason?: string;
  actorId?: string;
  actorRole?: string;
}): Promise<ConfirmationResponseResult> {
  return respondToConfirmation({ ...params, response: "decline" });
}

/**
 * If both confirmation rows are 'confirmed' and the session is still 'paired',
 * conditionally advance it to 'confirmed'. Callers MUST already hold the
 * both-student advisory locks + class-row lock (respondToConfirmation) or run
 * as a serialized lifecycle repair. The paired→confirmed transition uses a
 * conditional UPDATE ... WHERE status='paired' with .returning() so that under
 * concurrency EXACTLY ONE caller performs the queue-entry advance + notify.
 */
async function _maybeMarkSessionConfirmed(
  tx: DbTx,
  pairedSessionId: number,
): Promise<void> {
  const confs = await tx
    .select()
    .from(incarSessionConfirmations)
    .where(eq(incarSessionConfirmations.pairedSessionId, pairedSessionId));

  const [session] = await tx
    .select()
    .from(incarPairedSessions)
    .where(eq(incarPairedSessions.id, pairedSessionId))
    .limit(1);
  if (!session) return;

  const { transition } = decideBothConfirmedTransition(
    confs.map((c) => c.status),
    session.status,
  );
  if (!transition) return;

  // Conditional session transition — exactly one winner.
  const [confirmedSession] = await tx
    .update(incarPairedSessions)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(
      and(
        eq(incarPairedSessions.id, pairedSessionId),
        eq(incarPairedSessions.status, "paired"),
      ),
    )
    .returning();

  // Lost the race (another caller already confirmed) — skip the follow-ups.
  if (!confirmedSession) return;

  await tx
    .update(incarPairingQueue)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(
      inArray(incarPairingQueue.id, [
        session.queueEntryIdA,
        session.queueEntryIdB,
      ]),
    );

  await audit(tx, {
    eventType: "session_confirmed",
    pairedSessionId,
    actorId: "system",
    actorRole: "system",
    previousStatus: "paired",
    newStatus: "confirmed",
  });

  // Notify both students that both final confirmations are in.
  notifyBothConfirmed(pairedSessionId).catch((err) =>
    console.error("[incar-pairing] both-confirmed notification error:", err),
  );
}

// ─── Dissolve pair helper ──────────────────────────────────────────────────────

/**
 * Dissolve a paired session:
 *   - declining/absent student → re-queued ('waiting')
 *   - remaining student's enrollment stays active; seat re-offered
 *   - paired session → 'dissolved'
 */
async function _dissolvePair(
  tx: DbTx,
  pairedSessionId: number,
  decliningStudentId: number,
  dissolutionReason: string,
  actorId: string,
  actorRole: string,
): Promise<void> {
  const [session] = await tx
    .select()
    .from(incarPairedSessions)
    .where(eq(incarPairedSessions.id, pairedSessionId))
    .limit(1);

  if (!session) return;
  if (session.status === "dissolved" || session.status === "cancelled") return;

  // Lock the class row FOR UPDATE (advisory student locks are already held by
  // the caller) so the re-offer below and any concurrent accept on this class
  // are serialized under the same protocol as accept/manualPair. Consistent
  // lock order (advisory locks → class row) prevents deadlocks.
  await lockClassRow(tx, session.classId);

  await tx
    .update(incarPairedSessions)
    .set({
      status: "dissolved",
      dissolvedAt: new Date(),
      dissolutionReason,
      updatedAt: new Date(),
    })
    .where(eq(incarPairedSessions.id, pairedSessionId));

  await audit(tx, {
    eventType: "pair_dissolved",
    pairedSessionId,
    studentId: decliningStudentId,
    classId: session.classId,
    actorId,
    actorRole,
    previousStatus: session.status,
    newStatus: "dissolved",
    details: { dissolutionReason },
  });

  // Determine which queue entry belongs to the declining student
  const decliningIsA = session.studentIdA === decliningStudentId;
  const decliningEntryId = decliningIsA ? session.queueEntryIdA : session.queueEntryIdB;
  const remainingEntryId = decliningIsA ? session.queueEntryIdB : session.queueEntryIdA;
  const remainingStudentId = decliningIsA ? session.studentIdB : session.studentIdA;

  // Cancel the declining student's enrollment
  const decliningEnrollmentId = decliningIsA ? session.enrollmentIdA : session.enrollmentIdB;
  if (decliningEnrollmentId) {
    await tx
      .update(classEnrollments)
      .set({ cancelledAt: new Date() })
      .where(eq(classEnrollments.id, decliningEnrollmentId));
  }

  // Re-queue declining student
  await tx
    .update(incarPairingQueue)
    .set({ status: "waiting", bookedClassId: null, enrollmentId: null, updatedAt: new Date() })
    .where(eq(incarPairingQueue.id, decliningEntryId));

  await audit(tx, {
    eventType: "requeued_after_dissolution",
    queueEntryId: decliningEntryId,
    studentId: decliningStudentId,
    actorId: "system",
    actorRole: "system",
    previousStatus: "paired",
    newStatus: "waiting",
  });

  // Remaining student: their enrollment stays; move back to booked_first
  await tx
    .update(incarPairingQueue)
    .set({ status: "booked_first", updatedAt: new Date() })
    .where(eq(incarPairingQueue.id, remainingEntryId));

  // Re-offer the seat
  await offerNextCandidate(tx, session.classId, "system", "system");

  // Notify both students that the pair broke (distinct messages).
  notifyPairBroken({
    pairedSessionId,
    classId: session.classId,
    remainingStudentId,
    requeuedStudentId: decliningStudentId,
  }).catch((err) =>
    console.error("[incar-pairing] pair-broken notification error:", err),
  );
}

// ─── manualPair ────────────────────────────────────────────────────────────────

/**
 * Admin manually pairs a waiting student with an existing booked-first student
 * on a specific class.
 *
 * Also exported as `pairStudents` for routes.ts back-compat (different signature
 * expected by routes — adapts below).
 */
export async function manualPair(params: {
  classId: number;
  waitingStudentId: number;
  actorId?: string;
  actorRole?: string;
}): Promise<OfferResponseResult> {
  const { classId, waitingStudentId, actorId = "admin", actorRole = "admin" } = params;

  return withLock([waitingStudentId], async (tx) => {
    // Find the waiting entry
    const [waitingEntry] = await tx
      .select()
      .from(incarPairingQueue)
      .where(
        and(
          eq(incarPairingQueue.studentId, waitingStudentId),
          inArray(incarPairingQueue.status, ["waiting", "offered"]),
        ),
      )
      .limit(1);

    // Lock the class row FOR UPDATE so concurrent pairings are serialized.
    const [cls] = await tx
      .select()
      .from(classes)
      .where(eq(classes.id, classId))
      .for("update")
      .limit(1);

    if (!cls) return { success: false, reason: "Class not found." };

    // Find the distinct active booked_first entry for this class.
    const [entry1] = await tx
      .select()
      .from(incarPairingQueue)
      .where(
        and(
          eq(incarPairingQueue.bookedClassId, classId),
          eq(incarPairingQueue.status, "booked_first"),
        ),
      )
      .limit(1);

    const enrolled = await tx
      .select()
      .from(classEnrollments)
      .where(
        and(
          eq(classEnrollments.classId, classId),
          isNull(classEnrollments.cancelledAt),
        ),
      );

    // Evaluate all guards via the shared pure decision helper.
    const guard = evaluateManualPairGuards({
      classIsCanonical: isCombined1213Class({
        classType: cls.classType,
        classNumber: cls.classNumber,
        duration: cls.duration,
        maxStudents: cls.maxStudents,
        courseType: cls.courseType,
      }),
      classStatus: cls.status,
      waitingStudentId,
      waitingEntryExists: !!waitingEntry,
      bookedFirstStudentId: entry1?.studentId ?? null,
      enrolledCount: enrolled.length,
      maxStudents: cls.maxStudents,
    });
    if (!guard.ok) {
      return { success: false, reason: guard.reason };
    }

    // Guard guarantees waitingEntry and entry1 both exist and are distinct.
    const wEntry = waitingEntry!;
    const firstBooker = entry1!;

    // (a) Withdraw any pending offer for THIS class (a candidate other than the
    // one we're pairing may be holding it) and return that candidate to
    // 'waiting' — otherwise the offer would orphan the second seat we consume.
    const openOffers = await tx
      .select()
      .from(incarPairingOffers)
      .where(
        and(
          eq(incarPairingOffers.classId, classId),
          eq(incarPairingOffers.status, "pending"),
        ),
      );
    for (const o of openOffers) {
      // Conditional claim — a concurrent accept/decline/expire wins.
      const claim = await applyOfferTransition(tx, o.id, "pending", "withdrawn");
      if (!claim.claimed) continue;
      // Return the offered candidate to waiting (unless it's the student we're
      // about to pair — that entry is advanced to paired below).
      if (o.queueEntryId !== wEntry.id) {
        await tx
          .update(incarPairingQueue)
          .set({ status: "waiting", updatedAt: new Date() })
          .where(
            and(
              eq(incarPairingQueue.id, o.queueEntryId),
              eq(incarPairingQueue.status, "offered"),
            ),
          );
      }
      await audit(tx, {
        eventType: "offer_withdrawn",
        queueEntryId: o.queueEntryId,
        offerId: o.id,
        studentId: o.studentId,
        classId,
        actorId: "system",
        actorRole: "system",
        previousStatus: "pending",
        newStatus: "withdrawn",
        details: { reason: "Admin manually paired a different student" },
      });
    }

    // (b) If the pairing candidate was itself 'offered' (possibly for a
    // DIFFERENT class than the manual-pair target), withdraw EVERY pending
    // offer belonging to their queue entry so a stale offer cannot later be
    // accepted. Collect the OTHER affected classes so their first-booker slots
    // are repaired via offerNextCandidate below.
    const classesToRepair = new Set<number>();
    if (wEntry.status === "offered") {
      const candidateOffers = await tx
        .select()
        .from(incarPairingOffers)
        .where(
          and(
            eq(incarPairingOffers.queueEntryId, wEntry.id),
            eq(incarPairingOffers.status, "pending"),
          ),
        );
      for (const o of candidateOffers) {
        const claim = await applyOfferTransition(tx, o.id, "pending", "withdrawn");
        if (!claim.claimed) continue;
        // The target class was already handled above; only OTHER classes need
        // a repair re-offer (their first-booker just lost their sole partner
        // offer). Do NOT repair the target class — it's being fully paired.
        if (o.classId !== classId) {
          classesToRepair.add(o.classId);
        }
        await audit(tx, {
          eventType: "offer_withdrawn",
          queueEntryId: wEntry.id,
          offerId: o.id,
          studentId: waitingStudentId,
          classId: o.classId,
          actorId: "system",
          actorRole: "system",
          previousStatus: "pending",
          newStatus: "withdrawn",
          details: {
            reason:
              "Candidate manually paired elsewhere; prior offer withdrawn",
          },
        });
      }
    }

    // Enroll the waiting student (mirrors the accept path).
    const [enrollment2] = await tx
      .insert(classEnrollments)
      .values({ classId, studentId: waitingStudentId, attendanceStatus: "registered" })
      .returning();

    const [session] = await tx
      .insert(incarPairedSessions)
      .values({
        queueEntryIdA: firstBooker.id,
        queueEntryIdB: wEntry.id,
        studentIdA: firstBooker.studentId,
        studentIdB: waitingStudentId,
        classId,
        enrollmentIdA: firstBooker.enrollmentId ?? null,
        enrollmentIdB: enrollment2.id,
        status: "paired",
      })
      .returning();

    // Advance both queue entries.
    await tx
      .update(incarPairingQueue)
      .set({ status: "paired", enrollmentId: enrollment2.id, updatedAt: new Date() })
      .where(eq(incarPairingQueue.id, wEntry.id));

    await tx
      .update(incarPairingQueue)
      .set({ status: "paired", updatedAt: new Date() })
      .where(eq(incarPairingQueue.id, firstBooker.id));

    await audit(tx, {
      eventType: "manually_paired",
      pairedSessionId: session.id,
      classId,
      actorId,
      actorRole,
      newStatus: "paired",
      details: {
        studentIdA: session.studentIdA,
        studentIdB: session.studentIdB,
      },
    });

    // Repair OTHER classes whose pending offer to this candidate we just
    // withdrew — their first-booker still has an open seat. Re-offer via the
    // lifecycle-safe helper (idempotent; one pending offer per class enforced).
    // Sorted ascending for deterministic ordering.
    for (const repairClassId of Array.from(classesToRepair).sort((a, b) => a - b)) {
      await offerNextCandidate(tx, repairClassId, "system", "system");
    }

    notifyPairCreated(session.id).catch(() => {});

    return { success: true, pairedSessionId: session.id };
  });
}

/** Legacy alias for routes.ts (routes passes queueEntryIdA, queueEntryIdB, proposedDate, proposedTime) */
export async function pairStudents(params: {
  queueEntryIdA: number;
  queueEntryIdB: number;
  proposedDate: string;
  proposedTime: string;
  actorId?: string;
  actorRole?: string;
}): Promise<OfferResponseResult> {
  const { queueEntryIdA, queueEntryIdB, actorId, actorRole } = params;

  // Look up the two entries to get student IDs and class
  const [entryA] = await db
    .select()
    .from(incarPairingQueue)
    .where(eq(incarPairingQueue.id, queueEntryIdA))
    .limit(1);
  const [entryB] = await db
    .select()
    .from(incarPairingQueue)
    .where(eq(incarPairingQueue.id, queueEntryIdB))
    .limit(1);

  if (!entryA || !entryB) {
    return { success: false, reason: "One or both queue entries not found." };
  }
  if (entryA.studentId === entryB.studentId) {
    return { success: false, reason: "Cannot pair a student with themselves." };
  }

  // One must be booked_first (has a classId) — the other joins that class
  const bookedEntry = entryA.bookedClassId
    ? entryA
    : entryB.bookedClassId
    ? entryB
    : null;
  const waitingEntry = bookedEntry?.id === entryA.id ? entryB : entryA;

  if (!bookedEntry?.bookedClassId) {
    return {
      success: false,
      reason:
        "One of the two entries must be in 'booked_first' status with a class booked. Use bookCombinedSlot first.",
    };
  }

  return manualPair({
    classId: bookedEntry.bookedClassId,
    waitingStudentId: waitingEntry.studentId,
    actorId,
    actorRole,
  });
}

// ─── requeueStudent ────────────────────────────────────────────────────────────

export async function requeueStudent(params: {
  queueEntryId: number;
  actorId?: string;
  actorRole?: string;
}): Promise<{ success: boolean; reason?: string }> {
  const { queueEntryId, actorId = "system", actorRole = "staff" } = params;

  // Read the entry (and, for paired/confirmed, the other party) first so we can
  // acquire the right advisory locks before mutating.
  const [preEntry] = await db
    .select()
    .from(incarPairingQueue)
    .where(eq(incarPairingQueue.id, queueEntryId))
    .limit(1);

  if (!preEntry) return { success: false, reason: "Queue entry not found." };

  const action = decideRequeueAction(preEntry.status);
  if (action.kind === "noop") return { success: true };
  if (action.kind === "reject") return { success: false, reason: action.reason };

  // For a pair dissolution we must lock BOTH students; otherwise just this one.
  let lockStudentIds: number[] = [preEntry.studentId];
  let pairedSessionId: number | null = null;
  if (action.kind === "dissolve_pair") {
    const [session] = await db
      .select()
      .from(incarPairedSessions)
      .where(
        and(
          or(
            eq(incarPairedSessions.queueEntryIdA, queueEntryId),
            eq(incarPairedSessions.queueEntryIdB, queueEntryId),
          ),
          inArray(incarPairedSessions.status, ["paired", "confirmed"]),
        ),
      )
      .limit(1);
    if (!session) {
      return {
        success: false,
        reason: "No active paired session found for this entry.",
      };
    }
    pairedSessionId = session.id;
    lockStudentIds = [session.studentIdA, session.studentIdB];
  }

  return withLock(lockStudentIds, async (tx) => {
    // Re-read the entry inside the lock (status may have drifted).
    const [entry] = await tx
      .select()
      .from(incarPairingQueue)
      .where(eq(incarPairingQueue.id, queueEntryId))
      .limit(1);
    if (!entry) return { success: false, reason: "Queue entry not found." };

    const lockedAction = decideRequeueAction(entry.status);
    if (lockedAction.kind === "noop") return { success: true };
    if (lockedAction.kind === "reject") {
      return { success: false, reason: lockedAction.reason };
    }

    const prev = entry.status;

    if (lockedAction.kind === "from_offered") {
      // Withdraw this student's pending offer, return them to waiting, then
      // re-offer the class so the seat isn't left blocked.
      const openOffers = await tx
        .select()
        .from(incarPairingOffers)
        .where(
          and(
            eq(incarPairingOffers.queueEntryId, queueEntryId),
            eq(incarPairingOffers.status, "pending"),
          ),
        );
      const claimedClassIds: number[] = [];
      for (const o of openOffers) {
        const claim = await applyOfferTransition(tx, o.id, "pending", "withdrawn");
        if (!claim.claimed) continue;
        claimedClassIds.push(o.classId);
        await audit(tx, {
          eventType: "offer_withdrawn",
          queueEntryId,
          offerId: o.id,
          studentId: entry.studentId,
          classId: o.classId,
          actorId,
          actorRole,
          previousStatus: "pending",
          newStatus: "withdrawn",
          details: { reason: "Admin requeued the offered student" },
        });
      }

      await tx
        .update(incarPairingQueue)
        .set({ status: "waiting", updatedAt: new Date() })
        .where(eq(incarPairingQueue.id, queueEntryId));

      await audit(tx, {
        eventType: "requeued",
        queueEntryId,
        studentId: entry.studentId,
        actorId,
        actorRole,
        previousStatus: prev,
        newStatus: "waiting",
      });

      // Re-offer only the class(es) whose offer we actually claimed.
      for (const cid of Array.from(new Set(claimedClassIds))) {
        await offerNextCandidate(tx, cid, "system", "system");
      }

      return { success: true };
    }

    if (lockedAction.kind === "from_booked_first") {
      // Lock the class row FOR UPDATE (advisory lock already held) and re-read
      // the entry so a concurrent ACCEPT that just paired this first-booker is
      // observed. If the entry is no longer booked_first, abort WITHOUT
      // mutating and tell the caller to retry.
      let liveEntry = entry;
      if (entry.bookedClassId != null) {
        const cls = await lockClassRow(tx, entry.bookedClassId);
        if (cls) {
          const [reread] = await tx
            .select()
            .from(incarPairingQueue)
            .where(eq(incarPairingQueue.id, queueEntryId))
            .limit(1);
          if (!reread) {
            return { success: false, reason: "Queue entry not found." };
          }
          const guard = decideBookedFirstTeardown(reread.status, "requeue");
          if (!guard.proceed) {
            return { success: false, reason: guard.reason };
          }
          liveEntry = reread;
        }
      }

      // Cancel this student's enrollment, withdraw the class's pending offer
      // (returning that candidate to waiting), then return this entry to
      // waiting retaining its priority.
      if (liveEntry.enrollmentId) {
        await tx
          .update(classEnrollments)
          .set({ cancelledAt: new Date() })
          .where(eq(classEnrollments.id, liveEntry.enrollmentId));
      }

      if (liveEntry.bookedClassId) {
        const openOffers = await tx
          .select()
          .from(incarPairingOffers)
          .where(
            and(
              eq(incarPairingOffers.classId, liveEntry.bookedClassId),
              eq(incarPairingOffers.status, "pending"),
            ),
          );
        for (const o of openOffers) {
          const claim = await applyOfferTransition(tx, o.id, "pending", "withdrawn");
          if (!claim.claimed) continue;
          await tx
            .update(incarPairingQueue)
            .set({ status: "waiting", updatedAt: new Date() })
            .where(
              and(
                eq(incarPairingQueue.id, o.queueEntryId),
                eq(incarPairingQueue.status, "offered"),
              ),
            );
          await audit(tx, {
            eventType: "offer_withdrawn",
            queueEntryId: o.queueEntryId,
            offerId: o.id,
            studentId: o.studentId,
            classId: liveEntry.bookedClassId,
            actorId: "system",
            actorRole: "system",
            previousStatus: "pending",
            newStatus: "withdrawn",
            details: { reason: "First-booker requeued by admin" },
          });
        }
      }

      await tx
        .update(incarPairingQueue)
        .set({
          status: "waiting",
          bookedClassId: null,
          enrollmentId: null,
          // priority retained (do not touch)
          updatedAt: new Date(),
        })
        .where(eq(incarPairingQueue.id, queueEntryId));

      await audit(tx, {
        eventType: "requeued",
        queueEntryId,
        studentId: liveEntry.studentId,
        actorId,
        actorRole,
        previousStatus: prev,
        newStatus: "waiting",
        details: { retainedPriority: liveEntry.priority },
      });

      return { success: true };
    }

    // dissolve_pair — paired | confirmed. Reuse the existing dissolution
    // semantics with THIS student as the leaving student.
    if (pairedSessionId == null) {
      return { success: false, reason: "No active paired session found for this entry." };
    }
    await _dissolvePair(
      tx,
      pairedSessionId,
      entry.studentId,
      "Admin requeued a paired student",
      actorId,
      actorRole,
    );

    return { success: true };
  });
}

// ─── Defer booked student (no partner before horizon) ──────────────────────────

async function deferBookedStudent(params: {
  queueEntryId: number;
  reason: string;
  actorId?: string;
  actorRole?: string;
}): Promise<void> {
  const { queueEntryId, reason, actorId = "scheduler", actorRole = "system" } = params;

  return db.transaction(async (tx) => {
    // Pre-lock read to discover the student (advisory lock) and target class.
    const [preEntry] = await tx
      .select()
      .from(incarPairingQueue)
      .where(eq(incarPairingQueue.id, queueEntryId))
      .limit(1);

    if (!preEntry || preEntry.status !== "booked_first") return;

    // Lock order: advisory (student) lock, THEN the class row FOR UPDATE — the
    // same protocol accept/manualPair use, so a concurrent accept on this class
    // is serialized against us.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${LOCK_NS}, ${preEntry.studentId})`,
    );
    let lockedClass: typeof classes.$inferSelect | null = null;
    if (preEntry.bookedClassId != null) {
      lockedClass = await lockClassRow(tx, preEntry.bookedClassId);
      if (!lockedClass) return; // class vanished — nothing to defer
    }

    // Re-read the entry UNDER the class lock and status-guard: if an accept won
    // the race the entry is now 'paired' — skip this entry this cycle.
    const [entry] = await tx
      .select()
      .from(incarPairingQueue)
      .where(eq(incarPairingQueue.id, queueEntryId))
      .limit(1);
    if (!entry) return;
    const guard = decideBookedFirstTeardown(entry.status, "defer");
    if (!guard.proceed) return;

    // A response deadline and the confirmation horizon are independent. While
    // a candidate still owns a pending, unexpired offer, preserve both queue
    // rows and the first enrollment until the class actually starts. The old
    // horizon transition withdrew this valid offer just before its recipient
    // clicked Accept, producing the misleading "no longer available" response.
    const now = new Date();
    const classStart = lockedClass
      ? getClassStartTime({
          date: lockedClass.date ?? "",
          time: lockedClass.time ?? "",
        })
      : null;
    if (entry.bookedClassId && classStart && now < classStart) {
      const [liveOffer] = await tx
        .select({ id: incarPairingOffers.id })
        .from(incarPairingOffers)
        .innerJoin(
          incarPairingQueue,
          eq(incarPairingQueue.id, incarPairingOffers.queueEntryId),
        )
        .where(
          and(
            eq(incarPairingOffers.classId, entry.bookedClassId),
            eq(incarPairingOffers.status, "pending"),
            sql`${incarPairingOffers.expiresAt} > ${now}`,
            eq(incarPairingQueue.status, "offered"),
          ),
        )
        .limit(1);
      if (liveOffer) return;
    }

    // Cancel enrollment
    if (entry.enrollmentId) {
      await tx
        .update(classEnrollments)
        .set({ cancelledAt: new Date() })
        .where(eq(classEnrollments.id, entry.enrollmentId));
    }

    // Withdraw any pending partner offer for this class and return the offered
    // candidate to 'waiting' — the seat is disappearing as we defer.
    if (entry.bookedClassId) {
      const openOffers = await tx
        .select()
        .from(incarPairingOffers)
        .where(
          and(
            eq(incarPairingOffers.classId, entry.bookedClassId),
            eq(incarPairingOffers.status, "pending"),
          ),
        );
      for (const o of openOffers) {
        const claim = await applyOfferTransition(tx, o.id, "pending", "withdrawn");
        if (!claim.claimed) continue;
        await tx
          .update(incarPairingQueue)
          .set({ status: "waiting", updatedAt: new Date() })
          .where(
            and(
              eq(incarPairingQueue.id, o.queueEntryId),
              eq(incarPairingQueue.status, "offered"),
            ),
          );
        await audit(tx, {
          eventType: "offer_withdrawn",
          queueEntryId: o.queueEntryId,
          offerId: o.id,
          studentId: o.studentId,
          classId: entry.bookedClassId,
          actorId: "system",
          actorRole: "system",
          previousStatus: "pending",
          newStatus: "withdrawn",
          details: { reason: "First-booker deferred; no partner in time" },
        });
      }
    }

    // Rather than a terminal 'deferred' status (which dead-ends the student),
    // return them to 'waiting' as a first-class queue member. We retain their
    // original queuedAt and boost priority (lower = higher) so they regain a
    // strong queue position for the next available shared slot. They can also
    // simply book a new date themselves.
    const boostedPriority = Math.min(entry.priority ?? 100, 50);
    await tx
      .update(incarPairingQueue)
      .set({
        status: "waiting",
        bookedClassId: null,
        enrollmentId: null,
        priority: boostedPriority,
        updatedAt: new Date(),
      })
      .where(eq(incarPairingQueue.id, queueEntryId));

    await audit(tx, {
      eventType: "deferred_no_partner",
      queueEntryId,
      studentId: entry.studentId,
      actorId,
      actorRole,
      previousStatus: "booked_first",
      newStatus: "waiting",
      details: { reason, boostedPriority },
    });

    notifyDeferral(entry.studentId).catch(() => {});
  });
}

// ─── convertPresentStudentToSolo ───────────────────────────────────────────────

export interface SoloConversionResult {
  success: boolean;
  newClassIds?: number[];
  newEnrollmentIds?: number[];
  preservedClassNumbers?: number[];
  reason?: string;
}
interface SoloConversionInternalResult extends SoloConversionResult {
  notification?: { studentId: number; newClassIds: number[] };
}

export function addMinutesToClassTime(time: string | null | undefined, minutes: number): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const total = hour * 60 + minute + minutes;
  if (total < 0 || total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
/**
 * Pure server-side gate for day-of solo conversion (Task 272, review round 4).
 *
 * Verifies:
 *  (1) The class has STARTED — conversion is valid only from the class start
 *      time onward (classStart <= now). A missing/unparseable start ⇒ blocked.
 *  (2) The present student's enrollment is still active (not cancelled).
 *  (3) The present student is marked checked-in/attended.
 *  (4) The partner's enrollment is marked 'absent' or 'no-show'.
 *
 * Returns { ok: true } when all gates pass, else { ok: false, reason } with a
 * caller-facing message. Exported so the transactional path and tests share
 * the exact same logic.
 */
export function evaluateSoloConversionGates(input: {
  classStartMs: number | null;
  nowMs: number;
  presentEnrollmentCancelled: boolean;
  presentEnrollmentExists: boolean;
  presentAttendanceStatus: string | null | undefined;
  partnerAttendanceStatus: string | null | undefined;
  partnerEnrollmentExists: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.classStartMs == null || input.classStartMs > input.nowMs) {
    return { ok: false, reason: "Class has not started yet." };
  }
  if (!input.presentEnrollmentExists || input.presentEnrollmentCancelled) {
    return { ok: false, reason: "Present student enrollment is not active." };
  }
  if (input.presentAttendanceStatus !== "attended") {
    return { ok: false, reason: "Present student has not been marked as attending." };
  }
  if (
    !input.partnerEnrollmentExists ||
    (input.partnerAttendanceStatus !== "absent" &&
      input.partnerAttendanceStatus !== "no-show")
  ) {
    return { ok: false, reason: "Partner has not been marked as a no-show." };
  }
  return { ok: true };
}

/**
 * Day-of conversion: the partner did not show.
 *
 * - Creates two NEW 60-minute solo classes with the same instructor/date:
 *   In-Car #11 at the original start, then In-Car #14 one hour later.
 * - Enrolls the present student in both and marks both 'attended'.
 * - Present student queue entry → 'converted_solo'.
 * - Absent student's original enrollment is kept (no-show; fee charged
 *   separately by the caller via chargeNoShowFee).
 * - Absent student queue entry → 'waiting' (re-queued).
 * - Paired session → 'dissolved'.
 */
interface SoloConversionParams {
  pairedSessionId: number;
  presentEnrollmentId: number;
  actorId?: string;
  actorRole?: string;
  testHooks?: {
    beforeSecondLesson?: () => Promise<void>;
  };
}

async function convertPresentStudentToSoloInTransaction(
  tx: DbTx,
  params: SoloConversionParams,
): Promise<SoloConversionInternalResult> {
  const {
    pairedSessionId,
    presentEnrollmentId,
    actorId = "admin",
    actorRole = "admin",
    testHooks,
  } = params;

    const [session] = await tx
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, pairedSessionId))
      .limit(1);

    if (!session) return { success: false, reason: "Paired session not found." };
    if (!["paired", "confirmed"].includes(session.status)) {
      return { success: false, reason: `Session status is '${session.status}'; can only convert active sessions.` };
    }

    // Identify present vs absent based on presentEnrollmentId
    const isAPresent =
      session.enrollmentIdA === presentEnrollmentId;
    const isBPresent =
      session.enrollmentIdB === presentEnrollmentId;
    if (!isAPresent && !isBPresent) {
      return { success: false, reason: "presentEnrollmentId does not match either enrollment in this session." };
    }

    const presentStudentId = isAPresent ? session.studentIdA : session.studentIdB;
    const presentQueueEntryId = isAPresent ? session.queueEntryIdA : session.queueEntryIdB;
    const absentStudentId = isAPresent ? session.studentIdB : session.studentIdA;
    const absentQueueEntryId = isAPresent ? session.queueEntryIdB : session.queueEntryIdA;
    const absentEnrollmentId = isAPresent ? session.enrollmentIdB : session.enrollmentIdA;

    // Advisory locks
    await acquireStudentMutationLocks(tx, [presentStudentId, absentStudentId]);
    const [lockedOrigClass] = await tx.select().from(classes)
      .where(eq(classes.id, session.classId))
      .for("update")
      .limit(1);
    if (!lockedOrigClass) return { success: false, reason: "Original class not found." };
    const linkedEnrollmentIds = [session.enrollmentIdA, session.enrollmentIdB]
      .filter((id): id is number => id != null)
      .sort((a, b) => a - b);
    if (linkedEnrollmentIds.length !== 2) {
      return { success: false, reason: "Paired session is missing an enrollment linkage." };
    }
    const linkedEnrollments = await tx.select().from(classEnrollments)
      .where(inArray(classEnrollments.id, linkedEnrollmentIds))
      .orderBy(asc(classEnrollments.id))
      .for("update");
    const enrollmentA = linkedEnrollments.find((row) => row.id === session.enrollmentIdA);
    const enrollmentB = linkedEnrollments.find((row) => row.id === session.enrollmentIdB);
    if (
      linkedEnrollments.length !== 2 ||
      enrollmentA?.studentId !== session.studentIdA ||
      enrollmentB?.studentId !== session.studentIdB ||
      enrollmentA.classId !== session.classId ||
      enrollmentB.classId !== session.classId
    ) {
      return { success: false, reason: "Paired session enrollment ownership is inconsistent." };
    }

    // The first lookup identifies which students to lock. Re-read the session
    // under a row lock after those advisory locks so two simultaneous
    // conversions cannot both proceed from the same stale active status.
    const [lockedSession] = await tx
      .select()
      .from(incarPairedSessions)
      .where(eq(incarPairedSessions.id, pairedSessionId))
      .for("update")
      .limit(1);
    if (!lockedSession || !["paired", "confirmed"].includes(lockedSession.status)) {
      return {
        success: false,
        reason: `Session status is '${lockedSession?.status ?? "missing"}'; can only convert active sessions.`,
      };
    }

    // Preserve legitimate completed #11/#14 credit, but never silently consume
    // or cancel an unrelated active booking for either lesson.
    const existingTargets = await tx
      .select({
        enrollmentId: classEnrollments.id,
        attendanceStatus: classEnrollments.attendanceStatus,
        cancelledAt: classEnrollments.cancelledAt,
        classId: classes.id,
        classNumber: classes.classNumber,
      })
      .from(classEnrollments)
      .innerJoin(classes, eq(classEnrollments.classId, classes.id))
      .where(
        and(
          eq(classEnrollments.studentId, presentStudentId),
          eq(classes.courseType, "auto"),
          eq(classes.classType, "driving"),
          inArray(classes.classNumber, [11, 14]),
          isNull(classEnrollments.cancelledAt),
        ),
      );

    const unrelatedBooking = existingTargets.find(
      (row) =>
        row.attendanceStatus === "registered" ||
        row.attendanceStatus === "checked_in",
    );
    if (unrelatedBooking) {
      return {
        success: false,
        reason:
          `Cannot convert attendance: In-Car #${unrelatedBooking.classNumber} ` +
          `has an unrelated active booking (class ${unrelatedBooking.classId}).`,
      };
    }
    const completedNumbers = new Set(
      existingTargets
        .filter((row) => row.attendanceStatus === "attended")
        .map((row) => row.classNumber)
        .filter((value): value is number => value != null),
    );

    // Load the original class to copy instructor/date/time
    const origClass = lockedOrigClass;
    if (!isCombined1213Class(origClass)) {
      return { success: false, reason: "Original class is not a canonical Auto In-Car 12 paired lesson." };
    }
    if (
      actorRole === "instructor" &&
      (!Number.isInteger(Number(actorId)) || origClass.instructorId !== Number(actorId))
    ) {
      return { success: false, reason: "Instructor may only convert a class assigned to them." };
    }

    // ── Server-side conversion gates (Task 272, review round 4) ──────────────
    // Read both enrollments and the class start, then evaluate via the shared
    // pure helper so the transactional path and tests use identical logic.
    const classStart = getClassStartTime({
      date: origClass.date ?? "",
      time: origClass.time ?? "00:00",
    });

    const [presentEnrollment] = await tx
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.id, presentEnrollmentId))
      .limit(1);

    const [absentEnrollment] = absentEnrollmentId
      ? await tx
          .select()
          .from(classEnrollments)
          .where(eq(classEnrollments.id, absentEnrollmentId))
          .limit(1)
      : [undefined];
    if (absentEnrollment?.cancelledAt) {
      return { success: false, reason: "Partner enrollment is cancelled." };
    }

    const gate = evaluateSoloConversionGates({
      classStartMs: classStart ? classStart.getTime() : null,
      nowMs: Date.now(),
      presentEnrollmentExists: !!presentEnrollment,
      presentEnrollmentCancelled: !!presentEnrollment?.cancelledAt,
      presentAttendanceStatus: presentEnrollment?.attendanceStatus ?? null,
      partnerEnrollmentExists: !!absentEnrollment,
      partnerAttendanceStatus: absentEnrollment?.attendanceStatus ?? null,
    });
    if (!gate.ok) {
      return { success: false, reason: gate.reason };
    }

    const lesson14Time = addMinutesToClassTime(origClass.time, 60);
    if (!lesson14Time) {
      return { success: false, reason: "Original class time cannot support a second consecutive lesson." };
    }

    // Atomically CANCEL the present student's original combined 12/13
    // enrollment so it can never be marked attended and award #12/#13.
    // Setting cancelledAt is the authoritative exclusion mechanism: both
    // completeSession and buildCompletedClasses ignore cancelled/non-attended
    // rows. This must happen before we create the new solo class/enrollment.
    await tx
      .update(classEnrollments)
      .set({ cancelledAt: new Date() })
      .where(eq(classEnrollments.id, presentEnrollmentId));

    const newClasses: Array<typeof classes.$inferSelect> = [];
    const newEnrollments: Array<typeof classEnrollments.$inferSelect> = [];
    const conversionLessons = ([11, 14] as const).filter(
      (lesson) => !completedNumbers.has(lesson),
    );
    for (let index = 0; index < conversionLessons.length; index += 1) {
      const lesson = conversionLessons[index];
      if (index === 1) await testHooks?.beforeSecondLesson?.();
      const [newClass] = await tx.insert(classes).values({
        courseType: origClass.courseType ?? "auto",
        classType: "driving",
        classNumber: lesson,
        date: origClass.date,
        time: lesson === 11 ? origClass.time : lesson14Time,
        duration: 60,
        instructorId: origClass.instructorId,
        vehicleId: origClass.vehicleId,
        maxStudents: 1,
        status: "scheduled",
        lessonType: "regular",
        isExtra: false,
        room: origClass.room,
      }).returning();
      const [newEnrollment] = await tx.insert(classEnrollments).values({
        classId: newClass.id,
        studentId: presentStudentId,
        attendanceStatus: "attended",
      }).returning();
      newClasses.push(newClass);
      newEnrollments.push(newEnrollment);
    }

    // Update present student queue entry
    await tx
      .update(incarPairingQueue)
      .set({ status: "converted_solo", updatedAt: new Date() })
      .where(eq(incarPairingQueue.id, presentQueueEntryId));

    // Re-queue absent student (enrollment stays; caller charges no-show fee)
    await tx
      .update(incarPairingQueue)
      .set({
        status: "waiting",
        bookedClassId: null,
        enrollmentId: null,
        updatedAt: new Date(),
      })
      .where(eq(incarPairingQueue.id, absentQueueEntryId));

    // Dissolve paired session
    await tx
      .update(incarPairedSessions)
      .set({
        status: "dissolved",
        dissolvedAt: new Date(),
        dissolutionReason: "Day-of no-show; present student converted to In-Car 11 and 14",
        updatedAt: new Date(),
      })
      .where(eq(incarPairedSessions.id, pairedSessionId));

    await audit(tx, {
      eventType: "converted_to_solo",
      pairedSessionId,
      queueEntryId: presentQueueEntryId,
      studentId: presentStudentId,
      classId: newClasses[0]?.id ?? session.classId,
      actorId,
      actorRole,
      previousStatus: lockedSession.status,
      newStatus: "converted_solo",
      details: {
        targetSessionNumbers: [11, 14],
        preservedClassNumbers: Array.from(completedNumbers),
        newClassIds: newClasses.map((row) => row.id),
        newEnrollmentIds: newEnrollments.map((row) => row.id),
        absentStudentId,
        originalClassId: session.classId,
      },
    });

    await audit(tx, {
      eventType: "requeued_after_noshow",
      queueEntryId: absentQueueEntryId,
      studentId: absentStudentId,
      actorId: "system",
      actorRole: "system",
      previousStatus: "paired",
      newStatus: "waiting",
      details: { reason: "Partner was present; this student no-showed" },
    });

    return {
      success: true,
      newClassIds: newClasses.map((row) => row.id),
      newEnrollmentIds: newEnrollments.map((row) => row.id),
      preservedClassNumbers: Array.from(completedNumbers),
      notification: {
        studentId: presentStudentId,
        newClassIds: newClasses.map((row) => row.id),
      },
    };
}

export async function convertPresentStudentToSolo(
  params: SoloConversionParams,
): Promise<SoloConversionResult> {
  const result = await db.transaction((tx) =>
    convertPresentStudentToSoloInTransaction(tx, params),
  );
  const { notification, ...publicResult } = result;
  if (result.success && notification) {
    notifyLessonConverted(notification).catch((err) =>
      console.error("[incar-pairing] lesson-converted notification error:", err),
    );
  }
  return publicResult;
}

// ─── Central attendance write/finalization ────────────────────────────────────

type AttendanceStatus = "registered" | "checked_in" | "attended" | "absent" | "no-show";

export interface AttendanceEnrollmentChanges {
  attendanceStatus?: AttendanceStatus;
  testScore?: number | null;
  paymentStatus?: string | null;
  paidAmount?: number | null;
  checkInAt?: Date | string | null;
  checkOutAt?: Date | string | null;
  /** Friendly aliases accepted by roster callers. */
  checkInTime?: Date | string | null;
  checkOutTime?: Date | string | null;
  checkInSignature?: string | null;
  checkOutSignature?: string | null;
}

export interface AttendanceUpdate extends AttendanceEnrollmentChanges {
  enrollmentId: number;
  /** Routes may pass a nested changes object; direct fields remain supported. */
  changes?: AttendanceEnrollmentChanges;
}

export interface AttendanceClassUpdate {
  classId: number;
  changes: {
    status?: string;
    attendanceSignature?: string | null;
    attendanceSignedAt?: string | null;
    attendanceSignedBy?: number | null;
  };
}

export type PairedAttendanceFinalizationStatus =
  | "pending"
  | "completed"
  | "converted"
  | "unchanged"
  | "reconciled";

export interface PairedAttendanceFinalization {
  pairedSessionId: number;
  classId: number;
  status: PairedAttendanceFinalizationStatus;
  message: string;
  presentEnrollmentId?: number;
  newClassIds?: number[];
  newEnrollmentIds?: number[];
  preservedClassNumbers?: number[];
}

export interface SaveAttendanceWithPairingResult {
  enrollments: Array<typeof classEnrollments.$inferSelect>;
  pairedFinalizations: PairedAttendanceFinalization[];
}

export class AttendancePairingFinalizationError extends Error {
  readonly code = "ATTENDANCE_PAIRING_FINALIZATION_FAILED";
  readonly httpStatus = 409;
  constructor(
    message: string,
    readonly pairedSessionId?: number,
  ) {
    super(message);
    this.name = "AttendancePairingFinalizationError";
  }
}

function normalizedAttendanceChanges(update: AttendanceUpdate) {
  const source = { ...update, ...(update.changes ?? {}) };
  const changes: Record<string, unknown> = {};
  const copy = [
    "attendanceStatus",
    "testScore",
    "paymentStatus",
    "paidAmount",
    "checkInSignature",
    "checkOutSignature",
  ] as const;
  for (const key of copy) {
    if (source[key] !== undefined) changes[key] = source[key];
  }
  if (
    changes.attendanceStatus !== undefined &&
    !["registered", "checked_in", "attended", "absent", "no-show"].includes(
      String(changes.attendanceStatus),
    )
  ) {
    throw new AttendancePairingFinalizationError("Unsupported attendance status.");
  }
  const normalizeDate = (value: Date | string | null | undefined, field: string) => {
    if (value === undefined) return;
    if (value === null) {
      changes[field] = null;
      return;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new AttendancePairingFinalizationError(`${field} is not a valid date/time.`);
    }
    changes[field] = date;
  };
  normalizeDate(
    source.checkInAt !== undefined ? source.checkInAt : source.checkInTime,
    "checkInAt",
  );
  normalizeDate(
    source.checkOutAt !== undefined ? source.checkOutAt : source.checkOutTime,
    "checkOutAt",
  );
  return changes;
}

function pairedStatuses(
  session: typeof incarPairedSessions.$inferSelect,
  rows: Map<number, typeof classEnrollments.$inferSelect>,
) {
  const a = session.enrollmentIdA ? rows.get(session.enrollmentIdA) : undefined;
  const b = session.enrollmentIdB ? rows.get(session.enrollmentIdB) : undefined;
  return { a, b, aStatus: a?.attendanceStatus, bStatus: b?.attendanceStatus };
}

async function setSessionCompleted(
  tx: DbTx,
  session: typeof incarPairedSessions.$inferSelect,
  actorId: string,
  actorRole: string,
) {
  await tx.update(incarPairedSessions).set({
    status: "completed",
    completedAt: new Date(),
    dissolvedAt: null,
    dissolutionReason: null,
    updatedAt: new Date(),
  }).where(eq(incarPairedSessions.id, session.id));
  await tx.update(incarPairingQueue).set({
    status: "completed",
    updatedAt: new Date(),
  }).where(inArray(incarPairingQueue.id, [session.queueEntryIdA, session.queueEntryIdB]));
  await audit(tx, {
    eventType: "session_completed",
    pairedSessionId: session.id,
    classId: session.classId,
    actorId,
    actorRole,
    previousStatus: session.status,
    newStatus: "completed",
    details: { studentIdA: session.studentIdA, studentIdB: session.studentIdB },
  });
}

async function restoreActivePairedSession(
  tx: DbTx,
  session: typeof incarPairedSessions.$inferSelect,
  actorId: string,
  actorRole: string,
  reason: string,
) {
  await tx.update(incarPairedSessions).set({
    status: "paired",
    completedAt: null,
    dissolvedAt: null,
    dissolutionReason: null,
    updatedAt: new Date(),
  }).where(eq(incarPairedSessions.id, session.id));
  await tx.update(incarPairingQueue).set({
    status: "paired",
    bookedClassId: session.classId,
    updatedAt: new Date(),
  }).where(inArray(incarPairingQueue.id, [session.queueEntryIdA, session.queueEntryIdB]));
  if (session.enrollmentIdA) {
    await tx.update(incarPairingQueue)
      .set({ enrollmentId: session.enrollmentIdA })
      .where(eq(incarPairingQueue.id, session.queueEntryIdA));
  }
  if (session.enrollmentIdB) {
    await tx.update(incarPairingQueue)
      .set({ enrollmentId: session.enrollmentIdB })
      .where(eq(incarPairingQueue.id, session.queueEntryIdB));
  }
  await audit(tx, {
    eventType: "attendance_finalization_reconciled",
    pairedSessionId: session.id,
    classId: session.classId,
    actorId,
    actorRole,
    previousStatus: session.status,
    newStatus: "paired",
    details: { reason },
  });
}

async function reverseSoloConversion(
  tx: DbTx,
  session: typeof incarPairedSessions.$inferSelect,
  actorId: string,
  actorRole: string,
) {
  const [conversion] = await tx.select()
    .from(incarPairingAudit)
    .where(and(
      eq(incarPairingAudit.pairedSessionId, session.id),
      eq(incarPairingAudit.eventType, "converted_to_solo"),
    ))
    .orderBy(desc(incarPairingAudit.createdAt), desc(incarPairingAudit.id))
    .limit(1);
  if (!conversion) {
    throw new AttendancePairingFinalizationError(
      "Cannot reconcile converted attendance: conversion audit linkage is missing.",
      session.id,
    );
  }
  const details = (conversion.details ?? {}) as Record<string, unknown>;
  const generatedIds = Array.isArray(details.newEnrollmentIds)
    ? details.newEnrollmentIds.filter((id): id is number => Number.isInteger(id))
    : [];
  const presentEnrollmentId =
    session.enrollmentIdA != null && session.studentIdA === conversion.studentId
      ? session.enrollmentIdA
      : session.enrollmentIdB;
  const absentQueueId =
    session.studentIdA === conversion.studentId ? session.queueEntryIdB : session.queueEntryIdA;
  const presentQueueId =
    session.studentIdA === conversion.studentId ? session.queueEntryIdA : session.queueEntryIdB;
  const absentStudentId =
    session.studentIdA === conversion.studentId ? session.studentIdB : session.studentIdA;

  const queueRows = await tx.select().from(incarPairingQueue)
    .where(inArray(incarPairingQueue.id, [presentQueueId, absentQueueId]))
    .orderBy(asc(incarPairingQueue.id))
    .for("update");
  const presentQueue = queueRows.find((row) => row.id === presentQueueId);
  const absentQueue = queueRows.find((row) => row.id === absentQueueId);
  if (
    !presentQueue ||
    !absentQueue ||
    presentQueue.studentId !== conversion.studentId ||
    absentQueue.studentId !== absentStudentId
  ) {
    throw new AttendancePairingFinalizationError(
      "Cannot reconcile converted attendance because its queue ownership is inconsistent.",
      session.id,
    );
  }
  if (
    presentQueue.status !== "converted_solo" ||
    absentQueue.status !== "waiting" ||
    absentQueue.bookedClassId != null ||
    absentQueue.enrollmentId != null
  ) {
    throw new AttendancePairingFinalizationError(
      `Cannot reconcile converted attendance because the absent student's queue entry is now '${absentQueue.status}'.`,
      session.id,
    );
  }
  const [otherSession] = await tx.select({ id: incarPairedSessions.id })
    .from(incarPairedSessions)
    .where(and(
      or(
        inArray(incarPairedSessions.queueEntryIdA, [presentQueueId, absentQueueId]),
        inArray(incarPairedSessions.queueEntryIdB, [presentQueueId, absentQueueId]),
      ),
      inArray(incarPairedSessions.status, ["paired", "confirmed", "completed"]),
    ))
    .limit(1);
  if (otherSession) {
    throw new AttendancePairingFinalizationError(
      `Cannot reconcile converted attendance because queue ownership moved to paired session ${otherSession.id}.`,
      session.id,
    );
  }

  if (generatedIds.length) {
    const generated = await tx.select({
      enrollment: classEnrollments,
      class: classes,
    }).from(classEnrollments)
      .innerJoin(classes, eq(classEnrollments.classId, classes.id))
      .where(inArray(classEnrollments.id, generatedIds))
      .for("update");
    const unsafe = generated.find(({ enrollment, class: lesson }) =>
      enrollment.studentId !== conversion.studentId ||
      (enrollment.cancelledAt == null && enrollment.attendanceStatus !== "attended") ||
      enrollment.checkInAt != null ||
      enrollment.checkOutAt != null ||
      lesson.courseType !== "auto" ||
      lesson.classType !== "driving" ||
      ![11, 14].includes(lesson.classNumber) ||
      lesson.duration !== 60 ||
      lesson.maxStudents !== 1
    );
    if (generated.length !== generatedIds.length || unsafe) {
      throw new AttendancePairingFinalizationError(
        "Cannot reconcile converted attendance because a generated In-Car 11/14 credit was modified.",
        session.id,
      );
    }
    const generatedClassIds = generated.map(({ class: lesson }) => lesson.id);
    const otherActiveEnrollments = generatedClassIds.length
      ? await tx.select({ id: classEnrollments.id }).from(classEnrollments)
          .where(and(
            inArray(classEnrollments.classId, generatedClassIds),
            isNull(classEnrollments.cancelledAt),
          ))
      : [];
    if (otherActiveEnrollments.some((row) => !generatedIds.includes(row.id))) {
      throw new AttendancePairingFinalizationError(
        "Cannot reconcile converted attendance because a generated lesson now has another enrollment.",
        session.id,
      );
    }
    await tx.update(classEnrollments)
      .set({ cancelledAt: new Date() })
      .where(inArray(classEnrollments.id, generatedIds));
    if (generatedClassIds.length) {
      await tx.update(classes).set({ status: "cancelled" })
        .where(inArray(classes.id, generatedClassIds));
    }
  }
  if (presentEnrollmentId) {
    await tx.update(classEnrollments).set({ cancelledAt: null })
      .where(eq(classEnrollments.id, presentEnrollmentId));
  }
  await restoreActivePairedSession(
    tx,
    session,
    actorId,
    actorRole,
    "Attendance correction reversed generated solo credits",
  );
  await audit(tx, {
    eventType: "solo_conversion_reversed",
    pairedSessionId: session.id,
    classId: session.classId,
    studentId: conversion.studentId,
    actorId,
    actorRole,
    previousStatus: "converted_solo",
    newStatus: "paired",
    details: {
      conversionAuditId: conversion.id,
      reversedEnrollmentIds: generatedIds,
      preservedClassNumbers: details.preservedClassNumbers ?? [],
    },
  });
}

/**
 * Atomically writes one or many attendance rows and finalizes every affected
 * canonical paired 12/13 session. A finalization conflict throws
 * AttendancePairingFinalizationError and rolls back the whole write.
 */
export async function saveAttendanceWithPairing(params: {
  updates: AttendanceUpdate[];
  actorId: string;
  actorRole: string;
  expectedClassId?: number;
  classUpdate?: AttendanceClassUpdate;
  /** Internal read-only invocation used by lifecycle/legacy completion. */
  finalizeOnly?: boolean;
}): Promise<SaveAttendanceWithPairingResult> {
  const { updates, actorId, actorRole, expectedClassId, classUpdate, finalizeOnly = false } = params;
  if (!updates.length) {
    throw new AttendancePairingFinalizationError("At least one attendance update is required.");
  }
  const ids = updates.map((update) => update.enrollmentId);
  if (new Set(ids).size !== ids.length) {
    throw new AttendancePairingFinalizationError("Each enrollment may only be updated once.");
  }

  const conversionNotifications: Array<{ studentId: number; newClassIds: number[] }> = [];
  const result = await db.transaction(async (tx) => {
    const initialRows = await tx.select().from(classEnrollments)
      .where(inArray(classEnrollments.id, ids));
    if (initialRows.length !== ids.length) {
      throw new AttendancePairingFinalizationError("One or more attendance enrollments were not found.");
    }
    const submittedStudentIds = initialRows
      .map((row) => row.studentId)
      .filter((id): id is number => id != null);
    const submittedClassIds = Array.from(new Set(
      initialRows.map((row) => row.classId).filter((id): id is number => id != null),
    ));
    const possibleSessions = submittedClassIds.length
      ? await tx.select().from(incarPairedSessions)
          .where(or(
            inArray(incarPairedSessions.enrollmentIdA, ids),
            inArray(incarPairedSessions.enrollmentIdB, ids),
            inArray(incarPairedSessions.classId, submittedClassIds),
          ))
      : [];
    const discoveredSessions = possibleSessions.filter((session) =>
      ids.includes(session.enrollmentIdA ?? -1) ||
      ids.includes(session.enrollmentIdB ?? -1) ||
      (
        (session.enrollmentIdA == null || session.enrollmentIdB == null) &&
        submittedClassIds.includes(session.classId) &&
        submittedStudentIds.some(
          (studentId) => studentId === session.studentIdA || studentId === session.studentIdB,
        )
      ),
    );
    const allStudentIds = [
      ...submittedStudentIds,
      ...discoveredSessions.flatMap((session) => [session.studentIdA, session.studentIdB]),
    ];
    await acquireStudentMutationLocks(tx, allStudentIds);
    const sessionsAfterLock = submittedClassIds.length
      ? await tx.select().from(incarPairedSessions)
          .where(or(
            inArray(incarPairedSessions.enrollmentIdA, ids),
            inArray(incarPairedSessions.enrollmentIdB, ids),
            inArray(incarPairedSessions.classId, submittedClassIds),
          ))
      : [];
    const discoveredIds = new Set(discoveredSessions.map((session) => session.id));
    const newlyRelevantSession = sessionsAfterLock.find((session) =>
      !discoveredIds.has(session.id) &&
      (
        ids.includes(session.enrollmentIdA ?? -1) ||
        ids.includes(session.enrollmentIdB ?? -1) ||
        (
          (session.enrollmentIdA == null || session.enrollmentIdB == null) &&
          submittedClassIds.includes(session.classId) &&
          submittedStudentIds.some(
            (studentId) => studentId === session.studentIdA || studentId === session.studentIdB,
          )
        )
      )
    );
    if (newlyRelevantSession) {
      throw new AttendancePairingFinalizationError(
        "Pairing changed concurrently; retry the attendance save.",
        newlyRelevantSession.id,
      );
    }

    const classIds = Array.from(new Set([
      ...submittedClassIds,
      ...discoveredSessions.map((session) => session.classId),
    ])).sort((a, b) => a - b);
    const affectedClasses = classIds.length
      ? await tx.select().from(classes).where(inArray(classes.id, classIds))
          .orderBy(asc(classes.id)).for("update")
      : [];
    const allEnrollmentIds = Array.from(new Set([
      ...ids,
      ...discoveredSessions.flatMap((session) =>
        [session.enrollmentIdA, session.enrollmentIdB]
          .filter((id): id is number => id != null)
      ),
    ])).sort((a, b) => a - b);
    const allLockedRows = await tx.select().from(classEnrollments)
      .where(inArray(classEnrollments.id, allEnrollmentIds))
      .orderBy(asc(classEnrollments.id))
      .for("update");
    const lockedRows = allLockedRows.filter((row) => ids.includes(row.id));
    const classesById = new Map(affectedClasses.map((row) => [row.id, row]));

    if (expectedClassId != null && lockedRows.some((row) => row.classId !== expectedClassId)) {
      throw new AttendancePairingFinalizationError("An enrollment does not belong to the expected class.");
    }
    if (classUpdate && !classIds.includes(classUpdate.classId)) {
      throw new AttendancePairingFinalizationError("The class update is unrelated to these attendance rows.");
    }
    if (actorRole === "instructor") {
      const instructorId = Number(actorId);
      if (!Number.isInteger(instructorId) ||
          affectedClasses.some((row) => row.instructorId !== instructorId)) {
        throw new AttendancePairingFinalizationError(
          "Instructor may only save attendance for classes assigned to them.",
        );
      }
    }

    // Generated solo credits are immutable through ordinary attendance APIs;
    // staff correct the linked original paired enrollment instead.
    const generatedEdit = await tx.select({ id: incarPairingAudit.id })
      .from(incarPairingAudit)
      .where(and(
        eq(incarPairingAudit.eventType, "converted_to_solo"),
        sql`(${sql.join(
          ids.map((id) =>
            sql`${incarPairingAudit.details} @> ${JSON.stringify({ newEnrollmentIds: [id] })}::jsonb`
          ),
          sql` OR `,
        )})`,
      ))
      .limit(1);
    if (generatedEdit.length) {
      throw new AttendancePairingFinalizationError(
        "Generated In-Car 11/14 attendance must be corrected through its original paired lesson.",
      );
    }

    const previousById = new Map(lockedRows.map((row) => [row.id, row]));
    const updated: Array<typeof classEnrollments.$inferSelect> = [];
    for (const update of updates) {
      const changes = normalizedAttendanceChanges(update);
      if (!Object.keys(changes).length) {
        if (finalizeOnly) {
          const existing = previousById.get(update.enrollmentId);
          if (!existing) {
            throw new AttendancePairingFinalizationError(
              `Enrollment ${update.enrollmentId} disappeared during finalization.`,
            );
          }
          updated.push(existing);
          continue;
        }
        throw new AttendancePairingFinalizationError(
          `No attendance changes were supplied for enrollment ${update.enrollmentId}.`,
        );
      }
      const [row] = await tx.update(classEnrollments).set(changes)
        .where(eq(classEnrollments.id, update.enrollmentId)).returning();
      updated.push(row);
      const prior = previousById.get(row.id);
      const assignedClass = row.classId ? classesById.get(row.classId) : undefined;
      await tx.insert(attendanceAuditLogs).values({
        actorType: actorRole,
        actorId,
        actorName: null,
        action: updates.length > 1 ? "bulk_attendance" : "save_attendance",
        outcome: "success",
        classId: row.classId,
        enrollmentId: row.id,
        studentId: row.studentId,
        instructorId: assignedClass?.instructorId ?? null,
        previousStatus: prior?.attendanceStatus ?? null,
        newStatus: row.attendanceStatus,
        details: "Saved atomically with paired-attendance finalization",
      });
    }
    if (classUpdate) {
      await tx.update(classes).set(classUpdate.changes)
        .where(eq(classes.id, classUpdate.classId));
    }
    const currentLockedRows = await tx.select().from(classEnrollments)
      .where(inArray(classEnrollments.id, allEnrollmentIds))
      .orderBy(asc(classEnrollments.id));

    const sessionIds = discoveredSessions.map((session) => session.id).sort((a, b) => a - b);
    const sessions = sessionIds.length
      ? await tx.select().from(incarPairedSessions)
          .where(inArray(incarPairedSessions.id, sessionIds))
          .orderBy(asc(incarPairedSessions.id))
          .for("update")
      : [];
    const outcomes: PairedAttendanceFinalization[] = [];

    for (let session of sessions) {
      const [pairedClass] = await tx.select().from(classes)
        .where(eq(classes.id, session.classId)).limit(1);
      if (!pairedClass || !isCombined1213Class(pairedClass)) continue;
      const enrollmentIds = [session.enrollmentIdA, session.enrollmentIdB]
        .filter((id): id is number => id != null);
      if (enrollmentIds.length !== 2) {
        throw new AttendancePairingFinalizationError(
          "Paired session is missing an enrollment linkage.",
          session.id,
        );
      }
      let allRows = currentLockedRows.filter((row) => enrollmentIds.includes(row.id));
      let rowMap = new Map(allRows.map((row) => [row.id, row]));
      const rowA = session.enrollmentIdA ? rowMap.get(session.enrollmentIdA) : undefined;
      const rowB = session.enrollmentIdB ? rowMap.get(session.enrollmentIdB) : undefined;
      if (
        allRows.length !== 2 ||
        !rowA ||
        !rowB ||
        rowA.studentId !== session.studentIdA ||
        rowB.studentId !== session.studentIdB ||
        rowA.classId !== session.classId ||
        rowB.classId !== session.classId
      ) {
        throw new AttendancePairingFinalizationError(
          "Paired session enrollment ownership does not match its linked students and class.",
          session.id,
        );
      }
      let status = pairedStatuses(session, rowMap);
      let bothAttended = false;
      let soloA = false;
      let soloB = false;
      const deriveFinalState = () => {
        const a = status.a;
        const b = status.b;
        const aMissed = status.aStatus === "absent" || status.aStatus === "no-show";
        const bMissed = status.bStatus === "absent" || status.bStatus === "no-show";
        bothAttended =
          status.aStatus === "attended" && status.bStatus === "attended" &&
          a?.cancelledAt == null && b?.cancelledAt == null;
        soloA =
          status.aStatus === "attended" && bMissed &&
          a?.cancelledAt == null && b?.cancelledAt == null;
        soloB =
          status.bStatus === "attended" && aMissed &&
          a?.cancelledAt == null && b?.cancelledAt == null;
      };
      deriveFinalState();
      const start = getClassStartTime({ date: pairedClass.date, time: pairedClass.time });
      const hasStarted = !!start && start.getTime() <= Date.now();

      if (session.status === "dissolved") {
        const [conversion] = await tx.select({
          id: incarPairingAudit.id,
          studentId: incarPairingAudit.studentId,
        })
          .from(incarPairingAudit)
          .where(and(
            eq(incarPairingAudit.pairedSessionId, session.id),
            eq(incarPairingAudit.eventType, "converted_to_solo"),
          ))
          .orderBy(desc(incarPairingAudit.createdAt), desc(incarPairingAudit.id))
          .limit(1);
        const convertedEnrollmentId =
          conversion?.studentId === session.studentIdA
            ? session.enrollmentIdA
            : session.enrollmentIdB;
        const absentEnrollmentId =
          conversion?.studentId === session.studentIdA
            ? session.enrollmentIdB
            : session.enrollmentIdA;
        const convertedStatus = convertedEnrollmentId
          ? rowMap.get(convertedEnrollmentId)?.attendanceStatus
          : null;
        const absentStatus = absentEnrollmentId
          ? rowMap.get(absentEnrollmentId)?.attendanceStatus
          : null;
        const correctionContradictsConversion = !!conversion && (
          (ids.includes(convertedEnrollmentId!) && convertedStatus !== "attended") ||
          (ids.includes(absentEnrollmentId!) &&
            absentStatus !== "absent" && absentStatus !== "no-show")
        );
        if (conversion && correctionContradictsConversion) {
          await reverseSoloConversion(tx, session, actorId, actorRole);
          [session] = await tx.select().from(incarPairedSessions)
            .where(eq(incarPairedSessions.id, session.id)).limit(1);
          allRows = await tx.select().from(classEnrollments)
            .where(inArray(classEnrollments.id, enrollmentIds));
          rowMap = new Map(allRows.map((row) => [row.id, row]));
          status = pairedStatuses(session, rowMap);
          deriveFinalState();
        } else {
          outcomes.push({
            pairedSessionId: session.id,
            classId: session.classId,
            status: "unchanged",
            message: "The existing 11/14 conversion remains consistent with attendance.",
          });
          continue;
        }
      }

      const rawAMissed = status.aStatus === "absent" || status.aStatus === "no-show";
      const rawBMissed = status.bStatus === "absent" || status.bStatus === "no-show";
      const rawTerminal =
        (status.aStatus === "attended" && status.bStatus === "attended") ||
        (status.aStatus === "attended" && rawBMissed) ||
        (status.bStatus === "attended" && rawAMissed);
      if (rawTerminal && !bothAttended && !soloA && !soloB) {
        throw new AttendancePairingFinalizationError(
          "Paired attendance cannot finalize because a linked enrollment is cancelled.",
          session.id,
        );
      }
      if (session.status === "completed" && !bothAttended) {
        await restoreActivePairedSession(
          tx, session, actorId, actorRole, "Attendance correction reversed paired completion",
        );
        session = { ...session, status: "paired", completedAt: null };
      }
      if (!hasStarted) {
        outcomes.push({
          pairedSessionId: session.id,
          classId: session.classId,
          status: "pending",
          message: "Paired attendance is saved but cannot finalize before the school-local class start.",
        });
      } else if (bothAttended) {
        if (session.status !== "completed") {
          await setSessionCompleted(tx, session, actorId, actorRole);
        }
        outcomes.push({
          pairedSessionId: session.id,
          classId: session.classId,
          status: session.status === "completed" ? "unchanged" : "completed",
          message: "Both students attended; the paired 12/13 session is complete.",
        });
      } else if (soloA || soloB) {
        const presentEnrollmentId = soloA ? session.enrollmentIdA! : session.enrollmentIdB!;
        const conversion = await convertPresentStudentToSoloInTransaction(tx, {
          pairedSessionId: session.id,
          presentEnrollmentId,
          actorId,
          actorRole,
        });
        if (!conversion.success) {
          throw new AttendancePairingFinalizationError(
            conversion.reason ?? "Paired no-show conversion failed.",
            session.id,
          );
        }
        if (conversion.notification) conversionNotifications.push(conversion.notification);
        outcomes.push({
          pairedSessionId: session.id,
          classId: session.classId,
          status: "converted",
          message: "The attending student received In-Car 11 and 14 credit.",
          presentEnrollmentId,
          newClassIds: conversion.newClassIds,
          newEnrollmentIds: conversion.newEnrollmentIds,
          preservedClassNumbers: conversion.preservedClassNumbers,
        });
      } else {
        outcomes.push({
          pairedSessionId: session.id,
          classId: session.classId,
          status: "pending",
          message: "Paired attendance is not final yet.",
        });
      }
    }

    const resultRows = await tx.select().from(classEnrollments)
      .where(inArray(classEnrollments.id, ids));
    return { enrollments: resultRows, pairedFinalizations: outcomes };
  });
  for (const notification of conversionNotifications) {
    notifyLessonConverted(notification).catch((err) =>
      console.error("[incar-pairing] lesson-converted notification error:", err),
    );
  }
  return result;
}

/** Legacy alias for routes.ts */
export async function convertToSoloLesson(params: {
  queueEntryId: number;
  studentId: number;
  actorId?: string;
  actorRole?: string;
}): Promise<SoloConversionResult> {
  const { queueEntryId, studentId, actorId, actorRole } = params;

  // Look up the paired session for this queue entry
  const entry = await db
    .select()
    .from(incarPairingQueue)
    .where(eq(incarPairingQueue.id, queueEntryId))
    .limit(1);

  if (entry.length === 0) return { success: false, reason: "Queue entry not found." };

  const session = await db
    .select()
    .from(incarPairedSessions)
    .where(
      and(
        or(
          eq(incarPairedSessions.queueEntryIdA, queueEntryId),
          eq(incarPairedSessions.queueEntryIdB, queueEntryId),
        ),
        inArray(incarPairedSessions.status, ["paired", "confirmed"]),
      ),
    )
    .limit(1);

  if (session.length === 0) {
    return { success: false, reason: "No active paired session found for this queue entry." };
  }

  const ps = session[0];
  const presentEnrollmentId =
    ps.queueEntryIdA === queueEntryId ? ps.enrollmentIdA : ps.enrollmentIdB;

  if (!presentEnrollmentId) {
    return { success: false, reason: "Enrollment ID not found on paired session." };
  }

  return convertPresentStudentToSolo({
    pairedSessionId: ps.id,
    presentEnrollmentId,
    actorId,
    actorRole,
  });
}

// ─── Complete session ──────────────────────────────────────────────────────────

/**
 * Called when the class is marked as attended by the instructor.
 * Marks both students' queue entries and the paired session as completed.
 * The buildCompletedClasses expansion in bookingRules.ts handles awarding
 * both In-Car #12 and #13 — no additional enrollment rows are needed.
 */
export async function completeSession(params: {
  pairedSessionId: number;
  actorId?: string;
  actorRole?: string;
}): Promise<{ success: boolean; reason?: string }> {
  const { pairedSessionId, actorId = "system", actorRole = "system" } = params;
  const [session] = await db.select().from(incarPairedSessions)
    .where(eq(incarPairedSessions.id, pairedSessionId))
    .limit(1);
  if (!session) return { success: false, reason: "Paired session not found." };
  if (session.status === "completed") return { success: true };
  if (!["paired", "confirmed"].includes(session.status)) {
    return { success: false, reason: `Cannot finalize session from status '${session.status}'.` };
  }
  const enrollmentIds = [session.enrollmentIdA, session.enrollmentIdB]
    .filter((id): id is number => id != null);
  if (enrollmentIds.length !== 2) {
    return { success: false, reason: "both_not_attended" };
  }
  try {
    const result = await saveAttendanceWithPairing({
      updates: enrollmentIds.map((enrollmentId) => ({
        enrollmentId,
        changes: {},
      })),
      actorId,
      actorRole,
      expectedClassId: session.classId,
      finalizeOnly: true,
    });
    const outcome = result.pairedFinalizations.find(
      (item) => item.pairedSessionId === pairedSessionId,
    );
    return outcome?.status === "completed" ||
      outcome?.status === "converted" ||
      outcome?.status === "unchanged"
      ? { success: true }
      : { success: false, reason: "both_not_attended" };
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : "Paired attendance finalization failed.",
    };
  }
}

// ─── processPairingLifecycle ───────────────────────────────────────────────────

/**
 * Scheduler sweep — should be called every few minutes.
 *
 * 1. Expire overdue pending offers → re-queue student 2 → offer next candidate.
 * 2. Defer booked-first students whose class is less than CONFIRMATION_HOURS_BEFORE
 *    hours away and still have no partner.
 * 3. Send confirmation requests to fully-paired sessions ~24 h before class
 *    (waking hours only, America/Toronto).
 */
export async function processPairingLifecycle(): Promise<{
  expiredOffers: number;
  deferredStudents: number;
  confirmationsSent: number;
  sessionsRepaired: number;
}> {
  const now = new Date();
  let expiredOffers = 0;
  let deferredStudents = 0;
  let confirmationsSent = 0;
  let sessionsRepaired = 0;

  // 1. Expire overdue offers
  const overdueOffers = await db
    .select()
    .from(incarPairingOffers)
    .where(
      and(
        eq(incarPairingOffers.status, "pending"),
        lt(incarPairingOffers.expiresAt, now),
      ),
    );

  for (const offer of overdueOffers) {
    try {
      await db.transaction(async (tx) => {
        await _expireOffer(tx, offer, "scheduler", "system");
      });
      expiredOffers++;
    } catch (err) {
      console.error(`[incar-pairing] Failed to expire offer ${offer.id}:`, err);
    }
  }

  // 2. Defer booked-first students with no partner if horizon reached
  const horizonTime = new Date(
    now.getTime() + CONFIRMATION_HOURS_BEFORE * 60 * 60 * 1000,
  );

  const bookedFirstEntries = await db
    .select({
      entry: incarPairingQueue,
      classDate: classes.date,
      classTime: classes.time,
    })
    .from(incarPairingQueue)
    .innerJoin(classes, eq(incarPairingQueue.bookedClassId, classes.id))
    .where(eq(incarPairingQueue.status, "booked_first"));

  for (const { entry, classDate, classTime } of bookedFirstEntries) {
    try {
      // Parse class start time in school timezone
      const { getClassStartTime } = await import("./class-time");
      const classStart = getClassStartTime({ date: classDate, time: classTime ?? "00:00" });
      if (!classStart) continue;
      if (classStart <= horizonTime) {
        await deferBookedStudent({
          queueEntryId: entry.id,
          reason: "No partner found before confirmation horizon",
        });
        deferredStudents++;
      }
    } catch (err) {
      console.error(`[incar-pairing] Failed to check deferred for entry ${entry.id}:`, err);
    }
  }

  // 3. Send confirmation requests for paired sessions nearing class time
  //    Only during waking hours in school timezone.
  const localHour = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: SCHOOL_TIMEZONE,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const inWakingHours = localHour >= WAKING_HOUR_START && localHour < WAKING_HOUR_END;

  if (inWakingHours) {
    const pairedSessions = await db
      .select({
        session: incarPairedSessions,
        classDate: classes.date,
        classTime: classes.time,
      })
      .from(incarPairedSessions)
      .innerJoin(classes, eq(incarPairedSessions.classId, classes.id))
      .where(inArray(incarPairedSessions.status, ["paired"]));

    for (const { session, classDate, classTime } of pairedSessions) {
      try {
        const { getClassStartTime } = await import("./class-time");
        const classStart = getClassStartTime({
          date: classDate,
          time: classTime ?? "00:00",
        });
        if (!classStart) continue;

        const hoursUntilClass =
          (classStart.getTime() - now.getTime()) / (60 * 60 * 1000);

        if (hoursUntilClass <= CONFIRMATION_HOURS_BEFORE && hoursUntilClass > 0) {
          // Check whether confirmations already sent
          const existingConfs = await db
            .select()
            .from(incarSessionConfirmations)
            .where(eq(incarSessionConfirmations.pairedSessionId, session.id));

          if (existingConfs.length === 0) {
            await db.transaction(async (tx) => {
              for (const { studentId, queueEntryId } of [
                { studentId: session.studentIdA, queueEntryId: session.queueEntryIdA },
                { studentId: session.studentIdB, queueEntryId: session.queueEntryIdB },
              ]) {
                const [conf] = await tx
                  .insert(incarSessionConfirmations)
                  .values({
                    pairedSessionId: session.id,
                    studentId,
                    queueEntryId,
                    status: "pending",
                  })
                  .returning();

                await audit(tx, {
                  eventType: "confirmation_requested",
                  pairedSessionId: session.id,
                  confirmationId: conf.id,
                  studentId,
                  actorId: "scheduler",
                  actorRole: "system",
                  newStatus: "pending",
                });

                confirmationsSent++;
                sendConfirmationNotification(conf.id).catch(() => {});
              }
            });
          }
        }
      } catch (err) {
        console.error(
          `[incar-pairing] Failed to process confirmation for session ${session.id}:`,
          err,
        );
      }
    }
  }

  // 4. Safety net: repair sessions where BOTH confirmations are 'confirmed' but
  //    the session is still 'paired' (e.g. a crash between the two concurrent
  //    confirms in an earlier build). Serialize each repair with the same
  //    both-student advisory locks + class-row lock; the conditional
  //    paired→confirmed transition inside _maybeMarkSessionConfirmed guarantees
  //    idempotency and exactly-one-winner semantics.
  const stalePairedSessions = await db
    .select({ session: incarPairedSessions })
    .from(incarPairedSessions)
    .where(eq(incarPairedSessions.status, "paired"));

  for (const { session } of stalePairedSessions) {
    try {
      const confs = await db
        .select()
        .from(incarSessionConfirmations)
        .where(eq(incarSessionConfirmations.pairedSessionId, session.id));

      // Cheap pre-filter (unlocked) — only lock/repair when it looks stuck.
      const { transition } = decideBothConfirmedTransition(
        confs.map((c) => c.status),
        session.status,
      );
      if (!transition) continue;

      await withLock([session.studentIdA, session.studentIdB], async (tx) => {
        const cls = await lockClassRow(tx, session.classId);
        if (!cls) return;
        // Re-reads both confirmations + session under the locks and applies the
        // conditional transition; no-op if another actor already confirmed.
        await _maybeMarkSessionConfirmed(tx, session.id);
      });

      // Re-read to see whether we actually flipped it (for the counter).
      const [after] = await db
        .select({ status: incarPairedSessions.status })
        .from(incarPairedSessions)
        .where(eq(incarPairedSessions.id, session.id))
        .limit(1);
      if (after?.status === "confirmed") sessionsRepaired++;
    } catch (err) {
      console.error(
        `[incar-pairing] Failed to repair stale confirmed session ${session.id}:`,
        err,
      );
    }
  }

  // 5. Attendance-finalization safety net. Routes normally finalize in the
  // same transaction as their write; this catches attendance imported or
  // committed by an older worker between deployments. The central service
  // re-reads and locks both rows, so a concurrent route save/conversion has one
  // winner and this retry becomes an idempotent no-op.
  const unfinishedAttendance = await db
    .select({ session: incarPairedSessions, class: classes })
    .from(incarPairedSessions)
    .innerJoin(classes, eq(incarPairedSessions.classId, classes.id))
    .where(inArray(incarPairedSessions.status, ["paired", "confirmed"]));
  for (const { session, class: pairedClass } of unfinishedAttendance) {
    if (!isCombined1213Class(pairedClass)) continue;
    const classStart = getClassStartTime({
      date: pairedClass.date,
      time: pairedClass.time,
    });
    if (!classStart || classStart.getTime() > now.getTime()) continue;
    const enrollmentIds = [session.enrollmentIdA, session.enrollmentIdB]
      .filter((id): id is number => id != null);
    if (enrollmentIds.length !== 2) continue;
    const attendance = await db.select({
      attendanceStatus: classEnrollments.attendanceStatus,
    }).from(classEnrollments).where(inArray(classEnrollments.id, enrollmentIds));
    if (attendance.length !== 2) continue;
    const statuses = attendance.map((row) => row.attendanceStatus);
    const attended = statuses.filter((status) => status === "attended").length;
    const missed = statuses.filter(
      (status) => status === "absent" || status === "no-show",
    ).length;
    if (!(attended === 2 || (attended === 1 && missed === 1))) continue;
    try {
      const finalized = await completeSession({
        pairedSessionId: session.id,
        actorId: "scheduler",
        actorRole: "system",
      });
      if (finalized.success) sessionsRepaired++;
    } catch (err) {
      console.error(
        `[incar-pairing] Failed attendance-finalization retry for session ${session.id}:`,
        err,
      );
    }
  }

  if (
    expiredOffers > 0 ||
    deferredStudents > 0 ||
    confirmationsSent > 0 ||
    sessionsRepaired > 0
  ) {
    console.log(
      `[incar-pairing] lifecycle: expired=${expiredOffers} deferred=${deferredStudents} confirmations=${confirmationsSent} repaired=${sessionsRepaired}`,
    );
  }

  return { expiredOffers, deferredStudents, confirmationsSent, sessionsRepaired };
}

// ─── Read helpers ──────────────────────────────────────────────────────────────

/** All active queue entries ordered by priority + FIFO.
 *  sessionNumber param accepted for routes.ts compat; always returns combined queue. */
export async function getQueue(
  _sessionNumber?: 12 | 13,
): Promise<IncarPairingQueue[]> {
  return db
    .select()
    .from(incarPairingQueue)
    .where(
      inArray(incarPairingQueue.status, [
        "waiting",
        "offered",
        "booked_first",
        "paired",
        "confirmed",
      ]),
    )
    .orderBy(asc(incarPairingQueue.priority), asc(incarPairingQueue.queuedAt));
}

/** Pending offer for a specific queue entry. */
export async function getPendingOffer(
  queueEntryId: number,
): Promise<IncarPairingOffer | null> {
  const [offer] = await db
    .select()
    .from(incarPairingOffers)
    .where(
      and(
        eq(incarPairingOffers.queueEntryId, queueEntryId),
        eq(incarPairingOffers.status, "pending"),
      ),
    )
    .limit(1);
  return offer ?? null;
}

/** Active paired sessions (paired, confirmed). */
export async function getActivePairedSessions(): Promise<IncarPairedSession[]> {
  return db
    .select()
    .from(incarPairedSessions)
    .where(inArray(incarPairedSessions.status, ["paired", "confirmed"]));
}

/** Pending confirmation rows for a student. */
export async function getPendingConfirmations(
  studentId: number,
): Promise<IncarSessionConfirmation[]> {
  return db
    .select()
    .from(incarSessionConfirmations)
    .where(
      and(
        eq(incarSessionConfirmations.studentId, studentId),
        eq(incarSessionConfirmations.status, "pending"),
      ),
    );
}

// ─── getStudentPairingStatus ───────────────────────────────────────────────────

export async function getStudentPairingStatus(studentId: number): Promise<{
  queueEntries: IncarPairingQueue[];
  pendingOffers: IncarPairingOffer[];
  pendingConfirmations: IncarSessionConfirmation[];
  activeSessions: IncarPairedSession[];
}> {
  const queueEntries = await db
    .select()
    .from(incarPairingQueue)
    .where(
      and(
        eq(incarPairingQueue.studentId, studentId),
        not(inArray(incarPairingQueue.status, ["cancelled", "completed"])),
      ),
    );

  const pendingOffers: IncarPairingOffer[] = [];
  for (const entry of queueEntries) {
    const offer = await getPendingOffer(entry.id);
    if (offer) pendingOffers.push(offer);
  }

  const pendingConfirmations = await getPendingConfirmations(studentId);

  const activeSessions = await db
    .select()
    .from(incarPairedSessions)
    .where(
      and(
        or(
          eq(incarPairedSessions.studentIdA, studentId),
          eq(incarPairedSessions.studentIdB, studentId),
        ),
        inArray(incarPairedSessions.status, ["paired", "confirmed"]),
      ),
    );

  return { queueEntries, pendingOffers, pendingConfirmations, activeSessions };
}

// ─── getAdminPairingOverview ───────────────────────────────────────────────────

/** Queue entry enriched with the student's name and, when booked, the class date/time. */
export type AdminPairingQueueEntry = IncarPairingQueue & {
  studentName: string | null;
  classDate: string | null;
  classTime: string | null;
};

/** Paired session enriched with both students' names and the class date/time. */
export type AdminPairedSession = IncarPairedSession & {
  studentNameA: string | null;
  studentNameB: string | null;
  classDate: string | null;
  classTime: string | null;
};

export async function getAdminPairingOverview(): Promise<{
  waiting: AdminPairingQueueEntry[];
  bookedFirst: AdminPairingQueueEntry[];
  offered: AdminPairingQueueEntry[];
  paired: AdminPairingQueueEntry[];
  activeSessions: AdminPairedSession[];
  pendingConfirmations: IncarSessionConfirmation[];
  stats: { waiting: number; bookedFirst: number; offered: number; activeSessionsTotal: number };
}> {
  const allActive = await getQueue();
  const rawActiveSessions = await getActivePairedSessions();

  // Batch-load student names and class date/time for everything referenced,
  // so the client doesn't need per-id lookups.
  const studentIds = new Set<number>();
  const classIds = new Set<number>();
  for (const e of allActive) {
    studentIds.add(e.studentId);
    if (e.bookedClassId != null) classIds.add(e.bookedClassId);
  }
  for (const s of rawActiveSessions) {
    studentIds.add(s.studentIdA);
    studentIds.add(s.studentIdB);
    classIds.add(s.classId);
  }

  const studentRows = studentIds.size
    ? await db
        .select({
          id: students.id,
          firstName: students.firstName,
          lastName: students.lastName,
        })
        .from(students)
        .where(inArray(students.id, Array.from(studentIds)))
    : [];
  const nameById = new Map(
    studentRows.map((s) => [s.id, `${s.firstName} ${s.lastName}`]),
  );

  const classRows = classIds.size
    ? await db
        .select({ id: classes.id, date: classes.date, time: classes.time })
        .from(classes)
        .where(inArray(classes.id, Array.from(classIds)))
    : [];
  const classById = new Map(classRows.map((c) => [c.id, c]));

  const enrichEntry = (e: IncarPairingQueue): AdminPairingQueueEntry => {
    const cls = e.bookedClassId != null ? classById.get(e.bookedClassId) : undefined;
    return {
      ...e,
      studentName: nameById.get(e.studentId) ?? null,
      classDate: cls?.date ?? null,
      classTime: cls?.time ?? null,
    };
  };

  const enriched = allActive.map(enrichEntry);
  const waiting = enriched.filter((e) => e.status === "waiting");
  const bookedFirst = enriched.filter((e) => e.status === "booked_first");
  const offered = enriched.filter((e) => e.status === "offered");
  const paired = enriched.filter((e) => e.status === "paired" || e.status === "confirmed");

  const activeSessions: AdminPairedSession[] = rawActiveSessions.map((s) => {
    const cls = classById.get(s.classId);
    return {
      ...s,
      studentNameA: nameById.get(s.studentIdA) ?? null,
      studentNameB: nameById.get(s.studentIdB) ?? null,
      classDate: cls?.date ?? null,
      classTime: cls?.time ?? null,
    };
  });

  const sessionStudentIds = Array.from(
    new Set(rawActiveSessions.flatMap((s) => [s.studentIdA, s.studentIdB])),
  );
  const pendingConfirmations: IncarSessionConfirmation[] = [];
  for (const sid of sessionStudentIds) {
    pendingConfirmations.push(...(await getPendingConfirmations(sid)));
  }

  return {
    waiting,
    bookedFirst,
    offered,
    paired,
    activeSessions,
    pendingConfirmations,
    stats: {
      waiting: waiting.length,
      bookedFirst: bookedFirst.length,
      offered: offered.length,
      activeSessionsTotal: activeSessions.length,
    },
  };
}

// ─── getPairingAuditHistory ────────────────────────────────────────────────────

/** A single pairing audit event enriched with the student's name for display. */
export interface PairingAuditHistoryEvent {
  id: number;
  eventType: string;
  queueEntryId: number | null;
  pairedSessionId: number | null;
  offerId: number | null;
  confirmationId: number | null;
  studentId: number | null;
  studentName: string | null;
  classId: number | null;
  actorId: string | null;
  actorRole: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Full 12/13 pairing audit timeline, filterable per student or per class,
 * newest first. Used by the office to answer "why was my session deferred /
 * why did my partner change" questions without querying the database.
 */
export async function getPairingAuditHistory(params: {
  studentId?: number;
  classId?: number;
  limit?: number;
}): Promise<PairingAuditHistoryEvent[]> {
  const conditions = [];
  if (params.studentId != null) {
    conditions.push(eq(incarPairingAudit.studentId, params.studentId));
  }
  if (params.classId != null) {
    conditions.push(eq(incarPairingAudit.classId, params.classId));
  }
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);

  const rows = await db
    .select({
      id: incarPairingAudit.id,
      eventType: incarPairingAudit.eventType,
      queueEntryId: incarPairingAudit.queueEntryId,
      pairedSessionId: incarPairingAudit.pairedSessionId,
      offerId: incarPairingAudit.offerId,
      confirmationId: incarPairingAudit.confirmationId,
      studentId: incarPairingAudit.studentId,
      firstName: students.firstName,
      lastName: students.lastName,
      classId: incarPairingAudit.classId,
      actorId: incarPairingAudit.actorId,
      actorRole: incarPairingAudit.actorRole,
      previousStatus: incarPairingAudit.previousStatus,
      newStatus: incarPairingAudit.newStatus,
      details: incarPairingAudit.details,
      createdAt: incarPairingAudit.createdAt,
    })
    .from(incarPairingAudit)
    .leftJoin(students, eq(incarPairingAudit.studentId, students.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(incarPairingAudit.createdAt), desc(incarPairingAudit.id))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    eventType: r.eventType,
    queueEntryId: r.queueEntryId,
    pairedSessionId: r.pairedSessionId,
    offerId: r.offerId,
    confirmationId: r.confirmationId,
    studentId: r.studentId,
    studentName:
      r.firstName || r.lastName
        ? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()
        : null,
    classId: r.classId,
    actorId: r.actorId,
    actorRole: r.actorRole,
    previousStatus: r.previousStatus,
    newStatus: r.newStatus,
    details: (r.details ?? null) as Record<string, unknown> | null,
    createdAt: r.createdAt,
  }));
}

// ─── Notification helpers ──────────────────────────────────────────────────────
//
// Distinct notification types (see server/services/notifications.ts):
//   incar_pairing_offer          — seat offered to a waiting student
//   incar_pairing_offer_expired  — the offer this student held expired
//   incar_pairing_confirmed      — pair created / both confirmations complete
//   incar_session_confirmation   — please confirm attendance (~24h before)
//   incar_pairing_broken         — pair dissolved (distinct message per role)
//   incar_pairing_deferred       — first-booker deferred; no partner found
//   incar_lesson_converted       — present student converted to solo lesson
//
// All are best-effort/fire-and-forget from the caller's perspective; they run
// after their transaction so a notification failure never rolls back state.

async function sendOfferNotification(
  offerId: number,
  classId: number,
  studentId: number,
): Promise<void> {
  const recipients = await getStudentRecipients(studentId);
  if (recipients.length === 0) return;

  const [cls] = await db
    .select()
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);

  const expiresIn = `${OFFER_DEADLINE_HOURS} hours`;
  await enqueueNotification({
    type: "incar_pairing_offer",
    title: "In-Car #12/13 Pairing Offer",
    message:
      `You have been offered a seat in an In-Car #12/13 shared session.\n\n` +
      `Class date: ${cls?.date ?? "TBD"} at ${cls?.time ?? "TBD"}\n\n` +
        `This two-consecutive-hour lesson requires two students and remains tentative until both students confirm. ` +
        `You will spend one hour driving and one hour observing and evaluating from the back seat. ` +
        `If your partner unexpectedly does not show up, the lesson may be adjusted to Sessions 11 and 14.\n\n` +
      `Please accept or decline within ${expiresIn}. If you do not respond, ` +
      `the offer will expire and you will remain in the queue.`,
    payload: { offerId, classId, studentId },
    recipients,
  });
}

async function notifyOfferExpired(
  offerId: number,
  classId: number,
  studentId: number,
): Promise<void> {
  const recipients = await getStudentRecipients(studentId);
  if (recipients.length === 0) return;

  await enqueueNotification({
    type: "incar_pairing_offer_expired",
    title: "In-Car #12/13 Pairing Offer Expired",
    message:
      `Your In-Car #12/13 pairing offer expired because it was not answered in time. ` +
      `You remain in the queue and will be offered another shared session when one ` +
      `becomes available.`,
    payload: { offerId, classId, studentId },
    recipients,
  });
}

/** Sent to both students when a pair is first created (offer accepted / manual). */
async function notifyPairCreated(pairedSessionId: number): Promise<void> {
  const [session] = await db
    .select()
    .from(incarPairedSessions)
    .where(eq(incarPairedSessions.id, pairedSessionId))
    .limit(1);
  if (!session) return;

  for (const studentId of [session.studentIdA, session.studentIdB]) {
    const recipients = await getStudentRecipients(studentId);
    if (recipients.length === 0) continue;
    await enqueueNotification({
      type: "incar_pairing_confirmed",
      title: "In-Car #12/13 Pairing Confirmed",
      message:
        `Great news — you have been paired for your In-Car #12/13 combined session! ` +
        `The booking remains tentative until both students confirm. This is a two-consecutive-hour shared lesson: ` +
        `one hour driving and one hour observing and evaluating from the back seat. If your partner unexpectedly ` +
        `does not show up, the lesson may be adjusted to Sessions 11 and 14. ` +
        `You will receive a confirmation request approximately 24 hours before the class. ` +
        `This session counts as both In-Car #12 and In-Car #13.`,
      payload: { sessionId: pairedSessionId, pairedSessionId, classId: session.classId },
      recipients,
    });
  }
}

/** Sent to both students once both final attendance confirmations are in. */
async function notifyBothConfirmed(pairedSessionId: number): Promise<void> {
  const [session] = await db
    .select()
    .from(incarPairedSessions)
    .where(eq(incarPairedSessions.id, pairedSessionId))
    .limit(1);
  if (!session) return;

  const [cls] = await db
    .select()
    .from(classes)
    .where(eq(classes.id, session.classId))
    .limit(1);

  for (const studentId of [session.studentIdA, session.studentIdB]) {
    const recipients = await getStudentRecipients(studentId);
    if (recipients.length === 0) continue;
    await enqueueNotification({
      type: "incar_pairing_confirmed",
      title: "In-Car #12/13 Session Confirmed by Both Students",
      message:
        `Both students have confirmed attendance for your In-Car #12/13 shared session` +
        `${cls?.date ? ` on ${cls.date} at ${cls.time ?? ""}` : ""}. ` +
        `The lesson lasts two consecutive hours: one hour driving and one hour observing and evaluating from the back seat. ` +
        `If your partner unexpectedly does not show up, the lesson may be adjusted to Sessions 11 and 14. ` +
        `See you there! This session counts as both In-Car #12 and In-Car #13.`,
      payload: { sessionId: pairedSessionId, pairedSessionId, classId: session.classId },
      recipients,
    });
  }
}

/**
 * Sent to BOTH students when a pair breaks, with role-specific messaging:
 *  - remaining student: we are finding you a new partner; your spot is held.
 *  - requeued student: you have been returned to the queue.
 */
async function notifyPairBroken(params: {
  pairedSessionId: number;
  classId: number;
  remainingStudentId: number;
  requeuedStudentId: number;
}): Promise<void> {
  const { pairedSessionId, classId, remainingStudentId, requeuedStudentId } = params;

  const [cls] = await db
    .select()
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);
  const dateStr = cls?.date ?? "your scheduled date";

  const remRecipients = await getStudentRecipients(remainingStudentId);
  if (remRecipients.length > 0) {
    await enqueueNotification({
      type: "incar_pairing_broken",
      title: "In-Car #12/13 Pairing Broken — Finding a New Partner",
      message:
        `Your pairing partner for the In-Car #12/13 session on ${dateStr} is no longer able ` +
        `to attend. Your spot is still reserved and we are looking for a new partner for you.`,
      payload: { sessionId: pairedSessionId, pairedSessionId, classId, role: "remaining" },
      recipients: remRecipients,
    });
  }

  const reqRecipients = await getStudentRecipients(requeuedStudentId);
  if (reqRecipients.length > 0) {
    await enqueueNotification({
      type: "incar_pairing_broken",
      title: "In-Car #12/13 Pairing Cancelled — Returned to Queue",
      message:
        `Your In-Car #12/13 pairing for ${dateStr} has been cancelled and you have been ` +
        `returned to the pairing queue. You will be offered another shared session when ` +
        `one becomes available.`,
      payload: { sessionId: pairedSessionId, pairedSessionId, classId, role: "requeued" },
      recipients: reqRecipients,
    });
  }
}

/** Sent to the deferred first-booker and the office when no partner was found. */
async function notifyDeferral(studentId: number): Promise<void> {
  const recipients = await getStudentRecipients(studentId);
  const officeRecipients = await getOfficeRecipients();
  if (recipients.length === 0 && officeRecipients.length === 0) return;

  await enqueueNotification({
    type: "incar_pairing_deferred",
    title: "In-Car #12/13 Session Deferred — No Partner Found",
    message:
      `We were unable to find a partner for your In-Car #12/13 session in time. ` +
      `Your enrollment for that date has been released, but you are kept in the queue with ` +
      `priority; you can also book a new date. You will be offered a new shared slot as ` +
      `soon as a partner is available. Please contact the office if you have questions.`,
    payload: { studentId },
    recipients: [...recipients, ...officeRecipients],
  });
}

/** Sent to the present student after a day-of solo conversion. */
async function notifyLessonConverted(params: {
  studentId: number;
  newClassIds: number[];
}): Promise<void> {
  const { studentId, newClassIds } = params;
  const recipients = await getStudentRecipients(studentId);
  if (recipients.length === 0) return;

  const [cls] = await db
    .select()
    .from(classes)
    .where(eq(classes.id, newClassIds[0]))
    .limit(1);

  await enqueueNotification({
    type: "incar_lesson_converted",
    title: "In-Car Session Converted to Lessons #11 and #14",
    message:
      `Because your pairing partner did not attend, your In-Car #12/13 session was ` +
      `converted to two solo 60-minute lessons: In-Car #11 followed by In-Car #14` +
      `${cls?.date ? ` on ${cls.date} at ${cls.time ?? ""}` : ""}. ` +
      `Your progress has been recorded accordingly.`,
    payload: { studentId, newClassIds, targetSessionNumbers: [11, 14] },
    recipients,
  });
}

async function sendConfirmationNotification(confirmationId: number): Promise<void> {
  const [conf] = await db
    .select()
    .from(incarSessionConfirmations)
    .where(eq(incarSessionConfirmations.id, confirmationId))
    .limit(1);
  if (!conf) return;

  const [session] = await db
    .select()
    .from(incarPairedSessions)
    .where(eq(incarPairedSessions.id, conf.pairedSessionId))
    .limit(1);
  if (!session) return;

  const [cls] = await db
    .select()
    .from(classes)
    .where(eq(classes.id, session.classId))
    .limit(1);

  const recipients = await getStudentRecipients(conf.studentId);
  if (recipients.length === 0) return;

  await enqueueNotification({
    type: "incar_session_confirmation",
    title: "Please Confirm Your In-Car #12/13 Session",
    message:
      `Your In-Car #12/13 paired session is coming up${cls?.date ? ` on ${cls.date} at ${cls.time ?? ""}` : ""}.\n\n` +
      `Please confirm you will attend. If you cannot make it, please decline ` +
      `so we can re-offer your spot to another student.`,
    payload: { confirmationId, sessionId: conf.pairedSessionId, pairedSessionId: conf.pairedSessionId },
    recipients,
  });
}
