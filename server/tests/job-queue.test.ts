/**
 * Integration tests for the background job queue (server/job-queue.ts).
 *
 * Runs against the real dev database, which the live app's worker also polls.
 * To keep tests deterministic, test jobs use category "billing": the live
 * worker holds billing jobs for 4 hours after startup, so it won't steal
 * them, while tests claim explicitly with claimNextJob(billingHeld=false).
 * Any foreign job a test claim happens to grab is restored to queued.
 */
import { describe, it, expect, afterEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { jobs, type Job } from "@shared/schema";
import {
  enqueueJob,
  claimNextJob,
  runJobNow,
  cancelJob,
  retryJob,
  validateEnqueueInput,
  failExpiredExhaustedJobs,
  registerJobHandler,
  __testing,
} from "../job-queue";

const createdIds: number[] = [];

async function track<T extends { id: number }>(job: T): Promise<T> {
  createdIds.push(job.id);
  return job;
}

/** If a test claim grabbed a job we didn't create, put it back untouched. */
async function absorbClaim(claimed: Job | null): Promise<Job | null> {
  if (claimed && !createdIds.includes(claimed.id)) {
    await db.update(jobs)
      .set({
        status: "queued",
        attempts: claimed.attempts - 1,
        lockedBy: null,
        leaseExpiresAt: null,
        startedAt: null,
      })
      .where(eq(jobs.id, claimed.id));
  }
  return claimed;
}

afterEach(async () => {
  if (createdIds.length > 0) {
    await db.delete(jobs).where(inArray(jobs.id, createdIds.splice(0)));
  }
});

describe("enqueue input validation", () => {
  it("rejects invalid dates and out-of-range attempts", () => {
    expect(validateEnqueueInput({ scheduledFor: "not-a-date" })).toMatch(/valid date/);
    expect(validateEnqueueInput({ maxAttempts: 0 })).toMatch(/between 1 and 10/);
    expect(validateEnqueueInput({ maxAttempts: -3 })).toMatch(/between 1 and 10/);
    expect(validateEnqueueInput({ maxAttempts: 2.5 })).toMatch(/between 1 and 10/);
    expect(validateEnqueueInput({ maxAttempts: 99 })).toMatch(/between 1 and 10/);
    expect(validateEnqueueInput({ maxAttempts: "3" as any })).toMatch(/between 1 and 10/);
  });

  it("accepts valid input", () => {
    expect(validateEnqueueInput({})).toBeNull();
    expect(validateEnqueueInput({ scheduledFor: new Date().toISOString(), maxAttempts: 3 })).toBeNull();
  });
});

describe("atomic claim", () => {
  it("claims a due queued job exactly once under concurrent claimers", async () => {
    const job = await track(await enqueueJob({ type: "test:echo", category: "billing", payload: { t: "concurrency" } }));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimNextJob(false).then(absorbClaim)),
    );
    const timesOurs = results.filter((j) => j?.id === job.id).length;
    expect(timesOurs).toBe(1);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.status).toBe("running");
    expect(row.attempts).toBe(1);
    expect(row.lockedBy).toBeTruthy();
    expect(row.leaseExpiresAt).toBeTruthy();
  });

  it("does not claim jobs scheduled in the future", async () => {
    const job = await track(await enqueueJob({
      type: "test:echo",
      category: "billing",
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    }));
    const claimed = await claimNextJob(false).then(absorbClaim);
    expect(claimed?.id).not.toBe(job.id);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.status).toBe("queued");
  });
});

describe("billing startup hold", () => {
  it("skips billing jobs while the hold is active, but claims them when it is not", async () => {
    const job = await track(await enqueueJob({ type: "test:echo", category: "billing" }));
    const heldClaim = await claimNextJob(true).then(absorbClaim);
    expect(heldClaim?.id).not.toBe(job.id);

    const freeClaim = await claimNextJob(false).then(absorbClaim);
    expect(freeClaim?.id).toBe(job.id);
  });

  it("run-now flags hold_override so a held billing job becomes claimable during the hold", async () => {
    const job = await track(await enqueueJob({
      type: "test:echo",
      category: "billing",
      scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }));
    const updated = await runJobNow(job.id);
    expect(updated?.holdOverride).toBe(true);
    // runJobNow triggers this process's worker tick, which is not started in
    // tests, so the job stays queued unless we claim it. With the hold
    // active, the override must make it claimable. (In the live app the
    // hold-active worker claims it the same way.)
    const [afterRunNow] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    if (afterRunNow.status === "queued") {
      const claimed = await claimNextJob(true).then(absorbClaim);
      expect(claimed?.id).toBe(job.id);
    } else {
      expect(["running", "succeeded"]).toContain(afterRunNow.status);
    }
  });
});

