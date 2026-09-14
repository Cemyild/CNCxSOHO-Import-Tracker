import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";

beforeAll(() => {
  process.env.EMAIL_TOKEN_ENC_KEY = "b".repeat(64);
});
afterEach(() => vi.useRealTimers());

describe("oauth-state", () => {
  it("imzalanan state aynı kullanıcıyı geri verir", async () => {
    const { signState, verifyState } = await import("./oauth-state");
    expect(verifyState(signState(7))).toEqual({ userId: 7 });
  });

  it("imzası bozulmuş state'i reddeder", async () => {
    const { signState, verifyState, InvalidStateError } = await import("./oauth-state");
    const state = signState(7);
    const tampered = state.slice(0, -3) + "xyz";
    expect(() => verifyState(tampered)).toThrow(InvalidStateError);
  });

  it("gövdesi değiştirilmiş state'i reddeder", async () => {
    const { signState, verifyState, InvalidStateError } = await import("./oauth-state");
    const [, sig] = signState(7).split(".");
    const forged = Buffer.from(
      JSON.stringify({ userId: 1, nonce: "x", exp: Date.now() + 1000 }),
    ).toString("base64url");
    expect(() => verifyState(`${forged}.${sig}`)).toThrow(InvalidStateError);
  });

  it("süresi geçmiş state'i reddeder", async () => {
    const { signState, verifyState, InvalidStateError, STATE_TTL_MS } = await import("./oauth-state");
    vi.useFakeTimers();
    const state = signState(7);
    vi.advanceTimersByTime(STATE_TTL_MS + 1000);
    expect(() => verifyState(state)).toThrow(InvalidStateError);
  });

  it("biçimi bozuk state'i reddeder", async () => {
    const { verifyState, InvalidStateError } = await import("./oauth-state");
    expect(() => verifyState("merhaba")).toThrow(InvalidStateError);
  });

  it("her çağrıda farklı state üretir", async () => {
    const { signState } = await import("./oauth-state");
    expect(signState(7)).not.toBe(signState(7));
  });
});
