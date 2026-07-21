import type {
  EnrichField,
  EnrichRow,
  EnrichValue,
  MatchMethod,
  MatchResult,
  MatchedGroup,
  UnmatchedRow,
} from "./types";

/** The subset of a procedure row that matching needs. */
export interface MatchCandidate {
  id: number;
  reference: string | null;
  invoice_no: string | null;
  amount: string | number | null;
}

/** Amounts are stored as DECIMAL(10,2); anything under a kuruş is the same. */
const AMOUNT_TOLERANCE = 0.01;

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `amount` defaults to `0` in the schema, so many procedures — and
 * occasionally a report row — carry a literal zero. Treating `0` as a usable
 * matching key would amount-match a row against every zero-amount procedure
 * in the table, which is a coincidence, not a real key. Everywhere matching
 * looks at an amount, it must go through this instead of `asNumber` directly.
 */
function usableAmount(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed === 0 ? null : parsed;
}

function sameAmount(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) < AMOUNT_TOLERANCE;
}

function trimmedInvoiceNo(row: EnrichRow): string | null {
  return row.values.invoice_no ? String(row.values.invoice_no).trim() : null;
}

interface RowMatch {
  row: EnrichRow;
  procedure: MatchCandidate;
  method: MatchMethod;
}

function unmatchedFrom(
  row: EnrichRow,
  reason: UnmatchedRow["reason"],
  candidates: MatchCandidate[] = [],
): UnmatchedRow {
  return {
    excelRowNumber: row.excelRowNumber,
    customsFileNo: (row.values.customs_file_no as string | undefined) ?? null,
    reason,
    invoiceNo: trimmedInvoiceNo(row),
    amount: asNumber(row.values.amount),
    candidates: candidates.map((c) => c.reference ?? String(c.id)),
  };
}

/** Step 1: bind one row to at most one procedure. */
function matchOne(
  row: EnrichRow,
  procedures: MatchCandidate[],
): RowMatch | UnmatchedRow {
  const invoiceNo = trimmedInvoiceNo(row);
  const amount = usableAmount(row.values.amount);

  if (!invoiceNo && amount === null) return unmatchedFrom(row, "no_key");

  if (invoiceNo) {
    const byInvoice = procedures.filter(
      (p) => p.invoice_no !== null && String(p.invoice_no).trim() === invoiceNo,
    );

    if (byInvoice.length === 1) {
      return { row, procedure: byInvoice[0], method: "invoice_no" };
    }

    if (byInvoice.length > 1) {
      const narrowed = byInvoice.filter((p) =>
        sameAmount(usableAmount(p.amount), amount),
      );
      if (narrowed.length === 1) {
        return { row, procedure: narrowed[0], method: "invoice_no+amount" };
      }
      return unmatchedFrom(row, "ambiguous", byInvoice);
    }
  }

  if (amount !== null) {
    const byAmount = procedures.filter((p) =>
      sameAmount(usableAmount(p.amount), amount),
    );
    if (byAmount.length === 1) {
      return { row, procedure: byAmount[0], method: "amount" };
    }
    if (byAmount.length > 1) return unmatchedFrom(row, "ambiguous", byAmount);
  }

  return unmatchedFrom(row, "not_found");
}

const DECLARATION_FIELDS: EnrichField[] = [
  "import_dec_number",
  "import_dec_date",
];

/** An import declaration number contains "IM"; a bonded-warehouse one "AN". */
function isImportDeclaration(row: EnrichRow): boolean {
  const decNo = row.values.import_dec_number;
  return typeof decNo === "string" && decNo.toUpperCase().includes("IM");
}

/** Higher is stronger. Ranks how much a matchMethod should be trusted. */
const METHOD_STRENGTH: Record<MatchMethod, number> = {
  invoice_no: 2,
  "invoice_no+amount": 1,
  amount: 0,
};

/**
 * A group's AN and IM rows can match by different methods (e.g. the IM row
 * carries the invoice number but the AN row only matched on amount). Report
 * the weakest method present so the UI never shows a confident badge for
 * data that partly came from a weaker match.
 */
function weakestMethod(matches: RowMatch[]): MatchMethod {
  return matches.reduce(
    (weakest, m) =>
      METHOD_STRENGTH[m.method] < METHOD_STRENGTH[weakest] ? m.method : weakest,
    matches[0].method,
  );
}

/**
 * Step 2: fold every row that landed on the same procedure into one update.
 *
 * Each shipment appears twice in the report — once as the bonded-warehouse
 * entry (AN) and once as the import declaration (IM). The database stores
 * the IM declaration, so that row wins for the declaration fields. Every
 * other field takes the first non-empty value across the group.
 */
function mergeGroup(matches: RowMatch[]): MatchedGroup {
  const first = matches[0];
  const values: Partial<Record<EnrichField, EnrichValue>> = {};

  for (const match of matches) {
    for (const [field, value] of Object.entries(match.row.values)) {
      const key = field as EnrichField;
      if (DECLARATION_FIELDS.includes(key)) continue;
      if (values[key] === undefined && value !== undefined && value !== null) {
        values[key] = value;
      }
    }
  }

  const declarationSource =
    matches.find((m) => isImportDeclaration(m.row)) ??
    matches.find((m) => m.row.values.import_dec_number !== undefined) ??
    first;

  for (const field of DECLARATION_FIELDS) {
    const value = declarationSource.row.values[field];
    if (value !== undefined && value !== null) values[field] = value;
  }

  return {
    procedureId: first.procedure.id,
    reference: first.procedure.reference ?? String(first.procedure.id),
    matchMethod: weakestMethod(matches),
    excelRowNumbers: matches.map((m) => m.row.excelRowNumber),
    values,
  };
}

export function matchRows(
  rows: EnrichRow[],
  procedures: MatchCandidate[],
): MatchResult {
  const byProcedure = new Map<number, RowMatch[]>();
  const unmatched: UnmatchedRow[] = [];

  for (const row of rows) {
    const outcome = matchOne(row, procedures);
    if ("procedure" in outcome) {
      const bucket = byProcedure.get(outcome.procedure.id);
      if (bucket) bucket.push(outcome);
      else byProcedure.set(outcome.procedure.id, [outcome]);
    } else {
      unmatched.push(outcome);
    }
  }

  const matched = [...byProcedure.values()].map(mergeGroup);
  return { matched, unmatched };
}
