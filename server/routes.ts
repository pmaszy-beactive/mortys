import type { Express } from "express";
import { createServer, type Server } from "http";
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
import { db } from "./db";
import { sql, eq, and, not, isNull, count } from "drizzle-orm";
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
} from "@shared/schema";
import { PHASE_DEFINITIONS } from "@shared/phaseConfig";
import type { PhaseProgressData, PhaseProgress, PhaseClassProgress } from "@shared/phaseConfig";
import { validateClassBooking, buildCompletedClasses } from "@shared/bookingRules";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { loginUser, isAuthenticatedTraditional } from "./auth";
import { loginInstructor, isInstructorAuthenticated } from "./instructor-auth";
import { loginStudent, isStudentAuthenticated } from "./student-auth";
import { loginParent, isParentAuthenticated } from "./parent-auth";
import { initializeDatabase } from "./init-db";
import { LegacyScraper } from "./services/legacy-scraper";
import * as notificationService from "./services/notifications";
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
  moto: [
    { name: "Theory Phase", order: 1, description: "Complete motorcycle theory", requiredTheoryClasses: 3, requiredInCarSessions: 0, estimatedDays: 14 },
    { name: "Practical Training", order: 2, description: "Complete riding sessions", requiredTheoryClasses: 3, requiredInCarSessions: 8, estimatedDays: 45 },
    { name: "Road Test Prep", order: 3, description: "Prepare for your road test", requiredTheoryClasses: 3, requiredInCarSessions: 10, estimatedDays: 14 },
    { name: "Completed", order: 4, description: "Graduation!", requiredTheoryClasses: 3, requiredInCarSessions: 10, estimatedDays: 0 },
  ],
  scooter: [
    { name: "Theory Phase", order: 1, description: "Complete scooter theory", requiredTheoryClasses: 2, requiredInCarSessions: 0, estimatedDays: 7 },
    { name: "Practical Training", order: 2, description: "Complete riding sessions", requiredTheoryClasses: 2, requiredInCarSessions: 4, estimatedDays: 14 },
    { name: "Completed", order: 3, description: "Graduation!", requiredTheoryClasses: 2, requiredInCarSessions: 4, estimatedDays: 0 },
  ],
};

