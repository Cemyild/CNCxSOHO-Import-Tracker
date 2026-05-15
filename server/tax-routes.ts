import express from 'express';
import { storage } from './storage';
import { pool } from './db';

const router = express.Router();

// Whitelist of tax category column names — used to safely interpolate column identifiers
// (parameter placeholders cannot stand in for identifiers in PostgreSQL).
const VALID_TAX_CATEGORIES = ['customs_tax', 'additional_customs_tax', 'kkdf', 'vat', 'stamp_tax', 'total'] as const;
type TaxCategory = typeof VALID_TAX_CATEGORIES[number];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ISO week number — Monday-anchored, matching /api/expenses/trend
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function periodKeyForDate(date: Date, groupBy: 'week' | 'month'): { key: string; sortDate: Date } {
  if (groupBy === 'week') {
    const { year, week } = getISOWeek(date);
    // Sort date = Monday of the ISO week
    const monday = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    return { key: `Week ${week}, ${year}`, sortDate: monday };
  }
  const year = date.getFullYear();
  const month = date.getMonth();
  return {
    key: date.toLocaleString('default', { month: 'long', year: 'numeric' }),
    sortDate: new Date(year, month, 1),
  };
}

// Tax analytics endpoint
router.get('/taxes/analytics', async (req, res) => {
  try {
    const { startDate, endDate, procedureRefs } = req.query;

    console.log('[/api/taxes/analytics] Request query params:', { startDate, endDate, procedureRefs });

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    if (typeof startDate !== 'string' || typeof endDate !== 'string' ||
        !DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) {
      return res.status(400).json({ message: 'Invalid date format (expected YYYY-MM-DD)' });
    }

    // Parse procedure references if provided
    let procedureReferences: string[] | undefined;
    if (procedureRefs && typeof procedureRefs === 'string') {
      procedureReferences = procedureRefs.split(',').map((s) => s.trim()).filter(Boolean);
    }

    // 1. Get procedures in date range (parameterized)
    const procParams: any[] = [startDate, endDate];
    let proceduresQuery = `
      SELECT reference
      FROM procedures
      WHERE import_dec_date::date BETWEEN $1::date AND $2::date
    `;

    if (procedureReferences && procedureReferences.length > 0) {
      const placeholders = procedureReferences.map((_, i) => `$${i + 3}`).join(',');
      proceduresQuery += ` AND reference IN (${placeholders})`;
      procParams.push(...procedureReferences);
    }

    const proceduresResult = await pool.query(proceduresQuery, procParams);
    const procedures = proceduresResult.rows || [];

    if (procedures.length === 0) {
      return res.json({ data: [] });
    }

    // 2. Tax data — parameterized IN clause
    const refsList = procedures.map((p) => p.reference);
    const refPlaceholders = refsList.map((_, i) => `$${i + 1}`).join(',');

    const taxQuery = `
      WITH tax_data AS (
        SELECT 'customs_tax' AS category, customs_tax AS amount
          FROM taxes WHERE procedure_reference IN (${refPlaceholders}) AND customs_tax > 0
        UNION ALL
        SELECT 'additional_customs_tax', additional_customs_tax
          FROM taxes WHERE procedure_reference IN (${refPlaceholders}) AND additional_customs_tax > 0
        UNION ALL
        SELECT 'kkdf', kkdf
          FROM taxes WHERE procedure_reference IN (${refPlaceholders}) AND kkdf > 0
        UNION ALL
        SELECT 'vat', vat
          FROM taxes WHERE procedure_reference IN (${refPlaceholders}) AND vat > 0
        UNION ALL
        SELECT 'stamp_tax', stamp_tax
          FROM taxes WHERE procedure_reference IN (${refPlaceholders}) AND stamp_tax > 0
      )
      SELECT category, SUM(amount) AS "totalAmount", COUNT(*) AS count
      FROM tax_data
      GROUP BY category
      ORDER BY "totalAmount" DESC
    `;

    // The query references the IN list 5 times — pg reuses the same $N params, so we pass them once
    const taxResult = await pool.query(taxQuery, refsList);
    // pg returns numeric/bigint as strings; coerce so the client doesn't end up string-concatenating
    const data = (taxResult.rows || []).map((row: any) => ({
      category: row.category,
      totalAmount: parseFloat(row.totalAmount ?? '0') || 0,
      count: parseInt(row.count ?? '0', 10) || 0,
    }));
    res.json({ data });
  } catch (error) {
    console.error('[/api/taxes/analytics] Error:', error);
    res.status(500).json({
      message: 'Failed to fetch tax analytics data',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Tax trend endpoint — filtered by date range
router.get('/taxes/trend', async (req, res) => {
  try {
    const { category, startDate, endDate, groupBy } = req.query;

    if (!category || !startDate || !endDate) {
      return res.status(400).json({
        message: 'Category, start date, and end date are required',
        params: { category, startDate, endDate },
      });
    }

    if (typeof startDate !== 'string' || typeof endDate !== 'string' ||
        !DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) {
      return res.status(400).json({ message: 'Invalid date format (expected YYYY-MM-DD)' });
    }

    const taxCategory = String(category);
    if (!VALID_TAX_CATEGORIES.includes(taxCategory as TaxCategory)) {
      return res.status(400).json({ message: 'Invalid tax category', valid: VALID_TAX_CATEGORIES });
    }

    const proceduresResult = await pool.query(
      `SELECT reference FROM procedures
       WHERE import_dec_date::date BETWEEN $1::date AND $2::date
       ORDER BY import_dec_date`,
      [startDate, endDate],
    );
    const procedures = proceduresResult.rows || [];
    if (procedures.length === 0) return res.json({ data: [] });

    const refsList = procedures.map((p) => p.reference);
    const placeholders = refsList.map((_, i) => `$${i + 1}`).join(',');

    let taxQuery: string;
    if (taxCategory === 'total') {
      taxQuery = `
        SELECT (COALESCE(t.customs_tax, 0) + COALESCE(t.additional_customs_tax, 0) +
                COALESCE(t.kkdf, 0) + COALESCE(t.vat, 0) + COALESCE(t.stamp_tax, 0)) AS amount,
               p.import_dec_date AS date
        FROM taxes t
        JOIN procedures p ON t.procedure_reference = p.reference
        WHERE t.procedure_reference IN (${placeholders})
        ORDER BY p.import_dec_date
      `;
    } else {
      // taxCategory is whitelisted above, safe to interpolate as identifier
      taxQuery = `
        SELECT t.${taxCategory} AS amount, p.import_dec_date AS date
        FROM taxes t
        JOIN procedures p ON t.procedure_reference = p.reference
        WHERE t.procedure_reference IN (${placeholders}) AND t.${taxCategory} > 0
        ORDER BY p.import_dec_date
      `;
    }

    const taxResult = await pool.query(taxQuery, refsList);
    res.json({ data: groupTaxRecords(taxResult.rows, groupBy === 'month' ? 'month' : 'week') });
  } catch (error) {
    console.error('[Trend API] Error:', error);
    res.status(500).json({
      message: 'Failed to fetch tax trend data',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Tax trend endpoint — full history (no date filter)
router.get('/taxes/trend-all', async (req, res) => {
  try {
    const { category, groupBy } = req.query;
    if (!category) return res.status(400).json({ message: 'Category is required' });

    const taxCategory = String(category);
    if (!VALID_TAX_CATEGORIES.includes(taxCategory as TaxCategory)) {
      return res.status(400).json({ message: 'Invalid tax category', valid: VALID_TAX_CATEGORIES });
    }

    let taxQuery: string;
    if (taxCategory === 'total') {
      taxQuery = `
        SELECT (COALESCE(t.customs_tax, 0) + COALESCE(t.additional_customs_tax, 0) +
                COALESCE(t.kkdf, 0) + COALESCE(t.vat, 0) + COALESCE(t.stamp_tax, 0)) AS amount,
               p.import_dec_date AS date
        FROM taxes t
        JOIN procedures p ON t.procedure_reference = p.reference
        ORDER BY p.import_dec_date
      `;
    } else {
      taxQuery = `
        SELECT t.${taxCategory} AS amount, p.import_dec_date AS date
        FROM taxes t
        JOIN procedures p ON t.procedure_reference = p.reference
        WHERE t.${taxCategory} > 0
        ORDER BY p.import_dec_date
      `;
    }

    const taxResult = await pool.query(taxQuery);
    res.json({ data: groupTaxRecords(taxResult.rows, groupBy === 'month' ? 'month' : 'week') });
  } catch (error) {
    console.error('[Trend All API] Error:', error);
    res.status(500).json({
      message: 'Failed to fetch complete tax trend data',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Bucket tax records into week/month periods with chronologically sortable rawDate
function groupTaxRecords(
  records: Array<{ amount: any; date: any }>,
  groupBy: 'week' | 'month',
): Array<{ period: string; amount: number; rawDate: string }> {
  const buckets = new Map<string, { amount: number; sortDate: Date }>();

  for (const record of records) {
    if (!record.date) continue;
    const date = new Date(record.date);
    if (isNaN(date.getTime())) continue;

    const { key, sortDate } = periodKeyForDate(date, groupBy);
    const existing = buckets.get(key);
    const amt = parseFloat(record.amount ?? '0') || 0;
    if (existing) {
      existing.amount += amt;
    } else {
      buckets.set(key, { amount: amt, sortDate });
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[1].sortDate.getTime() - b[1].sortDate.getTime())
    .map(([period, { amount, sortDate }]) => ({
      period,
      amount,
      rawDate: sortDate.toISOString(),
    }));
}

export default router;
