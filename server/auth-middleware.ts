import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { roleSatisfies, type Role } from "./auth-roles";
import { resolveUserId } from "./auth-identity";

/**
 * Express middleware: allow the request only if the acting user's role
 * (read fresh from the DB) is one of `allowed`. 401 if not logged in,
 * 403 if logged in but role not permitted.
 */
export function requireRole(...allowed: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Giriş gerekli" });
    }
    const user = await storage.getUserById(userId);
    if (!user || !roleSatisfies(user.role, allowed)) {
      return res.status(403).json({ message: "Bu işlem için yetkiniz yok" });
    }
    (req as any).currentUser = user;
    next();
  };
}
