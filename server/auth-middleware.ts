import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { verifyToken } from "./auth-token";
import { roleSatisfies, type Role } from "./auth-roles";

/** Resolve the acting user id from session cookie or signed bearer token. */
function resolveUserId(req: Request): number | null {
  const sessionUserId = (req.session as any)?.userId;
  if (sessionUserId) return sessionUserId;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return verifyToken(authHeader.substring(7));
  }
  return null;
}

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
