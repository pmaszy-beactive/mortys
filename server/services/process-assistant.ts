import OpenAI from "openai";
import type { RequestHandler, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { verifyStudentToken } from "../student-auth";
import {
  buildCompletedClasses,
  mergeScooterTransferCredits,
  validateClassBooking,
  getCourseClassCounts,
  getMotoPracticalDuration,
  type CompletedClassRecord,
} from "@shared/bookingRules";

/**
 * AI process Q&A assistant for students, parents, and instructors.
 * Answers questions about school processes/policies. For student sessions
 * (and parents with a selected student) the prompt also includes that
 * student's real completed-class progress so "what can I book next?" gets a
 * grounded, personalized answer. Instructors stay policy-only.
 */

const SYSTEM_PROMPT = `You are the helpful virtual assistant for Morty's Driving School. You answer questions about how the school's processes and policies work for students, parents, and instructors.

STRICT SCOPE:
- You ONLY answer questions about Morty's Driving School processes: booking rules, phase progression, class types, scheduling, payments/contracts basics, attendance rules, parent access, and how to contact the office.
- The only live account data you may have is the STUDENT PROGRESS section below (if present): the student's completed classes and what the booking-rules engine says about what they can book next. Use ONLY that data for progress/booking questions — never guess or extrapolate beyond it.
- If no STUDENT PROGRESS section is present, you have NO access to live account data. For any account-specific question (e.g. "what's my balance?", "when is my next class?", "why was my booking blocked?"), explain you can't look up personal records and direct them to check their portal or contact the office.
- Even when a STUDENT PROGRESS section is present, you still cannot see balances, payments, schedules of upcoming classes, contracts, or any other account details — direct those questions to the portal or the office.
- Politely decline questions unrelated to the driving school (general knowledge, homework, coding, other businesses, etc.) in one short sentence and offer to help with school-process questions instead.
- Never invent policies. If you are unsure or the question falls outside the knowledge below, say so and direct the person to the office.
- Keep answers concise, friendly, and in plain language. Use short bullet lists when helpful.
- Write in PLAIN TEXT only — no markdown formatting (no **bold**, no headings, no numbered markdown). Simple dashes for lists are fine.
- Always note, when giving policy answers, that the office is the final authority on any exceptions.

=== SCHOOL KNOWLEDGE BASE ===

CLASS TYPES
- Theory Classes: classroom lessons, Theory #1 through Theory #12. Some theory classes are offered over Zoom with attendance tracking.
- Driving Classes (in-car sessions): one-on-one lessons in a car with an instructor, In-Car #1 through In-Car #15. Most can be 1 hour (60 min) or 2 hours (120 min), with exceptions noted below.

4-PHASE PROGRESSION (standard auto course)
Phase 1 — Theory foundation:
- Theory #1 must be the very first class (no prerequisites).
- Theory #2, #3, #4 each require Theory #1 completed first (any order after that).
- Theory #5 (final test of Phase 1) requires Theory #1–#4 all completed AND at least 28 days since Theory #1.
Phase 2 — starts with Theory #6 (requires all of Phase 1 complete):
- Theory #7 must immediately follow Theory #6.
- In-Car #1 requires Theory #6 AND Theory #7 done. In-Car #1–#4 must be done in order (1→2→3→4) and are 60-minute sessions only.
- In-Car #4 also requires at least 28 days since Theory #6.
Phase 3 — starts with Theory #8 (requires all of Phase 2 complete):
- Theory #9 and #10 require Theory #8 first; otherwise flexible ordering.
- In-Car #5–#10 require Theory #8 first; can be 60 or 120 minutes.
- Phase 3 must last at least 56 days before starting Phase 4 (measured from Theory #8).
Phase 4 — starts with Theory #11 (requires all of Phase 3 complete, incl. Theory #8–#10 and In-Car #5–#10):
- Theory #12 requires Theory #11 first.
- In-Car #11–#14 require Theory #11 first; 60 or 120 minutes; any order among themselves.
- In-Car #12 and #13 must be shared 2-student sessions.
- In-Car #15 (final session) requires Theory #12 and In-Car #11–#14 all completed, and is 60 minutes only.
Other course types (moto, scooter) use simplified rules — students should ask the office for specifics.

DAILY BOOKING LIMIT
- Students can book a maximum of 2 classes per day by default. The school can set a different active daily-limit policy that overrides this default (higher or lower). If a booking is blocked for this reason, choose a different day or contact the office.

BOOKING & CANCELLATIONS
- Students book classes through the student portal from the available-classes list; the system automatically enforces the phase rules and daily limit above.
- If a class you expect to book isn't shown as available, it's usually because a prerequisite isn't completed yet, a minimum waiting period hasn't passed, the class is full, or the daily limit is reached.
- Office staff with override permission can bypass a booking rule in special cases, but a reason must be recorded. Ask the office if you believe an exception applies.
- If you need to cancel or reschedule, do it in your portal or contact the office as early as possible.

ATTENDANCE & CHECK-IN
- Check-in opens 15 minutes before a class's scheduled start time. Attendance actions (check-in, check-out, marking complete, no-show) are not possible before then.
- Class times follow the school's local time zone.
- A class only counts toward your progression once it is marked attended.

PAYMENTS & CONTRACTS (basics)
- Each student has a contract that tracks the course price and payments.
- The school accepts card payments online (through the portal) and can also record external/manual payments made at the office.
- Payment reminders and confirmations are sent by email/in-app notification depending on your notification preferences.
- For balances, refunds, payment plans, or receipts, contact the office — the assistant cannot see account balances.

PARENT / GUARDIAN ACCESS
- Parents are linked to students by invitation from the school.
- Three permission levels: View Only (see progress and schedule), View + Book (also book classes for the student), and View + Book + Payments (also make payments).
- Parents with multiple linked students can switch between them in the parent portal.
- Parents manage their own notification preferences (email and in-app) in the parent dashboard.

INSTRUCTORS
- Instructors set their availability in the instructor portal; classes are scheduled within it.
- Instructors record attendance and complete lessons after the class start time, and can add lesson notes and evaluations.

NOTIFICATIONS
- The system sends reminders for upcoming classes, schedule changes (reschedules/cancellations), and payment notices, by email and in-app, according to each user's preferences.

CONTACTING THE OFFICE
- For anything account-specific, exceptions, rescheduling help, payment questions, or issues the assistant can't resolve, contact the school office directly — by phone, email, or in person during office hours. Office staff have the final say on all policies.

=== END KNOWLEDGE BASE ===

Remember: informational answers only; the office is the final authority.`;

// ─── Combined auth: student (token/session), parent, or instructor ───────────

export const isPortalUserAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    const session = req.session as any;

    // Student via Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const studentId = verifyStudentToken(authHeader.substring(7));
      if (studentId) {
        const student = await storage.getStudent(studentId);
        if (student && student.accountStatus === "active") {
          (req as any).assistantUser = { role: "student", id: student.id };
          return next();
        }
      }
      // fall through to session checks (token may be stale while a session exists)
    }

    // Student via session (incl. admin impersonation)
    const studentId = session?.studentId || session?.impersonatingStudentId;
    if (studentId) {
      const student = await storage.getStudent(studentId);
      if (student && student.accountStatus === "active") {
        (req as any).assistantUser = { role: "student", id: student.id };
        return next();
      }
    }

    // Instructor via session
    if (session?.instructorId) {
      const instructor = await storage.getInstructor(session.instructorId);
      if (instructor && instructor.status === "active") {
        (req as any).assistantUser = { role: "instructor", id: instructor.id };
        return next();
      }
    }

    // Parent via session
    if (session?.parentId) {
      const parent = await storage.getParent(session.parentId);
      if (parent && parent.accountStatus === "active") {
        // Attach the selected student ONLY if this parent is actually linked
        // to them — prevents any cross-student data leakage via stale sessions.
        let selectedStudentId: number | undefined;
        const candidateId = session?.selectedStudentId;
        if (candidateId) {
          const linked = await storage.getParentStudents(parent.id);
          if (linked.some((rel: any) => rel.studentId === candidateId)) {
            selectedStudentId = candidateId;
          }
        }
        (req as any).assistantUser = { role: "parent", id: parent.id, studentId: selectedStudentId };
        return next();
      }
    }

    return res.status(401).json({ message: "Please log in to use the assistant." });
  } catch (error) {
    console.error("Assistant auth error:", error);
    return res.status(401).json({ message: "Unauthorized" });
  }
};

