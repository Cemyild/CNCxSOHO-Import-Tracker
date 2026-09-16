import type { Request } from "express";
import { verifyToken } from "./auth-token";

/**
 * Resolve the acting user id from the session cookie or a signed bearer token.
 *
 * Both are first-class: the front-end's `apiRequest` sends
 * `Authorization: Bearer <signed token>` and the browser may carry no session
 * cookie at all. A route that checks only `req.session.userId` rejects those
 * logged-in users with 401 — see server/auth-identity.test.ts.
 *
 * Lives apart from auth-middleware.ts so it pulls in no database module and
 * can be used (and tested) from any route file.
 */
export function resolveUserId(req: Pick<Request, "headers"> & { session?: any }): number | null {
  const sessionUserId = (req.session as any)?.userId;
  if (sessionUserId) return sessionUserId;

  const authHeader = req.headers?.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return verifyToken(authHeader.substring(7));
  }
  return null;
}
