import { randomUUID } from "crypto";
import { eq, sql as drizzleSql } from "drizzle-orm";
import { rawDb, db } from "./db";
import { paymentOffsets, paymentDistributions } from "@shared/schema";
import {
  OFFSET_TOLERANCE,
  CENT_EPSILON,
  round2,
  matchOffsets,
  planSourceConsumption,
  type OffsetMove,
  type SourceBucket,
} from "./offset-engine";

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

export interface OffsetPlan {
  moves: OffsetMove[];
  closedDebts: string[];
  unmatchedDebts: string[];
  usedAmount: number;
  remainingOverpayment: number;
}

export class OffsetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffsetValidationError";
  }
}

/** Runs the engine over current balances. Writes nothing. */
export async function previewOffsets(
  filter: CandidateFilter = {},
): Promise<OffsetPlan> {
  const { overpayments, debts } = await getOffsetCandidates(filter);

  return matchOffsets(
    overpayments.map((c) => ({ reference: c.reference, amount: -c.balance })),
    debts.map((c) => ({ reference: c.reference, amount: c.balance })),
  );
}

/** Anything that can run a query — the pool wrapper or a transaction. */
type Executor = { execute: (query: any) => Promise<any> };

function resultRows(result: any): any[] {
  return (result?.rows ?? result ?? []) as any[];
}

/**
 * Net usable amount per incoming payment for one procedure. Offset rows are
 * negative, so summing per payment already nets out earlier transfers.
 */
async function readSourceBuckets(
  executor: Executor,
  reference: string,
): Promise<SourceBucket[]> {
  const result = await executor.execute(drizzleSql`
    SELECT incoming_payment_id,
           payment_type::text AS payment_type,
           SUM(distributed_amount::numeric) AS net_amount,
           MAX(distribution_date) AS last_date,
           MAX(id) AS last_id
    FROM payment_distributions
    WHERE procedure_reference = ${reference}
    GROUP BY incoming_payment_id, payment_type
    HAVING SUM(distributed_amount::numeric) > 0
  `);

  return resultRows(result).map((r) => ({
    incomingPaymentId: Number(r.incoming_payment_id),
    paymentType: r.payment_type === "advance" ? "advance" : "balance",
    available: round2(Number(r.net_amount)),
    lastDate: new Date(r.last_date),
    lastId: Number(r.last_id),
  }));
}

/**
 * One procedure's balance and cost side, read inside the same transaction that
 * is about to write. The cost side matters: a procedure with nothing recorded
 * yet is not overpaid, it is simply uncalculated (see spec decision 6). The
 * candidate list already hides those, but a request could name one directly.
 */
async function readBalanceAndCost(
  executor: Executor,
  reference: string,
): Promise<{ balance: number; totalExpenses: number }> {
  const result = await executor.execute(drizzleSql`
    ${drizzleSql.raw(PROCEDURE_BALANCE_SQL)} WHERE p.reference = ${reference}
  `);

  const rows = resultRows(result);
  if (rows.length === 0) {
    throw new OffsetValidationError(`Procedure ${reference} not found`);
  }

  return {
    balance: round2(Number(rows[0].balance ?? 0)),
    totalExpenses: round2(Number(rows[0].total_expenses ?? 0)),
  };
}

/** Recompute an incoming payment's distributed/remaining/status fields. */
async function refreshIncomingPayment(
  executor: Executor,
  incomingPaymentId: number,
): Promise<void> {
  await executor.execute(drizzleSql`
    UPDATE incoming_payments ip
    SET amount_distributed = agg.total,
        remaining_balance  = GREATEST(0, ip.total_amount::numeric - agg.total),
        distribution_status = CASE
          WHEN agg.total <= 0 THEN 'pending_distribution'::distribution_status
          WHEN ABS(ip.total_amount::numeric - agg.total) < 0.01
            THEN 'fully_distributed'::distribution_status
          ELSE 'partially_distributed'::distribution_status
        END,
        updated_at = NOW()
    FROM (
      SELECT COALESCE(SUM(distributed_amount::numeric), 0) AS total
      FROM payment_distributions
      WHERE incoming_payment_id = ${incomingPaymentId}
    ) agg
    WHERE ip.id = ${incomingPaymentId}
  `);
}

