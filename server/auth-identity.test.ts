import { describe, it, expect, beforeAll } from "vitest";

// auth-token throws at import time when SESSION_SECRET is missing.
process.env.SESSION_SECRET ||= "test-secret-for-auth-middleware";

type Loaded = {
  resolveUserId: (req: any) => number | null;
  signToken: (userId: number, now?: number) => string;
};

let mod: Loaded;

beforeAll(async () => {
  const middleware = await import("./auth-identity");
  const token = await import("./auth-token");
  mod = { resolveUserId: middleware.resolveUserId, signToken: token.signToken };
});

function reqWith(opts: { sessionUserId?: number; authorization?: string }) {
  return {
    session: opts.sessionUserId ? { userId: opts.sessionUserId } : {},
    headers: opts.authorization ? { authorization: opts.authorization } : {},
  };
}

describe("resolveUserId", () => {
  it("reads the user from the session cookie", () => {
    expect(mod.resolveUserId(reqWith({ sessionUserId: 7 }))).toBe(7);
  });

  it("reads the user from a signed bearer token when there is no session", () => {
    // This is how the front-end authenticates: apiRequest sends Authorization,
    // and the browser may carry no session cookie at all.
    const token = mod.signToken(42);
    expect(mod.resolveUserId(reqWith({ authorization: `Bearer ${token}` }))).toBe(42);
  });

  it("rejects a forged bearer token", () => {
    expect(mod.resolveUserId(reqWith({ authorization: "Bearer 42.9999999999999.deadbeef" }))).toBeNull();
  });

  it("rejects the legacy plain-id token", () => {
    expect(mod.resolveUserId(reqWith({ authorization: "Bearer 42" }))).toBeNull();
  });

  it("returns null when the request carries no identity at all", () => {
    expect(mod.resolveUserId(reqWith({}))).toBeNull();
  });

  it("prefers the session when both are present", () => {
    const token = mod.signToken(42);
    expect(mod.resolveUserId(reqWith({ sessionUserId: 7, authorization: `Bearer ${token}` }))).toBe(7);
  });
});
