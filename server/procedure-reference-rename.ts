import { eq, getTableName, sql } from "drizzle-orm";
import { db } from "./db";
import {
  procedures,
  invoiceLineItems,
  invoiceLineItemsConfig,
  expenseDocuments,
  payments,
  paymentDistributions,
  procedureStatusDetails,
  taxCalculations,
  taxes,
  importExpenses,
  importServiceInvoices,
} from "@shared/schema";

/**
 * Renaming a procedure reference, safely.
 *
 * procedures.reference is not just a label — ten tables carry it as text.
 * Three of them (taxes, import_expenses, import_service_invoices) have real
 * foreign keys with ON UPDATE CASCADE in the production database and follow a
 * rename on their own. The other six do not, and are updated here by hand.
 * Everything happens in one transaction: either the whole reference moves or
 * nothing does.
 */

/**
 * Tables carrying procedure_reference WITHOUT a cascading foreign key.
 *
 * Do NOT add taxes / import_expenses / import_service_invoices here — the
 * database already updates those, and a second write would be redundant.
 */
export const MANUAL_REFERENCE_TABLES = [
  invoiceLineItems,
  invoiceLineItemsConfig,
  expenseDocuments,
  payments,
  paymentDistributions,
  procedureStatusDetails,
] as const;

/** Tables the database updates for us; counted for reporting, never written. */
const CASCADING_REFERENCE_TABLES = [taxes, importExpenses, importServiceInvoices] as const;

export interface RenameResult {
  procedureId: number;
  from: string;
  to: string;
  /** Rows rewritten per table. Cascading tables are absent — they self-update. */
  updated: Record<string, number>;
}

export interface LinkedCalculation {
  id: number;
  reference: string | null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Trim and validate both ends of a rename. */
export function assertRenameInputs(oldRef: string, newRef: string): { from: string; to: string } {
  const from = String(oldRef ?? "").trim();
  const to = String(newRef ?? "").trim();
  if (!from) throw new Error("renameProcedureReference: current reference is empty");
  if (!to) throw new Error("renameProcedureReference: new reference is empty");
  return { from, to };
}

/**
 * Which linked tax calculations should take the new reference?
 *
 * tax_calculations.reference is UNIQUE and holds its own copy of the text. When
 * exactly one calculation is linked we align it even if it spells the reference
 * differently (live data has "CNCALO-108 /1" against a "CNCALO-108" procedure).
 * With several linked, only an exact match is safe to touch.
 */
export function planTaxCalculationAlignment(
  linked: LinkedCalculation[],
  from: string,
  to: string,
): LinkedCalculation[] {
  const candidates =
    linked.length === 1 ? linked : linked.filter((calc) => calc.reference === from);
  return candidates.filter((calc) => calc.reference !== to);
}

export async function renameProcedureReference(
  oldRef: string,
  newRef: string,
  tx?: Tx,
): Promise<RenameResult> {
  const { from, to } = assertRenameInputs(oldRef, newRef);

  const run = async (t: Tx): Promise<RenameResult> => {
    const [source] = await t.select().from(procedures).where(eq(procedures.reference, from));
    if (!source) throw new Error(`Procedure not found: ${from}`);

    if (to !== from) {
      const [clash] = await t
        .select({ id: procedures.id })
        .from(procedures)
        .where(eq(procedures.reference, to));
      if (clash) throw new Error(`Reference already in use: ${to}`);
    }

    const updated: Record<string, number> = {};

    // The cascading three follow this write on their own.
    await t
      .update(procedures)
      .set({ reference: to, updatedAt: new Date() })
      .where(eq(procedures.id, source.id));

    for (const table of MANUAL_REFERENCE_TABLES) {
      const target = table as (typeof MANUAL_REFERENCE_TABLES)[number];
      const rows = await t
        .update(target)
        .set({ procedureReference: to })
        .where(eq(target.procedureReference, from))
        .returning({ id: target.id });
      updated[getTableName(target)] = rows.length;
    }

    const linked = await t
      .select({ id: taxCalculations.id, reference: taxCalculations.reference })
      .from(taxCalculations)
      .where(eq(taxCalculations.procedure_id, source.id));

    const toAlign = planTaxCalculationAlignment(linked, from, to);
    for (const calc of toAlign) {
      await t.update(taxCalculations).set({ reference: to }).where(eq(taxCalculations.id, calc.id));
    }
    updated.tax_calculations = toAlign.length;

    return { procedureId: source.id, from, to, updated };
  };

  return tx ? run(tx) : db.transaction(run);
}

/** Row counts per table for a reference — feeds the confirmation dialog. */
export async function countReferenceUsage(ref: string): Promise<Record<string, number>> {
  const reference = String(ref ?? "").trim();
  const counts: Record<string, number> = {};

  for (const table of [...MANUAL_REFERENCE_TABLES, ...CASCADING_REFERENCE_TABLES]) {
    const target = table as
      | (typeof MANUAL_REFERENCE_TABLES)[number]
      | (typeof CASCADING_REFERENCE_TABLES)[number];
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(target)
      .where(eq(target.procedureReference, reference));
    counts[getTableName(target)] = row?.n ?? 0;
  }

  const [calcRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(taxCalculations)
    .where(eq(taxCalculations.reference, reference));
  counts.tax_calculations = calcRow?.n ?? 0;

  return counts;
}
