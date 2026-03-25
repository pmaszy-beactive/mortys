import { storage } from "./storage";
import type { RequestHandler } from "express";
import bcrypt from "bcryptjs";

// Student authentication
export const loginStudent = async (email: string, password: string) => {
  try {
    // Get student from database by email
    const student = await storage.getStudentByEmail(email);
    
    if (!student) {
      return { success: false, message: "Invalid credentials" };
    }
    
    // Check if student is active
    if (student.accountStatus !== 'active') {
      return { 
        success: false, 
        message: "Student account is not active. Please check your email for the activation link.",
        errorType: "account_inactive",
      };
    }
    
    // Verify password
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

// Student auth middleware — also allows admin impersonation
export const isStudentAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    const session = req.session as any;
    const studentId = session?.studentId;
    
    if (studentId) {
      const student = await storage.getStudent(studentId);
      if (!student || student.accountStatus !== 'active') {
        return res.status(401).json({ message: "Student not found or inactive" });
      }
      (req as any).student = student;
      return next();
    }

    // Allow admin impersonation: admin session + impersonating student
    const impersonatingStudentId = session?.impersonatingStudentId;
    const adminUserId = session?.userId;
    if (impersonatingStudentId && adminUserId) {
      const student = await storage.getStudent(impersonatingStudentId);
      if (!student || student.accountStatus !== 'active') {
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