interface PhaseProgress {
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
): PhaseProgress {
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
    // Theory phase - progress based on theory classes only
    const theoryRequired = currentPhase.requiredTheoryClasses;
    phaseProgressPercent = theoryRequired > 0 ? Math.min(100, (completedTheoryClasses / theoryRequired) * 100) : 100;
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
  const requirements: PhaseProgress['requirements'] = [];
  
  if (nextPhase) {
    if (currentPhaseIndex === 0) {
      // Theory Phase: only show theory class requirements
      const theoryRequired = currentPhase.requiredTheoryClasses;
      requirements.push({
        label: "Theory Classes",
        completed: Math.min(completedTheoryClasses, theoryRequired),
        required: theoryRequired,
        isComplete: completedTheoryClasses >= theoryRequired,
      });
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
    }
  }

  let currentPhase = 4;
  const phases: PhaseProgress[] = [];

  for (let i = 0; i < PHASE_DEFINITIONS.length; i++) {
    const phaseDef = PHASE_DEFINITIONS[i];
    const phaseClasses: PhaseClassProgress[] = [];
    let completedCount = 0;
    let earliestDate: string | null = null;

    for (const classItem of phaseDef.classes) {
      const key = `${classItem.classType}_${classItem.classNumber}`;
      const completed = completedMap.get(key);
      const isCompleted = !!completed;

      if (isCompleted) {
        completedCount++;
        if (completed.date && (!earliestDate || completed.date < earliestDate)) {
          earliestDate = completed.date;
        }
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
    currentPhase = 4;
  }

  return { currentPhase, phases };
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

export async function registerRoutes(app: Express): Promise<Server> {
  const isProduction = process.env.NODE_ENV === "production";

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

  if (isProduction) {
    // Production: Use Replit Auth with demo fallback
    await setupAuth(app);

    // Set up session middleware for demo auth fallback in production
    const session = (await import("express-session")).default;
    const connectPg = (await import("connect-pg-simple")).default;

    const sessionTtl = 60 * 60 * 1000; // 1 hour in milliseconds
    const pgStore = connectPg(session);
    const sessionStore = new pgStore({
      conString: process.env.DATABASE_URL,
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
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Login failed" });
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
      conString: process.env.DATABASE_URL,
      createTableIfMissing: false,
      ttl: sessionTtl / 1000, // Convert to seconds for PostgreSQL TTL
      tableName: "sessions",
    });

    app.use(
      session({
        secret: process.env.SESSION_SECRET || "dev-secret-key",
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          secure: false, // Allow HTTP in development
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

    // Admin forgot password — send reset email
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
        console.error("Admin reset password error:", error);
        res.status(500).json({ message: "Failed to reset password" });
      }
    });
  }

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

      const from = "info@mortys.ca";
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
      console.error("Error fetching booking policy:", error);
      res.status(500).json({ message: "Failed to fetch booking policy" });
    }
  });

  app.post("/api/booking-policies", authMiddleware, async (req, res) => {
    try {
      const policy = await storage.createBookingPolicy(req.body);
      res.status(201).json(policy);
    } catch (error) {
      console.error("Error creating booking policy:", error);
      res.status(500).json({ message: "Failed to create booking policy" });
    }
  });

  app.patch("/api/booking-policies/:id", authMiddleware, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { changeReason, ...policyData } = req.body;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User authentication required" });
      }
      
      // Use version tracking if changeReason is provided
      if (changeReason) {
        const policy = await storage.updateBookingPolicyWithVersion(id, policyData, userId, changeReason);
        res.json(policy);
      } else {
        // Simple update without version tracking
        const policy = await storage.updateBookingPolicy(id, policyData);
        res.json(policy);
      }
    } catch (error) {
      console.error("Error updating booking policy:", error);
      res.status(500).json({ message: "Failed to update booking policy" });
    }
  });

  app.delete("/api/booking-policies/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBookingPolicy(id);
      res.status(204).send();
    } catch (error) {
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
      console.error("Error fetching effective booking policies:", error);
      res.status(500).json({ message: "Failed to fetch effective booking policies" });
    }
  });

  // Policy Override Logs routes - Audit trail for policy overrides
  app.get("/api/policy-override-logs", authMiddleware, async (req: any, res) => {
    try {
      const { staffUserId, studentId, startDate, endDate } = req.query;
      const filters: any = {};
      if (staffUserId) filters.staffUserId = staffUserId as string;
      if (studentId) filters.studentId = parseInt(studentId as string);
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

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
      console.error("Error fetching policy override log:", error);
      res.status(500).json({ message: "Failed to fetch policy override log" });
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
      console.error("Error fetching students:", error);
      res.status(500).json({ message: "Failed to fetch students" });
    }
  });

  app.get("/api/students/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const student = await storage.getStudent(id);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      res.json(student);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch student" });
    }
  });

  app.post("/api/students", authMiddleware, async (req, res) => {
    try {
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
        console.error("Contract auto-generation failed:", contractError);
        // Don't fail student creation if contract generation fails
      }
      
      res.status(201).json(student);
    } catch (error) {
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
      const updateData = req.body;
      const student = await storage.updateStudent(id, updateData);
      res.json(student);
    } catch (error) {
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

  app.delete("/api/students/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteStudent(id);
      res.status(204).send();
    } catch (error) {
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
          console.error(`Failed to delete student ${id}:`, error);
        }
      }
      
      res.json({ deletedCount, totalRequested: ids.length });
    } catch (error) {
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
      console.error("Error fetching instructor hours:", error);
      res.status(500).json({ message: "Failed to fetch instructor hours" });
    }
  });

  // Classes routes
  app.get("/api/classes", authMiddleware, async (req, res) => {
    try {
      const classes = await storage.getClasses();
      res.json(classes);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch class" });
    }
  });

  app.post("/api/classes", authMiddleware, async (req, res) => {
    try {
      console.log("Class creation request body:", req.body);
      const classData = insertClassSchema.parse(req.body);
      console.log("Class data after validation:", classData);
      const newClass = await storage.createClass(classData);
      console.log("Class created successfully:", newClass);
      res.status(201).json(newClass);
    } catch (error) {
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

  app.put("/api/classes/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      
      // Get existing class data to compare for changes
      const existingClass = await storage.getClass(id);
      
      const classData = await storage.updateClass(id, updateData);
      
      // Send schedule change notifications if relevant fields changed
      if (existingClass && classData) {
        const changes: any = {};
        let hasChanges = false;
        
        if (existingClass.scheduledDate !== classData.scheduledDate) {
          changes.oldDate = existingClass.scheduledDate;
          changes.newDate = classData.scheduledDate;
          hasChanges = true;
        }
        if (existingClass.startTime !== classData.startTime || existingClass.endTime !== classData.endTime) {
          changes.oldTime = `${existingClass.startTime} - ${existingClass.endTime}`;
          changes.newTime = `${classData.startTime} - ${classData.endTime}`;
          hasChanges = true;
        }
        if (existingClass.instructorId !== classData.instructorId) {
          const oldInstructor = existingClass.instructorId ? await storage.getInstructor(existingClass.instructorId) : null;
          const newInstructor = classData.instructorId ? await storage.getInstructor(classData.instructorId) : null;
          changes.oldInstructor = oldInstructor ? `${oldInstructor.firstName} ${oldInstructor.lastName}` : 'Unassigned';
          changes.newInstructor = newInstructor ? `${newInstructor.firstName} ${newInstructor.lastName}` : 'Unassigned';
          hasChanges = true;
        }
        
        if (hasChanges) {
          try {
            const triggeredBy = (req as any).user?.id || (req.session as any)?.userId || 'system';
            await notificationService.notifyScheduleChange({
              id: classData.id,
              title: classData.title,
              changes,
            }, triggeredBy);
          } catch (notifyError) {
            console.error("Failed to send schedule change notification:", notifyError);
          }
        }
      }
      
      res.json(classData);
    } catch (error) {
      res.status(400).json({ message: "Failed to update class" });
    }
  });

  app.delete("/api/classes/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteClass(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete class" });
    }
  });

  // Approve change request
  app.post("/api/change-requests/:id/approve", authMiddleware, async (req, res) => {
    try {
      const classId = parseInt(req.params.id);
      const updateData = req.body;
      
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
        res.status(500).json({ message: "Failed to fetch class enrollments" });
      }
    },
  );

  app.get("/api/class-enrollments/student/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const enrollments = await storage.getClassEnrollmentsByStudent(studentId);
      res.json(enrollments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch student enrollments" });
    }
  });

  app.post("/api/class-enrollments", authMiddleware, async (req: any, res) => {
    try {
      // Extract override flags before schema parsing to avoid validation error
      const { overridePolicy, overrideReason, ...enrollmentBody } = req.body;
      const enrollmentData = insertClassEnrollmentSchema.parse(enrollmentBody);

      // Check if user has permission to override booking policies
      const canOverride = req.user?.canOverrideBookingPolicies === true;

      // Track policy violations for logging
      const policyViolations: { policyType: string; originalValue: string; overriddenValue: string }[] = [];

      // Get class data for policy checks
      const classData = await storage.getClass(enrollmentData.classId!);
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
                };
              });
            const completedForPhase = buildCompletedClasses(enrollmentDetailsPhase);
            const targetForPhase = {
              classType: classData.classType as "theory" | "driving",
              classNumber: classData.classNumber ?? 0,
              date: classData.date ?? new Date().toISOString().slice(0, 10),
              duration: classData.duration ?? undefined,
              maxStudents: classData.maxStudents ?? undefined,
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
        const classType = classData.classNumber && classData.classNumber <= 5 ? 'theory' : 'driving';
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

        // Check max_bookings_per_day policy
        const maxBookingsPolicy = policies.find(p => p.policyType === 'max_bookings_per_day');
        if (maxBookingsPolicy && classData.date && enrollmentData.studentId) {
          const studentEnrollments = await storage.getClassEnrollmentsByStudent(enrollmentData.studentId);
          const classesForStudent = await Promise.all(
            studentEnrollments
              .filter(e => !e.cancelledAt)
              .map(async (e) => e.classId ? await storage.getClass(e.classId) : null)
          );
          const bookingsOnSameDay = classesForStudent.filter(c => c && c.date === classData.date).length;

          if (bookingsOnSameDay >= maxBookingsPolicy.value) {
            if (!overridePolicy || !canOverride) {
              return res.status(400).json({ 
                message: `Student has ${bookingsOnSameDay} booking(s) on this date. Maximum is ${maxBookingsPolicy.value}. ${canOverride ? 'Provide overrideReason to override.' : ''}`,
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
              originalValue: `${maxBookingsPolicy.value} bookings`,
              overriddenValue: `${bookingsOnSameDay + 1} bookings`
            });
          }
        }
      }

      // Validate learner's permit for driving (in-car) classes
      if (classData && enrollmentData.studentId) {
        const classType = classData.classNumber && classData.classNumber <= 5 ? 'theory' : 'driving';
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
      const enrollment = await storage.createClassEnrollment(enrollmentData);

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
              studentId: enrollmentData.studentId,
              classId: enrollmentData.classId,
              policyType: violation.policyType,
              reason: overrideReason,
              staffName,
            }, req.user.id);
          } catch (notifyError) {
            console.error("Failed to send policy override notification via service:", notifyError);
          }
        }
      }

      res.status(201).json(enrollment);
    } catch (error) {
      console.error("Error creating enrollment:", error);
      res.status(400).json({ message: "Invalid enrollment data" });
    }
  });

  app.put("/api/class-enrollments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const enrollment = await storage.updateClassEnrollment(id, updateData);
      res.json(enrollment);
    } catch (error) {
      res.status(400).json({ message: "Failed to update enrollment" });
    }
  });

  app.delete("/api/class-enrollments/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteClassEnrollment(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete enrollment" });
    }
  });

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
      
      res.json(enrollment);
    } catch (error) {
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
      
      const enrollment = await storage.updateClassEnrollment(id, {
        checkOutSignature: signature,
        checkOutAt: new Date(),
        attendanceStatus: "attended"
      });
      
      res.json(enrollment);
    } catch (error) {
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
      
      res.json(enrollment);
    } catch (error) {
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
        return res.status(400).json({ message: "Attendance can only be corrected on the same day as the class" });
      }

      const enrollment = await storage.updateClassEnrollment(id, {
        checkInAt: null,
        checkInSignature: null,
        checkOutAt: null,
        checkOutSignature: null,
        attendanceStatus: "registered"
      });

      res.json(enrollment);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch contract" });
    }
  });

  app.get("/api/contracts/student/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const contracts = await storage.getContractsByStudent(studentId);
      res.json(contracts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch student contracts" });
    }
  });

  app.post("/api/contracts", async (req, res) => {
    try {
      const contractData = insertContractSchema.parse(req.body);
      const contract = await storage.createContract(contractData);
      res.status(201).json(contract);
    } catch (error) {
      res.status(400).json({ message: "Invalid contract data" });
    }
  });

  app.put("/api/contracts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const contract = await storage.updateContract(id, updateData);
      res.json(contract);
    } catch (error) {
      res.status(400).json({ message: "Failed to update contract" });
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
      res.status(500).json({ message: "Failed to fetch evaluation" });
    }
  });

  app.get("/api/evaluations/student/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const evaluations = await storage.getEvaluationsByStudent(studentId);
      res.json(evaluations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch student evaluations" });
    }
  });

  app.post("/api/evaluations", async (req, res) => {
    try {
      const evaluationData = insertEvaluationSchema.parse(req.body);
      const evaluation = await storage.createEvaluation(evaluationData);
      res.status(201).json(evaluation);
    } catch (error) {
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
      res.status(400).json({ message: "Failed to update evaluation" });
    }
  });

  // Notes routes
  app.get("/api/notes", async (req, res) => {
    try {
      const notes = await storage.getNotes();
      res.json(notes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  app.get("/api/notes/student/:studentId", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const notes = await storage.getNotesByStudent(studentId);
      res.json(notes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch student notes" });
    }
  });

  app.post("/api/notes", async (req, res) => {
    try {
      const noteData = insertNoteSchema.parse(req.body);
      const note = await storage.createNote(noteData);
      res.status(201).json(note);
    } catch (error) {
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
      res.status(400).json({ message: "Failed to update note" });
    }
  });

  app.delete("/api/notes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteNote(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete note" });
    }
  });

  // Communications routes
  app.get("/api/communications", async (req, res) => {
    try {
      const communications = await storage.getCommunications();
      res.json(communications);
    } catch (error) {
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
      const theoryClasses = filteredClasses.filter((c) => {
        if (c.classType) return c.classType === "theory";
        return c.classNumber != null && c.classNumber <= 5;
      });
      const drivingClasses = filteredClasses.filter((c) => {
        if (c.classType) return c.classType === "driving";
        return c.classNumber != null && c.classNumber > 5;
      });
      
      res.json({
        total: filteredClasses.length,
        theory: theoryClasses.length,
        driving: drivingClasses.length,
        view: view as string,
      });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch registration summary" });
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
          if (cls.classNumber <= 5) {
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
      const theoryClasses = filteredClasses.filter(c => c.classNumber <= 5).length;
      const drivingClasses = filteredClasses.filter(c => c.classNumber > 5).length;
      const completedTheoryClasses = completedClasses.filter(c => c.classNumber <= 5).length;
      const completedDrivingClasses = completedClasses.filter(c => c.classNumber > 5).length;
      
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
            classType: cls && cls.classNumber <= 5 ? 'Theory' : 'Driving',
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
          
          if (cls.classNumber <= 5) {
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
      
      const records = filteredStudents.map(student => {
        const studentEnrollments = enrollments.filter(e => e.studentId === student.id && !e.cancelledAt);
        const attendedEnrollments = studentEnrollments.filter(e => e.attendanceStatus === 'attended');
        
        // Count by class type
        let theoryClassesAttended = 0;
        let drivingClassesAttended = 0;
        
        for (const enrollment of attendedEnrollments) {
          const cls = classes.find(c => c.id === enrollment.classId);
          if (cls) {
            if (cls.classNumber <= 5) {
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
          theoryHoursCompleted: student.theoryHoursCompleted || 0,
          practicalHoursCompleted: student.practicalHoursCompleted || 0,
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
      res.status(400).json({ message: "Failed to update availability" });
    }
  });

  app.delete("/api/instructors/availability/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteInstructorAvailability(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete availability" });
    }
  });

  // Zoom Integration routes
  app.get("/api/zoom/settings", async (req, res) => {
    try {
      const settings = await storage.getZoomSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Zoom settings" });
    }
  });

  app.put("/api/zoom/settings", async (req, res) => {
    try {
      const settingsData = insertZoomSettingsSchema.parse(req.body);
      const settings = await storage.updateZoomSettings(settingsData);
      res.json(settings);
    } catch (error) {
      res.status(400).json({ message: "Invalid settings data" });
    }
  });

  app.get("/api/classes/:classId/zoom-meetings", async (req, res) => {
    try {
      const classId = parseInt(req.params.classId);
      const meetings = await storage.getZoomMeetingsByClass(classId);
      res.json(meetings);
    } catch (error) {
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
      res.status(400).json({ message: "Invalid meeting data" });
    }
  });

  app.get("/api/zoom/meetings/:meetingId/attendance", async (req, res) => {
    try {
      const meetingId = parseInt(req.params.meetingId);
      const attendance = await storage.getZoomAttendanceByMeeting(meetingId);
      res.json(attendance);
    } catch (error) {
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
      res.status(400).json({ message: "Failed to adjust attendance" });
    }
  });

  app.get("/api/students/:studentId/zoom-attendance", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const attendance = await storage.getZoomAttendanceByStudent(studentId);
      res.json(attendance);
    } catch (error) {
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
      res.status(500).json({ message: "Webhook processing failed" });
    }
  });

  // School Permits routes
  app.get("/api/school-permits", async (req, res) => {
    try {
      const permits = await storage.getSchoolPermits();
      res.json(permits);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch school permit" });
    }
  });

  app.post("/api/school-permits", async (req, res) => {
    try {
      const permitData = insertSchoolPermitSchema.parse(req.body);
      const permit = await storage.createSchoolPermit(permitData);
      res.status(201).json(permit);
    } catch (error) {
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
      res.status(400).json({ message: "Failed to update school permit" });
    }
  });

  app.delete("/api/school-permits/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSchoolPermit(id);
      res.status(204).send();
    } catch (error) {
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
      res.status(500).json({ message: "Failed to assign permit number" });
    }
  });

  app.get("/api/students/:studentId/permits", async (req, res) => {
    try {
      const studentId = parseInt(req.params.studentId);
      const permits = await storage.getAssignedPermitNumbers(studentId);
      res.json(permits);
    } catch (error) {
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
      console.error("Failed to stop migration:", error);
      res.status(500).json({ error: "Failed to stop migration" });
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
      console.error("Error fetching locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.get("/api/locations/active", async (req, res) => {
    try {
      const locations = await storage.getActiveLocations();
      res.json(locations);
    } catch (error) {
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
      res.status(400).json({ message: "Invalid location data" });
    }
  });

  app.put("/api/locations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const location = await storage.updateLocation(id, updateData);
      res.json(location);
    } catch (error) {
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
      console.error("Error fetching vehicles:", error);
      res.status(500).json({ message: "Failed to fetch vehicles" });
    }
  });

  app.get("/api/vehicles/active", authMiddleware, async (req, res) => {
    try {
      const vehicles = await storage.getActiveVehicles();
      res.json(vehicles);
    } catch (error) {
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
      res.status(500).json({ message: "Failed to fetch vehicle" });
    }
  });

  app.post("/api/vehicles", authMiddleware, async (req, res) => {
    try {
      const vehicleData = insertVehicleSchema.parse(req.body);

      // Convert empty VIN string to null to avoid unique constraint violations
      if (vehicleData.vin === "") {
        vehicleData.vin = null;
      }

      const vehicle = await storage.createVehicle(vehicleData);
      res.status(201).json(vehicle);
    } catch (error) {
      console.error("Vehicle creation error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      res.status(400).json({ message: "Invalid vehicle data" });
    }
  });

  app.put("/api/vehicles/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      const vehicle = await storage.updateVehicle(id, updateData);
      res.json(vehicle);
    } catch (error) {
      console.error("Vehicle update error:", error);
      if (error.name === "ZodError") {
        const fieldErrors = error.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        return res.status(400).json({
          message: `Validation failed: ${fieldErrors}`,
          errors: error.errors,
        });
      }
      res.status(400).json({ message: "Failed to update vehicle" });
    }
  });

  app.delete("/api/vehicles/:id", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteVehicle(id);
      res.status(204).send();
    } catch (error) {
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
      console.error("[STUDENT-INVITE] Error accepting invite:", error);
      res.status(500).json({ message: "Failed to accept invite" });
    }
  });

  // Student Self-Registration Routes
  app.post("/api/student/register", async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
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
          const sgMail = (await import("@sendgrid/mail")).default;
          const fromEmail = process.env.SENDGRID_FROM_EMAIL || "info@mortys.ca";
          
          try {
            await sgMail.send({
              to: email,
              from: fromEmail,
              subject: "Verify your email - Morty's Driving School",
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
          } catch (emailError) {
            console.error("SendGrid email error:", emailError);
          }
          
          return res.json({
            message: "Verification code sent to your email",
            registrationId: existingRegistration[0].id,
            step: "verify",
            expiresAt: expiresAt.toISOString()
          });
        }
        return res.status(400).json({ message: "An account with this email already exists" });
      }
      
      // Hash password
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Generate verification code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
      
      // Create verification token
      const [token] = await db.insert(emailVerificationTokens).values({
        email,
        code,
        expiresAt,
      }).returning();
      
      // Create registration
      const [registration] = await db.insert(studentRegistrations).values({
        email,
        passwordHash: hashedPassword,
        verificationTokenId: token.id,
      }).returning();
      
      // Send verification email
      const sgMail = (await import("@sendgrid/mail")).default;
      const fromEmail = process.env.SENDGRID_FROM_EMAIL || "info@mortys.ca";
      
      try {
        await sgMail.send({
          to: email,
          from: fromEmail,
          subject: "Verify your email - Morty's Driving School",
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
      } catch (emailError) {
        console.error("SendGrid email error:", emailError);
      }
      
      res.json({
        message: "Verification code sent to your email",
        registrationId: registration.id,
        step: "verify",
        expiresAt: expiresAt.toISOString()
      });
    } catch (error) {
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
      const sgMail = (await import("@sendgrid/mail")).default;
      const fromEmail = process.env.SENDGRID_FROM_EMAIL || "info@mortys.ca";
      
      try {
        await sgMail.send({
          to: registration.email,
          from: fromEmail,
          subject: "Your new verification code - Morty's Driving School",
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
      } catch (emailError) {
        console.error("SendGrid email error:", emailError);
      }
      
      res.json({ message: "New verification code sent to your email", expiresAt: expiresAt.toISOString() });
    } catch (error) {
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
      });
      
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
      
      res.json({
        message: "Welcome to Morty's Driving School!",
        studentId: newStudent.id,
        email: newStudent.email,
      });
    } catch (error) {
      console.error("[STUDENT-COMPLETE] Error:", error);
      res.status(500).json({ message: "Failed to complete registration" });
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
      console.error("[STUDENT-UPLOAD] Error:", error);
      res.status(500).json({ message: "Failed to upload document" });
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
          student: {
            id: result.student.id,
            firstName: result.student.firstName,
            lastName: result.student.lastName,
            email: result.student.email,
            courseType: result.student.courseType,
            status: result.student.status,
            progress: result.student.progress,
            phase: result.student.phase,
          },
        });
      }

      return res.status(401).json({ 
        success: false, 
        message: result.message,
        errorType: (result as any).errorType || undefined,
      });
    } catch (error) {
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
        console.error(`[RESEND-ACTIVATION] Failed to send email to ${student.email}:`, emailError);
      }

      res.json({ success: true, message: "If an account with this email needs activation, a link has been sent." });
    } catch (error) {
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
      });
    } catch (error) {
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
      });
    } catch (error) {
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
        },
      });
    } catch (error) {
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
        const classDateTime = new Date(`${classItem.date}T${classItem.time}`);
        const isTheory = classItem.classNumber && classItem.classNumber <= 5;
        
        // Determine lesson status
        let lessonStatus = 'upcoming';
        if (enrollment.cancelledAt) {
          lessonStatus = 'cancelled';
        } else if (enrollment.attendanceStatus === 'attended') {
          lessonStatus = 'completed';
        } else if (enrollment.attendanceStatus === 'absent' || enrollment.attendanceStatus === 'no-show') {
          lessonStatus = 'missed';
        } else if (classDateTime < new Date()) {
          lessonStatus = 'past';
        }

        historyEntries.push({
          id: `lesson-${classItem.id}`,
          type: 'lesson',
          date: classItem.date,
          time: classItem.time,
          timestamp: classDateTime.toISOString(),
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

        // Get upcoming classes
        const upcomingClasses = studentClasses
          .filter((c) => {
            const classDate = new Date(`${c.date}T${c.time}`);
            return classDate > new Date() && c.status === "scheduled";
          })
          .slice(0, 5);

        // Get student's evaluations
        const evaluations = await storage.getEvaluationsByStudent(student.id);

        // Calculate stats from actual class data (not stored arrays which may be empty)
        // Theory classes = classNumber 1-5, In-car sessions = classNumber > 5
        // Only count classes where the STUDENT actually attended (not just class marked complete)
        let completedTheoryClasses = 0;
        let completedInCarSessions = 0;
        
        for (const classItem of studentClasses) {
          const enrollment = enrollments.find(e => e.classId === classItem.id);
          // Only count if student actually attended - don't use class.status as it's class-level not student-level
          const isAttended = enrollment?.attendanceStatus === 'attended';
          
          if (isAttended) {
            if (classItem.classNumber <= 5) {
              completedTheoryClasses++;
            } else {
              completedInCarSessions++;
            }
          }
        }
        
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
        // Theory classes = classNumber 1-5, In-car sessions = classNumber > 5
        // Only count classes where the STUDENT actually attended (not just class marked complete)
        let completedTheoryClasses = 0;
        let completedInCarSessions = 0;
        
        for (const classItem of studentClasses) {
          const enrollment = enrollments.find(e => e.classId === classItem.id);
          // Only count if student actually attended - don't use class.status as it's class-level not student-level
          const isAttended = enrollment?.attendanceStatus === 'attended';
          
          if (isAttended) {
            if (classItem.classNumber <= 5) {
              completedTheoryClasses++;
            } else {
              completedInCarSessions++;
            }
          }
        }
        
        const phaseProgress = calculatePhaseProgress(student, completedTheoryClasses, completedInCarSessions, enrollments);
        res.json(phaseProgress);
      } catch (error) {
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

        // Filter out past classes - only show upcoming classes
        const now = new Date();
        const upcomingClasses = studentClasses.filter((c) => {
          const classDateTime = new Date(`${c.date}T${c.time}`);
          return classDateTime >= now;
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
        const { courseType, instructorId, startDate, endDate } = req.query;

        const filters: any = {};
        if (courseType) filters.courseType = courseType;
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
            };
          });

        const completedClassesAvail = buildCompletedClasses(enrollmentDetailsAvail);
        const studentCourseTypeAvail = (student.courseType || 'auto').toLowerCase();

        // Count for legacy phase display info
        const completedTheoryClasses = completedClassesAvail.filter(c => c.classType === 'theory').length;
        const completedInCarSessions = completedClassesAvail.filter(c => c.classType === 'driving').length;

        const availableClasses = await storage.getAvailableClasses(
          student.id,
          filters,
        );

        // Filter using full booking rules engine — only show classes the student can actually book
        const today = new Date().toISOString().slice(0, 10);
        const filteredClasses = availableClasses.filter((classItem: any) => {
          if (!classItem.classType || !classItem.classNumber) return false;
          const target = {
            classType: classItem.classType as "theory" | "driving",
            classNumber: classItem.classNumber,
            date: classItem.date || today,
            duration: classItem.duration ?? undefined,
            maxStudents: classItem.maxStudents ?? undefined,
          };
          const validation = validateClassBooking(target, completedClassesAvail, studentCourseTypeAvail);
          return validation.allowed;
        });

        // Phase info for UI display
        const phaseProgress = calculatePhaseProgress(student, completedTheoryClasses, completedInCarSessions, enrollments);
        const currentPhase = phaseProgress.currentPhase;
        const phases = COURSE_PHASES[studentCourseTypeAvail] || COURSE_PHASES.auto;
        const theoryPhase = phases[0];
        const requiredTheoryForDriving = theoryPhase.requiredTheoryClasses;
        const hasCompletedTheoryRequirements = completedTheoryClasses >= requiredTheoryForDriving;

        res.json({
          classes: filteredClasses,
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
          
          const classDateTime = new Date(`${c.date}T${c.time}`);
          if (classDateTime <= now) return false;
          
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
            const isTheory = c.classNumber && c.classNumber <= 5;
            
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
            const dateA = new Date(`${a.date}T${a.time}`);
            const dateB = new Date(`${b.date}T${b.time}`);
            return dateA.getTime() - dateB.getTime();
          });

        res.json(enrichedLessons);
      } catch (error) {
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
        const classDateTime = new Date(`${classData.date}T${classData.time}`);
        if (classDateTime <= new Date()) {
          return res.status(400).json({ message: "This lesson has already started or passed" });
        }
        
        const price = classData.price || 0;
        
        if (price > 0) {
          // Create a payment intent for the extra lesson
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-04-30.basil' });
          
          const paymentIntent = await stripe.paymentIntents.create({
            amount: price,
            currency: 'usd',
            metadata: {
              type: 'extra_lesson',
              classId: classId.toString(),
              studentId: student.id.toString(),
              studentName: `${student.firstName} ${student.lastName}`,
              lessonTopic: classData.topic || 'Extra Lesson',
              lessonDate: classData.date,
            }
          });
          
          // Create enrollment with pending payment status
          const enrollment = await storage.createClassEnrollment({
            classId: classId,
            studentId: student.id,
            attendanceStatus: 'registered',
            paymentStatus: 'pending',
            lastPaymentIntentId: paymentIntent.id
          });
          
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
          });
          
          res.json({
            enrollmentId: enrollment.id,
            paymentRequired: false,
            message: 'Successfully booked the free extra lesson'
          });
        }
      } catch (error) {
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
          return res.status(400).json({ message: "Payment already confirmed" });
        }
        
        // Verify payment with Stripe
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-04-30.basil' });
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status !== 'succeeded') {
          return res.status(400).json({ message: "Payment not yet successful" });
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
        const student = req.student;
        const classId = parseInt(req.params.classId);

        // Get the class to check details
        const classData = await storage.getClass(classId);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
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
            };
          });

        const completedClassesForRules = buildCompletedClasses(enrollmentDetails);
        const studentCourseType = (student.courseType || 'auto').toLowerCase();

        const bookingTarget = {
          classType: classData.classType as "theory" | "driving",
          classNumber: classData.classNumber ?? 0,
          date: classData.date ?? new Date().toISOString().slice(0, 10),
          duration: classData.duration ?? undefined,
          currentEnrollmentCount: undefined as number | undefined,
          maxStudents: classData.maxStudents ?? undefined,
        };

        // For shared session check on In-Car 12/13, count current non-cancelled enrollments
        if (classData.classType === 'driving' && (classData.classNumber === 12 || classData.classNumber === 13)) {
          const existingEnrollments = await storage.getClassEnrollmentsByClass(classData.id);
          bookingTarget.currentEnrollmentCount = existingEnrollments.filter(e => !e.cancelledAt).length;
        }

        const phaseValidation = validateClassBooking(bookingTarget, completedClassesForRules, studentCourseType);
        if (!phaseValidation.allowed) {
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
            return res.status(400).json({
              message: "You need a valid learner's permit on file to book driving classes. Please update your permit information in your profile.",
              policyViolation: 'permit_required'
            });
          }
          
          if (!student.learnerPermitExpiryDate) {
            return res.status(400).json({
              message: "Your learner's permit expiration date is not on file. Please update your permit information in your profile.",
              policyViolation: 'permit_expiry_missing'
            });
          }
          
          const permitExpiry = new Date(student.learnerPermitExpiryDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          if (permitExpiry < today) {
            return res.status(400).json({
              message: "Your learner's permit has expired. Please renew your permit and update your profile before booking driving classes.",
              policyViolation: 'permit_expired'
            });
          }
          
          if (classData.date) {
            const classDate = new Date(classData.date);
            if (classDate > permitExpiry) {
              return res.status(400).json({
                message: `Your learner's permit expires on ${permitExpiry.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. You cannot book a driving class after that date.`,
                policyViolation: 'permit_expires_before_class'
              });
            }
          }
        }

        // Get active booking policies for this class type
        const policies = await storage.getActiveBookingPolicies(classData.courseType || undefined, classType);

        // Check max_duration policy
        const maxDurationPolicy = policies.find(p => p.policyType === 'max_duration');
        if (maxDurationPolicy && classData.duration) {
          if (classData.duration > maxDurationPolicy.value) {
            return res.status(400).json({ 
              message: `Class duration (${classData.duration} minutes) exceeds the maximum allowed (${maxDurationPolicy.value} minutes)`,
              policyViolation: 'max_duration'
            });
          }
        }

        // Check max_bookings_per_day policy
        const maxBookingsPolicy = policies.find(p => p.policyType === 'max_bookings_per_day');
        if (maxBookingsPolicy && classData.date) {
          // Count student's bookings for this date
          const studentEnrollments = await storage.getClassEnrollmentsByStudent(student.id);
          const classesForStudent = await Promise.all(
            studentEnrollments
              .filter(e => !e.cancelledAt)
              .map(async (e) => {
                if (e.classId) {
                  return await storage.getClass(e.classId);
                }
                return null;
              })
          );
          const bookingsOnSameDay = classesForStudent.filter(
            c => c && c.date === classData.date
          ).length;

          if (bookingsOnSameDay >= maxBookingsPolicy.value) {
            return res.status(400).json({ 
              message: `You have already booked ${bookingsOnSameDay} class(es) on this date. Maximum allowed is ${maxBookingsPolicy.value}.`,
              policyViolation: 'max_bookings_per_day'
            });
          }
        }

        // Check advance_booking_days policy
        const advanceBookingPolicy = policies.find(p => p.policyType === 'advance_booking_days');
        if (advanceBookingPolicy && classData.date) {
          const classDate = new Date(classData.date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const diffTime = classDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          if (diffDays > advanceBookingPolicy.value) {
            return res.status(400).json({ 
              message: `Cannot book classes more than ${advanceBookingPolicy.value} days in advance`,
              policyViolation: 'advance_booking_days'
            });
          }
        }

        const result = await storage.bookClass(student.id, classId);

        if (result.success) {
          res.json({
            message: "Class booked successfully",
            enrollment: result.enrollment,
          });
        } else {
          res.status(400).json({ message: result.message });
        }
      } catch (error) {
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
        const classDateTime = new Date(`${classData.date}T${classData.time}`);
        const now = new Date();
        if (classDateTime <= now) {
          return res.status(400).json({ message: "Cannot reschedule past classes" });
        }

        // SIMPLE HARDCODED POLICY FOR TESTING
        const rescheduleWindowHours = 24;
        const rescheduleFee = 25.00;

        // Check if within restricted window
        const hoursUntilClass = (classDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const withinRestrictedWindow = hoursUntilClass < rescheduleWindowHours;
        const feeRequired = withinRestrictedWindow;

        // Get available slots - simplified query
        let availableClasses = await storage.getAvailableClasses(student.id, {
          courseType: classData.courseType,
        });

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
        const classDateTime = new Date(`${classData.date}T${classData.time}`);
        const now = new Date();
        const hoursUntilClass = (classDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const rescheduleWindowHours = parseInt(await storage.getSetting('rescheduleWindowHours') || '24');
        const rescheduleFee = parseFloat(await storage.getSetting('rescheduleFee') || '25.00');
        const feeRequired = hoursUntilClass < rescheduleWindowHours;

        if (!feeRequired) {
          return res.status(400).json({ message: "No fee required for this reschedule" });
        }

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(rescheduleFee * 100), // Convert to cents
          currency: "usd",
          metadata: {
            enrollmentId: String(enrollmentId),
            studentId: String(student.id),
            purpose: 'reschedule',
          },
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
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
        const classDateTime = new Date(`${oldClass.date}T${oldClass.time}`);
        const now = new Date();
        if (classDateTime < now) {
          return res.status(400).json({ message: "Cannot reschedule a class that has already started" });
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
              return res.status(400).json({ message: "This payment has already been used" });
            }

            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            
            // Verify payment is successful
            if (paymentIntent.status !== 'succeeded') {
              return res.status(400).json({ message: "Payment was not successful" });
            }
            
            // Verify currency matches (USD or CAD)
            const expectedCurrency = 'usd'; // TODO: Make this configurable per school
            if (paymentIntent.currency.toLowerCase() !== expectedCurrency) {
              return res.status(400).json({ message: `Payment must be in ${expectedCurrency.toUpperCase()}` });
            }
            
            // Verify exact amount (not just >=)
            const expectedAmount = Math.round(rescheduleFee * 100); // Convert to cents
            if (paymentIntent.amount !== expectedAmount) {
              return res.status(400).json({ 
                message: "Payment amount does not match the required fee",
                expected: expectedAmount,
                received: paymentIntent.amount,
              });
            }

            // Verify payment metadata matches this enrollment
            if (paymentIntent.metadata.enrollmentId !== String(enrollmentId)) {
              return res.status(400).json({ message: "Payment does not match this enrollment" });
            }

            // Record payment in global ledger atomically to prevent reuse
            await db.insert(policyFeePayments).values({
              paymentIntentId,
              enrollmentId,
              status: 'reschedule',
              amount: expectedAmount,
              currency: expectedCurrency,
            });
          } catch (error) {
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
        });

        res.json({
          success: true,
          message: "Class rescheduled successfully",
          newClass,
        });
      } catch (error) {
        console.error("Error rescheduling class:", error);
        res.status(500).json({ message: "Failed to reschedule class" });
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
        const classDateTime = new Date(`${classData.date}T${classData.time}`);
        const now = new Date();
        if (classDateTime <= now) {
          return res.status(400).json({ message: "Cannot cancel past classes" });
        }

        // SIMPLE HARDCODED POLICY FOR TESTING
        const cancelWindowHours = 24;
        const cancelFee = 25.00;

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
        const classDateTime = new Date(`${classData.date}T${classData.time}`);
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
          currency: "usd",
          metadata: {
            enrollmentId: String(enrollmentId),
            studentId: String(student.id),
            purpose: 'cancel',
          },
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
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

        // Check if already cancelled
        if (enrollment.cancelledAt) {
          return res.status(400).json({ message: "This class has already been cancelled" });
        }

        // Get the class
        const classData = await storage.getClass(enrollment.classId!);
        if (!classData) {
          return res.status(404).json({ message: "Class not found" });
        }

        // Check if class has already started or is in the past
        const classDateTime = new Date(`${classData.date}T${classData.time}`);
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
              return res.status(400).json({ message: "This payment has already been used" });
            }

            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            
            // Verify payment is successful
            if (paymentIntent.status !== 'succeeded') {
              return res.status(400).json({ message: "Payment was not successful" });
            }
            
            // Verify currency matches (USD or CAD)
            const expectedCurrency = 'usd'; // TODO: Make this configurable per school
            if (paymentIntent.currency.toLowerCase() !== expectedCurrency) {
              return res.status(400).json({ message: `Payment must be in ${expectedCurrency.toUpperCase()}` });
            }
            
            // Verify exact amount (not just >=)
            const expectedAmount = Math.round(cancelFee * 100); // Convert to cents
            if (paymentIntent.amount !== expectedAmount) {
              return res.status(400).json({ 
                message: "Payment amount does not match the required fee",
                expected: expectedAmount,
                received: paymentIntent.amount,
              });
            }

            // Verify payment metadata matches this enrollment
            if (paymentIntent.metadata.enrollmentId !== String(enrollmentId)) {
              return res.status(400).json({ message: "Payment does not match this enrollment" });
            }

            // Record payment in global ledger atomically to prevent reuse
            await db.insert(policyFeePayments).values({
              paymentIntentId,
              enrollmentId,
              status: 'cancel',
              amount: expectedAmount,
              currency: expectedCurrency,
            });
          } catch (error) {
            console.error("Error verifying payment:", error);
            return res.status(400).json({ message: "Failed to verify payment" });
          }
        }

        // Soft delete the enrollment and record payment intent if used
        await storage.updateClassEnrollment(enrollmentId, {
          cancelledAt: new Date(),
          ...(paymentIntentId ? { lastPaymentIntentId: paymentIntentId } : {}),
        });

        res.json({
          success: true,
          message: "Class cancelled successfully",
        });
      } catch (error) {
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

        if (type === "package") {
          if (!packageId) {
            return res.status(400).json({ message: "Package ID required for package purchase" });
          }
          const packages = await storage.getLessonPackages();
          const pkg = packages.find(p => p.id === packageId);
          if (!pkg || !pkg.isActive) {
            return res.status(404).json({ message: "Package not found or inactive" });
          }
          finalAmount = parseFloat(pkg.price?.toString() || '0');
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

        // Create payment intent and confirm atomically
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(finalAmount * 100), // Convert to cents
          currency: "usd",
          customer: student.stripeCustomerId || undefined,
          payment_method: method.stripePaymentMethodId,
          confirm: true,
          description: finalDescription,
          metadata: {
            studentId: String(student.id),
            type,
            packageId: packageId ? String(packageId) : '',
          },
          return_url: `${process.env.REPL_URL || 'http://localhost:5000'}/student/billing`,
        });

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
          amount: String(finalAmount),
          gst: "0.00",
          pst: "0.00",
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
          pdfPath: null, // Will be generated later
        });

        res.json({
          status: "paid",
          receiptUrl: `/api/student/billing/receipt/${transaction.id}`,
          transaction,
        });
      } catch (error: any) {
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
          coveredItems: null
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
        console.error("Error fetching payment history:", error);
        res.status(500).json({ message: "Failed to fetch payment history" });
      }
    }
  );

  // Download receipt
  app.get(
    "/api/student/billing/receipt/:id",
    isStudentAuthenticated,
    async (req: any, res) => {
      try {
        const student = req.student;
        const transactionId = parseInt(req.params.id);

        // Get transaction
        const transactions = await storage.getStudentPaymentHistory(student.id);
        const transaction = transactions.find(t => t.id === transactionId);

        if (!transaction) {
          return res.status(404).json({ message: "Receipt not found" });
        }

        // For now, return a simple JSON receipt
        // TODO: Generate PDF using a library like PDFKit
        const receipt = {
          receiptNumber: `REC-${transactionId}`,
          date: transaction.date,
          studentName: `${student.firstName} ${student.lastName}`,
          description: transaction.description,
          amount: transaction.amount,
          gst: transaction.gst,
          pst: transaction.pst,
          total: transaction.total,
          paymentMethod: transaction.paymentMethod,
          referenceNumber: transaction.referenceNumber,
        };

        res.json(receipt);
      } catch (error) {
        console.error("Error fetching receipt:", error);
        res.status(500).json({ message: "Failed to fetch receipt" });
      }
    }
  );

  // ============================================
  // Admin Payment Reconciliation Routes
  // ============================================

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
      console.error("Error fetching payment intakes:", error);
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // Create a new payment intake (record incoming payment)
  app.post("/api/admin/payments/intakes", authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const data = {
        ...req.body,
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
      console.error("Error creating payment intake:", error);
      res.status(400).json({ message: "Failed to record payment" });
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
        console.error("Failed to send payment received notification:", notifyError);
      }
      
      res.json({ intake: updatedIntake, allocation, transaction });
    } catch (error) {
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
          description: tx.description,
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
          tx.description.toLowerCase().includes(searchLower) ||
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
          new Date(`${c.date}T${c.time}`) > new Date()
        ).length;
        
        const pendingEvaluations = evaluations.filter(
          (e) => !e.signedOff,
        ).length;
        
        const pendingVehicleConfirmations = classes.filter((c) => 
          c.vehicleId && !c.vehicleConfirmed && 
          new Date(`${c.date}T${c.time}`) > new Date()
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

        // Calculate stats
        const upcomingClasses = classes.filter((c) => {
          const classDate = new Date(`${c.date}T${c.time}`);
          return classDate > new Date() && c.status === "scheduled";
        });

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
        res.json(students);
      } catch (error) {
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

        // Check that the class date is today or in the past
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [year, month, day] = classData.date.split('-').map(Number);
        const classDate = new Date(year, month - 1, day);
        
        if (classDate > today) {
          return res.status(400).json({ message: "Cannot mark a future class as completed" });
        }

        // Update the class status to 'completed'
        await storage.updateClass(classId, { status: 'completed' });

        res.json({ success: true, message: "Class marked as completed" });
      } catch (error) {
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

        // Check that the class date is today or in the past
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [year, month, day] = classData.date.split('-').map(Number);
        const classDate = new Date(year, month - 1, day);
        
        if (classDate > today) {
          return res.status(400).json({ message: "Cannot submit attendance for a future class" });
        }

        // Update attendance for each student
        for (const record of attendance) {
          await storage.updateClassEnrollment(record.enrollmentId, {
            attendanceStatus: record.attended ? 'attended' : 'absent',
          });
        }

        // Mark the class as completed with the attendance signature
        await storage.updateClass(classId, { 
          status: 'completed',
          attendanceSignature: signature,
          attendanceSignedAt: new Date().toISOString(),
          attendanceSignedBy: instructor.id,
        });

        res.json({ 
          success: true, 
          message: "Attendance submitted successfully",
          attendedCount: attendance.filter((a: any) => a.attended).length,
          absentCount: attendance.filter((a: any) => !a.attended).length,
        });
      } catch (error) {
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

        // Class type breakdown (Theory: class 1-5, Driving: class 6+, One-Off: driving lessons with lessonType='one_off')
        const theoryClasses = completedClasses.filter((c: any) => c.classNumber >= 1 && c.classNumber <= 5);
        const regularDrivingClasses = completedClasses.filter((c: any) => c.classNumber > 5 && c.lessonType !== 'one_off');
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
      console.error("Error generating PDF:", error);
      res.status(500).json({ message: "Failed to generate PDF report" });
    }
  });

  // ============================================
  // NOTIFICATION API ENDPOINTS
  // ============================================

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
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
