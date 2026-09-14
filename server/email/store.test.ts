import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {}, rawDb: {} }));

import { normalizeSenderPattern, isValidSenderPattern } from "./store";

describe("normalizeSenderPattern", () => {
  it("küçük harfe çevirir ve kırpar", () => {
    expect(normalizeSenderPattern("  Ops@ISSGlobal.com ")).toBe("ops@issglobal.com");
  });
});

describe("isValidSenderPattern", () => {
  it("tam mail adresini kabul eder", () => {
    expect(isValidSenderPattern("ops@issglobal.com")).toBe(true);
  });
  it("@ ile başlayan alan adını kabul eder", () => {
    expect(isValidSenderPattern("@dhl.com")).toBe(true);
  });
  it("çıplak kelimeyi reddeder", () => {
    expect(isValidSenderPattern("dhl")).toBe(false);
  });
  it("boş değeri reddeder", () => {
    expect(isValidSenderPattern("   ")).toBe(false);
  });
  it("boşluk içeren değeri reddeder", () => {
    expect(isValidSenderPattern("ops@iss global.com")).toBe(false);
  });
  it("yalnızca @ işaretini reddeder", () => {
    expect(isValidSenderPattern("@")).toBe(false);
  });
});
