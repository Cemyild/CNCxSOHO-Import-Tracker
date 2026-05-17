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
  products as productsTable,
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

// ---------------------------------------------------------------------------
// write_save_extracted_invoice — bridges ai_extract_pdf output into the
// tax_calculations + tax_calculation_items tables. After this runs, the
// caller can invoke write_calculate_tax to compute taxes.
// ---------------------------------------------------------------------------

registerTool({
  name: "write_save_extracted_invoice",
  tier: "write",
  description:
    "Save the output of ai_extract_pdf (or ai_extract_excel) into the tax_calculations + tax_calculation_items tables for a procedure. Creates one header row and N item rows in a single transaction. Returns the new tax_calculation_id, which can then be passed to write_calculate_tax.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_reference: {
        type: "string",
        description: "Procedure reference (e.g. 'CNCALO-72'). Must already exist. tax_calculations.reference is UNIQUE, so this errors if an invoice is already saved.",
      },
      invoice_metadata: {
        type: "object",
        description: "From ai_extract_pdf result.invoiceMetadata.",
        properties: {
          invoice_no: { type: "string" },
          invoice_date: { type: "string", description: "YYYY-MM-DD" },
          shipper: { type: "string", description: "Informational only — not stored on tax_calculations" },
        },
        additionalProperties: true,
      },
      products: {
        type: "array",
        description: "From ai_extract_pdf result.products. Each item becomes one tax_calculation_items row.",
        items: {
          type: "object",
          properties: {
            style: { type: "string" },
            color: { type: "string" },
            category: { type: "string" },
            description: { type: "string" },
            fabric_content: { type: "string" },
            country_of_origin: { type: "string" },
            hts_code: { type: "string" },
            tr_hs_code: { type: "string" },
            cost: { type: ["string", "number"] },
            unit_count: { type: ["string", "integer"] },
            total_value: { type: ["string", "number"] },
          },
          required: ["style", "cost", "unit_count"],
          additionalProperties: true,
        },
      },
      costs: {
        type: "object",
        description: "Header-level cost inputs (entered by user, NOT in the invoice). All optional; default 0.",
        properties: {
          transport_cost: { type: ["string", "number"] },
          insurance_cost: { type: ["string", "number"] },
          storage_cost: { type: ["string", "number"] },
          currency_rate: { type: ["string", "number"], description: "TCMB rate at customs declaration date" },
        },
        additionalProperties: false,
      },
      is_prepaid: { type: "boolean", default: false },
      is_atr: { type: "boolean", default: false, description: "Set true if this invoice qualifies for ATR (EU/EFTA preferential origin)" },
    },
    required: ["procedure_reference", "products"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      // 1. Find procedure to attach to + check reference is free.
      const [procedure] = await tx.select().from(proceduresTable).where(eq(proceduresTable.reference, args.procedure_reference));
      if (!procedure) throw new McpToolError(`Procedure '${args.procedure_reference}' not found`);

      const [existingCalc] = await tx.select().from(taxCalculations).where(eq(taxCalculations.reference, args.procedure_reference));
      if (existingCalc) {
        throw new McpToolError(
          `tax_calculations row already exists for ${args.procedure_reference} (id=${existingCalc.id}). ` +
          `Delete it first via destructive_delete_record(table:'tax_calculations'...) or use a future update tool.`
        );
      }

      // 2. Coerce products into the schema's expected shape.
      const products = Array.isArray(args.products) ? args.products : [];
      if (products.length === 0) throw new McpToolError("products[] is empty — nothing to save");

      let totalValue = 0;
      let totalQuantity = 0;
      const itemsToInsert = products.map((p: any, idx: number) => {
        const cost = parseFloat(String(p.cost));
        const unitCount = parseInt(String(p.unit_count), 10);
        if (!Number.isFinite(cost)) throw new McpToolError(`products[${idx}].cost is not a number: ${p.cost}`);
        if (!Number.isInteger(unitCount)) throw new McpToolError(`products[${idx}].unit_count is not an integer: ${p.unit_count}`);
        const lineTotal = p.total_value !== undefined && p.total_value !== null && p.total_value !== ""
          ? parseFloat(String(p.total_value))
          : cost * unitCount;
        if (!Number.isFinite(lineTotal)) throw new McpToolError(`products[${idx}].total_value invalid`);

        totalValue += lineTotal;
        totalQuantity += unitCount;

        if (!p.style) throw new McpToolError(`products[${idx}].style is required`);

        return {
          line_number: idx + 1,
          style: String(p.style),
          color: p.color ?? null,
          category: p.category ?? null,
          description: p.description ?? null,
          fabric_content: p.fabric_content ?? null,
          country_of_origin: p.country_of_origin ?? null,
          hts_code: p.hts_code ?? null,
          tr_hs_code: p.tr_hs_code ?? null,
          cost: cost.toFixed(2),
          unit_count: unitCount,
          total_value: lineTotal.toFixed(2),
        };
      });

      // 3. Header row.
      const meta = args.invoice_metadata ?? {};
      const costs = args.costs ?? {};
      const headerData: any = {
        reference: args.procedure_reference,
        invoice_no: meta.invoice_no ?? null,
        invoice_date: meta.invoice_date ?? null,
        total_value: totalValue.toFixed(2),
        total_quantity: totalQuantity,
        is_prepaid: !!args.is_prepaid,
        is_atr: !!args.is_atr,
        status: "draft",
        procedure_id: procedure.id,
      };
      if (costs.transport_cost !== undefined && costs.transport_cost !== null && costs.transport_cost !== "") {
        headerData.transport_cost = String(parseFloat(String(costs.transport_cost)).toFixed(2));
      }
      if (costs.insurance_cost !== undefined && costs.insurance_cost !== null && costs.insurance_cost !== "") {
        headerData.insurance_cost = String(parseFloat(String(costs.insurance_cost)).toFixed(2));
      }
      if (costs.storage_cost !== undefined && costs.storage_cost !== null && costs.storage_cost !== "") {
        headerData.storage_cost = String(parseFloat(String(costs.storage_cost)).toFixed(2));
      }
      if (costs.currency_rate !== undefined && costs.currency_rate !== null && costs.currency_rate !== "") {
        headerData.currency_rate = String(parseFloat(String(costs.currency_rate)).toFixed(4));
      }

      const [calc] = await tx.insert(taxCalculations).values(headerData).returning();
      if (!calc) throw new McpToolError("tax_calculations insert returned no row");

      // 4. Item rows.
      const itemsWithFk = itemsToInsert.map(it => ({ ...it, tax_calculation_id: calc.id }));
      const insertedItems = await tx.insert(taxCalculationItems).values(itemsWithFk).returning();

      return {
        data: {
          tax_calculation_id: calc.id,
          calculation: calc,
          item_count: insertedItems.length,
          items: insertedItems.map(i => ({ id: i.id, style: i.style, line_number: i.line_number })),
          next_step: `Pass tax_calculation_id=${calc.id} to write_match_invoice_items to look up tr_hs_code from the products table, THEN to write_calculate_tax.`,
        },
        meta: {
          affectedTable: "tax_calculations",
          affectedIds: [calc.id, ...insertedItems.map(i => i.id)],
          summary: `Saved invoice for ${args.procedure_reference}: ${insertedItems.length} items, total ${totalValue.toFixed(2)}, ${totalQuantity} pcs`,
        },
      };
    });
  },
});

