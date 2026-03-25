import { storage } from "./storage";
import type { RequestHandler } from "express";

// Traditional auth for development/demos
export const loginUser = async (username: string, password: string) => {
  try {
    // Demo credentials for both environments
    const demoCredentials = [
      { username: "admin", password: "demo123", id: "demo-admin" },
      { username: "demo", password: "demo123", id: "demo-user" },
      { username: "morty", password: "driving2025", id: "morty-admin" }
    ];

    const credential = demoCredentials.find(c => c.username === username && c.password === password);
    
    if (!credential) {
      return { success: false, message: "Invalid credentials" };
    }

    // Get or create demo user
    let user = await storage.getUserByUsernamePassword(credential.username);
    
    if (!user) {
      // Create demo user
      user = await storage.createDemoUser({
        id: credential.id,
        email: `${credential.username}@mortysdriving.com`,
        firstName: credential.username === "morty" ? "Morty" : "Demo",
        lastName: credential.username === "morty" ? "Smith" : "User",
        profileImageUrl: null
      });
    }

    return { success: true, user };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, message: "Login failed" };
  }
};

// Traditional auth middleware for development
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

    // Add user to request
    (req as any).user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(401).json({ message: "Unauthorized" });
  }
};