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
  invoiceLineItems,
} from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { calculateItemTax, type AtrContext } from "../../tax-calculation-service";
import { extractFromPdf, extractFromExcel } from "../../document-extraction";
import { McpToolError } from "../errors";
import { resolveAgentUserId } from "../audit-attribution";
import { rawDb } from "../../db";
import { getFile, createPresignedUploadUrl } from "../../object-storage";

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
        description: "Header-level cost inputs (entered by user, NOT in the invoice itself). All optional.",
        properties: {
          transport_cost: { type: ["string", "number"], description: "Navlun bedeli (USD). Comes from the email body or user input." },
          insurance_cost: { type: ["string", "number"], description: "Sigorta bedeli (USD). If omitted, auto-calculated as 0.2% of total invoice value (CNCxSOHO standard). Pass 0 to opt out." },
          storage_cost: { type: ["string", "number"], description: "Antrepo/depo bedeli (USD), if any." },
          currency_rate: { type: ["string", "number"], description: "TCMB rate at customs declaration date (USD→TL)." },
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
      // Insurance auto-rule: if caller didn't specify, default to 0.2% of total_value
      // (CNCxSOHO standard sigorta = fatura bedeli * 0.002). Caller can override by
      // passing costs.insurance_cost explicitly OR by setting costs.insurance_cost
      // to 0 / "0" to opt out of the default.
      if (costs.insurance_cost !== undefined && costs.insurance_cost !== null && costs.insurance_cost !== "") {
        headerData.insurance_cost = String(parseFloat(String(costs.insurance_cost)).toFixed(2));
      } else {
        headerData.insurance_cost = (totalValue * 0.002).toFixed(2);
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

// ---------------------------------------------------------------------------
// read_next_invoice_reference — query the DB for the highest existing
// reference matching a prefix (e.g. "CNCALO") across BOTH procedures and
// tax_calculations, and return the suggested next number.
// Cowork should call this whenever a new invoice arrives and the user hasn't
// explicitly given a reference, so the new procedure follows the existing
// sequence (CNCALO-76 -> CNCALO-77).
// ---------------------------------------------------------------------------
registerTool({
  name: "read_next_invoice_reference",
  tier: "read",
  description:
    "For a given prefix like 'CNCALO' or 'CNCAMIRI' or 'CNCSOHO', return the " +
    "suggested next sequential reference (e.g. if CNCALO-76 is the highest " +
    "existing, this returns 'CNCALO-77'). Scans procedures.reference AND " +
    "tax_calculations.reference. Strips any suffix like '/1' or 'GARMENTS' " +
    "from existing references when computing the max number — those suffix " +
    "variants share the base number.",
  inputSchema: {
    type: "object",
    properties: {
      prefix: {
        type: "string",
        description: "Reference prefix, e.g. 'CNCALO'. The tool appends a '-' and the next number.",
      },
    },
    required: ["prefix"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const prefix = String(args.prefix).trim();
    if (!prefix) throw new McpToolError("prefix is required");
    // Query both tables, extract numeric component after `<prefix>-`, take max.
    const result = await rawDb.query(
      `
      WITH refs AS (
        SELECT reference FROM procedures WHERE reference ILIKE $1
        UNION ALL
        SELECT reference FROM tax_calculations WHERE reference ILIKE $1
      )
      SELECT MAX(
        NULLIF(
          regexp_replace(
            substring(reference FROM (length($2::text) + 2)),
            '[^0-9].*$', ''
          ),
          ''
        )::int
      ) AS max_num,
      COUNT(*) AS scanned
      FROM refs
      WHERE substring(reference FROM (length($2::text) + 2)) ~ '^[0-9]+'
      `,
      [`${prefix}-%`, prefix]
    );
    const maxNum: number | null = result.rows?.[0]?.max_num ?? null;
    const scanned: number = parseInt(String(result.rows?.[0]?.scanned ?? 0), 10);
    if (maxNum === null) {
      return {
        data: {
          prefix,
          scanned,
          max_existing_number: null,
          suggested_next: `${prefix}-1`,
          note: `No existing references starting with '${prefix}-<number>' found. Suggesting '${prefix}-1' to start.`,
        },
      };
    }
    return {
      data: {
        prefix,
        scanned,
        max_existing_number: maxNum,
        suggested_next: `${prefix}-${maxNum + 1}`,
      },
    };
  },
});


// ---------------------------------------------------------------------------
// import_invoice_from_file — one-shot Cowork entry point. Calls the SAME
// HTTP endpoints the React UI's "Calculate Taxes" and "Create Procedure"
// buttons call, in the same order. No direct DB writes from this tool —
// everything goes through the app's existing services so the result is
// identical to what a manual UI run would produce.
//
// React UI flow this mirrors:
//   1. POST /api/tax-calculation/calculations             (create header)
//   2. POST /api/tax-calculation/calculations/:id/items/batch (items with
//      tr_hs_code pre-filled from products / HS suggestion)
//   3. POST /api/tax-calculation/calculations/:id/calculate (runs
//      calculateAllItems — fills per-item tax fields + status='calculated')
//   4. POST /api/tax-calculation/calculations/:id/create-procedure
//      (procedure row + invoice_line_items, tax_calc.procedure_id set)
//   5. PUT  /api/procedures/:reference                    (shipper if known)
//
// MCP-tool-specific helpers (computed BEFORE the HTTP chain):
//   - Auto-resolve reference (auto_reference_prefix → next sequential)
//   - Auto-fetch TCMB currency_rate if omitted
//   - Auto-insurance = 0.2% of invoice total if omitted
//   - HS-code suggestion fallback for items whose style is not in products
//     (mirrors the React UI's MissingProductsForm suggestions-by-hts logic)
// ---------------------------------------------------------------------------

registerTool({
  name: "import_invoice_from_file",
  tier: "write",
  description:
    "Process an invoice file end-to-end via the app's existing HTTP routes: " +
    "extract → tax_calc + items → calculate → create procedure. Cowork's role " +
    "is just to transport the file in (via prepare_invoice_upload). " +
    "No direct DB writes from this tool. Result is identical to a manual UI run.\n\n" +
    "Inputs:\n" +
    "  - s3_key (REQUIRED): file in S3, from prepare_invoice_upload.\n" +
    "  - Either procedure_reference OR auto_reference_prefix " +
    "(CNCALO / CNCAMIRI / CNCSOHO). Tool computes next sequential number.\n" +
    "  - transport_cost (optional): navlun USD.\n" +
    "  - currency_rate (optional): if omitted, auto-fetched from TCMB.\n" +
    "  - insurance_cost (optional): if omitted, auto = 0.2% of invoice total.\n" +
    "  - is_atr (optional): for ATR-eligible (EU/EFTA) invoices.\n\n" +
    "DO NOT inline file content. Always call prepare_invoice_upload first " +
    "and pass the resulting s3_key.",
  inputSchema: {
    type: "object",
    properties: {
      s3_key: {
        type: "string",
        description: "S3 object key returned by prepare_invoice_upload. REQUIRED.",
      },
      procedure_reference: {
        type: "string",
        description: "Pass when the user named an EXISTING reference (e.g. 'CNCALO-72'). For a NEW invoice leave blank.",
      },
      auto_reference_prefix: {
        type: "string",
        description: "For a NEW invoice, pass 'CNCALO' (ALO Yoga / ALO HONG KONG LTD / ALO, LLC), 'CNCAMIRI' (AMIRI / Atelier Luxury Group), or 'CNCSOHO' (SOHO). The tool scans procedures AND tax_calculations for the highest existing numeric suffix.",
      },
      transport_cost: { type: ["string", "number"], description: "Navlun bedeli (USD). Usually from the freight invoice email." },
      insurance_cost: { type: ["string", "number"], description: "Sigorta bedeli (USD). Omit to auto-set to 0.2% of invoice total." },
      storage_cost: { type: ["string", "number"], description: "Antrepo/depo bedeli (USD). Default null." },
      currency_rate: { type: ["string", "number"], description: "TCMB USD/TRY rate. Omit to auto-fetch from TCMB." },
      is_atr: { type: "boolean", default: false, description: "True for ATR-eligible (EU/EFTA preferential origin) invoices." },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: any, _ctx: any) => {
    if (!args.procedure_reference && !args.auto_reference_prefix) {
      throw new McpToolError("Provide either procedure_reference OR auto_reference_prefix.");
    }
    if (!args.s3_key) {
      throw new McpToolError("s3_key is required. Upload via prepare_invoice_upload first.");
    }

    const PORT = process.env.PORT || "5000";
    const BASE = `http://127.0.0.1:${PORT}`;

    // 1. Download from S3 + extract products
    const { buffer: fileBuf, contentType } = await getFile(args.s3_key);
    if (fileBuf.length === 0) throw new McpToolError(`s3_key '${args.s3_key}' is empty or not found in S3`);
    const isPdf = (contentType ?? "").includes("pdf") || /\.pdf$/i.test(args.s3_key);
    const extracted: any = isPdf ? await extractFromPdf(fileBuf) : await extractFromExcel(fileBuf);
    const products: any[] = Array.isArray(extracted?.products) ? extracted.products : [];
    if (products.length === 0) throw new McpToolError("No products extracted from the file.");

    // 2. Compute totals (we'll need these for auto-insurance and the user summary)
    let totalValue = 0;
    let totalQuantity = 0;
    for (const p of products) {
      const cost = parseFloat(String(p.cost));
      const unitCount = parseInt(String(p.unit_count), 10);
      if (!Number.isFinite(cost) || !Number.isInteger(unitCount)) {
        throw new McpToolError(`Invalid cost/unit_count on product '${p.style ?? "(no style)"}'`);
      }
      const lineTotal = p.total_value !== undefined && p.total_value !== null && p.total_value !== ""
        ? parseFloat(String(p.total_value))
        : cost * unitCount;
      totalValue += lineTotal;
      totalQuantity += unitCount;
    }

    // 3. Resolve reference (auto-pick or given)
    let resolvedReference: string = args.procedure_reference;
    let referenceWasAuto = false;
    if (!resolvedReference) {
      const prefix = String(args.auto_reference_prefix).trim();
      const refResult = await rawDb.query(
        `
        WITH refs AS (
          SELECT reference FROM procedures WHERE reference ILIKE $1
          UNION ALL
          SELECT reference FROM tax_calculations WHERE reference ILIKE $1
        )
        SELECT MAX(
          NULLIF(
            regexp_replace(
              substring(reference FROM (length($2::text) + 2)),
              '[^0-9].*$', ''
            ),
            ''
          )::int
        ) AS max_num
        FROM refs
        WHERE substring(reference FROM (length($2::text) + 2)) ~ '^[0-9]+'
        `,
        [`${prefix}-%`, prefix]
      );
      const maxNum: number | null = refResult.rows?.[0]?.max_num ?? null;
      resolvedReference = `${prefix}-${(maxNum ?? 0) + 1}`;
      referenceWasAuto = true;
    }

    // 4. Auto-fetch TCMB rate if not provided
    let resolvedCurrencyRate: number | null = null;
    let currencyRateSource = "none";
    if (args.currency_rate !== undefined && args.currency_rate !== null && args.currency_rate !== "") {
      resolvedCurrencyRate = parseFloat(String(args.currency_rate));
      currencyRateSource = "caller";
    } else {
      try {
        const r = await fetch(`${BASE}/api/usdtl-rate`);
        if (r.ok) {
          const j: any = await r.json();
          if (typeof j?.rate === "number" && j.rate > 0) {
            resolvedCurrencyRate = j.rate;
            currencyRateSource = `TCMB(${j.date ?? "today"})`;
          }
        }
      } catch (_e) {
        // Silent — caller will see currency_rate_source='none' in result
      }
    }

    // 5. Auto-insurance: 0.2% of invoice total
    const insuranceWasAuto = args.insurance_cost === undefined || args.insurance_cost === null || args.insurance_cost === "";
    const resolvedInsuranceCost: string = insuranceWasAuto
      ? (totalValue * 0.002).toFixed(2)
      : parseFloat(String(args.insurance_cost)).toFixed(2);

    // 6. Pre-match: style → products.tr_hs_code; fallback to most-popular tr_hs_code
    //    among other products with the same US hts_code (mirrors React UI's
    //    /api/tax-calculation/products/suggestions-by-hts logic).
    const styles = Array.from(new Set(products.map(p => p.style).filter(Boolean))) as string[];
    const productRows = styles.length
      ? await db.select().from(productsTable).where(inArray(productsTable.style, styles))
      : [];
    const productByStyle = new Map<string, any>(productRows.map((p: any) => [p.style, p]));

    const htsCodesNeedingFallback = new Set<string>();
    for (const p of products) {
      const matchedProduct = productByStyle.get(p.style);
      if ((!matchedProduct || !matchedProduct.tr_hs_code) && p.hts_code) {
        htsCodesNeedingFallback.add(String(p.hts_code));
      }
    }
    const fallbackByHts = new Map<string, string>();
    for (const hts of htsCodesNeedingFallback) {
      const sug = await rawDb.query(
        `
        SELECT tr_hs_code FROM products
        WHERE hts_code = $1 AND tr_hs_code IS NOT NULL AND tr_hs_code <> ''
        GROUP BY tr_hs_code
        ORDER BY COUNT(*) DESC
        LIMIT 1
        `,
        [hts]
      );
      const top = sug.rows?.[0]?.tr_hs_code;
      if (top) fallbackByHts.set(hts, top);
    }

    // 7. Build items for /items/batch with tr_hs_code pre-filled.
    let matchedCount = 0;
    let matchedViaSuggestion = 0;
    const unmatched: { style: string; hts_code?: string; reason: string }[] = [];
    const itemsForBatch = products.map((p: any, idx: number) => {
      const cost = parseFloat(String(p.cost));
      const unitCount = parseInt(String(p.unit_count), 10);
      const lineTotal = p.total_value !== undefined && p.total_value !== null && p.total_value !== ""
        ? parseFloat(String(p.total_value))
        : cost * unitCount;
      const matched = productByStyle.get(p.style);
      let trCode: string | null = null;
      let productId: number | null = null;
      let viaSuggestion = false;
      if (matched?.tr_hs_code) {
        trCode = matched.tr_hs_code;
        productId = matched.id;
      } else if (p.hts_code && fallbackByHts.has(String(p.hts_code))) {
        trCode = fallbackByHts.get(String(p.hts_code))!;
        viaSuggestion = true;
      }
      if (trCode) {
        matchedCount++;
        if (viaSuggestion) matchedViaSuggestion++;
      } else {
        unmatched.push({
          style: p.style,
          hts_code: p.hts_code ?? undefined,
          reason: matched
            ? "products row has no tr_hs_code, and no HS-code suggestion available"
            : "style not in products, and no HS-code suggestion available",
        });
      }
      return {
        product_id: productId,
        line_number: idx + 1,
        style: p.style,
        color: p.color ?? null,
        category: p.category ?? null,
        description: p.description ?? null,
        fabric_content: p.fabric_content ?? null,
        country_of_origin: p.country_of_origin ?? null,
        hts_code: p.hts_code ?? null,
        cost: cost,
        unit_count: unitCount,
        total_value: lineTotal,
        tr_hs_code: trCode,
      };
    });

    // 8. HTTP self-call chain — same routes the React UI calls.
    const meta = extracted?.invoiceMetadata ?? {};

    // 8a. Create tax_calculations header
    const headerBody: any = {
      reference: resolvedReference,
      invoice_no: meta.invoice_no ?? null,
      invoice_date: meta.invoice_date ?? null,
      total_value: totalValue.toFixed(2),
      total_quantity: totalQuantity,
      transport_cost: args.transport_cost !== undefined && args.transport_cost !== null && args.transport_cost !== ""
        ? parseFloat(String(args.transport_cost)).toFixed(2)
        : null,
      insurance_cost: resolvedInsuranceCost,
      storage_cost: args.storage_cost !== undefined && args.storage_cost !== null && args.storage_cost !== ""
        ? parseFloat(String(args.storage_cost)).toFixed(2)
        : null,
      currency_rate: resolvedCurrencyRate !== null ? resolvedCurrencyRate.toFixed(4) : null,
      is_prepaid: false,
      is_atr: !!args.is_atr,
      status: "draft",
    };
    const headerResp = await fetch(`${BASE}/api/tax-calculation/calculations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(headerBody),
    });
    if (!headerResp.ok) {
      const errText = await headerResp.text();
      throw new McpToolError(`Failed to create tax_calculations: ${headerResp.status} ${errText.slice(0, 300)}`);
    }
    const headerData: any = await headerResp.json();
    const calcId: number | undefined = headerData?.calculation?.id;
    if (!calcId) throw new McpToolError("Tax calculation create response did not include calculation.id");

    // 8b. Batch insert items
    const batchResp = await fetch(`${BASE}/api/tax-calculation/calculations/${calcId}/items/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: itemsForBatch }),
    });
    if (!batchResp.ok) {
      const errText = await batchResp.text();
      throw new McpToolError(`Failed to batch-insert items: ${batchResp.status} ${errText.slice(0, 300)}`);
    }
    const batchData: any = await batchResp.json();
    const insertedCount: number = batchData?.count ?? batchData?.items?.length ?? 0;

    // 8c. Run /calculate (calculateAllItems) — fills per-item tax fields + status
    const calcResp = await fetch(`${BASE}/api/tax-calculation/calculations/${calcId}/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!calcResp.ok) {
      const errText = await calcResp.text();
      throw new McpToolError(`Failed to run /calculate: ${calcResp.status} ${errText.slice(0, 300)}`);
    }
    const calcResult: any = await calcResp.json();
    const calculatedItems: any[] = Array.isArray(calcResult?.items) ? calcResult.items : [];

    // 8d. Create procedure (+ invoice_line_items) from the calculation
    const agentUserId = await resolveAgentUserId(db as any);
    const createProcResp = await fetch(`${BASE}/api/tax-calculation/calculations/${calcId}/create-procedure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: agentUserId }),
    });
    if (!createProcResp.ok) {
      const errText = await createProcResp.text();
      throw new McpToolError(`Failed to create-procedure: ${createProcResp.status} ${errText.slice(0, 300)}`);
    }
    const procResult: any = await createProcResp.json();
    const procedureId: number | undefined = procResult?.procedure?.id;

    // 8e. Optionally fill shipper on the procedure (React UI doesn't auto-fill it)
    let shipperSet = false;
    if (meta?.shipper && procedureId) {
      try {
        const updResp = await fetch(`${BASE}/api/procedures/${encodeURIComponent(resolvedReference)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shipper: meta.shipper }),
        });
        shipperSet = updResp.ok;
      } catch (_e) {
        // non-fatal
      }
    }

    // 9. Aggregate per-item totals for the user summary
    let totalCustoms = 0, totalAdditional = 0, totalKkdf = 0, totalVat = 0, totalUsd = 0, totalTl = 0;
    let calcOK = 0;
    let calcSkipped = 0;
    for (const it of calculatedItems) {
      const cVal = parseFloat(it.customs_tax ?? "0");
      const vVal = parseFloat(it.vat ?? "0");
      if (cVal > 0 || vVal > 0 || parseFloat(it.kkdf ?? "0") > 0) {
        calcOK++;
      } else if (!it.tr_hs_code) {
        calcSkipped++;
      }
      totalCustoms += cVal;
      totalAdditional += parseFloat(it.additional_customs_tax ?? "0");
      totalKkdf += parseFloat(it.kkdf ?? "0");
      totalVat += vVal;
      totalUsd += parseFloat(it.total_tax_usd ?? "0");
      totalTl += parseFloat(it.total_tax_tl ?? "0");
    }

    // 10. POST /api/taxes — populate the procedure-details "Tax Details" panel.
    // The React UI displays this panel with TL values (₺); a user would
    // normally manually enter the TL amounts on the Expenses page after
    // customs clearance. We compute them as USD per-category totals × TCMB rate.
    let taxesRowId: number | null = null;
    let taxesRowError: string | null = null;
    if (resolvedCurrencyRate && resolvedCurrencyRate > 0 && calcOK > 0) {
      const rate = resolvedCurrencyRate;
      const taxBody = {
        procedureReference: resolvedReference,
        customsTax: (totalCustoms * rate).toFixed(2),
        additionalCustomsTax: (totalAdditional * rate).toFixed(2),
        kkdf: (totalKkdf * rate).toFixed(2),
        vat: (totalVat * rate).toFixed(2),
        stampTax: "0.00",
      };
      try {
        const taxResp = await fetch(`${BASE}/api/taxes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(taxBody),
        });
        if (taxResp.ok) {
          const tj: any = await taxResp.json();
          taxesRowId = tj?.tax?.id ?? null;
        } else {
          taxesRowError = `${taxResp.status} ${(await taxResp.text()).slice(0, 200)}`;
        }
      } catch (e: any) {
        taxesRowError = e?.message ?? String(e);
      }
    } else if (calcOK > 0 && (!resolvedCurrencyRate || resolvedCurrencyRate <= 0)) {
      taxesRowError = "Skipped: no currency_rate, cannot convert USD totals to TL.";
    }

    return {
      data: {
        reference: resolvedReference,
        reference_was_auto: referenceWasAuto,
        procedure_id: procedureId,
        tax_calculation_id: calcId,
        extracted_products: products.length,
        items_inserted: insertedCount,
        items_matched_total: matchedCount,
        items_matched_via_products_style: matchedCount - matchedViaSuggestion,
        items_matched_via_hts_suggestion: matchedViaSuggestion,
        items_unmatched: unmatched.length,
        unmatched_sample: unmatched.slice(0, 5),
        items_calculated: calcOK,
        items_calc_skipped: calcSkipped,
        totals_usd: {
          customs_tax: totalCustoms.toFixed(2),
          additional_customs_tax: totalAdditional.toFixed(2),
          kkdf: totalKkdf.toFixed(2),
          vat: totalVat.toFixed(2),
          total: totalUsd.toFixed(2),
        },
        totals_tl: { total: totalTl.toFixed(2) },
        insurance_cost_used: resolvedInsuranceCost,
        insurance_was_auto: insuranceWasAuto,
        currency_rate_used: resolvedCurrencyRate?.toFixed(4) ?? null,
        currency_rate_source: currencyRateSource,
        shipper_set: shipperSet,
        taxes_row_id: taxesRowId,
        taxes_row_error: taxesRowError,
        invoice_metadata: meta,
        summary_for_user:
          `${resolvedReference}${referenceWasAuto ? " (otomatik numara)" : ""} oluşturuldu. ` +
          (procedureId ? `Procedure id=${procedureId} React UI'da görünüyor. ` : "") +
          `${products.length} ürün, ${insertedCount} item kaydedildi, ${calcOK} vergi hesaplandı` +
          (unmatched.length > 0 ? `, ⚠ ${unmatched.length} eşleşmemiş style (manuel kontrol gerekebilir). ` : ". ") +
          `Fatura ${totalValue.toFixed(2)} USD. ` +
          `Gümrük ${totalCustoms.toFixed(2)} USD, Ek Gümrük ${totalAdditional.toFixed(2)} USD, ` +
          `KKDF ${totalKkdf.toFixed(2)} USD, KDV ${totalVat.toFixed(2)} USD. ` +
          `Toplam ${totalUsd.toFixed(2)} USD = ${totalTl.toFixed(2)} TL (kur ${resolvedCurrencyRate?.toFixed(4) ?? "?"} via ${currencyRateSource}). ` +
          (taxesRowId ? `Tax Details paneli dolduruldu (TL).` : (taxesRowError ? `⚠ Tax Details panel doldurulamadı: ${taxesRowError}` : "")),
      },
      meta: {
        affectedTable: "procedures",
        affectedIds: [procedureId, calcId].filter((x): x is number => typeof x === "number"),
        summary: `import_invoice_from_file → ${resolvedReference}${referenceWasAuto ? " (auto)" : ""}, ${calcOK}/${insertedCount} items calculated, procedure id=${procedureId ?? "?"}`,
      },
    };
  },
});



