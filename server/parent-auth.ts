import { storage } from "./storage";
import type { RequestHandler } from "express";
import bcrypt from "bcryptjs";

export const loginParent = async (email: string, password: string) => {
  try {
    const parent = await storage.getParentByEmail(email);
    
    if (!parent) {
      return { success: false, message: "Invalid credentials" };
    }
    
    if (parent.accountStatus !== 'active') {
      return { success: false, message: "Parent account is not active. Please check your email for the activation link." };
    }
    
    if (!parent.password) {
      return { success: false, message: "Invalid credentials - account not set up" };
    }
    
    const passwordMatch = await bcrypt.compare(password, parent.password);
    if (!passwordMatch) {
      return { success: false, message: "Invalid credentials" };
    }

    const linkedStudents = await storage.getParentStudents(parent.id);

    return { success: true, parent, linkedStudents };
  } catch (error) {
    console.error("Parent login error:", error);
    return { success: false, message: "Login failed" };
  }
};

export const isParentAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    const parentId = (req.session as any)?.parentId;
    
    if (!parentId) {
      return res.status(401).json({ message: "Unauthorized - parent not logged in" });
    }

    const parent = await storage.getParent(parentId);
    if (!parent || parent.accountStatus !== 'active') {
      return res.status(401).json({ message: "Parent not found or inactive" });
    }

    (req as any).parent = parent;
    
    const selectedStudentId = (req.session as any)?.selectedStudentId;
    if (selectedStudentId) {
      const student = await storage.getStudent(selectedStudentId);
      if (student) {
        (req as any).selectedStudent = student;
      }
    }
    
    next();
  } catch (error) {
    console.error("Parent auth middleware error:", error);
    res.status(401).json({ message: "Unauthorized" });
  }
};
