// server/expense-defaults-service.ts
// Single source of truth for the Adv. Taxletter expense defaults. Used by
// BOTH the React modal (via GET /api/tax-calculation/calculations/:id/default-expenses)
// AND the MCP export_adv_taxletter tool.
//
// Rules (CNCxSOHO standard):
//   FIXED:
//     • Export Registry Fee           1,500 TL
//     • Awb Fee                       5,000 TL
//     • Bonded Warehouse Storage Fee 40,000 TL
//     • Tareks Fee                    2,500 TL
//   COMPUTED FROM CALC:
//     • Insurance: ceil(calc.insurance_cost × rate / 500) × 500  (500 TL kademe)
//   HISTORICAL (per-USD-of-invoice from this year's closed USD procedures,
//     rounded UP to next 5,000 TL):
//     • Airport Storage Fee
//     • Transportation
//     • Service Invoice (if > 0)
//   OPT-IN:
//     • International Transportation: calc.transport_cost × rate
//
// Caching: per-(category, year) rate cache, 1-hour TTL.

import { rawDb } from "./db";
import { storage } from "./storage";

export interface DefaultExpense {
  id: string;
  type: string;
  amount: number;
  source: "fixed" | "computed" | "historical" | "opt-in";
  rule?: string;
}

export interface DefaultExpensesResult {
  expenses: DefaultExpense[];
  metadata: {
    tax_calculation_id: number;
    reference: string | null;
    invoice_usd: number;
    insurance_source_usd: number;
    currency_rate: number;
    historical_year: number;
    historical_rates: Record<
      string,
      { rate_tl_per_usd: number; sample_procedures: number; from_cache: boolean }
    >;
    international_transportation_included: boolean;
  };
}

const RATE_CACHE_TTL_MS = 60 * 60 * 1000;
const rateCache = new Map<string, { rate: number; sampleSize: number; fetchedAt: number }>();

async function getHistoricalRate(
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

const ceilTo = (n: number, step: number) => (n > 0 ? Math.ceil(n / step) * step : 0);

export async function computeDefaultExpenses(
  taxCalculationId: number,
  opts: { includeInternationalTransportation?: boolean } = {},
): Promise<DefaultExpensesResult> {
  const calculation = await storage.getTaxCalculation(taxCalculationId);
  if (!calculation) {
    throw new Error(`tax_calculation_id ${taxCalculationId} not found`);
  }

  const rate = parseFloat((calculation as any).currency_rate ?? "0");
  const invoiceUsd = parseFloat((calculation as any).total_value ?? "0");
  const insuranceUsd = parseFloat((calculation as any).insurance_cost ?? "0");

  // Insurance: ceil to 500
  const insuranceTl = insuranceUsd > 0 && rate > 0 ? ceilTo(insuranceUsd * rate, 500) : 0;

  // Historical rates (3 categories, cached)
  const year = new Date().getFullYear();
  const [airportRate, transportRate, serviceRate] = await Promise.all([
    getHistoricalRate({ kind: "expense", category: "airport_storage_fee" }, year),
    getHistoricalRate({ kind: "expense", category: "transportation" }, year),
    getHistoricalRate({ kind: "service" }, year),
  ]);

  // Round UP to nearest 5,000 TL
  const airportTl = ceilTo(invoiceUsd * airportRate.rate, 5000);
  const transportTl = ceilTo(invoiceUsd * transportRate.rate, 5000);
  const serviceTl = ceilTo(invoiceUsd * serviceRate.rate, 5000);

  // International Transportation (opt-in)
  const includeNavlun = opts.includeInternationalTransportation === true;
  const navlunUsd = parseFloat((calculation as any).transport_cost ?? "0");
  const intlTransportTl =
    includeNavlun && navlunUsd > 0 && rate > 0 ? Math.round(navlunUsd * rate) : 0;

  const expenses: DefaultExpense[] = [
    { id: "1", type: "Export Registry Fee", amount: 1500, source: "fixed" },
    {
      id: "2",
      type: "Insurance",
      amount: insuranceTl,
      source: "computed",
      rule: `ceil(${insuranceUsd.toFixed(2)} USD × ${rate.toFixed(4)} / 500) × 500`,
    },
    { id: "3", type: "Awb Fee", amount: 5000, source: "fixed" },
    { id: "4", type: "Bonded Warehouse Storage Fee", amount: 40000, source: "fixed" },
    { id: "5", type: "Tareks Fee", amount: 2500, source: "fixed" },
    {
      id: "6",
      type: "Airport Storage Fee",
      amount: airportTl,
      source: "historical",
      rule: `ceil(${airportRate.rate.toFixed(4)} × ${invoiceUsd.toFixed(2)} USD / 5000) × 5000`,
    },
    {
      id: "7",
      type: "Transportation",
      amount: transportTl,
      source: "historical",
      rule: `ceil(${transportRate.rate.toFixed(4)} × ${invoiceUsd.toFixed(2)} USD / 5000) × 5000`,
    },
  ];

  if (serviceTl > 0) {
    expenses.push({
      id: "8",
      type: "Service Invoice",
      amount: serviceTl,
      source: "historical",
      rule: `ceil(${serviceRate.rate.toFixed(4)} × ${invoiceUsd.toFixed(2)} USD / 5000) × 5000`,
    });
  }

  if (intlTransportTl > 0) {
    expenses.push({
      id: String(expenses.length + 1),
      type: "International Transportation",
      amount: intlTransportTl,
      source: "opt-in",
      rule: `${navlunUsd.toFixed(2)} USD × ${rate.toFixed(4)}`,
    });
  }

  return {
    expenses,
    metadata: {
      tax_calculation_id: taxCalculationId,
      reference: (calculation as any).reference ?? null,
      invoice_usd: invoiceUsd,
      insurance_source_usd: insuranceUsd,
      currency_rate: rate,
      historical_year: year,
      historical_rates: {
        airport_storage_fee: {
          rate_tl_per_usd: airportRate.rate,
          sample_procedures: airportRate.sampleSize,
          from_cache: airportRate.fromCache,
        },
        transportation: {
          rate_tl_per_usd: transportRate.rate,
          sample_procedures: transportRate.sampleSize,
          from_cache: transportRate.fromCache,
        },
        service_invoice: {
          rate_tl_per_usd: serviceRate.rate,
          sample_procedures: serviceRate.sampleSize,
          from_cache: serviceRate.fromCache,
        },
      },
      international_transportation_included: includeNavlun && intlTransportTl > 0,
    },
  };
}
