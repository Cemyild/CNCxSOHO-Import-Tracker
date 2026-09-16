import { describe, it, expect } from "vitest";
import { decodeMultipartFilename } from "./multipart-filename";

/** What multer hands us: the UTF-8 bytes read back as latin1. */
function asMulterSees(realName: string): string {
  return Buffer.from(realName, "utf8").toString("latin1");
}

describe("decodeMultipartFilename", () => {
  const turkish = [
    "A0590U KAHVERENGİ.pdf",
    "M3199R ANALİZ RAPORU.pdf",
    "M3245R - HAKİ.pdf",
    "M3732R - M5251R - 2856984 - Ticaret Bakanlığı (Softline).pdf",
    "M3245R - ÇİÇEKLİ ÖRGÜ ŞAL.pdf",
  ];

  for (const name of turkish) {
    it(`restores ${name}`, () => {
      expect(decodeMultipartFilename(asMulterSees(name))).toBe(name);
    });
  }

  it("leaves a plain ASCII filename untouched", () => {
    expect(decodeMultipartFilename("M5175R GRAVEL.pdf")).toBe("M5175R GRAVEL.pdf");
  });

  it("leaves an already-correct UTF-8 name untouched", () => {
    // Some clients send the name correctly; re-decoding must not corrupt it.
    expect(decodeMultipartFilename("A0590U KAHVERENGİ.pdf")).toBe("A0590U KAHVERENGİ.pdf");
  });

  it("keeps the original when decoding would produce replacement characters", () => {
    const notUtf8 = Buffer.from([0x41, 0xff, 0xfe, 0x2e, 0x70, 0x64, 0x66]).toString("latin1");
    expect(decodeMultipartFilename(notUtf8)).toBe(notUtf8);
  });

  it("handles an empty name", () => {
    expect(decodeMultipartFilename("")).toBe("");
  });
});