describe("lease-based ownership", () => {
  it("reclaims a running job with an expired lease (crashed worker)", async () => {
    const [job] = await db.insert(jobs).values({
      type: "test:echo",
      category: "billing",
      status: "running",
      attempts: 1,
      scheduledFor: new Date(Date.now() - 60 * 1000),
      lockedBy: "dead-worker",
      leaseExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
    }).returning();
    await track(job);
    const claimed = await claimNextJob(false).then(absorbClaim);
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.attempts).toBe(2);
  });

  it("never reclaims a running job with a live lease (active worker elsewhere)", async () => {
    const [job] = await db.insert(jobs).values({
      type: "test:echo",
      category: "billing",
      status: "running",
      attempts: 1,
      scheduledFor: new Date(Date.now() - 60 * 1000),
      lockedBy: "live-worker",
      leaseExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }).returning();
    await track(job);
    const claimed = await claimNextJob(false).then(absorbClaim);
    expect(claimed?.id).not.toBe(job.id);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.status).toBe("running");
    expect(row.lockedBy).toBe("live-worker");
  });

  it("never reclaims past max_attempts: a final-attempt crash is finalized failed", async () => {
    const [job] = await db.insert(jobs).values({
      type: "test:echo",
      category: "billing",
      status: "running",
      attempts: 3,
      maxAttempts: 3,
      scheduledFor: new Date(Date.now() - 60 * 1000),
      lockedBy: "dead-worker",
      leaseExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
    }).returning();
    await track(job);
    // Claim must skip it (attempts >= max_attempts)...
    const claimed = await claimNextJob(false).then(absorbClaim);
    expect(claimed?.id).not.toBe(job.id);
    // ...and the sweep (run at the start of every worker tick) finalizes it.
    await failExpiredExhaustedJobs();
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(3);
    expect(row.lastError).toMatch(/final permitted attempt/);
    expect(row.lockedBy).toBeNull();
  });
});

describe("cancel/retry race safety", () => {
  it("blocks retry of a cancelled job while its handler still holds a live lease", async () => {
    // Simulate: another instance is mid-execution (live lease), admin cancels.
    const [job] = await db.insert(jobs).values({
      type: "test:echo",
      category: "billing",
      status: "running",
      attempts: 1,
      scheduledFor: new Date(Date.now() - 60 * 1000),
      lockedBy: "other-instance",
      leaseExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }).returning();
    await track(job);
    const cancelled = await cancelJob(job.id);
    expect(cancelled?.status).toBe("cancelled");
    // Retry must be refused while the lease is live — otherwise a second
    // instance could claim it while the original handler is still running.
    expect(await retryJob(job.id)).toBeNull();
    // Once the lease lapses (handler wound down), retry is allowed.
    await db.update(jobs)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, job.id));
    const retried = await retryJob(job.id);
    expect(retried?.status).toBe("queued");
    expect(retried?.attempts).toBe(0);
    expect(retried?.lockedBy).toBeNull();
  });

  it("keeps the lease alive while a cancelled handler is still executing, blocking retry until it truly ends", async () => {
    // Handler runs much longer than the (shrunken) lease window.
    registerJobHandler("test:slow", async (payload: any) => {
      await new Promise((r) => setTimeout(r, payload?.ms ?? 1500));
    });
    __testing.setLeaseConfig(300, 100); // lease 300ms, heartbeat every 100ms
    try {
      const job = await track(await enqueueJob({ type: "test:slow", category: "billing", payload: { ms: 1500 } }));
      const claimed = await claimNextJob(false).then(absorbClaim);
      expect(claimed?.id).toBe(job.id);
      // Execute the claimed job in the background (as the worker would).
      const running = __testing.runJob(claimed!);
      await new Promise((r) => setTimeout(r, 200));
      // Cancel mid-run.
      const cancelled = await cancelJob(job.id);
      expect(cancelled?.status).toBe("cancelled");
      // Wait well past the original 300ms lease: the heartbeat must keep the
      // lease alive because the handler is still executing, so retry is
      // refused — no second invocation can start concurrently.
      await new Promise((r) => setTimeout(r, 700));
      expect(await retryJob(job.id)).toBeNull();
      const [mid] = await db.select().from(jobs).where(eq(jobs.id, job.id));
      expect(mid.status).toBe("cancelled");
      expect(mid.lockedBy).toBe(__testing.workerId());
      // Once the handler invocation actually finishes, the lease is released
      // (status stays cancelled) and retry becomes possible.
      await running;
      const [done] = await db.select().from(jobs).where(eq(jobs.id, job.id));
      expect(done.status).toBe("cancelled");
      expect(done.lockedBy).toBeNull();
      expect(done.leaseExpiresAt).toBeNull();
      const retried = await retryJob(job.id);
      expect(retried?.status).toBe("queued");
      expect(retried?.attempts).toBe(0);
      // Park it in the future so the live app's worker never executes it
      // before cleanup (it's billing-held anyway, belt and suspenders).
      await db.update(jobs).set({ scheduledFor: new Date(Date.now() + 60 * 60 * 1000) }).where(eq(jobs.id, job.id));
    } finally {
      __testing.setLeaseConfig(60 * 1000, 20 * 1000);
    }
  }, 15000);
});

describe("admin actions", () => {
  it("cancel only affects queued/running jobs; retry resets attempts", async () => {
    const job = await track(await enqueueJob({
      type: "test:echo",
      category: "billing",
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    }));
    const cancelled = await cancelJob(job.id);
    expect(cancelled?.status).toBe("cancelled");
    // Cancelling again is a no-op
    expect(await cancelJob(job.id)).toBeNull();
    // Retry requeues with attempts reset
    const retried = await retryJob(job.id);
    expect(retried?.status).toBe("queued");
    expect(retried?.attempts).toBe(0);
  });

  it("run-now returns null for non-queued jobs", async () => {
    const [job] = await db.insert(jobs).values({ type: "test:echo", category: "billing", status: "succeeded" }).returning();
    await track(job);
    expect(await runJobNow(job.id)).toBeNull();
  });
});
