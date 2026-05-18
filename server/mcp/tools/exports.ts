// server/mcp/tools/exports.ts
// MCP tools that wrap the React UI's "Export Excel" and "Adv. Taxletter PDF"
// buttons. Each tool calls the existing HTTP route, captures the file, stores
// it in S3 under SOHO/mcp-exports/, and returns a 1-hour presigned download
// URL. Cowork then attaches the file to its Gmail reply (or hands the URL
// to the user) — no manual download step.
import { registerTool } from "../registry";
import { McpToolError } from "../errors";
import { uploadFile, createPresignedDownloadUrl } from "../../object-storage";
import { db, rawDb } from "../../db";
import {
  taxCalculations,
  taxCalculationItems,
} from "@shared/schema";
import { eq } from "drizzle-orm";

// Historical rate cache (in-memory, ~1 hour TTL). Avoids recomputing the same
// SQL on every export_adv_taxletter call.
const RATE_CACHE_TTL_MS = 60 * 60 * 1000;
const rateCache = new Map<string, { rate: number; sampleSize: number; fetchedAt: number }>();

/**
 * Compute the historical "TL paid per 1 USD of invoice value" rate for one
 * expense category in a given year, based on closed USD-currency procedures
 * with their import_expenses (or import_service_invoices) entries.
 *
 * source.kind = "expense": rate from import_expenses filtered by category.
 * source.kind = "service": rate from import_service_invoices (no category).
 */
async function getHistoricalExpenseRate(
  source: { kind: "expense"; category: string } | { kind: "service" },
  year: number,
): Promise<{ rate: number; sampleSize: number; fromCache: boolean }> {
  const cacheKey = source.kind === "expense" ? `exp:${source.category}:${year}` : `svc:${year}`;
  const cached = rateCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < RATE_CACHE_TTL_MS) {
    return { rate: cached.rate, sampleSize: cached.sampleSize, fromCache: true };
  }

  let query: string;
  let params: any[];
  if (source.kind === "expense") {
    query = `
      SELECT
        COUNT(DISTINCT p.reference) AS proc_count,
        SUM(p.amount::numeric) AS total_invoice_usd,
        SUM(
          CASE
            WHEN ie.currency IN ('TL','TRY') OR ie.currency IS NULL THEN ie.amount::numeric
            WHEN ie.currency = 'USD' THEN ie.amount::numeric * COALESCE(p.usdtl_rate::numeric, 0)
            ELSE 0
          END
        ) AS total_expense_tl
      FROM procedures p
      JOIN import_expenses ie ON ie.procedure_reference = p.reference
      WHERE p.shipment_status = 'closed'
        AND p.currency = 'USD'
        AND p.amount::numeric > 0
        AND EXTRACT(YEAR FROM p.arrival_date::date) = $1
        AND ie.category = $2
    `;
    params = [year, source.category];
  } else {
    query = `
      SELECT
        COUNT(DISTINCT p.reference) AS proc_count,
        SUM(p.amount::numeric) AS total_invoice_usd,
        SUM(
          CASE
            WHEN isi.currency IN ('TL','TRY') THEN isi.amount::numeric
            WHEN isi.currency = 'USD' THEN isi.amount::numeric * COALESCE(p.usdtl_rate::numeric, 0)
            ELSE 0
          END
        ) AS total_expense_tl
      FROM procedures p
      JOIN import_service_invoices isi ON isi.procedure_reference = p.reference
      WHERE p.shipment_status = 'closed'
        AND p.currency = 'USD'
        AND p.amount::numeric > 0
        AND EXTRACT(YEAR FROM p.arrival_date::date) = $1
    `;
    params = [year];
  }
  const r = await rawDb.query(query, params);
  const invoiceUsd = parseFloat(r.rows?.[0]?.total_invoice_usd ?? "0");
  const expenseTl = parseFloat(r.rows?.[0]?.total_expense_tl ?? "0");
  const procCount = parseInt(r.rows?.[0]?.proc_count ?? "0", 10);
  const rate = invoiceUsd > 0 ? expenseTl / invoiceUsd : 0;
  rateCache.set(cacheKey, { rate, sampleSize: procCount, fetchedAt: Date.now() });
  return { rate, sampleSize: procCount, fromCache: false };
}

