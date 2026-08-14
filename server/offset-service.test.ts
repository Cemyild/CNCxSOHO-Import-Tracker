import { describe, it, expect } from "vitest";

/**
 * These touch a real database. The local .env points at the LIVE Neon
 * database, so they only run when a separate TEST_DATABASE_URL is provided.
 * Create one with a Neon branch, then:
 *   TEST_DATABASE_URL=... npx vitest run server/offset-service.test.ts
 */
const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

if (hasTestDb) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

describe.skipIf(!hasTestDb)("applyOffsets", () => {
  it("moves the balance from source to target", async () => {
    const { getOffsetCandidates, applyOffsets } = await import("./offset-service");
    const before = await getOffsetCandidates();
    const source = before.overpayments[0];
    const target = before.debts[0];
    const amount = Math.min(Math.abs(source.balance), target.balance);

    await applyOffsets(
      [{ fromReference: source.reference, toReference: target.reference, amount }],
      1,
      "manual",
    );

    const after = await getOffsetCandidates();
    const sourceAfter = after.overpayments.find((c) => c.reference === source.reference);
    const targetAfter = after.debts.find((c) => c.reference === target.reference);

    expect(Math.abs(sourceAfter?.balance ?? 0)).toBeCloseTo(
      Math.abs(source.balance) - amount, 2,
    );
    expect(targetAfter?.balance ?? 0).toBeCloseTo(target.balance - amount, 2);
  });

  it("leaves the incoming payment untouched", async () => {
    const { getOffsetCandidates, applyOffsets } = await import("./offset-service");
    const { rawDb } = await import("./db");

    const snapshot = async () =>
      (await rawDb.query(
        "SELECT id, total_amount, amount_distributed, remaining_balance, distribution_status::text FROM incoming_payments ORDER BY id",
      )).rows;

    const before = await snapshot();
    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const target = candidates.debts[0];

    await applyOffsets(
      [{
        fromReference: source.reference,
        toReference: target.reference,
        amount: Math.min(Math.abs(source.balance), target.balance),
      }],
      1,
      "manual",
    );

    expect(await snapshot()).toEqual(before);
  });

  it("keeps the sum of all balances constant", async () => {
    const { getOffsetCandidates, applyOffsets } = await import("./offset-service");
    const total = async () => {
      const c = await getOffsetCandidates();
      return c.totalDebt - c.totalOverpayment;
    };

    const before = await total();
    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const target = candidates.debts[0];

    await applyOffsets(
      [{
        fromReference: source.reference,
        toReference: target.reference,
        amount: Math.min(Math.abs(source.balance), target.balance),
      }],
      1,
      "manual",
    );

    expect(await total()).toBeCloseTo(before, 2);
  });

  it("refuses a transfer larger than the source's overpayment", async () => {
    const { getOffsetCandidates, applyOffsets, OffsetValidationError } =
      await import("./offset-service");
    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const target = candidates.debts[0];

    await expect(
      applyOffsets(
        [{
          fromReference: source.reference,
          toReference: target.reference,
          amount: Math.abs(source.balance) + 1000,
        }],
        1,
        "manual",
      ),
    ).rejects.toBeInstanceOf(OffsetValidationError);
  });

  it("refuses to draw from a procedure with no expenses recorded", async () => {
    const { applyOffsets, getOffsetCandidates, OffsetValidationError } =
      await import("./offset-service");
    const { rawDb } = await import("./db");

    // Find a procedure holding money but with an empty cost side.
    const { rows } = await rawDb.query(`
      SELECT p.reference
      FROM procedures p
      JOIN (SELECT procedure_reference AS ref, SUM(distributed_amount::numeric) AS v
            FROM payment_distributions GROUP BY 1) d ON d.ref = p.reference
      WHERE d.v > 0
        AND NOT EXISTS (SELECT 1 FROM import_expenses e WHERE e.procedure_reference = p.reference)
        AND NOT EXISTS (SELECT 1 FROM import_service_invoices s WHERE s.procedure_reference = p.reference)
        AND NOT EXISTS (SELECT 1 FROM taxes t WHERE t.procedure_reference = p.reference)
      LIMIT 1
    `);

    if (rows.length === 0) return; // nothing uncosted in this dataset

    const candidates = await getOffsetCandidates();
    const target = candidates.debts[0];

    await expect(
      applyOffsets(
        [{ fromReference: rows[0].reference, toReference: target.reference, amount: 100 }],
        1,
        "manual",
      ),
    ).rejects.toBeInstanceOf(OffsetValidationError);
  });

  it("writes nothing when one move in a batch is invalid", async () => {
    const { getOffsetCandidates, applyOffsets } = await import("./offset-service");
    const { rawDb } = await import("./db");
    const countRows = async () =>
      Number((await rawDb.query("SELECT COUNT(*) AS c FROM payment_distributions")).rows[0].c);

    const before = await countRows();
    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const target = candidates.debts[0];

    await expect(
      applyOffsets(
        [
          { fromReference: source.reference, toReference: target.reference, amount: 1 },
          { fromReference: source.reference, toReference: source.reference, amount: 1 },
        ],
        1,
        "manual",
      ),
    ).rejects.toThrow();

    expect(await countRows()).toBe(before);
  });
});

