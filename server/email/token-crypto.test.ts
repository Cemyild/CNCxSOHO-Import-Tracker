import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.EMAIL_TOKEN_ENC_KEY = "a".repeat(64);
});

describe("token-crypto", () => {
  it("şifrelenen değer aynen geri çözülür", async () => {
    const { encryptToken, decryptToken } = await import("./token-crypto");
    const secret = "1//0gRefreshTokenÖrneği_ĞÜŞİ";
    expect(decryptToken(encryptToken(secret))).toBe(secret);
  });

  it("aynı girdi her seferinde farklı şifreli metin üretir (rastgele IV)", async () => {
    const { encryptToken } = await import("./token-crypto");
    expect(encryptToken("abc")).not.toBe(encryptToken("abc"));
  });

  it("bozulmuş veriyi çözmeyi reddeder", async () => {
    const { encryptToken, decryptToken } = await import("./token-crypto");
    const payload = encryptToken("abc");
    const tampered = payload.slice(0, -2) + (payload.endsWith("aa") ? "bb" : "aa");
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("biçimi bozuk veriyi reddeder", async () => {
    const { decryptToken } = await import("./token-crypto");
    expect(() => decryptToken("merhaba")).toThrow(/biçim/i);
  });
});
