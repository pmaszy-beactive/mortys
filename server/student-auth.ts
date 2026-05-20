import { storage } from "./storage";
import type { RequestHandler } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const TOKEN_SECRET = process.env.SESSION_SECRET || "student-token-secret-key";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateStudentToken(studentId: number): string {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = `${studentId}:${expiry}`;
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + sig;
}

export function verifyStudentToken(token: string): number | null {
  try {
    const dotIdx = token.indexOf(".");
    if (dotIdx === -1) return null;
    const b64payload = token.substring(0, dotIdx);
    const sig = token.substring(dotIdx + 1);
    const payload = Buffer.from(b64payload, "base64url").toString("utf8");
    const expectedSig = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"))) return null;
    const colonIdx = payload.indexOf(":");
    if (colonIdx === -1) return null;
    const studentId = parseInt(payload.substring(0, colonIdx));
    const expiry = parseInt(payload.substring(colonIdx + 1));
    if (isNaN(studentId) || isNaN(expiry)) return null;
    if (Date.now() > expiry) return null;
    return studentId;
  } catch {
    return null;
  }
}

// Student authentication
export const loginStudent = async (email: string, password: string) => {
  try {
    const student = await storage.getStudentByEmail(email);
    
    if (!student) {
      return { success: false, message: "Invalid credentials" };
    }
    
    if (student.accountStatus !== "active") {
      return { 
        success: false, 
        message: "Student account is not active. Please check your email for the activation link.",
        errorType: "account_inactive",
      };
    }
    
    if (!student.password) {
      return { success: false, message: "Invalid credentials - account not set up" };
    }
    
    const passwordMatch = await bcrypt.compare(password, student.password);
    if (!passwordMatch) {
      return { success: false, message: "Invalid credentials" };
    }

    return { success: true, student };
  } catch (error) {
    console.error("Student login error:", error);
    return { success: false, message: "Login failed" };
  }
};

// Student auth middleware — checks Bearer token first, then session cookie, then admin impersonation
export const isStudentAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    // 1. Bearer token (localStorage-based, works in all environments including iframe previews)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const studentId = verifyStudentToken(token);
      if (studentId) {
        const student = await storage.getStudent(studentId);
        if (student && student.accountStatus === "active") {
          (req as any).student = student;
          return next();
        }
      }
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // 2. Session cookie fallback (works in normal browsers / new-tab context)
    const session = req.session as any;
    const studentId = session?.studentId;
    if (studentId) {
      const student = await storage.getStudent(studentId);
      if (!student || student.accountStatus !== "active") {
        return res.status(401).json({ message: "Student not found or inactive" });
      }
      (req as any).student = student;
      return next();
    }

    // 3. Admin impersonation
    const impersonatingStudentId = session?.impersonatingStudentId;
    const adminUserId = session?.userId;
    if (impersonatingStudentId && adminUserId) {
      const student = await storage.getStudent(impersonatingStudentId);
      if (!student || student.accountStatus !== "active") {
        return res.status(401).json({ message: "Impersonated student not found or inactive" });
      }
      (req as any).student = student;
      (req as any).isImpersonating = true;
      return next();
    }

    return res.status(401).json({ message: "Unauthorized - student not logged in" });
  } catch (error) {
    console.error("Student auth middleware error:", error);
    res.status(401).json({ message: "Unauthorized" });
  }
};