/**
 * Write the transfers. All or nothing: one transaction, balances re-checked
 * inside it, so a stale preview can never overdraw a source.
 */
export async function applyOffsets(
  moves: OffsetMove[],
  userId: number,
  mode: "auto" | "manual",
): Promise<{ batchId: string; offsetIds: number[]; applied: number }> {
  if (moves.length === 0) {
    throw new OffsetValidationError("No moves to apply");
  }

  const batchId = randomUUID();
  const offsetIds: number[] = [];

  await db.transaction(async (tx) => {
    // Aggregate per source so several moves from one procedure are validated
    // against its balance together, not one by one.
    const requestedBySource = new Map<string, number>();
    for (const move of moves) {
      if (!Number.isFinite(move.amount) || move.amount <= 0) {
        throw new OffsetValidationError(
          `Transfer amount must be positive (${move.fromReference} → ${move.toReference})`,
        );
      }
      if (move.fromReference === move.toReference) {
        throw new OffsetValidationError(
          `Cannot offset ${move.fromReference} against itself`,
        );
      }
      requestedBySource.set(
        move.fromReference,
        round2((requestedBySource.get(move.fromReference) ?? 0) + move.amount),
      );
    }

    for (const [reference, requested] of requestedBySource) {
      const { balance, totalExpenses } = await readBalanceAndCost(tx as any, reference);

      if (totalExpenses <= 0) {
        throw new OffsetValidationError(
          `${reference} has no expenses recorded yet — its balance is not an overpayment`,
        );
      }

      const availableNow = round2(-balance);
      if (availableNow + CENT_EPSILON < requested) {
        throw new OffsetValidationError(
          `${reference} has ${availableNow.toFixed(2)} available but ${requested.toFixed(2)} was requested`,
        );
      }
    }

    const touchedPayments = new Set<number>();

    for (const move of moves) {
      const [offset] = await tx
        .insert(paymentOffsets)
        .values({
          batchId,
          fromReference: move.fromReference,
          toReference: move.toReference,
          amount: move.amount.toFixed(2),
          offsetDate: new Date(),
          mode,
          createdBy: userId,
        })
        .returning();

      offsetIds.push(offset.id);

      const buckets = await readSourceBuckets(tx as any, move.fromReference);
      const slices = planSourceConsumption(buckets, move.amount);

      for (const slice of slices) {
        await tx.insert(paymentDistributions).values({
          incomingPaymentId: slice.incomingPaymentId,
          procedureReference: move.fromReference,
          distributedAmount: (-slice.amount).toFixed(2),
          distributionDate: new Date(),
          paymentType: slice.paymentType,
          offsetId: offset.id,
          createdBy: userId,
        });

        await tx.insert(paymentDistributions).values({
          incomingPaymentId: slice.incomingPaymentId,
          procedureReference: move.toReference,
          distributedAmount: slice.amount.toFixed(2),
          distributionDate: new Date(),
          paymentType: "balance",
          offsetId: offset.id,
          createdBy: userId,
        });

        touchedPayments.add(slice.incomingPaymentId);
      }
    }

    for (const paymentId of touchedPayments) {
      await refreshIncomingPayment(tx as any, paymentId);
    }
  });

  return { batchId, offsetIds, applied: moves.length };
}

export interface OffsetHistoryEntry {
  id: number;
  batchId: string;
  fromReference: string;
  toReference: string;
  amount: number;
  offsetDate: Date;
  mode: string;
  createdBy: number | null;
  createdByName: string | null;
  reversedAt: Date | null;
}

