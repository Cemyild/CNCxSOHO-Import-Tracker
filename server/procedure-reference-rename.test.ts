import { describe, it, expect, vi } from "vitest";
import { getTableName } from "drizzle-orm";

/**
 * Only the pure decision helpers are under test here, but the module imports
 * ./db, which refuses to load without DATABASE_URL. Stub it — nothing in this
 * file touches a database, and the local .env points at the LIVE one.
 */
vi.mock("./db", () => ({ db: {}, pool: {}, rawDb: {} }));

import {
  MANUAL_REFERENCE_TABLES,
  planTaxCalculationAlignment,
  assertRenameInputs,
} from "./procedure-reference-rename";

describe("MANUAL_REFERENCE_TABLES", () => {
  it("lists exactly the six tables without a cascading foreign key", () => {
    expect(MANUAL_REFERENCE_TABLES.map(getTableName).sort()).toEqual([
      "expense_documents",
      "invoice_line_items",
      "invoice_line_items_config",
      "payment_distributions",
      "payments",
      "procedure_status_details",
    ]);
  });

  it("excludes the cascading tables, which the database updates itself", () => {
    const names = MANUAL_REFERENCE_TABLES.map(getTableName);
    expect(names).not.toContain("taxes");
    expect(names).not.toContain("import_expenses");
    expect(names).not.toContain("import_service_invoices");
  });
});

describe("planTaxCalculationAlignment", () => {
  it("aligns a lone linked calculation even when its spelling differs", () => {
    const linked = [{ id: 303, reference: "CNCALO-108 /1" }];
    expect(planTaxCalculationAlignment(linked, "CNCALO-108", "CNCALO-108 / 1")).toEqual([
      { id: 303, reference: "CNCALO-108 /1" },
    ]);
  });

  it("touches only the exact match when several calculations are linked", () => {
    const linked = [
      { id: 1, reference: "CNCALO-108" },
      { id: 2, reference: "CNCALO-108 /1" },
    ];
    expect(planTaxCalculationAlignment(linked, "CNCALO-108", "CNCALO-108 / 1")).toEqual([
      { id: 1, reference: "CNCALO-108" },
    ]);
  });

  it("skips a calculation that already carries the target reference", () => {
    const linked = [{ id: 5, reference: "CNCALO-108 / 1" }];
    expect(planTaxCalculationAlignment(linked, "CNCALO-108", "CNCALO-108 / 1")).toEqual([]);
  });

  it("returns nothing when no calculation is linked", () => {
    expect(planTaxCalculationAlignment([], "CNCALO-108", "CNCALO-108 / 1")).toEqual([]);
  });
});

describe("assertRenameInputs", () => {
  it("trims both references", () => {
    expect(assertRenameInputs(" CNCALO-108 ", " CNCALO-108 / 1 ")).toEqual({
      from: "CNCALO-108",
      to: "CNCALO-108 / 1",
    });
  });

  it("rejects an empty current reference", () => {
    expect(() => assertRenameInputs("   ", "CNCALO-108 / 1")).toThrow(/current reference/i);
  });

  it("rejects an empty new reference", () => {
    expect(() => assertRenameInputs("CNCALO-108", "  ")).toThrow(/new reference/i);
  });
});
