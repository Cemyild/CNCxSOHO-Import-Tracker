/**
 * Turning one raw Excel cell into a clean value.
 *
 * The broker's report uses several "no value here" markers ("-", ".", "X",
 * a single space). The old importer treated those as real data and wrote
 * them straight into the database, so junk detection is the first gate.
 */

/** Markers the report uses to mean "nothing here". Compared case-insensitively. */
const JUNK_TOKENS = new Set(["-", "--", ".", "x", "n/a", "na"]);

export function isJunk(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value);
  const text = String(value).trim();
  if (text === "") return true;
  return JUNK_TOKENS.has(text.toLowerCase());
}

export function cleanText(value: unknown): string | null {
  if (isJunk(value)) return null;
  return String(value).trim();
}

export function cleanNumber(value: unknown): number | null {
  if (isJunk(value)) return null;
  if (typeof value === "number") return value;

  let text = String(value).trim();
  // "1.234,56" (TR) -> dots are thousands separators, comma is the decimal
  // point. "1234.56" (EN) has no comma, so leave its dot alone.
  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  }
  text = text.replace(/\s/g, "");

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Excel's day 0 is 1899-12-30; JS epoch is 25569 days later. */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86_400_000;

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible dates like 31.02 that Date would roll over.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Always returns `YYYY-MM-DD` or null.
 *
 * The report writes dates as `dd.mm.yyyy`. Day-first is certain here: values
 * like `13.07.2026` cannot be month-first, and every BEYAN TARİHİ value read
 * this way agrees with the declaration dates already stored in the database.
 */
export function cleanDate(value: unknown): string | null {
  if (isJunk(value)) return null;

  if (typeof value === "number") {
    const ms = (value - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  const text = String(value).trim();

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (dayFirst) {
    return toIso(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  }

  // A bare number that arrived as text, e.g. "46206".
  if (/^\d+$/.test(text)) return cleanDate(Number(text));

  return null;
}

/**
 * The report spells offices out in full ("ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ") while
 * the app stores short names ("Erenköy"). Without this, the same office
 * would end up in the database under two different spellings.
 */
const CUSTOMS_OFFICES: Array<{ match: string; short: string }> = [
  { match: "erenkoy", short: "Erenköy" },
  { match: "muratbey", short: "Muratbey" },
  { match: "istanbulhavalimani", short: "Istanbul Airport" },
  { match: "ambarli", short: "Ambarlı" },
  { match: "gemlik", short: "Gemlik" },
];

/**
 * Lower-cases, folds Turkish letters to their ASCII equivalents, and strips
 * everything that isn't a-z0-9. Exported so Task 2's header matching can
 * apply the exact same folding to Excel header text without duplicating it.
 */
export function foldTurkish(text: string): string {
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
  };
  return text
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeCustoms(value: unknown): string | null {
  const text = cleanText(value);
  if (text === null) return null;

  const folded = foldTurkish(text);
  for (const office of CUSTOMS_OFFICES) {
    if (folded.startsWith(office.match)) return office.short;
  }
  // Unknown office: keep it verbatim so nothing is lost. The preview flags it.
  return text;
}
