/**
 * job-queue.ts — database-backed background job queue with an in-process
 * worker loop (same lifecycle pattern as the scheduled-message worker).
 *
 * - Jobs persist in the `jobs` table and survive restarts.
 * - The worker claims one job at a time with FOR UPDATE SKIP LOCKED, so
 *   multiple server instances never run the same job twice.
 * - Failed jobs retry with exponential backoff up to max_attempts.
 * - Running jobs hold a heartbeat lease (locked_by + lease_expires_at). Only
 *   jobs whose lease has expired are reclaimed, so a second instance starting
 *   up (rolling deploy) can never re-run a job that is actively executing on
 *   another live instance. Crash recovery falls out of the same rule: a dead
 *   process stops heartbeating and its jobs become reclaimable.
 * - Billing-category jobs are held for 4 hours after each server startup:
 *   they stay queued (visibly "held" in the admin UI) until the hold ends.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { jobs, type Job, type JobCategory } from "@shared/schema";

import { randomUUID } from "crypto";

const POLL_INTERVAL_MS = 5000;
export const BILLING_STARTUP_HOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

// Identity of this worker process; used to guard final status updates so a
// reclaimed job's original (stale) worker cannot overwrite the new owner.
const WORKER_ID = randomUUID();
let LEASE_MS = 60 * 1000; // running jobs must heartbeat within this window
let HEARTBEAT_MS = 20 * 1000;

/** Test-only hooks: shrink lease timings and run a claimed job directly. */
export const __testing = {
  setLeaseConfig(leaseMs: number, heartbeatMs: number) {
    LEASE_MS = leaseMs;
    HEARTBEAT_MS = heartbeatMs;
  },
  runJob: (job: Job) => runJob(job),
  workerId: () => WORKER_ID,
};

// Retry backoff: 1 min, 5 min, 15 min, then 60 min for later attempts.
const BACKOFF_MINUTES = [1, 5, 15];
function backoffMs(attempts: number): number {
  return (BACKOFF_MINUTES[attempts - 1] ?? 60) * 60 * 1000;
}

export type JobLogger = (line: string) => Promise<void>;
export type JobHandler = (payload: unknown, log: JobLogger) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export function getRegisteredJobTypes(): string[] {
  return Array.from(handlers.keys());
}

let intervalId: NodeJS.Timeout | null = null;
let workerStartedAt: Date | null = null;
let processing = false;

/** When billing jobs become eligible in this process (null before worker start). */
export function getBillingHoldUntil(): Date | null {
  return workerStartedAt ? new Date(workerStartedAt.getTime() + BILLING_STARTUP_HOLD_MS) : null;
}

export function isBillingHoldActive(): boolean {
  const until = getBillingHoldUntil();
  return until !== null && Date.now() < until.getTime();
}

export async function enqueueJob(opts: {
  type: string;
  category?: JobCategory;
  payload?: unknown;
  scheduledFor?: Date;
  maxAttempts?: number;
}): Promise<Job> {
  const [job] = await db.insert(jobs).values({
    type: opts.type,
    category: opts.category ?? "general",
    payload: opts.payload ?? null,
    scheduledFor: opts.scheduledFor ?? new Date(),
    maxAttempts: opts.maxAttempts ?? 3,
  }).returning();
  return job;
}