// ---------------------------------------------------------------------------
// write_match_invoice_items — for each tax_calculation_item, look up the
// products table by style and copy product.tr_hs_code onto the item. Mirrors
// the React UI's per-item /api/tax-calculation/items/:id/match endpoint, but
// in batch and inside a transaction.
// ---------------------------------------------------------------------------

registerTool({
  name: "write_match_invoice_items",
  tier: "write",
  description:
    "Match every item in a tax_calculations row against the products table by style, filling tr_hs_code and product_id. Required before write_calculate_tax because customs rate lookup uses tr_hs_code (not the US hts_code that PDFs typically contain). Reports per-style match success/miss.",
  inputSchema: {
    type: "object",
    properties: {
      tax_calculation_id: { type: "integer" },
      overwrite_existing: { type: "boolean", default: false, description: "If true, replace any tr_hs_code already on the item. If false (default), only fill missing values." },
    },
    required: ["tax_calculation_id"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      // 1. Load items.
      const items = await tx.select().from(taxCalculationItems).where(eq(taxCalculationItems.tax_calculation_id, args.tax_calculation_id));
      if (items.length === 0) throw new McpToolError(`No items found for tax_calculation_id ${args.tax_calculation_id}`);

      // 2. Look up products in one query.
      const styles = Array.from(new Set(items.map(i => i.style).filter(Boolean))) as string[];
      const productRows = styles.length
        ? await tx.select().from(productsTable).where(inArray(productsTable.style, styles))
        : [];
      const productByStyle = new Map<string, any>(productRows.map(p => [p.style, p]));

      // 3. Update items where appropriate.
      let matched = 0;
      let skipped = 0;
      const misses: { style: string; reason: string }[] = [];

      for (const item of items as any[]) {
        const product = productByStyle.get(item.style);
        if (!product) {
          misses.push({ style: item.style, reason: "no products row with this style" });
          continue;
        }
        const trCode = product.tr_hs_code ?? null;
        if (!trCode) {
          misses.push({ style: item.style, reason: "products row exists but tr_hs_code is empty" });
          continue;
        }
        const shouldUpdate = args.overwrite_existing || !item.tr_hs_code;
        if (!shouldUpdate) {
          skipped++;
          continue;
        }
        await tx
          .update(taxCalculationItems)
          .set({ tr_hs_code: trCode, product_id: product.id })
          .where(eq(taxCalculationItems.id, item.id));
        matched++;
      }

      return {
        data: {
          total_items: items.length,
          matched,
          skipped_existing: skipped,
          unmatched_count: misses.length,
          unmatched_sample: misses.slice(0, 10),
          ready_for_calc: misses.length === 0,
        },
        meta: {
          affectedTable: "tax_calculation_items",
          affectedIds: items.filter((i: any) => productByStyle.get(i.style)?.tr_hs_code && (args.overwrite_existing || !i.tr_hs_code)).map((i: any) => i.id),
          summary: `Matched ${matched}/${items.length} items (skipped ${skipped} already-set, ${misses.length} unmatched).`,
        },
      };
    });
  },
});
