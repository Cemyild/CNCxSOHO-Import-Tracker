import { describe, it, expect } from "vitest";
import { isFillable, computeChanges } from "./diff";
import type { MatchedGroup } from "./types";

function group(values: MatchedGroup["values"]): MatchedGroup {
  return {
    procedureId: 91,
    reference: "CNCALO-91",
    matchMethod: "invoice_no",
    excelRowNumbers: [3],
    values,
  };
}

describe("isFillable", () => {
  it("treats missing, blank and placeholder values as fillable", () => {
    for (const v of [null, undefined, "", "   ", "-", "."]) {
      expect(isFillable("customs", v), `for ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("treats zero as fillable on numeric fields", () => {
    // freight_amount is 0 on 165 of 175 procedures; the old rule meant it
    // could never be enriched.
    expect(isFillable("freight_amount", "0.00")).toBe(true);
    expect(isFillable("usdtl_rate", 0)).toBe(true);
    expect(isFillable("kg", "0.0000")).toBe(true);
    expect(isFillable("amount", "0")).toBe(true);
  });

  it("treats zero as a real value on text fields", () => {
    expect(isFillable("package", "0")).toBe(false);
  });

  it("never touches a field that already holds a value", () => {
    expect(isFillable("customs", "Erenköy")).toBe(false);
    expect(isFillable("amount", "8412.81")).toBe(false);
    expect(isFillable("invoice_no", "55559417")).toBe(false);
  });
});

describe("computeChanges", () => {
  it("proposes only the empty fields and stringifies the new value", () => {
    const procedure = {
      id: 91,
      reference: "CNCALO-91",
      invoice_no: "55559417",
      customs: null,
      usdtl_rate: "0.0000",
      shipper: "ALO, LLC",
    };

    const changes = computeChanges(
      group({
        invoice_no: "55559417",
        customs: "Erenköy",
        usdtl_rate: 46.692,
        shipper: "ALO HONG KONG LTD",
      }),
      procedure,
    );

    expect(changes).toEqual([
      { field: "customs", oldValue: null, newValue: "Erenköy" },
      { field: "usdtl_rate", oldValue: "0.0000", newValue: "46.692" },
    ]);
  });

  it("returns nothing when the procedure is already complete", () => {
    const procedure = { customs: "Erenköy", shipper: "ALO, LLC" };
    expect(
      computeChanges(group({ customs: "Muratbey", shipper: "X Ltd" }), procedure),
    ).toEqual([]);
  });

  it("ignores fields the Excel row said nothing about", () => {
    const procedure = { customs: null, shipper: null };
    const changes = computeChanges(group({ customs: "Erenköy" }), procedure);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("customs");
  });

  it("ignores columns that are not enrichable fields", () => {
    const procedure = { id: 91, createdBy: 1, customs: null };
    const changes = computeChanges(
      // @ts-expect-error deliberately smuggling a non-enrich field in
      group({ customs: "Erenköy", createdBy: 999 }),
      procedure,
    );
    expect(changes.map((c) => c.field)).toEqual(["customs"]);
  });
});
