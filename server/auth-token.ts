import crypto from "crypto";

/**
 * Signed auth tokens.
 *
 * Replaces the old insecure scheme where the bearer token was simply the
 * user id (so `Authorization: Bearer 1` impersonated user 1). Tokens are now
 * HMAC-signed with SESSION_SECRET and carry an expiry, so they cannot be
 * forged or guessed without the secret.
 *
 * Format: `${userId}.${expiresAtMs}.${hmacHex}`
 */

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error("SESSION_SECRET tanımlı değil — auth token imzalanamaz.");
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET!).update(payload).digest("hex");
}

/** Issue a signed token for the given user id. */
export function signToken(userId: number, now: number = Date.now()): string {
  const exp = now + TOKEN_TTL_MS;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a token and return its user id, or null if invalid/expired/forged.
 * Old plain-numeric tokens ("1") fail here because they have no valid signature.
 */
export function verifyToken(
  token: string | undefined | null,
  now: number = Date.now(),
): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [userIdStr, expStr, sig] = parts;
  const expected = sign(`${userIdStr}.${expStr}`);

  // Constant-time comparison to avoid timing attacks.
  let sigBuf: Buffer;
  let expBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, "hex");
    expBuf = Buffer.from(expected, "hex");
  } catch {
    return null;
  }
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || now > exp) return null;

  const userId = Number(userIdStr);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  return userId;
}
