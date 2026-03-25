import { storage } from "./storage";
import type { RequestHandler } from "express";
import bcrypt from "bcryptjs";

// Instructor authentication
export const loginInstructor = async (email: string, password: string) => {
  try {
    // Get instructor from database by email
    const instructor = await storage.getInstructorByEmail(email);
    
    if (!instructor) {
      return { success: false, message: "Invalid credentials" };
    }
    
    // Check if instructor is active
    if (instructor.status !== 'active') {
      return { success: false, message: "Instructor account is not active" };
    }
    
    // Check if instructor has completed the invitation process
    if (instructor.accountStatus !== 'active') {
      return { success: false, message: "Please complete your account setup using the invitation link" };
    }
    
    // Verify password
    if (!instructor.password) {
      return { success: false, message: "Please complete your account setup using the invitation link" };
    }
    
    const passwordMatch = await bcrypt.compare(password, instructor.password);
    
    if (!passwordMatch) {
      return { success: false, message: "Invalid credentials" };
    }

    return { success: true, instructor };
  } catch (error) {
    console.error("Instructor login error:", error);
    return { success: false, message: "Login failed" };
  }
};

// Instructor auth middleware — also allows admin impersonation
export const isInstructorAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    const session = req.session as any;
    const instructorId = session?.instructorId;
    
    if (instructorId) {
      const instructor = await storage.getInstructor(instructorId);
      if (!instructor || instructor.status !== 'active') {
        return res.status(401).json({ message: "Instructor not found or inactive" });
      }
      (req as any).instructor = instructor;
      return next();
    }

    // Allow admin impersonation: admin session + impersonating instructor
    const impersonatingInstructorId = session?.impersonatingInstructorId;
    const adminUserId = session?.userId;
    if (impersonatingInstructorId && adminUserId) {
      const instructor = await storage.getInstructor(impersonatingInstructorId);
      if (!instructor || instructor.status !== 'active') {
        return res.status(401).json({ message: "Impersonated instructor not found or inactive" });
      }
      (req as any).instructor = instructor;
      (req as any).isImpersonating = true;
      return next();
    }

    return res.status(401).json({ message: "Unauthorized - instructor not logged in" });
  } catch (error) {
    console.error("Instructor auth middleware error:", error);
    res.status(401).json({ message: "Unauthorized" });
  }
};
