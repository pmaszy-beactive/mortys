import { storage } from "./storage";
import type { RequestHandler } from "express";

export const loginUser = async (username: string, password: string) => {
  try {
    const bcrypt = await import("bcryptjs");

    // Look up user by email (username field accepts email)
    const user = await storage.getUserByEmail(username);

    if (!user || !user.password) {
      return { success: false, message: "Invalid credentials" };
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return { success: false, message: "Invalid credentials" };
    }

    return { success: true, user };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, message: "Login failed" };
  }
};

export const isAuthenticatedTraditional: RequestHandler = async (req, res, next) => {
  try {
    const userId = (req.session as any)?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    (req as any).user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(401).json({ message: "Unauthorized" });
  }
};
