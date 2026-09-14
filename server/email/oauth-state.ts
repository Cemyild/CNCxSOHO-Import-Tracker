import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const STATE_TTL_MS = 10 * 60 * 1000;

export class InvalidStateError extends Error {
  constructor(message = "OAuth state geçersiz veya süresi dolmuş") {
    super(message);
    this.name = "InvalidStateError";
  }
}

function secret(): string {
  const value = process.env.SESSION_SECRET || process.env.EMAIL_TOKEN_ENC_KEY;
  if (!value) throw new Error("SESSION_SECRET veya EMAIL_TOKEN_ENC_KEY tanımlı olmalı");
  return value;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function signState(userId: number): string {
  const body = Buffer.from(
    JSON.stringify({
      userId,
      nonce: randomBytes(9).toString("base64url"),
      exp: Date.now() + STATE_TTL_MS,
    }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyState(state: string): { userId: number } {
  const parts = state.split(".");
  if (parts.length !== 2) throw new InvalidStateError();

  const [body, signature] = parts;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new InvalidStateError();
  }

  let payload: { userId?: number; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new InvalidStateError();
  }

  if (typeof payload.userId !== "number" || typeof payload.exp !== "number") {
    throw new InvalidStateError();
  }
  if (payload.exp < Date.now()) throw new InvalidStateError();

  return { userId: payload.userId };
}
