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
// import_invoice_from_file — one-shot Cowork entry point. Mirrors the React
// UI's full "Tax Calculation → Upload Excel/PDF → … → Create Procedure" flow.
//
// Cowork's role here: transport an invoice file (from email or chat) into the
// app and let the app's business logic do the rest. This tool delegates to the
// SAME services the React UI uses (extractFromPdf/Excel, calculateItemTax,
// the products.tr_hs_code lookup with HS-code fallback, the same procedure /
// invoice_line_items shape).
//
// Inputs (almost all optional — auto-handled by the app):
//   - procedure_reference: pass if you know the exact reference. Otherwise
//     leave blank and pass `auto_reference_prefix` (e.g. "CNCALO") — the tool
//     calls read_next_invoice_reference logic and uses the suggested next.
//   - pdf_base64 / xlsx_base64: file content. App's existing extractor reads it.
//   - transport_cost: navlun bedeli (USD), comes from email body or user input.
//   - currency_rate: TCMB USD→TL kuru. Cowork should fetch today's TCMB rate
//     via web search before calling (Anthropic's web tool) — the app doesn't
//     auto-fetch.
//   - insurance_cost: omit to auto-set to 0.2% of invoice total (CNCxSOHO standard).
//   - is_atr: pass true for ATR-eligible (EU/EFTA) invoices.
//
// What the tool does internally (mirrors React UI flow):
//   1. Resolve reference (use given OR compute next from prefix)
//   2. Extract products from PDF/Excel
//   3. Insert tax_calculations header + items
//   4. Match items: by style in products table; for unmatched, fall back to
//      "most popular tr_hs_code for this US hts_code" (same rule the React UI
//      shows as suggestions). Caller can review unmatched in the result.
//   5. Calculate tax (per-item customs/KKDF/VAT/etc.)
//   6. Upsert aggregated taxes row
//   7. If the procedure doesn't exist yet, CREATE it from the tax_calculation
//      data + create invoice_line_items rows (matches the React UI's "Create
//      Procedure" button logic). Sets tax_calculations.procedure_id.
// ---------------------------------------------------------------------------

