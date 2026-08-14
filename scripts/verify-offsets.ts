/**
 * Acceptance checks for cross-procedure offsetting. Read-only.
 * Verifies the three invariants from the plan against live data.
 */
import { getOffsetCandidates, previewOffsets } from "../server/offset-service";
import { rawDb } from "../server/db";

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "GECTI " : "KALDI "} ${name.padEnd(46)} ${detail}`);
  if (!ok) failures++;
};

const candidates = await getOffsetCandidates();
const plan = await previewOffsets();

console.log("DURUM");
console.log("  fazla :", candidates.overpayments.length, "/", fmt(candidates.totalOverpayment), "TL");
console.log("  borc  :", candidates.debts.length, "/", fmt(candidates.totalDebt), "TL");
console.log("  haric :", candidates.uncosted.count, "/", fmt(candidates.uncosted.amount), "TL");
console.log("\nPLAN");
console.log("  kapanan borc:", plan.closedDebts.length);
console.log("  aktarilan   :", fmt(plan.usedAmount), "TL");
console.log("  islem       :", plan.moves.length);
console.log("  artan       :", fmt(plan.remainingOverpayment), "TL");
console.log("  kapanmayan  :", plan.unmatchedDebts.length);
console.log("\nKABUL OLCUTLERI");

// 1. Money is conserved: nothing created, nothing destroyed.
check(
  "1. Para korunuyor",
  Math.abs(plan.usedAmount + plan.remainingOverpayment - candidates.totalOverpayment) < 0.01,
  `${fmt(plan.usedAmount)} + ${fmt(plan.remainingOverpayment)} = ${fmt(candidates.totalOverpayment)}`,
);

// 2. Every move lands on a debt that ends up fully closed.
const perTarget = new Map<string, number>();
for (const m of plan.moves) {
  perTarget.set(m.toReference, (perTarget.get(m.toReference) ?? 0) + m.amount);
}
const debtByRef = new Map(candidates.debts.map((d) => [d.reference, d.balance]));
const halfPaid = Array.from(perTarget.entries()).filter(
  ([ref, total]) => Math.abs((debtByRef.get(ref) ?? 0) - total) > 0.005,
);
check(
  "2. Hicbir borc yarim kalmiyor",
  halfPaid.length === 0,
  halfPaid.length === 0 ? `${perTarget.size} hedefin hepsi tam kapaniyor` : JSON.stringify(halfPaid),
);

// 3. Unmatched debts really are unaffordable.
const unaffordable = plan.unmatchedDebts.every(
  (ref) => (debtByRef.get(ref) ?? 0) > candidates.totalOverpayment + 0.005,
);
check(
  "3. Kapanmayanlar gercekten karsilanamiyor",
  unaffordable,
  plan.unmatchedDebts.length === 0 ? "kapanmayan borc yok" : plan.unmatchedDebts.join(", "),
);

// 4. No source is drained beyond its overpayment.
const perSource = new Map<string, number>();
for (const m of plan.moves) {
  perSource.set(m.fromReference, (perSource.get(m.fromReference) ?? 0) + m.amount);
}
const overById = new Map(candidates.overpayments.map((o) => [o.reference, -o.balance]));
const overdrawn = Array.from(perSource.entries()).filter(
  ([ref, total]) => total > (overById.get(ref) ?? 0) + 0.005,
);
check(
  "4. Hicbir kaynak fazlasindan cok vermiyor",
  overdrawn.length === 0,
  overdrawn.length === 0 ? `${perSource.size} kaynak sinirlar icinde` : JSON.stringify(overdrawn),
);

// 5. Every excluded procedure genuinely has no cost side.
const { rows } = await rawDb.query(`
  SELECT p.reference,
    (SELECT COUNT(*) FROM import_expenses e WHERE e.procedure_reference = p.reference)
    + (SELECT COUNT(*) FROM import_service_invoices s WHERE s.procedure_reference = p.reference)
    + (SELECT COUNT(*) FROM taxes t WHERE t.procedure_reference = p.reference) AS cost_rows
  FROM procedures p
`);
const costRows = new Map(rows.map((r: any) => [r.reference, Number(r.cost_rows)]));
const listed = new Set([
  ...candidates.overpayments.map((c) => c.reference),
  ...candidates.debts.map((c) => c.reference),
]);
const wronglyListed = Array.from(listed).filter((ref) => (costRows.get(ref) ?? 0) === 0);
check(
  "5. Listedekilerin hepsinin gideri girilmis",
  wronglyListed.length === 0,
  wronglyListed.length === 0 ? `${listed.size} prosedur` : JSON.stringify(wronglyListed),
);

// 6. Offset rows never leave a procedure's distribution total negative.
const neg = await rawDb.query(`
  SELECT procedure_reference, SUM(distributed_amount::numeric) AS total
  FROM payment_distributions GROUP BY 1 HAVING SUM(distributed_amount::numeric) < 0
`);
check(
  "6. Hicbir prosedurun dagitimi eksiye dusmemis",
  neg.rows.length === 0,
  neg.rows.length === 0 ? "hepsi sifir veya pozitif" : JSON.stringify(neg.rows),
);

console.log(failures === 0 ? "\nTUM OLCUTLER GECTI" : `\n${failures} OLCUT KALDI`);
process.exit(failures === 0 ? 0 : 1);
