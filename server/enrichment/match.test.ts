import { describe, it, expect } from "vitest";
import { matchRows, type MatchCandidate } from "./match";
import type { EnrichRow } from "./types";

/** Real shapes taken from the live procedures table. */
const PROCEDURES: MatchCandidate[] = [
  { id: 91, reference: "CNCALO-91", invoice_no: "55559417", amount: "8412.81" },
  // Two procedures deliberately share one invoice number.
  { id: 83, reference: "CNCALO-83 /1", invoice_no: "54702017", amount: "396240.00" },
  { id: 84, reference: "CNCALO-83 / 2", invoice_no: "54702017", amount: "5108.77" },
  // No usable invoice number — only matchable on amount.
  { id: 98, reference: "CNCALO-98", invoice_no: null, amount: "291271.13" },
  // Stored with trailing whitespace, as some rows really are.
  { id: 95, reference: "CNCALO-95", invoice_no: " 33261192 ", amount: "2061.80" },
];

function row(excelRowNumber: number, values: EnrichRow["values"]): EnrichRow {
  return { excelRowNumber, values };
}

describe("matchRows", () => {
  it("matches on invoice number when it is unique", () => {
    const result = matchRows(
      [row(3, { invoice_no: "55559417", customs: "Erenköy" })],
      PROCEDURES,
    );
    expect(result.unmatched).toEqual([]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].procedureId).toBe(91);
    expect(result.matched[0].matchMethod).toBe("invoice_no");
  });

  it("trims whitespace on both sides before comparing", () => {
    const result = matchRows([row(3, { invoice_no: "33261192" })], PROCEDURES);
    expect(result.matched[0].procedureId).toBe(95);
  });

  it("breaks an invoice-number tie using the amount", () => {
    // The old importer used .find() and always wrote to CNCALO-83 /1.
    const result = matchRows(
      [row(24, { invoice_no: "54702017", amount: 5108.77 })],
      PROCEDURES,
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].reference).toBe("CNCALO-83 / 2");
    expect(result.matched[0].matchMethod).toBe("invoice_no+amount");
  });

  it("reports an ambiguous row instead of guessing when amount cannot break the tie", () => {
    const result = matchRows([row(24, { invoice_no: "54702017" })], PROCEDURES);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0].reason).toBe("ambiguous");
    expect(result.unmatched[0].candidates).toEqual([
      "CNCALO-83 /1",
      "CNCALO-83 / 2",
    ]);
  });

  it("falls back to amount when the row has no invoice number", () => {
    const result = matchRows([row(12, { amount: 291271.13 })], PROCEDURES);
    expect(result.matched[0].procedureId).toBe(98);
    expect(result.matched[0].matchMethod).toBe("amount");
  });

  it("tolerates sub-kuruş rounding on amount matches", () => {
    const result = matchRows([row(12, { amount: 291271.135 })], PROCEDURES);
    expect(result.matched[0].procedureId).toBe(98);
  });

  it("reports not_found when neither key hits", () => {
    const result = matchRows(
      [row(23, { invoice_no: "STN1", amount: 120, customs_file_no: "26-11128" })],
      PROCEDURES,
    );
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([
      {
        excelRowNumber: 23,
        customsFileNo: "26-11128",
        reason: "not_found",
        invoiceNo: "STN1",
        amount: 120,
        candidates: [],
      },
    ]);
  });

  it("reports no_key when the row carries neither invoice number nor amount", () => {
    const result = matchRows([row(30, { currency: "USD" })], PROCEDURES);
    expect(result.unmatched[0].reason).toBe("no_key");
  });

  it("never matches on a zero amount, because amount defaults to 0 in the schema", () => {
    const zeroAmountProcedures: MatchCandidate[] = [
      { id: 200, reference: "CNCALO-200", invoice_no: null, amount: "0.00" },
    ];
    const result = matchRows([row(5, { amount: 0 })], zeroAmountProcedures);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0].reason).toBe("no_key");
  });

  it("merges the AN and IM rows of one shipment, preferring the IM declaration", () => {
    // Every shipment appears twice in the report: once as the bonded-warehouse
    // entry (AN) and once as the import declaration (IM). The DB stores the IM one.
    const result = matchRows(
      [
        row(4, {
          invoice_no: "55559417",
          import_dec_number: "26341200AN00154190",
          import_dec_date: "2026-07-02",
          shipper: "ALO HONG KONG LTD",
        }),
        row(8, {
          invoice_no: "55559417",
          import_dec_number: "26341200IM00163105",
          import_dec_date: "2026-07-03",
          customs: "Erenköy",
        }),
      ],
      PROCEDURES,
    );

    expect(result.matched).toHaveLength(1);
    const group = result.matched[0];
    expect(group.procedureId).toBe(91);
    expect(group.excelRowNumbers).toEqual([4, 8]);
    expect(group.values.import_dec_number).toBe("26341200IM00163105");
    expect(group.values.import_dec_date).toBe("2026-07-03");
    // Non-declaration fields take the first non-empty value from either row.
    expect(group.values.shipper).toBe("ALO HONG KONG LTD");
    expect(group.values.customs).toBe("Erenköy");
  });

  it("reports the weakest match method when rows in a group matched differently", () => {
    const result = matchRows(
      [
        row(4, { invoice_no: "55559417", import_dec_number: "26341200IM00163105" }),
        row(8, { amount: 8412.81, customs: "Erenköy" }),
      ],
      PROCEDURES,
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].excelRowNumbers).toEqual([4, 8]);
    expect(result.matched[0].matchMethod).toBe("amount");
  });

  it("keeps the only declaration when no row is an IM one", () => {
    const result = matchRows(
      [
        row(4, {
          invoice_no: "55559417",
          import_dec_number: "26341200AN00154190",
          import_dec_date: "2026-07-02",
        }),
      ],
      PROCEDURES,
    );
    expect(result.matched[0].values.import_dec_number).toBe("26341200AN00154190");
  });
});
