import { AsyncLocalStorage } from "async_hooks";
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

/**
 * Central server-error capture. Every HTTP response with status >= 500 is
 * persisted to the error_logs table with the exception message, stack trace,
 * logged-in user and sanitized request context.
 *
 * Route handlers in this codebase mostly catch their own exceptions,
 * console.error() the error, and return a generic 500 message — so the
 * global Express error middleware never sees the real error. To capture
 * those without refactoring hundreds of catch blocks, this module:
 *
 *  1. Runs each request inside an AsyncLocalStorage context.
 *  2. Patches console.error once so any Error logged during a request is
 *     remembered in that request's context.
 *  3. On response "finish" with status >= 500, writes one error_logs row
 *     combining the response body message with the remembered Error's
 *     message/stack (when available).
 *
 * The global error middleware also calls captureRequestError(err) so errors
 * that DO reach it are recorded with a full stack even if console.error was
 * never called. Logging failures never break the request cycle.
 */

interface RequestErrorContext {
  lastError?: unknown;
}

const als = new AsyncLocalStorage<RequestErrorContext>();

const SENSITIVE_KEY_RE =
  /password|passwd|token|secret|authorization|auth|cookie|session|card|cvv|cvc|ssn|apikey|api_key|signature|credential/i;

const MAX_STRING = 2000;
const MAX_DEPTH = 5;

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[max depth]";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…[truncated]" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeForLog(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : sanitizeForLog(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Remember an error for the current request (used by the global error middleware). */
export function captureRequestError(err: unknown): void {
  const store = als.getStore();
  if (store) store.lastError = err;
}

// Patch console.error once so errors logged inside route catch blocks are
// associated with the in-flight request.
let consolePatched = false;
function patchConsoleError() {
  if (consolePatched) return;
  consolePatched = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const store = als.getStore();
      if (store) {
        const errArg = args.find((a) => a instanceof Error);
        if (errArg) store.lastError = errArg;
      }
    } catch {
      // never let capture break logging
    }
    original(...args);
  };
}

function extractError(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) {
    return { message: err.message || String(err), stack: err.stack || null };
  }
  if (err !== undefined && err !== null) {
    try {
      return { message: typeof err === "string" ? err : JSON.stringify(err), stack: null };
    } catch {
      return { message: String(err), stack: null };
    }
  }
  return { message: "", stack: null };
}

/**
 * Express middleware: wraps the request in an ALS context and records any
 * 500+ response to the error_logs table when the response finishes.
 */
export function errorCaptureMiddleware(req: Request, res: Response, next: NextFunction) {
  patchConsoleError();

  const context: RequestErrorContext = {};

  let responseBody: unknown;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    if (res.statusCode < 500) return;
    void persistErrorLog(req, res, context, responseBody);
  });

  als.run(context, () => next());
}

async function persistErrorLog(
  req: Request,
  res: Response,
  context: RequestErrorContext,
  responseBody: unknown,
) {
  try {
    const { message: errMessage, stack } = extractError(context.lastError);
    const bodyMessage =
      responseBody && typeof responseBody === "object" && "message" in (responseBody as any)
        ? String((responseBody as any).message)
        : undefined;

    const message = errMessage || bodyMessage || `HTTP ${res.statusCode}`;

    const user = (req as any).user;
    const sessionUserId = (req.session as any)?.userId;
    const studentId = (req as any).studentId ?? (req.session as any)?.studentId;

    let userId: string | null = null;
    let userEmail: string | null = null;
    if (user?.id) {
      userId = String(user.id);
      userEmail = user.email ?? null;
    } else if (sessionUserId) {
      userId = String(sessionUserId);
    } else if (studentId) {
      userId = `student:${studentId}`;
    }

    await storage.createErrorLog({
      statusCode: res.statusCode,
      method: req.method,
      path: req.originalUrl?.split("?")[0] || req.path,
      message: message.slice(0, 5000),
      stack: stack ? stack.slice(0, 20000) : null,
      userId,
      userEmail,
      requestContext: sanitizeForLog({
        body: req.body,
        params: req.params,
        query: req.query,
        responseMessage: bodyMessage,
      }) as any,
    });
  } catch (logErr) {
    // Never let error logging break anything; plain console output only.
    try {
      console.warn("[error-logger] failed to persist error log:", (logErr as Error)?.message);
    } catch {
      /* noop */
    }
  }
}

/**
 * Deletes error logs older than 30 days. Runs at startup and then daily.
 * Idempotent and safe across restarts.
 */
const RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startErrorLogCleanup(): void {
  const run = async () => {
    try {
      const deleted = await storage.deleteErrorLogsOlderThan(RETENTION_DAYS);
      if (deleted > 0) {
        console.log(`[error-logger] cleanup removed ${deleted} error log(s) older than ${RETENTION_DAYS} days`);
      }
    } catch (err) {
      console.warn("[error-logger] cleanup failed:", (err as Error)?.message);
    }
  };
  void run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref?.();
}