async function appendOutput(jobId: number, line: string) {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  await db.update(jobs)
    .set({ output: sql`${jobs.output} || ${stamped}`, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

/**
 * Atomically claim the next runnable job. Respects the billing startup hold
 * and per-job scheduled_for. Uses SKIP LOCKED so concurrent claimers never
 * grab the same row. Also reclaims "running" jobs whose heartbeat lease has
 * expired (their worker crashed or was killed) — but never jobs with a live
 * lease, so a rolling restart cannot double-run an actively executing job.
 *
 * This is the ONLY claim path — the worker tick and admin run-now both go
 * through it, so every execution is a single atomic conditional UPDATE and
 * a job can never be launched twice. Jobs flagged hold_override (admin
 * run-now) are claimable even while the billing startup hold is active.
 *
 * Exported for tests; `billingHeld` is injectable so hold behavior can be
 * tested without waiting on real process start time.
 */
export async function claimNextJob(billingHeld: boolean = isBillingHoldActive()): Promise<Job | null> {
  const result = await db.execute(sql`
    UPDATE jobs SET status = 'running', started_at = now(), finished_at = NULL,
                    attempts = attempts + 1, updated_at = now(),
                    locked_by = ${WORKER_ID}, lease_expires_at = now() + make_interval(secs => ${LEASE_MS / 1000})
    WHERE id = (
      SELECT id FROM jobs
      WHERE (
              (status = 'queued' AND scheduled_for <= now())
              OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
                  AND attempts < max_attempts)
            )
        ${billingHeld ? sql`AND (category <> 'billing' OR hold_override = true)` : sql``}
      ORDER BY scheduled_for ASC, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  const row = (result.rows as any[])[0];
  if (!row) return null;
  // db.execute returns snake_case columns; map to the Job shape we need.
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledFor: row.scheduled_for,
    output: row.output,
    holdOverride: row.hold_override,
    lockedBy: row.locked_by,
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  } as Job;
}

async function runJob(job: Job) {
  const log: JobLogger = (line) => appendOutput(job.id, line);
  const handler = handlers.get(job.type);
  // Heartbeat: keep extending the lease while the handler runs so other
  // instances never reclaim this job mid-execution. This intentionally
  // includes jobs cancelled mid-run: the (ignored) handler invocation is
  // still executing, so the lease must stay live to block retry/reclaim
  // until it actually winds down.
  const heartbeat = setInterval(() => {
    db.execute(sql`
      UPDATE jobs SET lease_expires_at = now() + make_interval(secs => ${LEASE_MS / 1000}), updated_at = now()
      WHERE id = ${job.id} AND locked_by = ${WORKER_ID} AND status IN ('running', 'cancelled')
    `).catch((err) => console.error(`[JOB-QUEUE] Heartbeat failed for job ${job.id}:`, err));
  }, HEARTBEAT_MS);
  // Final status updates require both status='running' (cancel may have
  // intervened) and locked_by=us (the job may have been reclaimed after a
  // lease expiry — the new owner's result must win, not ours).
  const stillOurs = () => and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, WORKER_ID));
  try {
    await log(`Attempt ${job.attempts}/${job.maxAttempts} started`);
    if (!handler) {
      throw new Error(`No handler registered for job type "${job.type}"`);
    }
    await handler(job.payload, log);
    const updated = await db.update(jobs)
      .set({ status: "succeeded", finishedAt: new Date(), lastError: null, lockedBy: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(stillOurs())
      .returning();
    if (updated.length > 0) await log("Succeeded");
  } catch (error: any) {
    const message = error?.message || String(error);
    await log(`ERROR: ${message}`);
    const willRetry = job.attempts < job.maxAttempts;
    const updates = willRetry
      ? {
          status: "queued" as const,
          scheduledFor: new Date(Date.now() + backoffMs(job.attempts)),
          lastError: message,
          lockedBy: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        }
      : { status: "failed" as const, finishedAt: new Date(), lastError: message, lockedBy: null, leaseExpiresAt: null, updatedAt: new Date() };
    const updated = await db.update(jobs)
      .set(updates)
      .where(stillOurs())
      .returning();
    if (updated.length > 0) {
      await log(willRetry
        ? `Retrying (attempt ${job.attempts + 1}/${job.maxAttempts}) after backoff`
        : `Failed permanently after ${job.attempts} attempts`);
    }
    console.error(`[JOB-QUEUE] Job ${job.id} (${job.type}) attempt ${job.attempts} failed:`, message);
  } finally {
    clearInterval(heartbeat);
    // If the job was cancelled while we were running it, the guarded final
    // update above matched nothing and the row still carries our lease.
    // Now that the handler invocation has truly ended, release the lease
    // (preserving cancelled status) so admin retry becomes possible.
    await db.update(jobs)
      .set({ lockedBy: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, WORKER_ID), eq(jobs.status, "cancelled")))
      .catch((err) => console.error(`[JOB-QUEUE] Failed to release cancelled job ${job.id}:`, err));
  }
}

/**
 * Finalize running jobs whose worker died during their final permitted
 * attempt: their lease has expired, but reclaiming them would push attempts
 * past max_attempts, so they are marked failed instead. Exported for tests.
 */
export async function failExpiredExhaustedJobs(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE jobs SET status = 'failed', finished_at = now(), updated_at = now(),
                    locked_by = NULL, lease_expires_at = NULL,
                    last_error = 'Worker died during the final permitted attempt (lease expired at max attempts)'
    WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
      AND attempts >= max_attempts
    RETURNING id
  `);
  const count = (result.rows as any[]).length;
  if (count > 0) console.log(`[JOB-QUEUE] Failed ${count} exhausted job(s) abandoned by a dead worker`);
  return count;
}

async function tick() {
  if (processing) return; // never overlap ticks
  processing = true;
  try {
    await failExpiredExhaustedJobs();
    // Drain all currently runnable jobs, one at a time.
    for (;;) {
      const job = await claimNextJob();
      if (!job) break;
      console.log(`[JOB-QUEUE] Running job ${job.id} (${job.type}, attempt ${job.attempts})`);
      await runJob(job);
    }
  } catch (error) {
    console.error("[JOB-QUEUE] Worker tick error:", error);
  } finally {
    processing = false;
  }
}

export function startJobQueueWorker() {
  if (intervalId) {
    console.log("[JOB-QUEUE] Worker already running");
    return;
  }
  workerStartedAt = new Date();
  console.log(`[JOB-QUEUE] Starting worker ${WORKER_ID}; billing jobs held until ${getBillingHoldUntil()!.toISOString()}`);

  // No blanket recovery of "running" jobs here: another live instance may
  // legitimately be executing them (rolling restart). Jobs abandoned by a
  // crashed process stop heartbeating and are reclaimed by claimNextJob()
  // once their lease expires.

  tick();
  intervalId = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopJobQueueWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[JOB-QUEUE] Stopped worker");
  }
}

// ---------------- Admin control actions ----------------

/**
 * Retry a failed/cancelled job: reset attempts window and queue it now.
 * Refuses while the job still holds a live lease — a job cancelled while
 * running keeps its lease until the (now-ignored) handler invocation winds
 * down and the lease lapses, so a retry can never produce two concurrent
 * handler executions across instances.
 */
export async function retryJob(id: number): Promise<Job | null> {
  const [job] = await db.update(jobs)
    .set({
      status: "queued",
      attempts: 0,
      scheduledFor: new Date(),
      startedAt: null,
      finishedAt: null,
      lastError: null,
      lockedBy: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(jobs.id, id),
      sql`${jobs.status} IN ('failed', 'cancelled', 'succeeded')`,
      sql`(${jobs.leaseExpiresAt} IS NULL OR ${jobs.leaseExpiresAt} < now())`,
    ))
    .returning();
  if (job) await appendOutput(id, "Manually retried by admin — attempts reset");
  return job ?? null;
}

/** Cancel a queued or running job. A running handler finishes its current
 *  attempt but its result is ignored (status stays cancelled). */
export async function cancelJob(id: number): Promise<Job | null> {
  const [job] = await db.update(jobs)
    .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(jobs.id, id), sql`${jobs.status} IN ('queued', 'running')`))
    .returning();
  if (job) await appendOutput(id, "Cancelled by admin");
  return job ?? null;
}

