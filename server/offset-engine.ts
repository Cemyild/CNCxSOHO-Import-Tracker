/**
 * Pure matching engine for cross-procedure payment offsetting.
 * Knows nothing about the database — give it balances, it gives back moves.
 */

/** Balances at or below this (in TL) are noise and never take part. */
export const OFFSET_TOLERANCE = 1;

/** Comparison epsilon for kurus-level arithmetic. */
export const CENT_EPSILON = 0.005;

export interface OffsetParty {
  reference: string;
  /** Always positive: how much this procedure has spare, or how much it owes. */
  amount: number;
}

export interface OffsetMove {
  fromReference: string;
  toReference: string;
  amount: number;
}

export interface MatchResult {
  moves: OffsetMove[];
  /** Debts that end up fully closed by this plan. */
  closedDebts: string[];
  /** Debts left untouched because no combination could close them in full. */
  unmatchedDebts: string[];
  usedAmount: number;
  remainingOverpayment: number;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Spend the available overpayments so that as many debts as possible are
 * closed *in full*. Debts are considered smallest-first — that is what
 * maximises the count. A debt that cannot be closed completely is skipped
 * entirely; automatic mode never leaves a half-paid procedure behind.
 */
export function matchOffsets(
  overpayments: OffsetParty[],
  debts: OffsetParty[],
): MatchResult {
  const sources = overpayments
    .filter((o) => o.amount > OFFSET_TOLERANCE)
    .map((o) => ({ reference: o.reference, left: o.amount }))
    .sort((a, b) => b.left - a.left || a.reference.localeCompare(b.reference));

  const targets = debts
    .filter((d) => d.amount > OFFSET_TOLERANCE)
    .map((d) => ({ reference: d.reference, left: d.amount }))
    .sort((a, b) => a.left - b.left || a.reference.localeCompare(b.reference));

  const moves: OffsetMove[] = [];
  const closedDebts: string[] = [];
  const unmatchedDebts: string[] = [];

  for (const target of targets) {
    const available = sources.reduce((sum, s) => sum + s.left, 0);
    if (available + CENT_EPSILON < target.left) {
      unmatchedDebts.push(target.reference);
      continue;
    }

    for (const source of sources) {
      if (target.left <= CENT_EPSILON) break;
      if (source.left <= CENT_EPSILON) continue;

      const amount = round2(Math.min(source.left, target.left));
      source.left = round2(source.left - amount);
      target.left = round2(target.left - amount);
      moves.push({
        fromReference: source.reference,
        toReference: target.reference,
        amount,
      });
    }

    closedDebts.push(target.reference);
  }

  const usedAmount = round2(moves.reduce((sum, m) => sum + m.amount, 0));
  const remainingOverpayment = round2(
    sources.reduce((sum, s) => sum + s.left, 0),
  );

  return { moves, closedDebts, unmatchedDebts, usedAmount, remainingOverpayment };
}
