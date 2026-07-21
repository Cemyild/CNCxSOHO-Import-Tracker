import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runEnrichmentPipeline } from "../excel-enrichment";
import type { MatchCandidate } from "./match";

const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "soho-enrich-ornek.xlsx"),
);

/**
 * A fixed stand-in for the procedures table. Values are copied from the live
 * database so the assertions describe real behaviour, but the list is frozen
 * here so the test does not drift as new procedures are created.
 */
const PROCEDURES: MatchCandidate[] = [
  { id: 91, reference: "CNCALO-91", invoice_no: "55559417", amount: "8412.81" },
  { id: 94, reference: "CNCALO-94", invoice_no: "33260982", amount: "107990.86" },
  { id: 95, reference: "CNCALO-95", invoice_no: "33261192", amount: "2061.80" },
  { id: 96, reference: "CNCALO-96", invoice_no: "55955496", amount: "422666.50" },
  { id: 98, reference: "CNCALO-98", invoice_no: "56163133", amount: "291271.13" },
  { id: 83, reference: "CNCALO-83 /1", invoice_no: "54702017", amount: "396240.00" },
  { id: 84, reference: "CNCALO-83 / 2", invoice_no: "54702017", amount: "5108.77" },
];

describe("runEnrichmentPipeline against the real broker report", () => {
  const result = runEnrichmentPipeline(FIXTURE, PROCEDURES);

  it("reports what it detected", () => {
    expect(result.detection.sheetName).toBe("İthalat Raporu");
    expect(result.detection.headerRowIndex).toBe(1);
    expect(result.detection.dataRowCount).toBe(24);
    expect(result.detection.skippedRowCount).toBeGreaterThanOrEqual(1);
  });

  it("flags the losing duplicate columns in the detection summary", () => {
    const unused = result.detection.unusedCandidates.map((u) => u.header);
    expect(unused).toContain("FATURA NO");
    expect(unused).toContain("KAP");
  });

  it("collapses each shipment's AN and IM rows into a single update", () => {
    const cnc91 = result.matched.find((m) => m.reference === "CNCALO-91");
    expect(cnc91?.excelRowNumbers).toHaveLength(2);
    expect(String(cnc91?.values.import_dec_number)).toContain("IM");
  });

  it("writes ISO dates, short customs names and parsed rates", () => {
    const cnc91 = result.matched.find((m) => m.reference === "CNCALO-91");
    expect(cnc91?.values.import_dec_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cnc91?.values.customs).toBe("Erenköy");
    expect(typeof cnc91?.values.usdtl_rate).toBe("number");
  });

  it("routes the shared invoice number to the procedure whose amount agrees", () => {
    const references = result.matched.map((m) => m.reference);
    expect(references).toContain("CNCALO-83 / 2");
    expect(references).not.toContain("CNCALO-83 /1");
  });

  it("reports the row that matches nothing instead of dropping it", () => {
    const stray = result.unmatched.find((u) => u.customsFileNo === "26-11128");
    expect(stray).toBeDefined();
    expect(stray?.reason).toBe("not_found");
    expect(stray?.excelRowNumber).toBe(23);
  });

  it("never invents a match: every matched group points at a known procedure", () => {
    const knownIds = new Set(PROCEDURES.map((p) => p.id));
    for (const group of result.matched) {
      expect(knownIds.has(group.procedureId)).toBe(true);
    }
  });
});
