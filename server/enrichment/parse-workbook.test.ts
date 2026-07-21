import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { parseWorkbook, EnrichmentParseError } from "./parse-workbook";

const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "soho-enrich-ornek.xlsx"),
);

/** Builds a small in-memory workbook from arrays of rows. */
function makeWorkbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseWorkbook — real broker report", () => {
  it("skips the empty first sheet and picks the one with recognizable headers", () => {
    // The old importer read SheetNames[0] ("Sayfa1"), found it empty and
    // returned HTTP 400 — the feature never got past this point.
    const parsed = parseWorkbook(FIXTURE);
    expect(parsed.sheetName).toBe("İthalat Raporu");
    expect(parsed.availableSheets).toEqual(["Sayfa1", "İthalat Raporu"]);
  });

  it("finds the header row below the report title row", () => {
    const parsed = parseWorkbook(FIXTURE);
    expect(parsed.headerRowIndex).toBe(1);
    expect(parsed.headers[0]).toBe("DOSYA NO");
    expect(parsed.headers[54]).toBe("FATURA NO");
    expect(parsed.headers[76]).toBe("FATURA NO(0100)");
  });

  it("returns the 24 data rows and skips the TOPLAM footer", () => {
    const parsed = parseWorkbook(FIXTURE);
    expect(parsed.dataRows).toHaveLength(24);
    expect(parsed.skippedRows.some((r) => r.reason === "total_row")).toBe(true);
  });

  it("numbers rows the way Excel shows them", () => {
    const parsed = parseWorkbook(FIXTURE);
    // Header is sheet index 1 = Excel row 2, so data starts at Excel row 3.
    expect(parsed.dataRows[0].excelRowNumber).toBe(3);
    expect(parsed.dataRows[0].cells[0]).toBe("26-09933");
  });

  it("honours an explicit sheet and header row override", () => {
    const parsed = parseWorkbook(FIXTURE, {
      sheetName: "İthalat Raporu",
      headerRowIndex: 1,
    });
    expect(parsed.sheetName).toBe("İthalat Raporu");
    expect(parsed.headerRowIndex).toBe(1);
    expect(parsed.dataRows).toHaveLength(24);
  });

  it("obeys a header row override that auto-detection would have rejected", () => {
    // Auto-detection picks row index 1. Row 0 is the report title line, which
    // has no recognizable columns — so if the override is honoured, parsing
    // must fail on it rather than quietly falling back to row 1.
    try {
      parseWorkbook(FIXTURE, { headerRowIndex: 0 });
      throw new Error("expected parseWorkbook to throw");
    } catch (error) {
      expect((error as EnrichmentParseError).code).toBe("no_headers");
    }
  });

  it("throws sheet_not_found rather than silently choosing another sheet", () => {
    try {
      // "Ithalat" with a dotless I — a plausible typo that matches nothing.
      parseWorkbook(FIXTURE, { sheetName: "Ithalat Raporu" });
      throw new Error("expected parseWorkbook to throw");
    } catch (error) {
      expect((error as EnrichmentParseError).code).toBe("sheet_not_found");
      // Sayfa1 is empty, so the only sheet worth offering is the data one.
      expect((error as EnrichmentParseError).availableSheets).toEqual([
        "İthalat Raporu",
      ]);
    }
  });
});

describe("parseWorkbook — synthetic edge cases", () => {
  it("throws no_data when every sheet is empty", () => {
    const buffer = makeWorkbook({ Sayfa1: [], Sayfa2: [] });
    expect(() => parseWorkbook(buffer)).toThrowError(EnrichmentParseError);
    try {
      parseWorkbook(buffer);
    } catch (error) {
      expect((error as EnrichmentParseError).code).toBe("no_data");
    }
  });

  it("throws no_headers and reports what it saw when nothing is recognizable", () => {
    const buffer = makeWorkbook({
      Sheet1: [
        ["Ad", "Soyad", "Şehir"],
        ["Ali", "Veli", "İstanbul"],
      ],
    });
    try {
      parseWorkbook(buffer);
      throw new Error("expected parseWorkbook to throw");
    } catch (error) {
      expect((error as EnrichmentParseError).code).toBe("no_headers");
      expect((error as EnrichmentParseError).detectedHeaders).toContain("Soyad");
    }
  });

  it("skips fully blank rows", () => {
    const buffer = makeWorkbook({
      Sheet1: [
        ["FATURA NO(0100)", "FAT.BEDELİ", "GUM."],
        ["53598059", 1255.5, "ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ"],
        [null, null, null],
        ["55559417", 8412.81, "ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ"],
      ],
    });
    const parsed = parseWorkbook(buffer);
    expect(parsed.dataRows).toHaveLength(2);
    expect(parsed.skippedRows.some((r) => r.reason === "empty_row")).toBe(true);
  });

  it("lets a sheet override win over the better-scoring sheet", () => {
    const buffer = makeWorkbook({
      Ozet: [
        ["FATURA NO(0100)", "FAT.BEDELİ", "DÖVİZ"],
        ["53598059", 1255.5, "USD"],
      ],
      Detay: [
        ["FATURA NO(0100)", "FAT.BEDELİ", "DÖVİZ", "GUM.", "BEYAN NO"],
        ["55559417", 8412.81, "USD", "ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ", "26341200IM00163105"],
      ],
    });

    // Detay scores higher (5 recognized columns vs 3), so it wins unaided.
    expect(parseWorkbook(buffer).sheetName).toBe("Detay");

    // The override must beat that.
    const parsed = parseWorkbook(buffer, { sheetName: "Ozet" });
    expect(parsed.sheetName).toBe("Ozet");
    expect(parsed.dataRows).toHaveLength(1);
  });
});
