import { storage } from "./storage";
import type { RequestHandler } from "express";

export const loginUser = async (username: string, password: string) => {
  const bcrypt = await import("bcryptjs");

  console.log(`[auth] loginUser: looking up "${username}"`);
  const user = await storage.getUserByEmail(username);

  if (!user || !user.password) {
    console.log(`[auth] loginUser: user not found or no password for "${username}"`);
    return { success: false, message: "Invalid credentials" };
  }

  console.log(`[auth] loginUser: comparing password for "${username}"`);
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    console.log(`[auth] loginUser: password mismatch for "${username}"`);
    return { success: false, message: "Invalid credentials" };
  }

  console.log(`[auth] loginUser: success for "${username}" (id=${user.id})`);
  return { success: true, user };
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
