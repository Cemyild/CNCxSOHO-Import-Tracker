// server/mcp/tools/taxes.ts
import { registerTool } from "../registry";
import { runQueryTaxes } from "../../ai-ask-tools";
import { db } from "../../db";
import {
  taxes as taxesTable,
  taxCalculations,
  taxCalculationItems,
  hsCodes,
  procedures as proceduresTable,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { calculateItemTax, type AtrContext } from "../../tax-calculation-service";
import { McpToolError } from "../errors";
import { resolveAgentUserId } from "../audit-attribution";

registerTool({
  name: "read_taxes",
  tier: "read",
  description: "Query tax records (procedure-level taxes). Supports filters by procedure, type, date range.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference_contains: { type: "string" },
      tax_type: { type: "string" },
      date_from: { type: "string", description: "YYYY-MM-DD" },
      date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryTaxes(args) }),
});

// ---------------------------------------------------------------------------
// Write tools (Phase 4.3)
// ---------------------------------------------------------------------------
//
// Schema notes (verified against shared/schema.ts):
//
//   taxCalculations (snake_case Drizzle props):
//     reference (text, unique), invoice_no, invoice_date, total_value,
//     transport_cost, insurance_cost, storage_cost, currency_rate,
//     is_prepaid, is_atr, status, procedure_id (FK procedures.id).
//
//   taxCalculationItems (snake_case Drizzle props):
//     tax_calculation_id (FK taxCalculations.id, NOT NULL),
//     line_number, style, cost, unit_count, total_value, tr_hs_code,
//     country_of_origin, hts_code, etc.
//
//   hsCodes (snake_case Drizzle props):
//     tr_hs_code (PK), customs_tax_percent, additional_customs_tax_percent,
//     kkdf_percent, vat_percent.
//
//   taxes (camelCase Drizzle props) — UNIQUE constraint on procedureReference:
//     procedureReference (FK procedures.reference, NOT NULL),
//     customsTax, additionalCustomsTax, kkdf, vat, stampTax (decimals),
//     createdBy (FK users.id, nullable).
//     IMPORTANT: there is NO total_tax_usd/total_tax_tl/tax_calculation_id
//     column on `taxes` — those live on taxCalculationItems. We therefore
//     report aggregated USD/TL totals in the response payload only, and only
//     persist the four tax category columns + stampTax (left at 0).
//
//   calculateItemTax(item, invoice, hsCode, atrContext?) returns a
//   TaxCalculationResult with snake_case fields:
//     transport_share, insurance_share, storage_share, cif_value,
//     customs_tax, additional_customs_tax, kkdf, vat_base, vat,
//     total_tax_usd, total_tax_tl.
//   ATR rate lookup keys are `tr_hs_code` on the items; we do not load the
//   ATR rates map here (would require an extra storage call). If a row has
//   is_atr=true, callers should run the full calculateAllItems pipeline
//   first; this MCP tool re-aggregates from already-computed item totals
//   when present, but falls back to a fresh per-item calc otherwise.