// ---------------------------------------------------------------------------
// read_usdtl_rate — wrapper around the app's existing /api/usdtl-rate route.
// Cached 30 min server-side. Returns the official TCMB USD/TRY ForexSelling
// rate published daily.
// ---------------------------------------------------------------------------
registerTool({
  name: "read_usdtl_rate",
  tier: "read",
  description:
    "Returns today's official TCMB USD/TRY ForexSelling rate (cached 30 min). " +
    "Use whenever you need to display or use the TL conversion rate. " +
    "Note: import_invoice_from_file auto-fetches this internally — you only " +
    "need to call this tool explicitly when displaying the rate to the user " +
    "(e.g. 'Bugünkü TCMB kuru kaç?').",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: async () => {
    const port = process.env.PORT || "5000";
    const r = await fetch(`http://127.0.0.1:${port}/api/usdtl-rate`);
    if (!r.ok) {
      throw new McpToolError(`TCMB rate fetch failed (HTTP ${r.status})`);
    }
    const data = (await r.json()) as { rate: number; source: string; date: string | null; fetchedAt: number };
    return {
      data,
      meta: { summary: `TCMB USD/TRY ForexSelling = ${data.rate} (date: ${data.date ?? "today"})` },
    };
  },
});

// ---------------------------------------------------------------------------
// prepare_invoice_upload — returns a short-lived presigned S3 PUT URL plus
// the resulting s3_key. Cowork (or any MCP client) calls this tool first,
// PUTs the file content to the returned URL via bash curl (no auth header
// needed — the URL itself is signed), then calls import_invoice_from_file
// with the s3_key.
//
// Solves the chicken-and-egg of: "Cowork is authenticated to MCP but not
// to /mcp/upload's bash-side curl because it can't read its own bearer
// token out to bash."
// ---------------------------------------------------------------------------
registerTool({
  name: "prepare_invoice_upload",
  tier: "write",
  description:
    "Get a 15-minute presigned S3 PUT URL for uploading an invoice file. " +
    "Workflow:\n" +
    "  1. Call this tool with the filename + content_type.\n" +
    "  2. From the response, take `presigned_put_url` and `s3_key`.\n" +
    "  3. Bash: curl -X PUT --data-binary @<file path> '<presigned_put_url>' " +
    "-H 'Content-Type: <same content_type>'\n" +
    "  4. Then call import_invoice_from_file with s3_key set to the returned value.\n" +
    "No bearer token needed on the PUT — the URL is signed. " +
    "Use this whenever a user attaches an invoice file (Excel or PDF) and you need " +
    "to feed it to import_invoice_from_file. This is the SUPPORTED path for any file " +
    "larger than what fits in a tool argument.",
  inputSchema: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "Original filename including extension, e.g. 'TR00026.xlsx' or 'invoice.pdf'. Used only to produce a recognizable s3_key — does not affect the procedure reference.",
      },
      content_type: {
        type: "string",
        description: "MIME type of the file. Common values: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' for .xlsx, 'application/pdf' for .pdf, 'application/vnd.ms-excel' for .xls.",
      },
    },
    required: ["filename", "content_type"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const result = await createPresignedUploadUrl(args.filename, args.content_type);
    return {
      data: {
        ...result,
        next_step:
          `Now run on your sandbox: ` +
          `curl -X PUT --data-binary @<file path> '${result.presigned_put_url}' ` +
          `-H 'Content-Type: ${args.content_type}'  ` +
          `(no auth header needed). On success (HTTP 200) call import_invoice_from_file with s3_key='${result.s3_key}'.`,
      },
      meta: { summary: `Presigned PUT URL ready for ${args.filename} (s3_key=${result.s3_key}, TTL ${result.expires_in_seconds}s)` },
    };
  },
});