describe.skipIf(!hasTestDb)("reverseOffset", () => {
  it("restores both balances exactly", async () => {
    const { getOffsetCandidates, applyOffsets, reverseOffset } =
      await import("./offset-service");

    const before = await getOffsetCandidates();
    const source = before.overpayments[0];
    const target = before.debts[0];

    const { offsetIds } = await applyOffsets(
      [{
        fromReference: source.reference,
        toReference: target.reference,
        amount: Math.min(Math.abs(source.balance), target.balance),
      }],
      1,
      "manual",
    );

    await reverseOffset(offsetIds[0], 1);

    const after = await getOffsetCandidates();
    expect(
      after.overpayments.find((c) => c.reference === source.reference)?.balance,
    ).toBeCloseTo(source.balance, 2);
    expect(
      after.debts.find((c) => c.reference === target.reference)?.balance,
    ).toBeCloseTo(target.balance, 2);
  });

  it("leaves no distribution rows behind", async () => {
    const { getOffsetCandidates, applyOffsets, reverseOffset } =
      await import("./offset-service");
    const { rawDb } = await import("./db");
    const countRows = async () =>
      Number((await rawDb.query("SELECT COUNT(*) AS c FROM payment_distributions")).rows[0].c);

    const before = await countRows();
    const candidates = await getOffsetCandidates();
    const { offsetIds } = await applyOffsets(
      [{
        fromReference: candidates.overpayments[0].reference,
        toReference: candidates.debts[0].reference,
        amount: 1,
      }],
      1,
      "manual",
    );

    expect(await countRows()).toBeGreaterThan(before);
    await reverseOffset(offsetIds[0], 1);
    expect(await countRows()).toBe(before);
  });

  it("refuses to reverse the same offset twice", async () => {
    const { getOffsetCandidates, applyOffsets, reverseOffset, OffsetValidationError } =
      await import("./offset-service");

    const candidates = await getOffsetCandidates();
    const { offsetIds } = await applyOffsets(
      [{
        fromReference: candidates.overpayments[0].reference,
        toReference: candidates.debts[0].reference,
        amount: 1,
      }],
      1,
      "manual",
    );

    await reverseOffset(offsetIds[0], 1);
    await expect(reverseOffset(offsetIds[0], 1)).rejects.toBeInstanceOf(
      OffsetValidationError,
    );
  });

  it("refuses when the money has since moved on", async () => {
    const { getOffsetCandidates, applyOffsets, reverseOffset, OffsetValidationError } =
      await import("./offset-service");

    const candidates = await getOffsetCandidates();
    const a = candidates.overpayments[0].reference;
    const b = candidates.debts[0].reference;
    const c = candidates.debts[1].reference;

    // A → B, then B → C. Undoing A → B first would leave B negative.
    const first = await applyOffsets(
      [{ fromReference: a, toReference: b, amount: 50 }],
      1,
      "manual",
    );
    const afterFirst = await getOffsetCandidates();
    const bBalance = afterFirst.overpayments.find((x) => x.reference === b);

    if (!bBalance) return; // B did not end up overpaid, chain not reproducible

    await applyOffsets([{ fromReference: b, toReference: c, amount: 50 }], 1, "manual");

    await expect(reverseOffset(first.offsetIds[0], 1)).rejects.toBeInstanceOf(
      OffsetValidationError,
    );
  });

  it("reverses a whole batch at once", async () => {
    const { getOffsetCandidates, applyOffsets, reverseBatch, getOffsetHistory } =
      await import("./offset-service");

    const candidates = await getOffsetCandidates();
    const source = candidates.overpayments[0];
    const { batchId } = await applyOffsets(
      [
        { fromReference: source.reference, toReference: candidates.debts[0].reference, amount: 1 },
        { fromReference: source.reference, toReference: candidates.debts[1].reference, amount: 1 },
      ],
      1,
      "auto",
    );

    const { reversed } = await reverseBatch(batchId, 1);
    expect(reversed).toBe(2);

    const history = await getOffsetHistory();
    expect(
      history.filter((h) => h.batchId === batchId).every((h) => h.reversedAt !== null),
    ).toBe(true);
  });
});