// ─── Simple in-memory rate limiter ───────────────────────────────────────────

const RATE_LIMIT_MAX = 15; // messages
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // per 5 minutes

const rateBuckets = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const bucket = (rateBuckets.get(key) ?? []).filter((t) => t > cutoff);
  if (bucket.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, bucket);
    return true;
  }
  bucket.push(now);
  rateBuckets.set(key, bucket);
  return false;
}

// Periodically clear stale buckets so the map doesn't grow forever
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  rateBuckets.forEach((times, key) => {
    const fresh = times.filter((t) => t > cutoff);
    if (fresh.length === 0) rateBuckets.delete(key);
    else rateBuckets.set(key, fresh);
  });
}, 10 * 60 * 1000).unref();

// ─── Student progress context ────────────────────────────────────────────────

function classLabel(classType: "theory" | "driving", classNumber: number): string {
  return classType === "theory" ? `Theory #${classNumber}` : `In-Car #${classNumber}`;
}

/**
 * Build a grounded STUDENT PROGRESS prompt section from the student's real
 * enrollment data. Runs the same booking-rules engine used at booking time so
 * "what can I book next" answers match what the portal will actually allow.
 * Returns null if the student can't be loaded (assistant falls back to
 * policy-only mode).
 */
async function buildStudentProgressContext(studentId: number): Promise<string | null> {
  try {
    const student = await storage.getStudent(studentId);
    if (!student) return null;

    const enrollments = await storage.getClassEnrollmentsByStudent(studentId);
    const allClasses = await storage.getClasses();
    const enrollmentDetails = enrollments
      .filter((e: any) => !e.cancelledAt)
      .map((e: any) => {
        const cls = allClasses.find((c: any) => c.id === e.classId);
        return {
          attendanceStatus: e.attendanceStatus,
          classType: cls?.classType ?? null,
          classNumber: cls?.classNumber ?? null,
          date: cls?.date ?? null,
          duration: cls?.duration ?? null,
          maxStudents: cls?.maxStudents ?? null,
          courseType: cls?.courseType ?? null,
        };
      });
    const completed = mergeScooterTransferCredits(buildCompletedClasses(enrollmentDetails), student);
    const courseType = (student.courseType || "auto").toLowerCase();
    const today = new Date().toISOString().slice(0, 10);

    // Evaluate every not-yet-completed class through the real rules engine
    // (course-aware counts: auto 12/15, moto 2/7, scooter 1/1).
    const counts = getCourseClassCounts(courseType);
    const candidates: { classType: "theory" | "driving"; classNumber: number }[] = [];
    for (let n = 1; n <= counts.theoryCount; n++) candidates.push({ classType: "theory", classNumber: n });
    for (let n = 1; n <= counts.drivingCount; n++) candidates.push({ classType: "driving", classNumber: n });

    const bookableNow: string[] = [];
    const blocked: string[] = [];
    for (const cand of candidates) {
      const done = completed.some(
        (c: CompletedClassRecord) =>
          c.classType === cand.classType && c.classNumber === cand.classNumber
      );
      if (done) continue;
      const result = validateClassBooking(
        {
          classType: cand.classType,
          classNumber: cand.classNumber,
          date: today,
          // Evaluate prerequisites only: assume a valid duration and a shared
          // session where required, and ignore the daily limit (no specific
          // class is being booked yet).
          duration:
            courseType === "moto"
              ? (cand.classType === "driving" ? (getMotoPracticalDuration(cand.classNumber) ?? 240) : 180)
              : 60,
          saaq6rKnowledgePassed: !!(student as any).saaqKnowledgeTestDate,
          phase1TimingAdvanceDays: (student as any).phase1TimingAdvanceDays ?? 0,
          maxStudents: cand.classType === "driving" && (cand.classNumber === 12 || cand.classNumber === 13) ? 2 : undefined,
          currentEnrollmentCount: 0,
          sameDayAlreadyBookedCount: 0,
        },
        completed,
        courseType
      );
      const label = classLabel(cand.classType, cand.classNumber);
      if (result.allowed) {
        bookableNow.push(label);
      } else if (result.reason) {
        blocked.push(`${label}: ${result.reason}`);
      }
    }

    const completedSorted = [...completed].sort((a, b) => a.date.localeCompare(b.date));
    const completedLines =
      completedSorted.length > 0
        ? completedSorted
            .map((c) => `- ${classLabel(c.classType, c.classNumber)} (attended ${c.date})`)
            .join("\n")
        : "- None yet";

    return `=== STUDENT PROGRESS (live data for ${student.firstName} ${student.lastName}, as of ${today}) ===

Course type: ${courseType}

Completed (attended) classes:
${completedLines}

Classes the booking rules allow booking RIGHT NOW (prerequisites met):
${bookableNow.length > 0 ? bookableNow.map((l) => `- ${l}`).join("\n") : "- None — see blocked reasons below"}

Classes NOT yet bookable and why:
${blocked.length > 0 ? blocked.map((l) => `- ${l}`).join("\n") : "- None — everything remaining is bookable"}

NOTES ON THIS DATA:
- "Bookable right now" means the phase/prerequisite rules are satisfied. An actual booking can still be limited by class availability, class capacity, the daily booking limit, or an active school policy.
- In-Car #1–#4 and In-Car #15 must be 60-minute sessions; In-Car #12 and #13 must be shared 2-student sessions.
- A class only counts once it is marked ATTENDED — a booked-but-not-yet-attended class does not unlock the next one.
- When answering "what can I book next?", list the bookable classes above and briefly explain what unlocks the next blocked ones. Always remind them the office is the final authority.

=== END STUDENT PROGRESS ===`;
  } catch (error) {
    console.error("Assistant: failed to build student progress context:", error);
    return null;
  }
}

