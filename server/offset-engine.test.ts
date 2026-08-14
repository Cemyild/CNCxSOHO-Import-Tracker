import { describe, it, expect } from "vitest";
import {
  matchOffsets,
  round2,
  OFFSET_TOLERANCE,
  planSourceConsumption,
  InsufficientSourceError,
  type SourceBucket,
} from "./offset-engine";

describe("matchOffsets", () => {
  it("closes every debt when the overpayment covers all of them", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 100 }],
      [{ reference: "X", amount: 30 }, { reference: "Y", amount: 20 }],
    );

    expect(result.closedDebts.sort()).toEqual(["X", "Y"]);
    expect(result.unmatchedDebts).toEqual([]);
    expect(result.usedAmount).toBe(50);
    expect(result.remainingOverpayment).toBe(50);
  });

  it("prefers closing the largest number of debts in full", () => {
    // 40 available. Smallest-first closes X(12) and Y(25) = 2 debts.
    const result = matchOffsets(
      [{ reference: "A", amount: 40 }],
      [
        { reference: "Z", amount: 30 },
        { reference: "Y", amount: 25 },
        { reference: "X", amount: 12 },
      ],
    );

    expect(result.closedDebts.sort()).toEqual(["X", "Y"]);
    expect(result.unmatchedDebts).toEqual(["Z"]);
    expect(result.usedAmount).toBe(37);
    expect(result.remainingOverpayment).toBe(3);
  });

  it("never partially pays a debt it cannot close", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 10 }],
      [{ reference: "X", amount: 500 }],
    );

    expect(result.moves).toEqual([]);
    expect(result.closedDebts).toEqual([]);
    expect(result.unmatchedDebts).toEqual(["X"]);
    expect(result.remainingOverpayment).toBe(10);
  });

  it("feeds one debt from several sources", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 60 }, { reference: "B", amount: 40 }],
      [{ reference: "X", amount: 100 }],
    );

    expect(result.closedDebts).toEqual(["X"]);
    expect(result.moves).toHaveLength(2);
    expect(result.moves.map((m) => m.fromReference).sort()).toEqual(["A", "B"]);
    expect(round2(result.moves.reduce((s, m) => s + m.amount, 0))).toBe(100);
  });

  it("drains the biggest source first so small sources survive", () => {
    const result = matchOffsets(
      [{ reference: "SMALL", amount: 5 }, { reference: "BIG", amount: 95 }],
      [{ reference: "X", amount: 90 }],
    );

    expect(result.moves).toEqual([
      { fromReference: "BIG", toReference: "X", amount: 90 },
    ]);
  });

  it("ignores parties at or below the 1 TL tolerance", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 0.5 }, { reference: "B", amount: 100 }],
      [{ reference: "X", amount: 0.9 }, { reference: "Y", amount: 40 }],
    );

    expect(result.moves.map((m) => m.fromReference)).toEqual(["B"]);
    expect(result.closedDebts).toEqual(["Y"]);
    expect(result.unmatchedDebts).toEqual([]);
    expect(OFFSET_TOLERANCE).toBe(1);
  });

  it("handles kurus amounts without leaving rounding dust", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 214006.91 }],
      [{ reference: "X", amount: 66896.97 }, { reference: "Y", amount: 147109.94 }],
    );

    expect(result.closedDebts.sort()).toEqual(["X", "Y"]);
    expect(result.usedAmount).toBe(214006.91);
    expect(result.remainingOverpayment).toBe(0);
  });

  it("closes an exact match with nothing left over", () => {
    const result = matchOffsets(
      [{ reference: "A", amount: 50 }],
      [{ reference: "X", amount: 50 }],
    );

    expect(result.moves).toEqual([
      { fromReference: "A", toReference: "X", amount: 50 },
    ]);
    expect(result.remainingOverpayment).toBe(0);
  });

  it("returns an empty result for empty input", () => {
    const result = matchOffsets([], []);

    expect(result.moves).toEqual([]);
    expect(result.closedDebts).toEqual([]);
    expect(result.unmatchedDebts).toEqual([]);
    expect(result.usedAmount).toBe(0);
    expect(result.remainingOverpayment).toBe(0);
  });

  it("does not mutate its input arrays", () => {
    const overpayments = [{ reference: "A", amount: 100 }];
    const debts = [{ reference: "X", amount: 30 }];
    matchOffsets(overpayments, debts);

    expect(overpayments).toEqual([{ reference: "A", amount: 100 }]);
    expect(debts).toEqual([{ reference: "X", amount: 30 }]);
  });
});

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(66896.974)).toBe(66896.97);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

const bucket = (
  id: number,
  available: number,
  isoDate: string,
  paymentType: "advance" | "balance" = "balance",
): SourceBucket => ({
  incomingPaymentId: id,
  paymentType,
  available,
  lastDate: new Date(isoDate),
  lastId: id,
});

describe("planSourceConsumption", () => {
  it("takes everything from the newest bucket when it is big enough", () => {
    const slices = planSourceConsumption(
      [bucket(1, 500, "2026-01-10"), bucket(2, 800, "2026-05-20")],
      300,
    );

    expect(slices).toEqual([
      { incomingPaymentId: 2, paymentType: "balance", amount: 300 },
    ]);
  });

  it("walks backwards through buckets when one is not enough", () => {
    const slices = planSourceConsumption(
      [bucket(1, 500, "2026-01-10"), bucket(2, 200, "2026-05-20")],
      600,
    );

    expect(slices).toEqual([
      { incomingPaymentId: 2, paymentType: "balance", amount: 200 },
      { incomingPaymentId: 1, paymentType: "balance", amount: 400 },
    ]);
  });

  it("keeps each bucket's payment type", () => {
    const slices = planSourceConsumption(
      [bucket(1, 100, "2026-01-10", "advance"), bucket(2, 50, "2026-05-20", "balance")],
      120,
    );

    expect(slices).toEqual([
      { incomingPaymentId: 2, paymentType: "balance", amount: 50 },
      { incomingPaymentId: 1, paymentType: "advance", amount: 70 },
    ]);
  });

  it("breaks ties on id, newest first", () => {
    const slices = planSourceConsumption(
      [bucket(7, 10, "2026-03-01"), bucket(9, 10, "2026-03-01")],
      15,
    );

    expect(slices.map((s) => s.incomingPaymentId)).toEqual([9, 7]);
  });

  it("throws when the buckets cannot cover the amount", () => {
    expect(() =>
      planSourceConsumption([bucket(1, 100, "2026-01-10")], 150),
    ).toThrow(InsufficientSourceError);
  });

  it("tolerates kurus shortfall inside the epsilon", () => {
    const slices = planSourceConsumption([bucket(1, 99.999, "2026-01-10")], 100);

    expect(slices).toHaveLength(1);
    expect(slices[0].amount).toBe(100);
  });

  it("skips exhausted buckets", () => {
    const slices = planSourceConsumption(
      [bucket(1, 0, "2026-06-01"), bucket(2, 75, "2026-05-01")],
      75,
    );

    expect(slices).toEqual([
      { incomingPaymentId: 2, paymentType: "balance", amount: 75 },
    ]);
  });
});
