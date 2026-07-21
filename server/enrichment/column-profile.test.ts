import { describe, it, expect } from "vitest";
import {
  normalizeHeader,
  buildColumnProfile,
  countRecognizedHeaders,
  applyProfile,
  FIELD_CANDIDATES,
} from "./column-profile";
import type { RawRow } from "./types";

/**
 * A faithful slice of the real report's header row, keeping the original
 * column indices so ordering bugs surface.
 */
function realHeaders(): string[] {
  const headers: string[] = new Array(80).fill("");
  headers[0] = "DOSYA NO";
  headers[3] = "GONDEREN";
  headers[5] = "KOLİ";
  headers[8] = "GUM.";
  headers[10] = "BEYAN TARİHİ";
  headers[11] = "BEYAN NO";
  headers[12] = "FAT.BEDELİ";
  headers[13] = "DÖVİZ";
  headers[14] = "DÖVİZ KURU";
  headers[16] = "KAP";
  headers[22] = "NAVLUN";
  headers[45] = "BRUT KG.";
  headers[54] = "FATURA NO";
  headers[55] = "FATURA TARİHİ";
  headers[75] = "FATURA TARİHİ(0100)";
  headers[76] = "FATURA NO(0100)";
  return headers;
}

function colFor(field: string) {
  const profile = buildColumnProfile(realHeaders());
  return profile.mapped.find((m) => m.field === field);
}

describe("normalizeHeader", () => {
  it("strips case, Turkish diacritics and punctuation", () => {
    expect(normalizeHeader("FATURA NO(0100)")).toBe("faturano0100");
    expect(normalizeHeader("GUM.")).toBe("gum");
    expect(normalizeHeader("BRUT KG.")).toBe("brutkg");
    expect(normalizeHeader("DÖVİZ KURU")).toBe("dovizkuru");
    expect(normalizeHeader("KOLİ")).toBe("koli");
    expect(normalizeHeader("FAT.BEDELİ")).toBe("fatbedeli");
    expect(normalizeHeader("FATURA TARİHİ(0100)")).toBe("faturatarihi0100");
  });

  it("returns an empty string for blank headers", () => {
    expect(normalizeHeader(null)).toBe("");
    expect(normalizeHeader("")).toBe("");
  });
});

describe("buildColumnProfile", () => {
  it("uses FATURA NO(0100) for invoice_no, not FATURA NO", () => {
    // Verified against the live DB: FATURA NO matched 0/7 procedures,
    // FATURA NO(0100) matched 13/13.
    expect(colFor("invoice_no")?.colIndex).toBe(76);
    expect(colFor("invoice_no")?.header).toBe("FATURA NO(0100)");
  });

  it("uses FATURA TARİHİ(0100) for invoice_date, not FATURA TARİHİ", () => {
    expect(colFor("invoice_date")?.colIndex).toBe(75);
  });

  it("uses KOLİ for package, not the junk-filled KAP column", () => {
    expect(colFor("package")?.colIndex).toBe(5);
  });

  it("maps GUM. to customs", () => {
    expect(colFor("customs")?.colIndex).toBe(8);
  });

  it("maps the columns the old importer ignored entirely", () => {
    expect(colFor("amount")?.colIndex).toBe(12);
    expect(colFor("usdtl_rate")?.colIndex).toBe(14);
    expect(colFor("freight_amount")?.colIndex).toBe(22);
    expect(colFor("customs_file_no")?.colIndex).toBe(0);
  });

  it("reports losing candidates so the UI can warn about them", () => {
    const profile = buildColumnProfile(realHeaders());
    const unusedHeaders = profile.unusedCandidates.map((u) => u.header);
    expect(unusedHeaders).toContain("FATURA NO");
    expect(unusedHeaders).toContain("KAP");
    const invoiceLoser = profile.unusedCandidates.find(
      (u) => u.header === "FATURA NO",
    );
    expect(invoiceLoser?.winnerHeader).toBe("FATURA NO(0100)");
  });

  it("never maps two columns to the same field", () => {
    const profile = buildColumnProfile(realHeaders());
    const fields = profile.mapped.map((m) => m.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("lists headers it does not recognize", () => {
    const profile = buildColumnProfile(["DOSYA NO", "SEKTÖR", "PLAKASI"]);
    expect(profile.unmappedHeaders).toEqual(["SEKTÖR", "PLAKASI"]);
  });

  it("does not map fields that were deliberately left out of scope", () => {
    const profile = buildColumnProfile([
      "MAL TESLİM TARİHİ",
      "KONŞİMENTO NO",
      "NAKLİYECİ",
      "KALEM SAYISI",
    ]);
    expect(profile.mapped).toEqual([]);
  });
});

describe("countRecognizedHeaders", () => {
  it("counts distinct recognized fields, used for sheet and header-row detection", () => {
    expect(countRecognizedHeaders(realHeaders())).toBeGreaterThanOrEqual(12);
    expect(
      countRecognizedHeaders(["Alıcı : SOHO PERAK", "Baş. Kur. Tar. : 01.07.2026"]),
    ).toBe(0);
  });
});

describe("applyProfile", () => {
  it("cleans each cell with the normalizer its field requires", () => {
    const profile = buildColumnProfile(realHeaders());
    const cells: unknown[] = new Array(80).fill(null);
    cells[0] = "26-09933";
    cells[8] = "ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ";
    cells[10] = "03.07.2026";
    cells[11] = "26341200IM00162621";
    cells[12] = 1255.5;
    cells[14] = 46.692;
    cells[76] = 53598059;

    const rows: RawRow[] = [{ excelRowNumber: 3, cells }];
    const [row] = applyProfile(rows, profile);

    expect(row.excelRowNumber).toBe(3);
    expect(row.values.customs_file_no).toBe("26-09933");
    expect(row.values.customs).toBe("Erenköy");
    expect(row.values.import_dec_date).toBe("2026-07-03");
    expect(row.values.import_dec_number).toBe("26341200IM00162621");
    expect(row.values.amount).toBe(1255.5);
    expect(row.values.usdtl_rate).toBe(46.692);
    expect(row.values.invoice_no).toBe("53598059");
  });

  it("drops junk instead of storing it", () => {
    const profile = buildColumnProfile(realHeaders());
    const cells: unknown[] = new Array(80).fill(null);
    cells[10] = "."; // "not declared yet" marker
    cells[5] = "X"; // junk in the winning KOLİ column
    cells[12] = 5108.77;

    const [row] = applyProfile([{ excelRowNumber: 9, cells }], profile);

    expect(row.values.import_dec_date).toBeUndefined();
    expect(row.values.package).toBeUndefined();
    expect(row.values.amount).toBe(5108.77);
  });
});

describe("FIELD_CANDIDATES", () => {
  it("keeps every field's candidate headers disjoint from every other field's", () => {
    // buildColumnProfile has no cross-field guard, so a header shared between
    // two fields would let one column be claimed twice.
    const seen = new Map<string, string>();
    for (const [field, candidates] of Object.entries(FIELD_CANDIDATES)) {
      for (const candidate of candidates) {
        const owner = seen.get(candidate);
        expect(owner, `"${candidate}" claimed by both ${owner} and ${field}`).toBeUndefined();
        seen.set(candidate, field);
      }
    }
  });
});