const PORT = process.env.PORT || "5000";
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// export_calculation_excel — wraps GET /api/tax-calculation/calculations/:id/export/excel
// ---------------------------------------------------------------------------
registerTool({
  name: "export_calculation_excel",
  tier: "ai",
  description:
    "Generate the Tax Calculation Excel export (same as the React UI's 'Export " +
    "Excel' button) and store it in S3. Returns a 1-hour presigned download URL " +
    "Cowork can use to attach the file to an email reply. Use this immediately " +
    "after import_invoice_from_file when the supplier asks for the tax calc Excel.",
  inputSchema: {
    type: "object",
    properties: {
      tax_calculation_id: { type: "integer", description: "id from tax_calculations." },
    },
    required: ["tax_calculation_id"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const id = parseInt(String(args.tax_calculation_id), 10);
    if (!Number.isFinite(id)) throw new McpToolError("tax_calculation_id must be an integer.");

    // Look up reference for a nice filename.
    const [calc] = await db.select().from(taxCalculations).where(eq(taxCalculations.id, id));
    if (!calc) throw new McpToolError(`tax_calculation_id ${id} not found.`);

    const resp = await fetch(`${BASE}/api/tax-calculation/calculations/${id}/export/excel`);
    if (!resp.ok) {
      throw new McpToolError(`Excel export failed: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) throw new McpToolError("Excel export returned an empty file.");

    const safeRef = (calc.reference ?? `calc-${id}`).replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${safeRef}-tax-calc.xlsx`;
    const objectKey = await uploadFile(
      buf,
      filename,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "mcp-exports",
    );
    const { presigned_get_url, expires_in_seconds } = await createPresignedDownloadUrl(objectKey, 3600);

    return {
      data: {
        s3_key: objectKey,
        filename,
        size: buf.length,
        download_url: presigned_get_url,
        expires_in_seconds,
        reference: calc.reference,
        next_step: `Attach this URL to your reply: download via curl -o '${filename}' '${presigned_get_url}', then send as Gmail attachment.`,
      },
      meta: {
        summary: `Exported Excel for ${calc.reference} (${buf.length} bytes, URL TTL ${expires_in_seconds}s)`,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// export_adv_taxletter — wraps POST /api/tax-calculation/calculations/:id/export/adv-taxletter
// Auto-applies CNCxSOHO's standard expense defaults when caller doesn't pass
// an explicit `expenses` array. Categories:
//   FIXED:
//     • Export Registry Fee:           1,500 TL
//     • Awb Fee:                       5,000 TL
//     • Bonded Warehouse Storage Fee:  40,000 TL
//     • Tareks Fee:                    2,500 TL
//   COMPUTED FROM CALC:
//     • Insurance:                     ceil(calc.insurance_cost * rate / 500) * 500
//     • International Transportation:  OPT-IN. Only included when
//                                      include_international_transportation:true.
//                                      Default behavior: SKIP (per CNCxSOHO convention).
//   HISTORICAL (per-USD-of-invoice rate from closed USD procedures this year):
//     • Airport Storage Fee
//     • Transportation
//     • Service Invoice (if > 0)
// Rates are cached 1h. Sample size + cache state reported back in
// `historical_rates` on the response.
// Taxes (TL) auto-computed from per-item totals × currency_rate unless
// caller passes taxes_tl.
// ---------------------------------------------------------------------------
registerTool({
  name: "export_adv_taxletter",
  tier: "ai",
  description:
    "Generate the Advance Taxletter PDF (same as the React UI's 'Adv. Taxletter' " +
    "button modal). Auto-fills tax values (TL) and applies CNCxSOHO's standard " +
    "expense defaults: 4 fixed (Export Registry, AWB, Bonded Warehouse, Tareks), " +
    "Insurance auto-computed (rounded up to 500 TL), and Airport Storage / " +
    "Transportation / Service Invoice from historical per-USD-of-invoice " +
    "ratios across closed procedures this year. International Transportation " +
    "(navlun) is NOT included by default — pass " +
    "include_international_transportation:true ONLY when the user explicitly " +
    "asks for navlun on the taxletter. Returns a 1-hour presigned download URL.",
  inputSchema: {
    type: "object",
    properties: {
      tax_calculation_id: { type: "integer" },
      taxes_tl: {
        type: "object",
        description: "Override TL tax values. If omitted, auto-computed from per-item USD totals × currency_rate.",
        properties: {
          customsTax: { type: "number" },
          additionalTax: { type: "number" },
          kkdf: { type: "number" },
          vat: { type: "number" },
          stampTax: { type: "number" },
        },
        additionalProperties: false,
      },
      include_international_transportation: {
        type: "boolean",
        default: false,
        description:
          "Default false. Set true ONLY when the user explicitly says navlun " +
          "should be on the taxletter. When true, the tool adds an " +
          "'International Transportation' line = calc.transport_cost × currency_rate. " +
          "When false (default), navlun is NEVER on the taxletter, even if " +
          "calc.transport_cost > 0.",
      },
      expenses: {
        type: "array",
        description: "Override expense list (full replacement, not merge). If omitted, the 5 standard CNCxSOHO defaults are auto-applied.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "Display label (Export Registry Fee, Insurance, Transportation, etc.)" },
            amount: { type: "number", description: "Amount in TL." },
          },
          required: ["type", "amount"],
        },
      },
    },
    required: ["tax_calculation_id"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const id = parseInt(String(args.tax_calculation_id), 10);
    if (!Number.isFinite(id)) throw new McpToolError("tax_calculation_id must be an integer.");

    const [calc] = await db.select().from(taxCalculations).where(eq(taxCalculations.id, id));
    if (!calc) throw new McpToolError(`tax_calculation_id ${id} not found.`);

    const rate = parseFloat((calc as any).currency_rate ?? "0");
    if (rate <= 0 && !args.taxes_tl) {
      throw new McpToolError(
        `tax_calculations.currency_rate is 0 — cannot auto-compute TL tax values. ` +
        `Either set currency_rate on the calc (PUT /api/tax-calculation/calculations/:id) or pass taxes_tl explicitly.`,
      );
    }

    // 1. Compute taxes_tl (caller override OR per-item × rate)
    let taxesTl: any;
    if (args.taxes_tl) {
      taxesTl = {
        customsTax: parseFloat(String(args.taxes_tl.customsTax ?? 0)),
        additionalTax: parseFloat(String(args.taxes_tl.additionalTax ?? 0)),
        kkdf: parseFloat(String(args.taxes_tl.kkdf ?? 0)),
        vat: parseFloat(String(args.taxes_tl.vat ?? 0)),
        stampTax: parseFloat(String(args.taxes_tl.stampTax ?? 0)),
      };
    } else {
      const items = await db.select().from(taxCalculationItems).where(eq(taxCalculationItems.tax_calculation_id, id));
      let cu = 0, ad = 0, kk = 0, va = 0;
      for (const it of items as any[]) {
        cu += parseFloat(it.customs_tax ?? "0");
        ad += parseFloat(it.additional_customs_tax ?? "0");
        kk += parseFloat(it.kkdf ?? "0");
        va += parseFloat(it.vat ?? "0");
      }
      taxesTl = {
        customsTax: +(cu * rate).toFixed(2),
        additionalTax: +(ad * rate).toFixed(2),
        kkdf: +(kk * rate).toFixed(2),
        vat: +(va * rate).toFixed(2),
        stampTax: 0,
      };
    }

    // 2. Resolve expenses.
    //    If caller passes `expenses`, that's a full override (replaces auto rules).
    //    Otherwise we apply CNCxSOHO's standard default rules:
    //      • Export Registry Fee:           1,500 TL (fixed)
    //      • Insurance:                     ceil(calc.insurance_cost * rate / 500) * 500
    //      • Awb Fee:                       5,000 TL (fixed)
    //      • Bonded Warehouse Storage Fee:  40,000 TL (fixed)
    //      • Tareks Fee:                    2,500 TL (fixed)
    //    Airport Storage Fee, Transportation, International Transportation,
    //    Customs Inspection, Azo Test, Service Invoice, Other — TBD (omitted
    //    from the auto-generated list; caller must pass via `expenses` to include).
    let expensesList: { type: string; amount: number; id?: string }[];
    let expensesSource: "caller_override" | "auto_defaults" = "auto_defaults";
    if (Array.isArray(args.expenses)) {
      expensesSource = "caller_override";
      expensesList = args.expenses.map((e: any, i: number) => ({
        type: String(e.type),
        amount: parseFloat(String(e.amount ?? 0)),
        id: String(i + 1),
      }));
    } else {
      // === Auto-defaults: CNCxSOHO standard expense rules ===
      // FIXED:
      //   Export Registry Fee 1500, AWB Fee 5000, Bonded Warehouse 40000, Tareks 2500
      // INSURANCE (computed):
      //   ceil(calc.insurance_cost * rate / 500) * 500
      // INTERNATIONAL TRANSPORTATION (navlun):
      //   calc.transport_cost * rate (if > 0)
      // HISTORICAL (per-USD-of-invoice rate from closed procedures this year):
      //   Airport Storage Fee, Transportation, Service Invoice

      const invoiceUsd = parseFloat((calc as any).total_value ?? "0");

      // Insurance
      const insuranceUsd = parseFloat((calc as any).insurance_cost ?? "0");
      const insuranceTlRaw = insuranceUsd * rate;
      const insuranceTl = insuranceTlRaw > 0
        ? Math.ceil(insuranceTlRaw / 500) * 500
        : 0;

      // International Transportation (navlun) — OPT-IN only. Default: skipped.
      // Per CNCxSOHO convention navlun is NOT on the taxletter unless caller
      // explicitly says so via include_international_transportation:true.
      const includeNavlun = args.include_international_transportation === true;
      const navlunUsd = parseFloat((calc as any).transport_cost ?? "0");
      const intlTransportTl = includeNavlun && navlunUsd > 0 && rate > 0
        ? Math.round(navlunUsd * rate)
        : 0;

      // Historical per-USD rates for the current year (cached 1h)
      const year = new Date().getFullYear();
      const [airportRate, transportRate, serviceRate] = await Promise.all([
        getHistoricalExpenseRate({ kind: "expense", category: "airport_storage_fee" }, year),
        getHistoricalExpenseRate({ kind: "expense", category: "transportation" }, year),
        getHistoricalExpenseRate({ kind: "service" }, year),
      ]);
      const airportTl = invoiceUsd > 0 ? Math.round(invoiceUsd * airportRate.rate) : 0;
      const transportTl = invoiceUsd > 0 ? Math.round(invoiceUsd * transportRate.rate) : 0;
      const serviceTl = invoiceUsd > 0 ? Math.round(invoiceUsd * serviceRate.rate) : 0;

      expensesList = [
        { id: "1", type: "Export Registry Fee", amount: 1500 },
        { id: "2", type: "Insurance", amount: insuranceTl },
        { id: "3", type: "Awb Fee", amount: 5000 },
        { id: "4", type: "Bonded Warehouse Storage Fee", amount: 40000 },
        { id: "5", type: "Tareks Fee", amount: 2500 },
        { id: "6", type: "Airport Storage Fee", amount: airportTl },
        { id: "7", type: "Transportation", amount: transportTl },
      ];
      if (intlTransportTl > 0) {
        expensesList.push({ id: "8", type: "International Transportation", amount: intlTransportTl });
      }
      if (serviceTl > 0) {
        expensesList.push({ id: String(expensesList.length + 1), type: "Service Invoice", amount: serviceTl });
      }

      // Attach rate metadata so callers can audit which historical sample produced each line.
      (expensesList as any).__historicalRates = {
        year,
        airport_storage_fee: { rate_tl_per_usd: airportRate.rate, sample_procedures: airportRate.sampleSize, from_cache: airportRate.fromCache },
        transportation: { rate_tl_per_usd: transportRate.rate, sample_procedures: transportRate.sampleSize, from_cache: transportRate.fromCache },
        service_invoice: { rate_tl_per_usd: serviceRate.rate, sample_procedures: serviceRate.sampleSize, from_cache: serviceRate.fromCache },
        international_transportation: includeNavlun
          ? { source: navlunUsd > 0 ? "calc.transport_cost * rate (opt-in)" : "opt-in but navlun=0" }
          : { source: "skipped — set include_international_transportation:true to include" },
      };
    }

    const totalExpenses = expensesList.reduce((s, e) => s + e.amount, 0);
    const totalTax = taxesTl.customsTax + taxesTl.additionalTax + taxesTl.kkdf + taxesTl.vat + taxesTl.stampTax;
    const grandTotal = totalTax + totalExpenses;

    // 3. POST to the existing route
    const resp = await fetch(`${BASE}/api/tax-calculation/calculations/${id}/export/adv-taxletter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taxes: taxesTl,
        expenses: expensesList,
        totalExpenses,
        grandTotal,
      }),
    });
    if (!resp.ok) {
      throw new McpToolError(`Taxletter export failed: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) throw new McpToolError("Taxletter export returned an empty file.");

    const safeRef = (calc.reference ?? `calc-${id}`).replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${safeRef}-adv-taxletter.pdf`;
    const objectKey = await uploadFile(buf, filename, "application/pdf", "mcp-exports");
    const { presigned_get_url, expires_in_seconds } = await createPresignedDownloadUrl(objectKey, 3600);

    return {
      data: {
        s3_key: objectKey,
        filename,
        size: buf.length,
        download_url: presigned_get_url,
        expires_in_seconds,
        reference: calc.reference,
        taxes_used_tl: taxesTl,
        expenses_used: expensesList,
        expenses_source: expensesSource,
        historical_rates: (expensesList as any).__historicalRates ?? null,
        total_tax_tl: totalTax,
        total_expenses_tl: totalExpenses,
        grand_total_tl: grandTotal,
        next_step: `Attach this URL to your reply: download via curl -o '${filename}' '${presigned_get_url}', then send as Gmail attachment.`,
      },
      meta: {
        summary: `Exported Adv. Taxletter for ${calc.reference}: ${expensesList.length} expense items, Tax ${totalTax.toFixed(2)} TL, Expenses ${totalExpenses.toFixed(2)} TL, Grand ${grandTotal.toFixed(2)} TL`,
      },
    };
  },
});
