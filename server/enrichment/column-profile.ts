import {
  FIELD_KIND,
  type ColumnProfile,
  type EnrichField,
  type EnrichRow,
  type EnrichValue,
  type MappedColumn,
  type RawRow,
  type UnusedColumn,
} from "./types";
import { cleanDate, cleanNumber, cleanText, foldTurkish, normalizeCustoms } from "./normalize";

/**
 * "FATURA NO(0100)" -> "faturano0100". Lower-cases, folds Turkish letters to
 * ASCII and drops everything that is not a letter or digit, so spacing and
 * punctuation in the broker's headers stop mattering.
 */
export function normalizeHeader(header: unknown): string {
  if (header === null || header === undefined) return "";
  return foldTurkish(String(header));
}

/**
 * Per field, the acceptable normalized headers in priority order. The FIRST
 * match in the sheet wins.
 *
 * Priority matters: the report has both "FATURA NO" (the broker's own file
 * reference, 0/7 match against the DB) and "FATURA NO(0100)" (the real
 * invoice number, 13/13 match). The old importer relied on object key order
 * to break this tie, which was luck, not intent.
 *
 * Fields deliberately absent — `piece`, `awb_number`, `carrier`,
 * `arrival_date` — are out of scope per the design spec.
 */
export const FIELD_CANDIDATES: Record<EnrichField, string[]> = {
  invoice_no: ["faturano0100", "faturanumarasi", "faturano", "invoiceno", "invno"],
  invoice_date: ["faturatarihi0100", "faturatarihi", "invoicedate"],
  amount: ["fatbedeli", "faturatutari", "dovizkiymeti", "malbedeli", "tutar", "amount"],
  currency: ["doviz", "parabirimi", "currency"],
  usdtl_rate: ["dovizkuru", "kur", "exchangerate"],
  import_dec_number: ["beyanno", "beyannameno", "beyannamenumarasi", "tcgbno"],
  import_dec_date: ["beyantarihi", "beyannametarihi", "tcgbtarihi"],
  customs: ["gum", "gumruk", "gumrukidaresi", "customs"],
  shipper: ["gonderen", "gonderici", "shipper", "sender"],
  package: ["koli", "kap", "paket", "package"],
  kg: ["brutkg", "kilo", "kg", "grossweight"],
  freight_amount: ["navlun", "freight"],
  customs_file_no: ["dosyano", "dosyanumarasi"],
};

const ALL_FIELDS = Object.keys(FIELD_CANDIDATES) as EnrichField[];

export function buildColumnProfile(headers: unknown[]): ColumnProfile {
  const normalized = headers.map(normalizeHeader);

  const mapped: MappedColumn[] = [];
  const unusedCandidates: UnusedColumn[] = [];
  const claimedIndices = new Set<number>();

  for (const field of ALL_FIELDS) {
    const hits: number[] = [];
    for (const candidate of FIELD_CANDIDATES[field]) {
      normalized.forEach((norm, idx) => {
        if (norm === candidate && !hits.includes(idx)) hits.push(idx);
      });
    }
    if (hits.length === 0) continue;

    const [winner, ...losers] = hits;
    mapped.push({ field, colIndex: winner, header: String(headers[winner]) });
    claimedIndices.add(winner);

    for (const loser of losers) {
      unusedCandidates.push({
        field,
        colIndex: loser,
        header: String(headers[loser]),
        winnerHeader: String(headers[winner]),
      });
      claimedIndices.add(loser);
    }
  }

  const unmappedHeaders = headers
    .map((h, idx) => ({ h, idx }))
    .filter(({ h, idx }) => !claimedIndices.has(idx) && normalizeHeader(h) !== "")
    .map(({ h }) => String(h));

  return { mapped, unusedCandidates, unmappedHeaders };
}

/** How many distinct fields a candidate header row would produce. */
export function countRecognizedHeaders(headers: unknown[]): number {
  return buildColumnProfile(headers).mapped.length;
}

function cleanFor(field: EnrichField, raw: unknown): EnrichValue | undefined {
  let value: EnrichValue | null;
  switch (FIELD_KIND[field]) {
    case "number":
      value = cleanNumber(raw);
      break;
    case "date":
      value = cleanDate(raw);
      break;
    case "customs":
      value = normalizeCustoms(raw);
      break;
    default:
      value = cleanText(raw);
  }
  // `undefined` means "this row said nothing about this field", which is
  // different from an explicit value. Junk collapses to "said nothing".
  return value === null ? undefined : value;
}

export function applyProfile(rows: RawRow[], profile: ColumnProfile): EnrichRow[] {
  return rows.map((row) => {
    const values: Partial<Record<EnrichField, EnrichValue>> = {};
    for (const column of profile.mapped) {
      const cleaned = cleanFor(column.field, row.cells[column.colIndex]);
      if (cleaned !== undefined) values[column.field] = cleaned;
    }
    return { excelRowNumber: row.excelRowNumber, values };
  });
}
