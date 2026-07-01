// server/mcp/tools/exports.ts
// MCP tools that wrap the React UI's "Export Excel" and "Adv. Taxletter PDF"
// buttons. Each tool calls the existing HTTP route, captures the file, stores
// it in S3 under SOHO/mcp-exports/, and returns a 1-hour presigned download
// URL. Cowork then attaches the file to its Gmail reply (or hands the URL
// to the user) — no manual download step.
import { registerTool } from "../registry";
import { McpToolError } from "../errors";
import { uploadFile, createPresignedDownloadUrl } from "../../object-storage";
import { db } from "../../db";
import {
  taxCalculations,
  taxCalculationItems,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { internalAuthHeader } from "../audit-attribution";

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

    const resp = await fetch(`${BASE}/api/tax-calculation/calculations/${id}/export/excel`, {
      headers: await internalAuthHeader(),
    });
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
    "button modal). Auto-fills both TAXES (USD totals × rate, rounded UP to next " +
    "5,000 TL; stamp tax fixed at 5,000 TL) and EXPENSES (4 fixed, insurance " +
    "computed with 500 TL ceiling, 3 historical with 5,000 TL ceiling). Calls the " +
    "app's GET /default-expenses endpoint so React UI and Cowork use identical " +
    "rules. International Transportation (navlun) is NOT included by default — " +
    "pass include_international_transportation:true ONLY when the user explicitly " +
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

    // 1. Compute taxes_tl
    //    Caller override path: use values as-is (no ceil).
    //    Auto path: sum per-item × rate, then CEIL each to next 5,000 TL.
    //    Stamp tax is FIXED at 5,000 TL (CNCxSOHO convention).
    const ceil5k = (n: number) => (n > 0 ? Math.ceil(n / 5000) * 5000 : 0);
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
        customsTax: ceil5k(cu * rate),
        additionalTax: ceil5k(ad * rate),
        kkdf: ceil5k(kk * rate),
        vat: ceil5k(va * rate),
        stampTax: 5000,
      };
    }

    // 2. Resolve expenses.
    //    If caller passes `expenses`, that's a full override (replaces auto rules).
    //    Otherwise we fetch from the app's GET /default-expenses endpoint —
    //    SINGLE SOURCE OF TRUTH for the standard CNCxSOHO rules. Both this MCP
    //    tool AND the React modal call the same endpoint.
    let expensesList: { type: string; amount: number; id?: string }[];
    let expensesSource: "caller_override" | "auto_defaults" = "auto_defaults";
    let historicalMetadata: any = null;
    if (Array.isArray(args.expenses)) {
      expensesSource = "caller_override";
      expensesList = args.expenses.map((e: any, i: number) => ({
        type: String(e.type),
        amount: parseFloat(String(e.amount ?? 0)),
        id: String(i + 1),
      }));
    } else {
      const includeNavlun = args.include_international_transportation === true;
      const defaultsResp = await fetch(
        `${BASE}/api/tax-calculation/calculations/${id}/default-expenses` +
          (includeNavlun ? "?include_international_transportation=true" : ""),
        { headers: await internalAuthHeader() },
      );
      if (!defaultsResp.ok) {
        throw new McpToolError(
          `Failed to fetch default expenses: HTTP ${defaultsResp.status} ${(await defaultsResp.text()).slice(0, 200)}`,
        );
      }
      const defaultsData: any = await defaultsResp.json();
      expensesList = (defaultsData?.expenses ?? [])
        .filter((e: any) => parseFloat(String(e.amount ?? 0)) > 0)
        .map((e: any, i: number) => ({
          id: String(i + 1),
          type: String(e.type),
          amount: parseFloat(String(e.amount)),
        }));
      historicalMetadata = defaultsData?.metadata ?? null;
    }

    const totalExpenses = expensesList.reduce((s, e) => s + e.amount, 0);
    const totalTax = taxesTl.customsTax + taxesTl.additionalTax + taxesTl.kkdf + taxesTl.vat + taxesTl.stampTax;
    const grandTotal = totalTax + totalExpenses;

    // 3. POST to the existing route
    const resp = await fetch(`${BASE}/api/tax-calculation/calculations/${id}/export/adv-taxletter`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await internalAuthHeader()) },
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
        defaults_metadata: historicalMetadata,
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
