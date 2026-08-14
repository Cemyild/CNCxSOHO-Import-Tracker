import { rawDb } from "./db";
import { OFFSET_TOLERANCE, round2 } from "./offset-engine";

export interface OffsetCandidate {
  reference: string;
  shipper: string | null;
  paymentStatus: string | null;
  /** Positive = owes money, negative = overpaid. */
  balance: number;
}

export interface CandidateFilter {
  shipper?: string;
  /** Closed procedures take part by default (product decision, 2026-08-06). */
  includeClosed?: boolean;
}

export interface CandidateResult {
  overpayments: OffsetCandidate[];
  debts: OffsetCandidate[];
  totalOverpayment: number;
  totalDebt: number;
  /**
   * Procedures holding money but with no expenses, service invoices or taxes
   * recorded yet. Their balance looks like an overpayment but the cost side
   * simply has not been entered, so they are kept out of offsetting. Reported
   * rather than silently dropped.
   */
  uncosted: { count: number; amount: number };
}

/**
 * Every procedure's balance in one query.
 *
 * Mirrors storage.calculateFinancialSummary (server/storage.ts:2253):
 *   balance = expenses + service invoices + taxes - payments - distributions
 * That function issues ~5 queries per procedure; at 185 procedures it would
 * blow past the 60s proxy_read_timeout in front of the app.
 */
export const PROCEDURE_BALANCE_SQL = `
  WITH exp AS (
    SELECT procedure_reference AS ref, SUM(amount::numeric) AS v
    FROM import_expenses GROUP BY 1
  ), svc AS (
    SELECT procedure_reference AS ref, SUM(amount::numeric) AS v
    FROM import_service_invoices GROUP BY 1
  ), tx AS (
    SELECT procedure_reference AS ref,
           SUM(COALESCE(customs_tax::numeric, 0)
             + COALESCE(additional_customs_tax::numeric, 0)
             + COALESCE(kkdf::numeric, 0)
             + COALESCE(vat::numeric, 0)
             + COALESCE(stamp_tax::numeric, 0)) AS v
    FROM taxes GROUP BY 1
  ), pay AS (
    SELECT procedure_reference AS ref, SUM(amount::numeric) AS v
    FROM payments GROUP BY 1
  ), dist AS (
    SELECT procedure_reference AS ref, SUM(distributed_amount::numeric) AS v
    FROM payment_distributions GROUP BY 1
  )
  SELECT p.reference,
         p.shipper,
         p.payment_status::text AS payment_status,
         ROUND(COALESCE(exp.v, 0) + COALESCE(svc.v, 0) + COALESCE(tx.v, 0), 2)
           AS total_expenses,
         ROUND(
           (COALESCE(exp.v, 0) + COALESCE(svc.v, 0) + COALESCE(tx.v, 0))
           - (COALESCE(pay.v, 0) + COALESCE(dist.v, 0)), 2
         ) AS balance
  FROM procedures p
  LEFT JOIN exp  ON exp.ref  = p.reference
  LEFT JOIN svc  ON svc.ref  = p.reference
  LEFT JOIN tx   ON tx.ref   = p.reference
  LEFT JOIN pay  ON pay.ref  = p.reference
  LEFT JOIN dist ON dist.ref = p.reference
`;

export async function getOffsetCandidates(
  filter: CandidateFilter = {},
): Promise<CandidateResult> {
  const { rows } = await rawDb.query(PROCEDURE_BALANCE_SQL);

  const visible = rows
    .map((r: any) => ({
      reference: r.reference as string,
      shipper: (r.shipper ?? null) as string | null,
      paymentStatus: (r.payment_status ?? null) as string | null,
      balance: round2(Number(r.balance ?? 0)),
      totalExpenses: round2(Number(r.total_expenses ?? 0)),
    }))
    .filter((c) => (filter.shipper ? c.shipper === filter.shipper : true))
    .filter((c) =>
      filter.includeClosed === false ? c.paymentStatus !== "closed" : true,
    );

  // A procedure that has taken money but has no cost side recorded yet is not
  // overpaid — its expenses and taxes simply have not been entered. Offsetting
  // that money would leave the procedure in debt the moment they are.
  const uncostedRows = visible.filter(
    (c) => c.totalExpenses <= 0 && -c.balance > OFFSET_TOLERANCE,
  );
  const uncostedReferences = new Set(uncostedRows.map((c) => c.reference));

  const candidates: OffsetCandidate[] = visible
    .filter((c) => !uncostedReferences.has(c.reference))
    .map(({ totalExpenses, ...candidate }) => candidate);

  const overpayments = candidates
    .filter((c) => -c.balance > OFFSET_TOLERANCE)
    .sort((a, b) => a.balance - b.balance);

  const debts = candidates
    .filter((c) => c.balance > OFFSET_TOLERANCE)
    .sort((a, b) => b.balance - a.balance);

  return {
    overpayments,
    debts,
    totalOverpayment: round2(
      overpayments.reduce((sum, c) => sum + Math.abs(c.balance), 0),
    ),
    totalDebt: round2(debts.reduce((sum, c) => sum + c.balance, 0)),
    uncosted: {
      count: uncostedRows.length,
      amount: round2(
        uncostedRows.reduce((sum, c) => sum + Math.abs(c.balance), 0),
      ),
    },
  };
}