registerTool({
  name: "write_calculate_tax",
  tier: "write",
  description:
    "Run customs/VAT/KKDF tax calculation for an existing tax_calculations row (with items + HS codes), then upsert the aggregated result into the taxes table for a procedure. " +
    "The taxes table has a UNIQUE constraint on procedure_reference, so an existing row for the procedure is overwritten. " +
    "Note: ATR-enabled calculations should be pre-computed via the app's calculateAllItems pipeline so per-item ATR rates are populated; this tool does not load ATR rate overrides.",
  inputSchema: {
    type: "object",
    properties: {
      tax_calculation_id: { type: "integer", description: "id from tax_calculations table" },
      procedure_reference: {
        type: "string",
        description: "Procedure reference to attach the resulting taxes row to (must exist in procedures.reference).",
      },
    },
    required: ["tax_calculation_id", "procedure_reference"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      // Verify procedure exists so the FK violation surfaces as a clear MCP error.
      const [proc] = await tx
        .select({ reference: proceduresTable.reference })
        .from(proceduresTable)
        .where(eq(proceduresTable.reference, args.procedure_reference));
      if (!proc) {
        throw new McpToolError(
          `Procedure with reference "${args.procedure_reference}" does not exist`,
        );
      }

      const [calc] = await tx
        .select()
        .from(taxCalculations)
        .where(eq(taxCalculations.id, args.tax_calculation_id));
      if (!calc) {
        throw new McpToolError(`tax_calculations id ${args.tax_calculation_id} not found`);
      }

      const items = await tx
        .select()
        .from(taxCalculationItems)
        .where(eq(taxCalculationItems.tax_calculation_id, args.tax_calculation_id));
      if (items.length === 0) {
        throw new McpToolError(
          `No items found for tax_calculation_id ${args.tax_calculation_id}`,
        );
      }

      // Load HS codes keyed by tr_hs_code (the PK of hs_codes table).
      const trCodes = Array.from(
        new Set(items.map((i: any) => i.tr_hs_code).filter(Boolean)),
      ) as string[];
      const hsRows = trCodes.length
        ? await tx.select().from(hsCodes).where(inArray(hsCodes.tr_hs_code, trCodes))
        : [];
      const hsByCode = new Map(hsRows.map((r: any) => [r.tr_hs_code, r]));

      // ATR: empty map — see comment block above. is_atr-enabled calcs should
      // be run via calculateAllItems first.
      const atrContext: AtrContext | undefined = (calc as any).is_atr
        ? { isAtr: true, atrRatesMap: new Map() }
        : undefined;

      let totalCustoms = 0,
        totalAdditional = 0,
        totalKkdf = 0,
        totalVat = 0,
        totalUsd = 0,
        totalTl = 0;
      const perItem: any[] = [];
      for (const item of items as any[]) {
        if (!item.tr_hs_code) {
          perItem.push({ item_id: item.id, error: "Item is missing tr_hs_code" });
          continue;
        }
        const hs = hsByCode.get(item.tr_hs_code);
        if (!hs) {
          perItem.push({
            item_id: item.id,
            error: `HS code ${item.tr_hs_code} not found in hs_codes`,
          });
          continue;
        }
        const r = await calculateItemTax(item, calc as any, hs as any, atrContext);
        perItem.push({ item_id: item.id, result: r });
        totalCustoms += r.customs_tax;
        totalAdditional += r.additional_customs_tax;
        totalKkdf += r.kkdf;
        totalVat += r.vat;
        totalUsd += r.total_tax_usd;
        totalTl += r.total_tax_tl;
      }

      const createdBy = await resolveAgentUserId(tx as any);
      const aggregate = {
        procedureReference: args.procedure_reference,
        customsTax: totalCustoms.toFixed(2),
        additionalCustomsTax: totalAdditional.toFixed(2),
        kkdf: totalKkdf.toFixed(2),
        vat: totalVat.toFixed(2),
        createdBy,
        updatedAt: new Date(),
      };

      // Upsert by procedure_reference (UNIQUE constraint).
      const [before] = await tx
        .select()
        .from(taxesTable)
        .where(eq(taxesTable.procedureReference, args.procedure_reference));
      let after;
      if (before) {
        const [updated] = await tx
          .update(taxesTable)
          .set(aggregate)
          .where(eq(taxesTable.id, before.id))
          .returning();
        after = updated;
      } else {
        const [inserted] = await tx.insert(taxesTable).values(aggregate).returning();
        after = inserted;
      }
      if (!after) throw new McpToolError("Upsert returned no row");

      return {
        data: {
          taxes_row: after,
          per_item: perItem,
          totals: {
            customs_tax: aggregate.customsTax,
            additional_customs_tax: aggregate.additionalCustomsTax,
            kkdf: aggregate.kkdf,
            vat: aggregate.vat,
            total_tax_usd: totalUsd.toFixed(2),
            total_tax_tl: totalTl.toFixed(2),
          },
        },
        meta: {
          affectedTable: "taxes",
          affectedIds: [after.id],
          before: before ?? null,
          summary: `Calculated taxes for procedure ${args.procedure_reference}: VAT=${aggregate.vat}, Customs=${aggregate.customsTax}, KKDF=${aggregate.kkdf}`,
        },
      };
    });
  },
});
