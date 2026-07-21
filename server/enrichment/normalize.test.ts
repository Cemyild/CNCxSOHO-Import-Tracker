import { describe, it, expect } from "vitest";
import {
  isJunk,
  cleanText,
  cleanNumber,
  cleanDate,
  normalizeCustoms,
} from "./normalize";

describe("isJunk", () => {
  it("treats blanks and placeholder marks as no-value", () => {
    for (const v of [null, undefined, "", "   ", "-", "--", ".", "X", "x", "N/A"]) {
      expect(isJunk(v), `expected ${JSON.stringify(v)} to be junk`).toBe(true);
    }
  });

  it("keeps real values, including zero", () => {
    for (const v of ["Erenköy", 0, "0", 46.692, "STN1", "USD"]) {
      expect(isJunk(v), `expected ${JSON.stringify(v)} to be kept`).toBe(false);
    }
  });
});

describe("cleanText", () => {
  it("trims and stringifies", () => {
    expect(cleanText("  55559417 ")).toBe("55559417");
    expect(cleanText(1)).toBe("1");
  });

  it("returns null for junk", () => {
    expect(cleanText("-")).toBeNull();
    expect(cleanText("   ")).toBeNull();
  });
});

describe("cleanNumber", () => {
  it("parses plain numbers", () => {
    expect(cleanNumber(46.692)).toBe(46.692);
    expect(cleanNumber("1234.56")).toBe(1234.56);
    expect(cleanNumber(0)).toBe(0);
  });

  it("parses Turkish decimal comma", () => {
    expect(cleanNumber("3510,98")).toBe(3510.98);
  });

  it("parses thousands separator plus decimal comma", () => {
    expect(cleanNumber("1.234,56")).toBe(1234.56);
  });

  it("returns null for junk and unparseable text", () => {
    expect(cleanNumber("-")).toBeNull();
    expect(cleanNumber("abc")).toBeNull();
  });
});

describe("cleanDate", () => {
  it("converts dd.mm.yyyy to ISO", () => {
    expect(cleanDate("03.07.2026")).toBe("2026-07-03");
    expect(cleanDate("13.07.2026")).toBe("2026-07-13");
  });

  it("accepts slash and dash separators", () => {
    expect(cleanDate("03/07/2026")).toBe("2026-07-03");
    expect(cleanDate("03-07-2026")).toBe("2026-07-03");
  });

  it("passes ISO dates through", () => {
    expect(cleanDate("2026-07-03")).toBe("2026-07-03");
  });

  it("converts Excel serial numbers", () => {
    // 46206 is 2026-07-03 in Excel's 1900 date system.
    expect(cleanDate(46206)).toBe("2026-07-03");
  });

  it("rejects the lone dot that the BEYAN TARİHİ column uses for 'not declared yet'", () => {
    expect(cleanDate(".")).toBeNull();
  });

  it("rejects junk and unparseable text", () => {
    expect(cleanDate("")).toBeNull();
    expect(cleanDate("bugün")).toBeNull();
    expect(cleanDate("32.01.2026")).toBeNull();
  });
});

describe("normalizeCustoms", () => {
  it("maps the long official office name to the short form the app already uses", () => {
    expect(normalizeCustoms("ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ")).toBe("Erenköy");
    expect(normalizeCustoms("MURATBEY GÜMRÜK MÜDÜRLÜĞÜ")).toBe("Muratbey");
    expect(normalizeCustoms("İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ")).toBe(
      "Istanbul Airport",
    );
    expect(normalizeCustoms("AMBARLI GÜMRÜK MÜDÜRLÜĞÜ")).toBe("Ambarlı");
    expect(normalizeCustoms("GEMLİK GÜMRÜK MÜDÜRLÜĞÜ")).toBe("Gemlik");
  });

  it("returns unknown offices unchanged so nothing is silently lost", () => {
    expect(normalizeCustoms("HALKALI GÜMRÜK MÜDÜRLÜĞÜ")).toBe(
      "HALKALI GÜMRÜK MÜDÜRLÜĞÜ",
    );
  });

  it("returns null for junk", () => {
    expect(normalizeCustoms("-")).toBeNull();
  });
});
