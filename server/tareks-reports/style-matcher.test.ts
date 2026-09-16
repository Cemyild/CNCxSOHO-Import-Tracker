import { describe, it, expect } from "vitest";
import { detectStyles, normalizeStyle, buildZipPaths } from "./style-matcher";

// A representative slice of the real product catalogue (products.style).
const KNOWN = [
  "A0059U", "A112U", "A0290U", "A0434U", "A0590U", "A0685U",
  "AMFOSR1095", "AMFOSR1123", "AWFOSR1085",
  "M2066R", "M3181R", "M3193R", "M3199R", "M3228R", "M3245R", "M3290R",
  "M3328R", "M3732R", "M5251R", "M5172R", "M5175R", "M5190R",
  "M6122R", "M6123R", "W3956R", "W31084R", "AWSNSN1056", "AMTOJR1121",
];

describe("normalizeStyle", () => {
  it("uppercases and trims", () => {
    expect(normalizeStyle("  m3245r ")).toBe("M3245R");
  });

  it("strips surrounding punctuation", () => {
    expect(normalizeStyle("-M3245R-")).toBe("M3245R");
  });
});

describe("detectStyles — real filenames from the archive", () => {
  const cases: Array<[string, string[]]> = [
    ["A0059U Test raporu.pdf", ["A0059U"]],
    ["A112U Test Raporu.pdf", ["A112U"]],
    ["A0290U Test Raporu.pdf", ["A0290U"]],
    ["A0434U.pdf", ["A0434U"]],
    ["A0590U KAHVERENGİ.pdf", ["A0590U"]],
    ["M2066R.pdf", ["M2066R"]],
    ["M3199R ANALİZ RAPORU.pdf", ["M3199R"]],
    ["M3245R - BURGUNDY.pdf", ["M3245R"]],
    ["M3245R- BLACK.pdf", ["M3245R"]],
    ["M6122R - BROWN.pdf", ["M6122R"]],
    ["AMFOSR1095.pdf", ["AMFOSR1095"]],
  ];

  for (const [filename, expected] of cases) {
    it(`reads ${filename}`, () => {
      expect(detectStyles(filename, KNOWN)).toEqual(expected);
    });
  }

  it("keeps the style when a suffix is glued on with a dash", () => {
    expect(detectStyles("AWFOSR1085-001.pdf", KNOWN)).toEqual(["AWFOSR1085"]);
  });

  it("finds both styles when a report covers two", () => {
    expect(
      detectStyles(
        "M3732R -  M5251R - 2856984 - Ticaret Bakanlığı (Softline) - A26857186 - SOHO PERAKENDE YATIRIM -.pdf",
        KNOWN,
      ),
    ).toEqual(["M3732R", "M5251R"]);
  });

  it("does not mistake a TAREKS number for a style", () => {
    const got = detectStyles(
      "M3193R - 260059838_-_TAREKS_NO_A26638221_-_MODEL_NO_.pdf",
      KNOWN,
    );
    expect(got).toEqual(["M3193R"]);
    expect(got).not.toContain("A26638221");
  });

  it("ignores EKOTEKS order numbers and trailing TAREKS ids", () => {
    expect(
      detectStyles("M3228R  EKOTEKS 2600003016 PASS SOHO ALO KAZAK MAVI A26410945.pdf", KNOWN),
    ).toEqual(["M3228R"]);
  });

  it("falls back to the pattern for a style missing from the catalogue", () => {
    // A0590V is not in KNOWN; the fallback pattern must still catch it.
    expect(detectStyles("A0590V - 2606001012.pdf", KNOWN)).toEqual(["A0590V"]);
  });

  it("returns an empty list when nothing looks like a style", () => {
    expect(detectStyles("Test raporu taranmış.pdf", KNOWN)).toEqual([]);
  });

  it("does not return the same style twice", () => {
    expect(detectStyles("M3245R - M3245R kopya.pdf", KNOWN)).toEqual(["M3245R"]);
  });

  it("prefers the longest catalogue match over a shorter substring", () => {
    // AMFOSR1095 must not be reported as some shorter accidental match.
    expect(detectStyles("AMFOSR1095 rapor.pdf", KNOWN)).toEqual(["AMFOSR1095"]);
  });

  it("matches case-insensitively", () => {
    expect(detectStyles("m3245r - burgundy.pdf", KNOWN)).toEqual(["M3245R"]);
  });
});

describe("buildZipPaths", () => {
  it("puts each report under a folder per style", () => {
    const paths = buildZipPaths([
      { id: 1, originalFilename: "M3245R - BURGUNDY.pdf", styles: ["M3245R"] },
      { id: 2, originalFilename: "rapor.pdf", styles: ["M3732R", "M5251R"] },
    ]);
    expect(paths).toEqual([
      { id: 1, pathInZip: "M3245R/M3245R - BURGUNDY.pdf" },
      { id: 2, pathInZip: "M3732R/rapor.pdf" },
      { id: 2, pathInZip: "M5251R/rapor.pdf" },
    ]);
  });

  it("files a report with no styles under _NO_STYLE", () => {
    expect(buildZipPaths([{ id: 3, originalFilename: "x.pdf", styles: [] }])).toEqual([
      { id: 3, pathInZip: "_NO_STYLE/x.pdf" },
    ]);
  });

  it("dedupes identical filenames inside the same style folder", () => {
    const paths = buildZipPaths([
      { id: 1, originalFilename: "rapor.pdf", styles: ["M3245R"] },
      { id: 2, originalFilename: "rapor.pdf", styles: ["M3245R"] },
    ]);
    expect(paths.map((p) => p.pathInZip)).toEqual([
      "M3245R/rapor.pdf",
      "M3245R/rapor (2).pdf",
    ]);
  });

  it("replaces characters that are illegal inside a zip path", () => {
    expect(
      buildZipPaths([{ id: 1, originalFilename: "a/b:c.pdf", styles: ["M3245R"] }])[0].pathInZip,
    ).toBe("M3245R/a_b_c.pdf");
  });
});