export async function getOffsetHistory(): Promise<OffsetHistoryEntry[]> {
  const { rows } = await rawDb.query(`
    SELECT o.id, o.batch_id, o.from_reference, o.to_reference, o.amount,
           o.offset_date, o.mode, o.created_by, u.username AS created_by_name,
           o.reversed_at
    FROM payment_offsets o
    LEFT JOIN users u ON u.id = o.created_by
    ORDER BY o.offset_date DESC, o.id DESC
  `);

  return rows.map((r: any) => ({
    id: Number(r.id),
    batchId: r.batch_id as string,
    fromReference: r.from_reference as string,
    toReference: r.to_reference as string,
    amount: round2(Number(r.amount)),
    offsetDate: new Date(r.offset_date),
    mode: r.mode as string,
    createdBy: r.created_by === null ? null : Number(r.created_by),
    createdByName: (r.created_by_name ?? null) as string | null,
    reversedAt: r.reversed_at === null ? null : new Date(r.reversed_at),
  }));
}

/**
 * Delete both halves of one transfer and mark its ledger row reversed.
 * Returns the incoming payments that need refreshing — the caller does that
 * once at the end, so reversing a batch touches each payment a single time.
 */
async function reverseOffsetInTx(
  tx: any,
  offsetId: number,
  userId: number,
): Promise<Set<number>> {
  const [offset] = await tx
    .select()
    .from(paymentOffsets)
    .where(eq(paymentOffsets.id, offsetId));

  if (!offset) {
    throw new OffsetValidationError(`Offset ${offsetId} not found`);
  }
  if (offset.reversedAt) {
    throw new OffsetValidationError(`Offset ${offsetId} is already reversed`);
  }

  const linked = await tx
    .select()
    .from(paymentDistributions)
    .where(eq(paymentDistributions.offsetId, offsetId));

  // The money must still be sitting on the target. If it has since been
  // offset onwards, undoing this one would push the target's distribution
  // total below zero — refuse and let the later transfer be undone first.
  const incomingOnTarget = new Map<number, number>();
  for (const row of linked) {
    const amount = Number(row.distributedAmount);
    if (amount > 0 && row.procedureReference === offset.toReference) {
      incomingOnTarget.set(
        row.incomingPaymentId,
        round2((incomingOnTarget.get(row.incomingPaymentId) ?? 0) + amount),
      );
    }
  }

  if (incomingOnTarget.size > 0) {
    const available = new Map(
      (await readSourceBuckets(tx, offset.toReference)).map((b) => [
        b.incomingPaymentId,
        b.available,
      ]),
    );

    for (const [incomingPaymentId, amount] of incomingOnTarget) {
      const left = available.get(incomingPaymentId) ?? 0;
      if (left + CENT_EPSILON < amount) {
        throw new OffsetValidationError(
          `${offset.toReference} no longer holds the ${amount.toFixed(2)} from this transfer — undo the later offset first`,
        );
      }
    }
  }

  await tx
    .delete(paymentDistributions)
    .where(eq(paymentDistributions.offsetId, offsetId));

  await tx
    .update(paymentOffsets)
    .set({ reversedAt: new Date(), reversedBy: userId })
    .where(eq(paymentOffsets.id, offsetId));

  return new Set<number>(linked.map((d: any) => Number(d.incomingPaymentId)));
}

export async function reverseOffset(
  offsetId: number,
  userId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const touched = await reverseOffsetInTx(tx, offsetId, userId);
    for (const paymentId of touched) {
      await refreshIncomingPayment(tx as any, paymentId);
    }
  });
}

/** Undo every open transfer of a batch, all inside one transaction. */
export async function reverseBatch(
  batchId: string,
  userId: number,
): Promise<{ reversed: number }> {
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(paymentOffsets)
      .where(eq(paymentOffsets.batchId, batchId));

    const open = rows.filter((o) => !o.reversedAt);
    if (open.length === 0) {
      throw new OffsetValidationError(
        `Batch ${batchId} has nothing left to reverse`,
      );
    }

    const touched = new Set<number>();
    // Newest first: a later transfer inside the batch may depend on an
    // earlier one, and undoing it first keeps every balance non-negative.
    for (const offset of [...open].sort((a, b) => b.id - a.id)) {
      for (const paymentId of await reverseOffsetInTx(tx, offset.id, userId)) {
        touched.add(paymentId);
      }
    }

    for (const paymentId of touched) {
      await refreshIncomingPayment(tx as any, paymentId);
    }

    return { reversed: open.length };
  });
}
