// server/ai-ask-tools.ts
// Tool definitions + drizzle implementations for the "Ask CNC?" Q&A endpoint.
// Claude calls these via tool-use to gather the data it needs to answer
// natural-language questions about procedures, taxes, expenses, payments,
// products, and Turkish HS codes.

import { and, eq, gte, lte, ilike, isNotNull, sql, desc, asc, inArray, or } from "drizzle-orm";
import { db } from "./db";
import {
  procedures,
  taxes,
  importExpenses,
  importServiceInvoices,
  payments,
  paymentDistributions,
  products,
  hsCodes,
} from "@shared/schema";

// ── Tool schemas (sent to Anthropic) ─────────────────────────────────────────
//
// Date filters: all fields here use the "YYYY-MM-DD" text representation that
// the database actually stores. The model resolves natural-language periods
// (e.g. "Ocak 2026") into start_date/end_date before calling.

const DATE = { type: 'string', description: "YYYY-MM-DD" };

export const TOOL_SCHEMAS = [
  {
    name: 'query_procedures',
    description:
      'Query the procedures table (imports). Filter by date, shipper, status, currency. ' +
      'Returns aggregate counts/sums and optionally a list. Date field defaults to arrival_date. ' +
      'For per-month / per-year breakdowns set group_by.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: DATE,
        end_date: DATE,
        date_field: {
          type: 'string',
          enum: ['invoice_date', 'arrival_date', 'import_dec_date', 'created_at'],
          description: 'Which date column to filter on. Default: arrival_date.',
        },
        shipper_contains: { type: 'string', description: 'Case-insensitive substring match on shipper name.' },
        reference_prefix: { type: 'string', description: 'e.g. "CNCALO" or "CNCSOHO".' },
        shipment_status: { type: 'string' },
        payment_status: { type: 'string' },
        document_status: { type: 'string' },
        currency: { type: 'string', description: 'e.g. USD, EUR, TL.' },
        group_by: { type: 'string', enum: ['shipper', 'currency', 'month', 'year', 'shipment_status', 'payment_status'] },
        list_limit: { type: 'integer', description: 'If set, also return up to N matching procedure rows.' },
      },
    },
  },
  {
    name: 'query_taxes',
    description:
      'Query the taxes table (one row per procedure). Returns sums of customs_tax, additional_customs_tax, ' +
      'kkdf, vat, stamp_tax. Joins to procedures to filter by date / shipper. Use group_by for trends, ' +
      'or list_limit to return per-procedure tax rows.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: DATE,
        end_date: DATE,
        date_field: { type: 'string', enum: ['invoice_date', 'arrival_date', 'import_dec_date'] },
        shipper_contains: { type: 'string' },
        reference_prefix: { type: 'string' },
        group_by: { type: 'string', enum: ['shipper', 'month', 'year'] },
        list_limit: { type: 'integer', description: 'If set, also return up to N per-procedure tax rows (max 200).' },
      },
    },
  },
  {
    name: 'query_expenses',
    description:
      'Query importExpenses (categorized fees: AWB, insurance, transport, customs inspection, etc.) ' +
      'and optionally importServiceInvoices (CNC service fees) together. Filter by category, issuer, ' +
      'date, currency. Use list_limit to return individual expense rows with date/invoice/issuer/amount. ' +
      'IMPORTANT: amounts in different currencies cannot be summed — always filter by a single currency ' +
      'OR use group_by:"currency" when reporting totals.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: DATE,
        end_date: DATE,
        category: {
          type: 'string',
          enum: ['export_registry_fee','insurance','awb_fee','airport_storage_fee','bonded_warehouse_storage_fee',
                 'transportation','international_transportation','tareks_fee','customs_inspection','azo_test','other'],
        },
        issuer_contains: { type: 'string', description: 'Vendor name substring. Matched case-insensitively against BOTH the issuer column AND the notes column, since vendor names are often recorded in notes (e.g. "THY Ardiye") rather than the issuer field. If 0 rows match, do NOT silently retry without this filter — report 0 to the user.' },
        reference_prefix: { type: 'string' },
        currency: { type: 'string', description: 'Filter to a single currency (e.g. TL, USD, EUR). Recommended whenever you report a total.' },
        include_service_invoices: { type: 'boolean', description: 'Also include CNC service-invoice totals. Default false.' },
        group_by: { type: 'string', enum: ['category', 'issuer', 'month', 'year', 'currency'] },
        list_limit: { type: 'integer', description: 'If set, return up to N matching expense rows (max 200) with date, invoice number, issuer, amount, currency, procedure reference, notes. Use this whenever the user asks for a list / breakdown / details.' },
      },
    },
  },
  {
    name: 'query_payments',
    description:
      'Query payments (legacy) + paymentDistributions (new). Returns sums by payment_type ' +
      '(advance/balance) and optionally per period. Use list_limit to return individual payment rows. ' +
      'NOTE: payments table itself has no currency column — currency lives on the parent procedure row, ' +
      'so payment totals across procedures of different currencies cannot be cleanly summed.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: DATE,
        end_date: DATE,
        payment_type: { type: 'string', enum: ['advance', 'balance'] },
        reference_prefix: { type: 'string' },
        group_by: { type: 'string', enum: ['type', 'month', 'year'] },
        list_limit: { type: 'integer', description: 'If set, return up to N payment rows (max 200) with date, amount, type, procedure reference, notes.' },
      },
    },
  },
  {
    name: 'query_products',
    description: 'Look up products by style / brand / category / hts / country. Returns count and list.',
    input_schema: {
      type: 'object',
      properties: {
        style_contains: { type: 'string' },
        brand: { type: 'string' },
        category_contains: { type: 'string' },
        hts_code_prefix: { type: 'string' },
        tr_hs_code_prefix: { type: 'string' },
        country_of_origin: { type: 'string' },
        has_tr_hs_code: { type: 'boolean', description: 'true=only products WITH a tr_hs_code; false=only WITHOUT.' },
        list_limit: { type: 'integer', description: 'Default 50.' },
      },
    },
  },
  {
    name: 'query_hs_codes',
    description:
      'Look up Turkish HS codes with their tax rates and special requirements ' +
      '(EX REGISTRY FORM, AZO DYE TEST, SPECIAL CUSTOM). Useful for "what tax rate for HS X?", ' +
      '"which codes need azo test?", etc.',
    input_schema: {
      type: 'object',
      properties: {
        tr_hs_code_prefix: { type: 'string' },
        description_contains: { type: 'string' },
        ex_registry_form: { type: 'boolean' },
        azo_dye_test: { type: 'boolean' },
        special_custom: { type: 'boolean' },
        list_limit: { type: 'integer', description: 'Default 25.' },
      },
    },
  },
  {
    name: 'query_time_series',
    description:
      'Generic time-series for charts. Aggregates a metric per period (month/year/day) over a date range. ' +
      'Always returns rows ordered chronologically.',
    input_schema: {
      type: 'object',
      required: ['source', 'metric', 'granularity', 'start_date', 'end_date'],
      properties: {
        source: { type: 'string', enum: ['procedures', 'taxes', 'expenses', 'payments'] },
        metric: {
          type: 'string',
          enum: ['count', 'amount', 'customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax', 'total_tax', 'expense_total', 'payment_total'],
        },
        granularity: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
        start_date: DATE,
        end_date: DATE,
        date_field: { type: 'string', enum: ['invoice_date', 'arrival_date', 'import_dec_date', 'invoiceDate', 'paymentDate'] },
        shipper_contains: { type: 'string' },
        reference_prefix: { type: 'string' },
      },
    },
  },
  {
    name: 'present_answer',
    description:
      'FINAL tool — call this exactly once when you have enough data to respond. ' +
      'Pass the user-facing answer text plus any tables/charts you want rendered. ' +
      'After you call this the conversation ends.',
    input_schema: {
      type: 'object',
      required: ['answer'],
      properties: {
        answer: {
          type: 'string',
          description: 'Markdown answer in the user\'s language. Be concise — 1-3 short paragraphs.',
        },
        blocks: {
          type: 'array',
          description: 'Optional structured blocks rendered below the text answer.',
          items: {
            oneOf: [
              {
                type: 'object',
                required: ['type', 'headers', 'rows'],
                properties: {
                  type: { type: 'string', enum: ['table'] },
                  title: { type: 'string' },
                  headers: { type: 'array', items: { type: 'string' } },
                  rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } } },
                },
              },
              {
                type: 'object',
                required: ['type', 'chart_type', 'data'],
                properties: {
                  type: { type: 'string', enum: ['chart'] },
                  title: { type: 'string' },
                  chart_type: { type: 'string', enum: ['bar', 'line'] },
                  x_label: { type: 'string' },
                  y_label: { type: 'string' },
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['name', 'value'],
                      properties: {
                        name: { type: 'string' },
                        value: { type: 'number' },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) ? n : 0;
};

const pickDateField = (input: any, defaultField: any) => input?.date_field ?? defaultField;

function dateBetweenSql(field: any, start?: string, end?: string) {
  const conds: any[] = [isNotNull(field)];
  if (start) conds.push(gte(field, start));
  if (end) conds.push(lte(field, end));
  return conds;
}

// PostgreSQL TO_CHAR for grouping text-stored YYYY-MM-DD dates
function toMonth(field: any) { return sql<string>`SUBSTRING(${field}, 1, 7)`; }      // 'YYYY-MM'
function toYear(field: any) { return sql<string>`SUBSTRING(${field}, 1, 4)`; }       // 'YYYY'
function toDay(field: any)  { return sql<string>`SUBSTRING(${field}, 1, 10)`; }      // 'YYYY-MM-DD'

// ── Tool implementations ────────────────────────────────────────────────────

export async function runQueryProcedures(input: any): Promise<any> {
  const dateField =
    pickDateField(input, 'arrival_date') === 'created_at'
      ? procedures.createdAt
      : (procedures as any)[pickDateField(input, 'arrival_date')];

  const where = and(
    ...dateBetweenSql(dateField, input.start_date, input.end_date),
    input.shipper_contains ? ilike(procedures.shipper, `%${input.shipper_contains}%`) : undefined,
    input.reference_prefix ? ilike(procedures.reference, `${input.reference_prefix}%`) : undefined,
    input.shipment_status ? eq((procedures as any).shipment_status, input.shipment_status) : undefined,
    input.payment_status ? eq((procedures as any).payment_status, input.payment_status) : undefined,
    input.document_status ? eq((procedures as any).document_status, input.document_status) : undefined,
    input.currency ? eq(procedures.currency, input.currency) : undefined,
  );

  // Aggregate
  const aggRow = await db.select({
    count: sql<number>`COUNT(*)::int`,
    total_amount: sql<string>`COALESCE(SUM(${procedures.amount}), 0)::text`,
    total_pieces: sql<string>`COALESCE(SUM(${(procedures as any).piece}), 0)::text`,
    total_kg: sql<string>`COALESCE(SUM(${(procedures as any).kg}), 0)::text`,
  }).from(procedures).where(where);

  const result: any = {
    count: aggRow[0]?.count ?? 0,
    total_amount: num(aggRow[0]?.total_amount),
    total_pieces: num(aggRow[0]?.total_pieces),
    total_kg: num(aggRow[0]?.total_kg),
  };

  // Group by
  if (input.group_by) {
    const dateColForGroup =
      pickDateField(input, 'arrival_date') === 'created_at'
        ? procedures.createdAt
        : (procedures as any)[pickDateField(input, 'arrival_date')];

    let groupExpr: any;
    if (input.group_by === 'shipper') groupExpr = procedures.shipper;
    else if (input.group_by === 'currency') groupExpr = procedures.currency;
    else if (input.group_by === 'shipment_status') groupExpr = (procedures as any).shipment_status;
    else if (input.group_by === 'payment_status') groupExpr = (procedures as any).payment_status;
    else if (input.group_by === 'month') groupExpr = toMonth(dateColForGroup);
    else if (input.group_by === 'year') groupExpr = toYear(dateColForGroup);
    else groupExpr = procedures.shipper;

    const groups = await db.select({
      key: sql<string>`COALESCE(${groupExpr}::text, '(empty)')`,
      count: sql<number>`COUNT(*)::int`,
      total_amount: sql<string>`COALESCE(SUM(${procedures.amount}), 0)::text`,
    })
      .from(procedures)
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    result.groups = groups.map(g => ({ key: g.key, count: g.count, total_amount: num(g.total_amount) }));
  }

  // List
  if (input.list_limit && input.list_limit > 0) {
    const items = await db.select({
      reference: procedures.reference,
      shipper: procedures.shipper,
      invoice_no: procedures.invoice_no,
      invoice_date: procedures.invoice_date,
      arrival_date: (procedures as any).arrival_date,
      amount: procedures.amount,
      currency: procedures.currency,
      piece: (procedures as any).piece,
      shipment_status: (procedures as any).shipment_status,
      payment_status: (procedures as any).payment_status,
    })
      .from(procedures)
      .where(where)
      .orderBy(desc(dateField))
      .limit(Math.min(input.list_limit, 200));
    result.items = items;
  }

  return result;
}

export async function runQueryTaxes(input: any): Promise<any> {
  // Need to join to procedures for date/shipper filtering
  const dateField = pickDateField(input, 'arrival_date');
  const procDate = (procedures as any)[dateField] ?? (procedures as any).arrival_date;

  const where = and(
    ...dateBetweenSql(procDate, input.start_date, input.end_date),
    input.shipper_contains ? ilike(procedures.shipper, `%${input.shipper_contains}%`) : undefined,
    input.reference_prefix ? ilike(procedures.reference, `${input.reference_prefix}%`) : undefined,
  );

  const aggRow = await db
    .select({
      count: sql<number>`COUNT(DISTINCT ${procedures.reference})::int`,
      customs_tax: sql<string>`COALESCE(SUM(${(taxes as any).customsTax}), 0)::text`,
      additional_customs_tax: sql<string>`COALESCE(SUM(${(taxes as any).additionalCustomsTax}), 0)::text`,
      kkdf: sql<string>`COALESCE(SUM(${taxes.kkdf}), 0)::text`,
      vat: sql<string>`COALESCE(SUM(${taxes.vat}), 0)::text`,
      stamp_tax: sql<string>`COALESCE(SUM(${(taxes as any).stampTax}), 0)::text`,
    })
    .from(taxes)
    .innerJoin(procedures, eq((taxes as any).procedureReference, procedures.reference))
    .where(where);

  const r = aggRow[0];
  const result: any = {
    count_procedures: r?.count ?? 0,
    total_customs_tax: num(r?.customs_tax),
    total_additional_customs_tax: num(r?.additional_customs_tax),
    total_kkdf: num(r?.kkdf),
    total_vat: num(r?.vat),
    total_stamp_tax: num(r?.stamp_tax),
  };
  result.total_tax = result.total_customs_tax + result.total_additional_customs_tax
                   + result.total_kkdf + result.total_vat + result.total_stamp_tax;

  if (input.group_by) {
    let groupExpr: any;
    if (input.group_by === 'shipper') groupExpr = procedures.shipper;
    else if (input.group_by === 'month') groupExpr = toMonth(procDate);
    else if (input.group_by === 'year') groupExpr = toYear(procDate);
    else groupExpr = procedures.shipper;

    const groups = await db
      .select({
        key: sql<string>`COALESCE(${groupExpr}::text, '(empty)')`,
        count: sql<number>`COUNT(DISTINCT ${procedures.reference})::int`,
        customs_tax: sql<string>`COALESCE(SUM(${(taxes as any).customsTax}), 0)::text`,
        additional_customs_tax: sql<string>`COALESCE(SUM(${(taxes as any).additionalCustomsTax}), 0)::text`,
        kkdf: sql<string>`COALESCE(SUM(${taxes.kkdf}), 0)::text`,
        vat: sql<string>`COALESCE(SUM(${taxes.vat}), 0)::text`,
        stamp_tax: sql<string>`COALESCE(SUM(${(taxes as any).stampTax}), 0)::text`,
      })
      .from(taxes)
      .innerJoin(procedures, eq((taxes as any).procedureReference, procedures.reference))
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    result.groups = groups.map(g => {
      const row: any = {
        key: g.key,
        count: g.count,
        customs_tax: num(g.customs_tax),
        additional_customs_tax: num(g.additional_customs_tax),
        kkdf: num(g.kkdf),
        vat: num(g.vat),
        stamp_tax: num(g.stamp_tax),
      };
      row.total_tax = row.customs_tax + row.additional_customs_tax + row.kkdf + row.vat + row.stamp_tax;
      return row;
    });
  }

  if (input.list_limit && input.list_limit > 0) {
    const items = await db
      .select({
        procedure_reference: (taxes as any).procedureReference,
        shipper: procedures.shipper,
        invoice_no: procedures.invoice_no,
        invoice_date: procedures.invoice_date,
        arrival_date: (procedures as any).arrival_date,
        import_dec_date: (procedures as any).import_dec_date,
        customs_tax: (taxes as any).customsTax,
        additional_customs_tax: (taxes as any).additionalCustomsTax,
        kkdf: taxes.kkdf,
        vat: taxes.vat,
        stamp_tax: (taxes as any).stampTax,
      })
      .from(taxes)
      .innerJoin(procedures, eq((taxes as any).procedureReference, procedures.reference))
      .where(where)
      .orderBy(desc(procDate))
      .limit(Math.min(input.list_limit, 200));
    result.items = items;
  }

  return result;
}

export async function runQueryExpenses(input: any): Promise<any> {
  const expDateField = (importExpenses as any).invoiceDate;
  const where = and(
    ...dateBetweenSql(expDateField, input.start_date, input.end_date),
    input.category ? eq(importExpenses.category, input.category as any) : undefined,
    input.issuer_contains
      ? or(
          ilike((importExpenses as any).issuer, `%${input.issuer_contains}%`),
          ilike((importExpenses as any).notes, `%${input.issuer_contains}%`),
        )
      : undefined,
    input.reference_prefix ? ilike((importExpenses as any).procedureReference, `${input.reference_prefix}%`) : undefined,
    input.currency ? eq((importExpenses as any).currency, input.currency) : undefined,
  );

  const aggRow = await db.select({
    count: sql<number>`COUNT(*)::int`,
    total: sql<string>`COALESCE(SUM(${importExpenses.amount}), 0)::text`,
  }).from(importExpenses).where(where);

  const result: any = {
    expense_count: aggRow[0]?.count ?? 0,
    expense_total: num(aggRow[0]?.total),
  };

  // Always also break down by currency so callers can see whether totals mix currencies.
  // (Summing across currencies is meaningless — caller should report per-currency.)
  const currencyRows = await db.select({
    key: sql<string>`COALESCE(${(importExpenses as any).currency}::text, '(empty)')`,
    count: sql<number>`COUNT(*)::int`,
    total: sql<string>`COALESCE(SUM(${importExpenses.amount}), 0)::text`,
  })
    .from(importExpenses)
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  result.totals_by_currency = currencyRows.map(g => ({
    currency: g.key, count: g.count, total: num(g.total),
  }));

  if (input.include_service_invoices) {
    const svcDateField = (importServiceInvoices as any).date;
    const svcWhere = and(
      ...dateBetweenSql(svcDateField, input.start_date, input.end_date),
      input.reference_prefix ? ilike((importServiceInvoices as any).procedureReference, `${input.reference_prefix}%`) : undefined,
      input.currency ? eq((importServiceInvoices as any).currency, input.currency) : undefined,
    );
    const svcRow = await db.select({
      count: sql<number>`COUNT(*)::int`,
      total: sql<string>`COALESCE(SUM(${importServiceInvoices.amount}), 0)::text`,
    }).from(importServiceInvoices).where(svcWhere);
    result.service_invoice_count = svcRow[0]?.count ?? 0;
    result.service_invoice_total = num(svcRow[0]?.total);
    result.combined_total = result.expense_total + result.service_invoice_total;
  }

  if (input.group_by) {
    let groupExpr: any;
    if (input.group_by === 'category') groupExpr = importExpenses.category;
    else if (input.group_by === 'issuer') groupExpr = (importExpenses as any).issuer;
    else if (input.group_by === 'month') groupExpr = toMonth(expDateField);
    else if (input.group_by === 'year') groupExpr = toYear(expDateField);
    else if (input.group_by === 'currency') groupExpr = (importExpenses as any).currency;

    const groups = await db.select({
      key: sql<string>`COALESCE(${groupExpr}::text, '(empty)')`,
      count: sql<number>`COUNT(*)::int`,
      total: sql<string>`COALESCE(SUM(${importExpenses.amount}), 0)::text`,
    })
      .from(importExpenses)
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    result.groups = groups.map(g => ({ key: g.key, count: g.count, total: num(g.total) }));
  }

  if (input.list_limit && input.list_limit > 0) {
    const items = await db.select({
      id: importExpenses.id,
      procedure_reference: (importExpenses as any).procedureReference,
      category: importExpenses.category,
      amount: importExpenses.amount,
      currency: (importExpenses as any).currency,
      invoice_number: (importExpenses as any).invoiceNumber,
      invoice_date: (importExpenses as any).invoiceDate,
      issuer: (importExpenses as any).issuer,
      document_number: (importExpenses as any).documentNumber,
      policy_number: (importExpenses as any).policyNumber,
      notes: (importExpenses as any).notes,
    })
      .from(importExpenses)
      .where(where)
      .orderBy(desc(expDateField))
      .limit(Math.min(input.list_limit, 200));
    result.items = items;
  }

  return result;
}

export async function runQueryPayments(input: any): Promise<any> {
  const payDateField = (payments as any).paymentDate;
  // payments table (legacy)
  const where = and(
    ...dateBetweenSql(payDateField, input.start_date, input.end_date),
    input.payment_type ? eq((payments as any).paymentType, input.payment_type as any) : undefined,
    input.reference_prefix ? ilike((payments as any).procedureReference, `${input.reference_prefix}%`) : undefined,
  );

  const aggRow = await db.select({
    count: sql<number>`COUNT(*)::int`,
    total: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
  }).from(payments).where(where);

  // distributions table (newer)
  const distRow = await db.select({
    count: sql<number>`COUNT(*)::int`,
    total: sql<string>`COALESCE(SUM(${(paymentDistributions as any).distributedAmount}), 0)::text`,
  }).from(paymentDistributions).where(and(
    input.payment_type ? eq((paymentDistributions as any).paymentType, input.payment_type as any) : undefined,
    input.reference_prefix ? ilike((paymentDistributions as any).procedureReference, `${input.reference_prefix}%`) : undefined,
  ));

  const result: any = {
    legacy_payment_count: aggRow[0]?.count ?? 0,
    legacy_payment_total: num(aggRow[0]?.total),
    distribution_count: distRow[0]?.count ?? 0,
    distribution_total: num(distRow[0]?.total),
    grand_total: num(aggRow[0]?.total) + num(distRow[0]?.total),
  };

  if (input.group_by) {
    let groupExpr: any;
    if (input.group_by === 'type') groupExpr = (payments as any).paymentType;
    else if (input.group_by === 'month') groupExpr = toMonth(payDateField);
    else if (input.group_by === 'year') groupExpr = toYear(payDateField);

    if (groupExpr) {
      const groups = await db.select({
        key: sql<string>`COALESCE(${groupExpr}::text, '(empty)')`,
        count: sql<number>`COUNT(*)::int`,
        total: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
      }).from(payments).where(where).groupBy(sql`1`).orderBy(sql`1`);
      result.groups = groups.map(t => ({ key: t.key, count: t.count, total: num(t.total) }));
    }
  }

  if (input.list_limit && input.list_limit > 0) {
    const items = await db.select({
      id: payments.id,
      procedure_reference: (payments as any).procedureReference,
      payment_date: (payments as any).paymentDate,
      payment_type: (payments as any).paymentType,
      amount: payments.amount,
      notes: (payments as any).notes,
    })
      .from(payments)
      .where(where)
      .orderBy(desc(payDateField))
      .limit(Math.min(input.list_limit, 200));
    result.items = items;
  }

  return result;
}

export async function runQueryProducts(input: any): Promise<any> {
  const where = and(
    input.style_contains ? ilike(products.style, `%${input.style_contains}%`) : undefined,
    input.brand ? ilike(products.brand, `%${input.brand}%`) : undefined,
    input.category_contains ? ilike(products.category, `%${input.category_contains}%`) : undefined,
    input.hts_code_prefix ? ilike(products.hts_code, `${input.hts_code_prefix}%`) : undefined,
    input.tr_hs_code_prefix ? ilike(products.tr_hs_code, `${input.tr_hs_code_prefix}%`) : undefined,
    input.country_of_origin ? eq(products.country_of_origin, input.country_of_origin) : undefined,
    input.has_tr_hs_code === true ? isNotNull(products.tr_hs_code) : undefined,
    input.has_tr_hs_code === false ? sql`${products.tr_hs_code} IS NULL` : undefined,
  );

  const countRow = await db.select({ count: sql<number>`COUNT(*)::int` }).from(products).where(where);
  const limit = Math.min(input.list_limit ?? 50, 200);
  const items = await db.select().from(products).where(where).orderBy(asc(products.style)).limit(limit);
  return { count: countRow[0]?.count ?? 0, items };
}

export async function runQueryHsCodes(input: any): Promise<any> {
  const where = and(
    input.tr_hs_code_prefix ? ilike(hsCodes.tr_hs_code, `${input.tr_hs_code_prefix}%`) : undefined,
    input.description_contains ? ilike((hsCodes as any).description_tr, `%${input.description_contains}%`) : undefined,
    input.ex_registry_form !== undefined ? eq((hsCodes as any).ex_registry_form, input.ex_registry_form) : undefined,
    input.azo_dye_test !== undefined ? eq((hsCodes as any).azo_dye_test, input.azo_dye_test) : undefined,
    input.special_custom !== undefined ? eq((hsCodes as any).special_custom, input.special_custom) : undefined,
  );

  const countRow = await db.select({ count: sql<number>`COUNT(*)::int` }).from(hsCodes).where(where);
  const limit = Math.min(input.list_limit ?? 25, 200);
  const items = await db.select().from(hsCodes).where(where).orderBy(asc(hsCodes.tr_hs_code)).limit(limit);
  return { count: countRow[0]?.count ?? 0, items };
}

export async function runQueryTimeSeries(input: any): Promise<any> {
  const { source, metric, granularity, start_date, end_date } = input;

  const granularityFn = granularity === 'year' ? toYear : granularity === 'day' ? toDay : toMonth;
  // 'week' isn't trivial in text dates; fold to day for now.

  if (source === 'procedures') {
    const dateField = (procedures as any)[input.date_field ?? 'arrival_date'] ?? (procedures as any).arrival_date;
    const where = and(
      ...dateBetweenSql(dateField, start_date, end_date),
      input.shipper_contains ? ilike(procedures.shipper, `%${input.shipper_contains}%`) : undefined,
      input.reference_prefix ? ilike(procedures.reference, `${input.reference_prefix}%`) : undefined,
    );
    const valueExpr =
      metric === 'count'
        ? sql<string>`COUNT(*)::text`
        : sql<string>`COALESCE(SUM(${procedures.amount}), 0)::text`;
    const rows = await db.select({
      period: granularityFn(dateField),
      value: valueExpr,
    }).from(procedures).where(where).groupBy(sql`1`).orderBy(sql`1`);
    return { source, metric, granularity, series: rows.map(r => ({ period: r.period, value: num(r.value) })) };
  }

  if (source === 'taxes') {
    const dateField = (procedures as any)[input.date_field ?? 'arrival_date'] ?? (procedures as any).arrival_date;
    const where = and(
      ...dateBetweenSql(dateField, start_date, end_date),
      input.shipper_contains ? ilike(procedures.shipper, `%${input.shipper_contains}%`) : undefined,
      input.reference_prefix ? ilike(procedures.reference, `${input.reference_prefix}%`) : undefined,
    );
    const valueCol =
      metric === 'customs_tax' ? (taxes as any).customsTax
      : metric === 'additional_customs_tax' ? (taxes as any).additionalCustomsTax
      : metric === 'kkdf' ? taxes.kkdf
      : metric === 'vat' ? taxes.vat
      : metric === 'stamp_tax' ? (taxes as any).stampTax
      : sql<number>`(${(taxes as any).customsTax} + ${(taxes as any).additionalCustomsTax} + ${taxes.kkdf} + ${taxes.vat} + ${(taxes as any).stampTax})`;
    const rows = await db.select({
      period: granularityFn(dateField),
      value: sql<string>`COALESCE(SUM(${valueCol}), 0)::text`,
    })
      .from(taxes)
      .innerJoin(procedures, eq((taxes as any).procedureReference, procedures.reference))
      .where(where).groupBy(sql`1`).orderBy(sql`1`);
    return { source, metric, granularity, series: rows.map(r => ({ period: r.period, value: num(r.value) })) };
  }

  if (source === 'expenses') {
    const dateField = (importExpenses as any).invoiceDate;
    const where = and(
      ...dateBetweenSql(dateField, start_date, end_date),
      input.reference_prefix ? ilike((importExpenses as any).procedureReference, `${input.reference_prefix}%`) : undefined,
    );
    const rows = await db.select({
      period: granularityFn(dateField),
      value: sql<string>`COALESCE(SUM(${importExpenses.amount}), 0)::text`,
    }).from(importExpenses).where(where).groupBy(sql`1`).orderBy(sql`1`);
    return { source, metric, granularity, series: rows.map(r => ({ period: r.period, value: num(r.value) })) };
  }

  if (source === 'payments') {
    const dateField = (payments as any).paymentDate;
    const where = and(
      ...dateBetweenSql(dateField, start_date, end_date),
      input.reference_prefix ? ilike((payments as any).procedureReference, `${input.reference_prefix}%`) : undefined,
    );
    const rows = await db.select({
      period: granularityFn(dateField),
      value: sql<string>`COALESCE(SUM(${payments.amount}), 0)::text`,
    }).from(payments).where(where).groupBy(sql`1`).orderBy(sql`1`);
    return { source, metric, granularity, series: rows.map(r => ({ period: r.period, value: num(r.value) })) };
  }

  return { source, metric, granularity, series: [] };
}

// Tool dispatcher
export async function runTool(name: string, input: any): Promise<any> {
  switch (name) {
    case 'query_procedures':   return await runQueryProcedures(input);
    case 'query_taxes':        return await runQueryTaxes(input);
    case 'query_expenses':     return await runQueryExpenses(input);
    case 'query_payments':     return await runQueryPayments(input);
    case 'query_products':     return await runQueryProducts(input);
    case 'query_hs_codes':     return await runQueryHsCodes(input);
    case 'query_time_series':  return await runQueryTimeSeries(input);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