registerTool({
  name: "import_invoice_from_file",
  tier: "write",
  description:
    "One-shot tax-calc pipeline: takes a base64 PDF or Excel invoice file and " +
    "delegates to the app's existing services (extractFromPdf/Excel, products " +
    "lookup with HS-code fallback, tax-calculation-service, the React UI's " +
    "create-procedure logic). Cowork's role is just to transport the file in. " +
    "Either provide procedure_reference (existing procedure) OR auto_reference_prefix " +
    "(e.g. 'CNCALO') and the tool will compute the next sequential reference and " +
    "auto-create the procedure at the end. Insurance auto-set to 0.2% if omitted. " +
    "TCMB currency_rate is NOT auto-fetched — Cowork should web-search today's USD/TRY " +
    "rate and pass it before calling, otherwise TL totals will be 0.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_reference: {
        type: "string",
        description: "Use this when you know the exact reference (e.g. 'CNCALO-72'). If omitted, auto_reference_prefix must be set.",
      },
      auto_reference_prefix: {
        type: "string",
        description: "Used when procedure_reference is not given. The tool computes the next sequential reference for this prefix (e.g. 'CNCALO' → 'CNCALO-77' if 76 is the highest). If neither is given, the tool errors.",
      },
      pdf_base64: { type: "string", description: "Base64 PDF (NO data: prefix). Provide either this or xlsx_base64." },
      xlsx_base64: { type: "string", description: "Base64 .xlsx. Provide either this or pdf_base64." },
      transport_cost: { type: ["string", "number"], description: "Navlun bedeli (USD). Usually given by the freight invoice email; pass when known." },
      insurance_cost: { type: ["string", "number"], description: "Sigorta bedeli (USD). Omit to auto-calc as 0.2% of invoice total (CNCxSOHO standard)." },
      storage_cost: { type: ["string", "number"], description: "Antrepo/depo bedeli (USD). Default 0." },
      currency_rate: { type: ["string", "number"], description: "TCMB USD→TL rate at customs declaration date. Cowork should fetch today's rate via web search and pass it; otherwise TL totals will be 0." },
      is_atr: { type: "boolean", default: false, description: "Set true for ATR (EU/EFTA preferential origin) invoices." },
      shipper: { type: "string", description: "Optional shipper name. If procedure is auto-created and this is not given, the invoice metadata's shipper field is used." },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: any, ctx: any) => {
    if (!args.procedure_reference && !args.auto_reference_prefix) {
      throw new McpToolError("Provide either procedure_reference OR auto_reference_prefix.");
    }
    if (!args.pdf_base64 && !args.xlsx_base64) {
      throw new McpToolError("Either pdf_base64 or xlsx_base64 is required.");
    }
    if (args.pdf_base64 && args.xlsx_base64) {
      throw new McpToolError("Pass either pdf_base64 OR xlsx_base64, not both.");
    }

    // 1. Extract (outside transaction — Claude API call is slow, no DB lock needed yet)
    let extracted: any;
    if (args.pdf_base64) {
      const buf = Buffer.from(args.pdf_base64, "base64");
      if (buf.length === 0) throw new McpToolError("pdf_base64 decoded to empty buffer");
      extracted = await extractFromPdf(buf);
    } else {
      const buf = Buffer.from(args.xlsx_base64, "base64");
      if (buf.length === 0) throw new McpToolError("xlsx_base64 decoded to empty buffer");
      extracted = await extractFromExcel(buf);
    }
    const products = extracted?.products ?? [];
    if (products.length === 0) throw new McpToolError("No products extracted from the file. Check that the file is a recognizable invoice.");

    // 2. Save + match + calc + (maybe) auto-create procedure — one transaction.
    return await db.transaction(async (tx) => {
      // 2a. Resolve reference.
      let resolvedReference = args.procedure_reference;
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
        const nextNum = (maxNum ?? 0) + 1;
        resolvedReference = `${prefix}-${nextNum}`;
        referenceWasAuto = true;
      }

      const [procedureMaybe] = await tx.select().from(proceduresTable).where(eq(proceduresTable.reference, resolvedReference));

      const [existingCalc] = await tx.select().from(taxCalculations).where(eq(taxCalculations.reference, resolvedReference));
      if (existingCalc) {
        throw new McpToolError(`tax_calculations row already exists for ${resolvedReference} (id=${existingCalc.id}). Delete it via destructive_delete_record(table:'tax_calculations'...) first, or pick a different reference.`);
      }

      let totalValue = 0;
      let totalQuantity = 0;
      const itemsToInsert = (products as any[]).map((p, idx) => {
        const cost = parseFloat(String(p.cost));
        const unitCount = parseInt(String(p.unit_count), 10);
        if (!Number.isFinite(cost)) throw new McpToolError(`products[${idx}].cost invalid: ${p.cost}`);
        if (!Number.isInteger(unitCount)) throw new McpToolError(`products[${idx}].unit_count invalid: ${p.unit_count}`);
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

      const meta = extracted?.invoiceMetadata ?? {};
      const headerData: any = {
        reference: resolvedReference,
        invoice_no: meta.invoice_no ?? null,
        invoice_date: meta.invoice_date ?? null,
        total_value: totalValue.toFixed(2),
        total_quantity: totalQuantity,
        is_prepaid: false,
        is_atr: !!args.is_atr,
        status: "draft",
        procedure_id: procedureMaybe?.id ?? null,
      };
      if (args.transport_cost !== undefined && args.transport_cost !== null && args.transport_cost !== "") {
        headerData.transport_cost = parseFloat(String(args.transport_cost)).toFixed(2);
      }
      // Insurance auto-rule: 0.2% of total_value
      if (args.insurance_cost !== undefined && args.insurance_cost !== null && args.insurance_cost !== "") {
        headerData.insurance_cost = parseFloat(String(args.insurance_cost)).toFixed(2);
      } else {
        headerData.insurance_cost = (totalValue * 0.002).toFixed(2);
      }
      if (args.storage_cost !== undefined && args.storage_cost !== null && args.storage_cost !== "") {
        headerData.storage_cost = parseFloat(String(args.storage_cost)).toFixed(2);
      }
      if (args.currency_rate !== undefined && args.currency_rate !== null && args.currency_rate !== "") {
        headerData.currency_rate = parseFloat(String(args.currency_rate)).toFixed(4);
      }

      const [calc] = await tx.insert(taxCalculations).values(headerData).returning();
      if (!calc) throw new McpToolError("tax_calculations insert returned no row");
      const itemsWithFk = itemsToInsert.map(it => ({ ...it, tax_calculation_id: calc.id }));
      const insertedItems = await tx.insert(taxCalculationItems).values(itemsWithFk).returning();

      // 3. Match: look up tr_hs_code from products table by style. If a style
      // has no exact match, fall back to the React UI's "suggestions-by-hts"
      // logic: query other products with the same US hts_code and use the
      // most-popular tr_hs_code (highest product_count). Mirrors
      // /api/tax-calculation/products/suggestions-by-hts.
      const styles = Array.from(new Set(insertedItems.map((i: any) => i.style).filter(Boolean))) as string[];
      const productRows = styles.length ? await tx.select().from(productsTable).where(inArray(productsTable.style, styles)) : [];
      const productByStyle = new Map<string, any>(productRows.map(p => [p.style, p]));

      // Pre-cache HS suggestions per unique hts_code seen on unmatched items.
      const htsCodesNeedingFallback = new Set<string>();
      for (const item of insertedItems as any[]) {
        const product = productByStyle.get(item.style);
        if ((!product || !product.tr_hs_code) && item.hts_code) {
          htsCodesNeedingFallback.add(String(item.hts_code));
        }
      }
      const fallbackByHts = new Map<string, string>();
      if (htsCodesNeedingFallback.size > 0) {
        for (const hts of htsCodesNeedingFallback) {
          const sugRes = await rawDb.query(
            `
            SELECT tr_hs_code, COUNT(*)::int as cnt
            FROM products
            WHERE hts_code = $1 AND tr_hs_code IS NOT NULL AND tr_hs_code <> ''
            GROUP BY tr_hs_code
            ORDER BY cnt DESC
            LIMIT 1
            `,
            [hts]
          );
          const top = sugRes.rows?.[0];
          if (top?.tr_hs_code) fallbackByHts.set(hts, top.tr_hs_code);
        }
      }

      let matched = 0;
      let matchedViaSuggestion = 0;
      const unmatched: { style: string; reason: string; hts_code?: string }[] = [];
      for (const item of insertedItems as any[]) {
        const product = productByStyle.get(item.style);
        let trCode: string | null = null;
        let productId: number | null = null;
        let viaSuggestion = false;

        if (product?.tr_hs_code) {
          trCode = product.tr_hs_code;
          productId = product.id;
        } else if (item.hts_code && fallbackByHts.has(String(item.hts_code))) {
          trCode = fallbackByHts.get(String(item.hts_code))!;
          viaSuggestion = true;
        }

        if (!trCode) {
          unmatched.push({
            style: item.style,
            hts_code: item.hts_code ?? undefined,
            reason: !product
              ? (item.hts_code ? "no products row for style AND no HS-code suggestion available" : "no products row for style and no hts_code on item")
              : "products row exists but tr_hs_code empty AND no HS-code suggestion available",
          });
          continue;
        }

        await tx.update(taxCalculationItems).set({ tr_hs_code: trCode, product_id: productId }).where(eq(taxCalculationItems.id, item.id));
        matched++;
        if (viaSuggestion) matchedViaSuggestion++;
      }

      // 4. Calculate tax (re-fetch items with their new tr_hs_code).
      const fullItems = await tx.select().from(taxCalculationItems).where(eq(taxCalculationItems.tax_calculation_id, calc.id));
      const trCodesNeeded = Array.from(new Set(fullItems.map((i: any) => i.tr_hs_code).filter(Boolean))) as string[];
      const hsRows = trCodesNeeded.length ? await tx.select().from(hsCodes).where(inArray((hsCodes as any).tr_hs_code, trCodesNeeded)) : [];
      const hsByCode = new Map<string, any>(hsRows.map((r: any) => [r.tr_hs_code, r]));
      const atrContext: AtrContext | undefined = (calc as any).is_atr ? { isAtr: true, atrRatesMap: new Map() } : undefined;

      let totalCustoms = 0, totalAdditional = 0, totalKkdf = 0, totalVat = 0, totalUsd = 0, totalTl = 0;
      const calcSkipped: { item_id: number; style: string; reason: string }[] = [];
      let calcOK = 0;
      for (const item of fullItems as any[]) {
        if (!item.tr_hs_code) {
          calcSkipped.push({ item_id: item.id, style: item.style, reason: "missing tr_hs_code" });
          continue;
        }
        const hs = hsByCode.get(item.tr_hs_code);
        if (!hs) {
          calcSkipped.push({ item_id: item.id, style: item.style, reason: `tr_hs_code ${item.tr_hs_code} not in hsCodes table` });
          continue;
        }
        const r = await calculateItemTax(item, calc as any, hs as any, atrContext);
        totalCustoms += r.customs_tax;
        totalAdditional += r.additional_customs_tax;
        totalKkdf += r.kkdf;
        totalVat += r.vat;
        totalUsd += r.total_tax_usd;
        totalTl += r.total_tax_tl;
        calcOK++;
      }

      // 5. Upsert the aggregated taxes row.
      const agentUserId = await resolveAgentUserId(tx as any);
      const aggregate: any = {
        procedureReference: resolvedReference,
        customsTax: totalCustoms.toFixed(2),
        additionalCustomsTax: totalAdditional.toFixed(2),
        kkdf: totalKkdf.toFixed(2),
        vat: totalVat.toFixed(2),
        createdBy: agentUserId,
      };
      const [taxBefore] = await tx.select().from(taxesTable).where(eq((taxesTable as any).procedureReference, resolvedReference));
      let taxesRow;
      if (taxBefore) {
        const [updated] = await tx.update(taxesTable).set(aggregate).where(eq(taxesTable.id, taxBefore.id)).returning();
        taxesRow = updated;
      } else {
        const [inserted] = await tx.insert(taxesTable).values(aggregate).returning();
        taxesRow = inserted;
      }

      // 6. If procedure didn't exist, auto-create it now — mirrors the React UI's
      // POST /api/tax-calculation/calculations/:id/create-procedure endpoint:
      // creates a procedures row + invoice_line_items rows from the tax_calc
      // items, and updates tax_calculations.procedure_id back.
      let procedureCreated = false;
      let procedureForReturn = procedureMaybe;
      if (!procedureMaybe) {
        const procedureShipper = args.shipper ?? (extracted?.invoiceMetadata?.shipper) ?? null;
        const procedureData: any = {
          reference: resolvedReference,
          amount: totalValue.toFixed(2),
          currency: "USD",
          piece: totalQuantity,
          invoice_no: meta.invoice_no ?? null,
          invoice_date: meta.invoice_date ?? null,
          shipper: procedureShipper,
          createdBy: agentUserId,
        };
        const [newProc] = await tx.insert(proceduresTable).values(procedureData).returning();
        procedureForReturn = newProc;
        procedureCreated = true;

        // Update tax_calculations.procedure_id
        await tx.update(taxCalculations).set({ procedure_id: newProc.id }).where(eq(taxCalculations.id, calc.id));

        // Create invoice_line_items rows mirroring create-procedure route (line 6318+).
        if (insertedItems.length > 0) {
          const lineItemsData = insertedItems.map((item: any, idx: number) => ({
            procedureReference: resolvedReference,
            styleNo: item.style,
            description: item.category,
            quantity: item.unit_count,
            unitPrice: item.cost,
            totalPrice: item.total_value,
            sortOrder: idx,
            source: "tax_calculation",
            createdBy: agentUserId,
          }));
          await tx.insert(invoiceLineItems).values(lineItemsData);
        }
      }

      return {
        data: {
          reference: resolvedReference,
          reference_was_auto: referenceWasAuto,
          procedure_id: procedureForReturn?.id ?? null,
          procedure_was_created: procedureCreated,
          tax_calculation_id: calc.id,
          taxes_row_id: taxesRow.id,
          extracted_products: products.length,
          items_inserted: insertedItems.length,
          items_matched_total: matched,
          items_matched_via_products_style: matched - matchedViaSuggestion,
          items_matched_via_hts_suggestion: matchedViaSuggestion,
          items_unmatched: unmatched.length,
          unmatched_sample: unmatched.slice(0, 5),
          items_calculated: calcOK,
          items_calc_skipped: calcSkipped.length,
          calc_skipped_sample: calcSkipped.slice(0, 5),
          totals_usd: {
            customs_tax: totalCustoms.toFixed(2),
            additional_customs_tax: totalAdditional.toFixed(2),
            kkdf: totalKkdf.toFixed(2),
            vat: totalVat.toFixed(2),
            total: totalUsd.toFixed(2),
          },
          totals_tl: { total: totalTl.toFixed(2) },
          insurance_cost_used: headerData.insurance_cost,
          insurance_was_auto: args.insurance_cost === undefined || args.insurance_cost === null || args.insurance_cost === "",
          summary_for_user:
            (referenceWasAuto ? `${resolvedReference} olarak yeni kayıt oluşturuldu (otomatik numara). ` : `${resolvedReference}'a kaydedildi. `) +
            (procedureCreated ? `Procedure ve invoice_line_items oluşturuldu. ` : `Mevcut procedure'a eklendi. `) +
            `${products.length} ürün, toplam fatura ${totalValue.toFixed(2)} USD. ` +
            `Match: ${matched - matchedViaSuggestion} style üzerinden + ${matchedViaSuggestion} HS kodu önerisinden. ` +
            (unmatched.length > 0 ? `${unmatched.length} eşleşmemiş. ` : "") +
            `Vergi: ${calcOK}/${insertedItems.length} hesaplandı. ` +
            `Toplam: Gümrük ${totalCustoms.toFixed(2)} USD, KKDF ${totalKkdf.toFixed(2)} USD, KDV ${totalVat.toFixed(2)} USD. ` +
            (totalTl > 0 ? `TL: ${totalTl.toFixed(2)}.` : `(TCMB rate verilmediği için TL totals 0.)`),
        },
        meta: {
          affectedTable: procedureCreated ? "procedures" : "tax_calculations",
          affectedIds: [
            ...(procedureCreated && procedureForReturn ? [procedureForReturn.id] : []),
            calc.id,
            taxesRow.id,
            ...insertedItems.map(i => i.id),
          ],
          summary: `import_invoice_from_file → ${resolvedReference}${referenceWasAuto ? " (auto)" : ""}${procedureCreated ? ", procedure created" : ""}, ${calcOK}/${insertedItems.length} items calculated`,
        },
      };
    });
  },
});

