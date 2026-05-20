// server/mcp/tools/storage-estimate.ts
//
// Estimates the Storage Cost (USD) for a new tax_calculation's form input,
// using this year's closed USD procedures as the historical sample.
//
// Formula (Cem's spec, asked NOT to be re-prompted on):
//   1. For every closed USD procedure with a positive amount this year:
//        invoice_usd   = procedure.amount (counted exactly ONCE per procedure)
//        expense_tl    = SUM of all import_expenses rows with
//                        category='airport_storage_fee' for that procedure,
//                        normalised to TL (USD * usdtl_rate where currency='USD').
//      A single procedure can have 2-3 airport storage fees; the invoice value
//      is still counted once. The CTE-based query handles this via per-procedure
//      aggregation before the global SUM.
//   2. rate_tl_per_usd  = SUM(expense_tl) / SUM(invoice_usd)
//   3. estimated_tl     = invoice_total_usd * rate_tl_per_usd
//   4. estimated_usd    = estimated_tl / usdtl_rate
//   5. recommended_usd  = estimated_usd + 1000   ← Cem's safety buffer
//
// The tax-calculation form Storage Cost field expects USD, so the tool returns
// the USD figure plus the +1000 buffer pre-applied as `recommended_usd`. Cowork
// types that value straight into the form — no more "what should storage be?"
// questions.

import { registerTool } from "../registry";
import { rawDb } from "../../db";
import { McpToolError } from "../errors";

registerTool({
  name: "read_storage_cost_estimate",
  tier: "read",
  description:
    "Estimate the Storage Cost (USD) for a new tax_calculation form, based on this year's closed USD procedures' airport_storage_fee expenses. Returns the rate, raw estimate, and the recommended value (estimate + 1000 USD safety buffer per CNCxSOHO standard). Cowork should type recommended_usd directly into the form.",
  inputSchema: {
    type: "object",
    properties: {
      invoice_total_usd: {
        type: "number",
        description: "Total invoice value in USD (the value being typed into the tax-calculation form's Invoice Total field).",
      },
      usdtl_rate: {
        type: "number",
        description: "TCMB USD/TL rate being used for this calculation (the value being typed into the form's USD/TL field).",
      },
      year: {
        type: "integer",
        description: "Year to sample historical procedures from. Defaults to the current year.",
      },
    },
    required: ["invoice_total_usd", "usdtl_rate"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const invoiceUsd = Number(args.invoice_total_usd);
    const usdtlRate = Number(args.usdtl_rate);
    const year = Number.isInteger(args.year) ? args.year : new Date().getFullYear();

    if (!Number.isFinite(invoiceUsd) || invoiceUsd <= 0) {
      throw new McpToolError(`invoice_total_usd must be a positive number, got ${args.invoice_total_usd}`);
    }
    if (!Number.isFinite(usdtlRate) || usdtlRate <= 0) {
      throw new McpToolError(`usdtl_rate must be a positive number, got ${args.usdtl_rate}`);
    }

    // CTE pattern mirrored from server/expense-defaults-service.ts so the
    // Adv. Taxletter modal and this tool give consistent rates.
    const query = `
      WITH closed_procs AS (
        SELECT reference, amount, usdtl_rate
        FROM procedures
        WHERE shipment_status = 'closed'
          AND currency = 'USD'
          AND amount::numeric > 0
          AND EXTRACT(YEAR FROM arrival_date::date) = $1
      ),
      per_proc AS (
        SELECT cp.reference,
               cp.amount::numeric AS invoice_usd,
               COALESCE(SUM(
                 CASE
                   WHEN ie.currency IN ('TL','TRY') OR ie.currency IS NULL THEN ie.amount::numeric
                   WHEN ie.currency = 'USD' THEN ie.amount::numeric * COALESCE(cp.usdtl_rate::numeric, 0)
                   ELSE 0
                 END
               ), 0) AS expense_tl
        FROM closed_procs cp
        LEFT JOIN import_expenses ie
          ON ie.procedure_reference = cp.reference
          AND ie.category = 'airport_storage_fee'
        GROUP BY cp.reference, cp.amount, cp.usdtl_rate
      )
      SELECT COUNT(*)::int            AS proc_count,
             COALESCE(SUM(invoice_usd), 0)::float AS total_invoice_usd,
             COALESCE(SUM(expense_tl), 0)::float  AS total_expense_tl
      FROM per_proc
    `;
    const result = await rawDb.query(query, [year]);
    const row = result.rows?.[0];
    const procCount = Number(row?.proc_count ?? 0);
    const totalInvoiceUsd = Number(row?.total_invoice_usd ?? 0);
    const totalExpenseTl = Number(row?.total_expense_tl ?? 0);

    if (totalInvoiceUsd <= 0) {
      throw new McpToolError(
        `No closed USD procedures with positive amount found for year ${year}. Cannot compute storage rate.`,
      );
    }

    const rateTlPerUsd = totalExpenseTl / totalInvoiceUsd;
    const estimatedTl = invoiceUsd * rateTlPerUsd;
    const estimatedUsd = estimatedTl / usdtlRate;
    const recommendedUsd = Math.round(estimatedUsd + 1000); // +1000 USD buffer, rounded

    return {
      data: {
        year,
        sample_procedures: procCount,
        rate_tl_per_usd: rateTlPerUsd,
        estimated_tl: estimatedTl,
        estimated_usd: estimatedUsd,
        recommended_usd: recommendedUsd,
        formula: `(${invoiceUsd.toFixed(2)} USD × ${rateTlPerUsd.toFixed(4)} TL/USD) ÷ ${usdtlRate} = ${estimatedUsd.toFixed(2)} USD → +1000 buffer → ${recommendedUsd} USD`,
      },
      meta: {
        summary: `Storage Cost recommended: $${recommendedUsd} (rate ${rateTlPerUsd.toFixed(4)} TL/USD over ${procCount} closed USD procedures in ${year})`,
      },
    };
  },
});
