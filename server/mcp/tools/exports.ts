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
  importExpenses,
  importServiceInvoices,
  procedures as proceduresTable,
} from "@shared/schema";
import { eq } from "drizzle-orm";

const PORT = process.env.PORT || "5000";
const BASE = `http://127.0.0.1:${PORT}`;

// Map expense_category enum → display labels used by the Adv. Taxletter modal.
const EXPENSE_TYPE_LABEL: Record<string, string> = {
  export_registry_fee: "Export Registry Fee",
  insurance: "Insurance",
  awb_fee: "Awb Fee",
  airport_storage_fee: "Airport Storage Fee",
  bonded_warehouse_storage_fee: "Bonded Warehouse Storage Fee",
  transportation: "Transportation",
  international_transportation: "International Transportation",
  tareks_fee: "Tareks Fee",
  customs_inspection: "Customs Inspection",
  azo_test: "Azo Test",
  other: "Other",
};

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
// Auto-aggregates the procedure's importExpenses + importServiceInvoices if
// the caller doesn't pass an explicit `expenses` array. Auto-computes the
// taxes_tl from per-item calculation totals × currency_rate if not given.
// ---------------------------------------------------------------------------
registerTool({
  name: "export_adv_taxletter",
  tier: "ai",
  description:
    "Generate the Advance Taxletter PDF (same as the React UI's 'Adv. Taxletter' " +
    "button modal). Auto-fills tax values from the calculation (TL) and pulls " +
    "import expenses from the procedure unless the caller overrides. Returns a " +
    "1-hour presigned download URL for Cowork to attach. " +
    "PREREQUISITE: the procedure must have all import expenses (transport, " +
    "insurance, customs broker fees etc.) already recorded — use " +
    "write_create_import_expense to add any missing ones first.",
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
      expenses: {
        type: "array",
        description: "Override expense list. If omitted, auto-pulled from importExpenses + importServiceInvoices for the procedure.",
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

    // 2. Resolve expenses (caller override OR auto-pull from procedure)
    let expensesList: { type: string; amount: number; id?: string }[];
    if (Array.isArray(args.expenses)) {
      expensesList = args.expenses.map((e: any, i: number) => ({
        type: String(e.type),
        amount: parseFloat(String(e.amount ?? 0)),
        id: String(i + 1),
      }));
    } else if (calc.reference) {
      // Pull all importExpenses + importServiceInvoices for the procedure reference.
      const expRows = await db
        .select()
        .from(importExpenses)
        .where(eq((importExpenses as any).procedureReference, calc.reference));
      const svcRows = await db
        .select()
        .from(importServiceInvoices)
        .where(eq((importServiceInvoices as any).procedureReference, calc.reference));

      expensesList = [];
      let idx = 0;
      for (const e of expRows as any[]) {
        const label = EXPENSE_TYPE_LABEL[String(e.category ?? "other")] ?? "Other";
        const amount = parseFloat(e.amount ?? "0");
        if (amount > 0) {
          expensesList.push({ id: String(++idx), type: label, amount });
        }
      }
      for (const s of svcRows as any[]) {
        const amount = parseFloat(s.amount ?? "0");
        if (amount > 0) {
          expensesList.push({ id: String(++idx), type: "Service Invoice", amount });
        }
      }
    } else {
      expensesList = [];
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