/**
 * Run a queued job immediately: pull scheduled_for to now and flag it as
 * exempt from the billing startup hold (hold_override). Execution itself
 * still flows through the single atomic claim path in the worker loop —
 * run-now never launches a handler directly, so a job can never be claimed
 * or executed twice, and the one-job-at-a-time worker invariant holds.
 */
export async function runJobNow(id: number): Promise<Job | null> {
  const [job] = await db.update(jobs)
    .set({ scheduledFor: new Date(), holdOverride: true, updatedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.status, "queued")))
    .returning();
  if (!job) return null;
  await appendOutput(id, "Run-now requested by admin (billing startup hold bypassed)");
  // Nudge the worker (only if it's running in this process); if a drain pass
  // is already in progress it will pick the job up on its next claim
  // iteration. Execution always flows through the single claim path.
  if (intervalId) {
    tick().catch((err) => console.error(`[JOB-QUEUE] run-now tick error:`, err));
  }
  return job;
}

// ---------------- Enqueue input validation ----------------

export function validateEnqueueInput(input: { scheduledFor?: unknown; maxAttempts?: unknown }): string | null {
  if (input.scheduledFor !== undefined && input.scheduledFor !== null) {
    const d = new Date(input.scheduledFor as any);
    if (isNaN(d.getTime())) return "scheduledFor must be a valid date";
  }
  if (input.maxAttempts !== undefined && input.maxAttempts !== null) {
    const n = input.maxAttempts;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 10) {
      return "maxAttempts must be an integer between 1 and 10";
    }
  }
  return null;
}

// ---------------- Built-in handlers ----------------

// Simple test handler so the queue can be exercised end-to-end from the
// admin page before real billing handlers exist (separate task).
registerJobHandler("test:echo", async (payload, log) => {
  await log(`Echo payload: ${JSON.stringify(payload ?? null)}`);
});

registerJobHandler("test:fail", async (payload, log) => {
  await log("This test job always fails (used to verify retry/backoff)");
  throw new Error((payload as any)?.message || "Intentional test failure");
});