// ─── Chat handler ─────────────────────────────────────────────────────────────

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2000),
      })
    )
    .min(1)
    .max(30),
});

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

export async function handleAssistantChat(req: Request, res: Response) {
  const openai = getOpenAI();
  if (!openai) {
    return res.status(503).json({
      message: "The assistant is not available right now. Please contact the office with your question.",
    });
  }

  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid chat request." });
  }

  const user = (req as any).assistantUser as { role: string; id: number; studentId?: number };
  const rateKey = `${user.role}:${user.id}`;
  if (isRateLimited(rateKey)) {
    return res.status(429).json({
      message: "You're sending messages too quickly. Please wait a few minutes and try again.",
    });
  }

  // Keep only the most recent exchanges to bound token usage
  const history = parsed.data.messages.slice(-12);

  // Personalized progress: students see their own; parents see their verified
  // selected student's. Instructors (and parents with no selected student)
  // stay policy-only.
  let progressContext: string | null = null;
  if (user.role === "student") {
    progressContext = await buildStudentProgressContext(user.id);
  } else if (user.role === "parent" && user.studentId) {
    progressContext = await buildStudentProgressContext(user.studentId);
  }

  let systemContent = `${SYSTEM_PROMPT}\n\nThe person you are talking to is a ${user.role}.`;
  if (progressContext) {
    systemContent += `\n\n${progressContext}`;
    if (user.role === "parent") {
      systemContent += `\n\nThe progress data above belongs to the parent's currently selected student.`;
    }
  }

  // Stream tokens back via Server-Sent Events so the widget can render
  // the reply word-by-word instead of waiting for the full completion.
  let stream: Awaited<ReturnType<typeof openai.chat.completions.create>>;
  try {
    stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 600,
      temperature: 0.3,
      stream: true,
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        ...history,
      ],
    });
  } catch (error) {
    console.error("Assistant stream start error:", error);
    return res.status(502).json({
      message: "The assistant couldn't generate a response. Please try again.",
    });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let sentAny = false;
  let fullReply = "";
  try {
    for await (const chunk of stream as AsyncIterable<any>) {
      if (res.writableEnded || res.destroyed) break;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        sentAny = true;
        fullReply += delta;
        send({ delta });
      }
    }
    if (!sentAny) {
      send({ error: "The assistant couldn't generate a response. Please try again." });
    } else {
      send({ done: true });
    }
  } catch (error) {
    console.error("Assistant stream error:", error);
    if (!res.writableEnded) {
      send({
        error: sentAny
          ? "The assistant's reply was cut off. Please try again."
          : "The assistant couldn't generate a response. Please try again.",
      });
    }
  } finally {
    if (!res.writableEnded) res.end();

    // Log the exchange for office review (fire-and-forget — never blocks the stream).
    // Logs whatever was streamed, even if the reply was cut off mid-stream.
    const lastUserMessage = [...history].reverse().find((m) => m.role === "user");
    if (lastUserMessage && fullReply.trim()) {
      storage
        .createAssistantLog({
          userRole: user.role,
          userId: user.id,
          question: lastUserMessage.content,
          answer: fullReply.trim(),
        })
        .catch((err) => {
          console.warn("[assistant] failed to log Q&A exchange:", (err as Error)?.message);
        });
    }
  }
}
