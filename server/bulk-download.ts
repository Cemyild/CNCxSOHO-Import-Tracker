import type { Express, Request, Response } from "express";

// ── Pure utilities (exported for testing) ──────────────────────────────────

/**
 * Lenient parser for procedures.import_dec_date (text column with no enforced format).
 * Accepts: yyyy-mm-dd, dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy.
 * Returns null for null/empty/unparseable input.
 */
export function parseImportDecDate(text: string | null | undefined): Date | null {
  if (text == null) return null;
  const t = String(text).trim();
  if (t === "") return null;

  // yyyy-mm-dd
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return buildDate(+m[1], +m[2], +m[3]);

  // dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(t);
  if (m) return buildDate(+m[3], +m[2], +m[1]);

  return null;
}

function buildDate(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Round-trip guard against e.g. 31 Feb → 2/Mar
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/**
 * Format a Date as dd.mm.yyyy (used inside ZIP folder names — slash is illegal there).
 */
export function formatDateDot(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Format a Date as dd/mm/yyyy (used in UI strings and the manifest CSV).
 */
export function formatDateSlash(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Replace illegal filesystem/ZIP characters (/ \ : * ? " < > |) with _ and collapse runs of _.
 */
export function sanitizePathSegment(s: string): string {
  return s
    .replace(/[\/\\:\*\?"<>|]/g, "_")
    .replace(/_+/g, "_")
    .trim();
}

/**
 * Build the per-procedure folder name: "<reference> - <dec_no> - <dd.mm.yyyy>".
 * Missing fields are simply omitted (no placeholder), separator " - " collapses.
 */
export function buildProcedureFolderName(args: {
  reference: string;
  importDecNumber: string | null;
  importDecDate: string | null;
}): string {
  const parts: string[] = [sanitizePathSegment(args.reference)];

  if (args.importDecNumber && args.importDecNumber.trim() !== "") {
    parts.push(sanitizePathSegment(args.importDecNumber));
  }

  if (args.importDecDate && args.importDecDate.trim() !== "") {
    const parsed = parseImportDecDate(args.importDecDate);
    parts.push(parsed ? formatDateDot(parsed) : sanitizePathSegment(args.importDecDate));
  }

  return parts.join(" - ");
}

const SUBFOLDER_MAP: Record<string, string> = {
  import_document: "01-Import-Documents",
  import_expense: "02-Expense-Receipts",
  service_invoice: "03-Service-Invoices",
  tax: "04-Tax-Documents",
};

/**
 * Map expense_documents.expenseType to the subfolder name inside a procedure folder.
 */
export function subfolderForExpenseType(t: string): string {
  return SUBFOLDER_MAP[t] ?? "99-Other";
}

/**
 * Deduplicate filenames within the same target folder by suffixing " (2)", " (3)" ...
 * Input items are returned in the same order with a new `name` field.
 */
export function dedupFilenames<T extends { originalFilename: string }>(items: T[]): (T & { name: string })[] {
  const counts = new Map<string, number>();
  return items.map((item) => {
    const cleaned = sanitizePathSegment(item.originalFilename);
    const seen = counts.get(cleaned) ?? 0;
    counts.set(cleaned, seen + 1);

    if (seen === 0) return { ...item, name: cleaned };

    // Insert " (n)" before the extension. No extension → append at end.
    const dot = cleaned.lastIndexOf(".");
    const suffix = ` (${seen + 1})`;
    const name = dot > 0 ? cleaned.slice(0, dot) + suffix + cleaned.slice(dot) : cleaned + suffix;
    return { ...item, name };
  });
}

/** Manifest row before CSV serialization. */
export interface ManifestRow {
  procedureReference: string;
  importDecNumber: string | null;
  importDecDate: string | null;
  shipper: string | null;
  category: string;
  originalFilename: string;
  pathInZip: string;
  fileSizeBytes: number;
  status: string;
}

/**
 * Render a list of manifest rows as a UTF-8 BOM-prefixed CSV Buffer.
 * Columns are listed in the spec. CSV escaping: wrap in "..." if the value
 * contains ',' '"' '\n' '\r'; escape internal '"' as '""'.
 */
export function buildManifestCsv(_rows: ManifestRow[]): Buffer {
  throw new Error("not implemented");
}

/** Build the downloaded ZIP filename per spec table. */
export function buildZipFilename(args: {
  mode: "single" | "multi" | "dateRange" | "all";
  singleReference?: string;
  dateFrom?: string;
  dateTo?: string;
  today: Date;
}): string {
  const today = formatDateDot(args.today);
  switch (args.mode) {
    case "single":
      return `CNCxSOHO-${sanitizePathSegment(args.singleReference ?? "Unknown")}-${today}.zip`;
    case "all":
      return `CNCxSOHO-Documents-All-${today}.zip`;
    case "dateRange": {
      const fromD = args.dateFrom ? parseImportDecDate(args.dateFrom) : null;
      const toD = args.dateTo ? parseImportDecDate(args.dateTo) : null;
      const from = fromD ? formatDateDot(fromD) : (args.dateFrom ?? "");
      const to = toD ? formatDateDot(toD) : (args.dateTo ?? "");
      return `CNCxSOHO-Documents-${from}_${to}.zip`;
    }
    case "multi":
    default:
      return `CNCxSOHO-Documents-${today}.zip`;
  }
}

// ── Route registration (filled in later tasks) ─────────────────────────────

export function registerBulkDownloadRoutes(_app: Express): void {
  throw new Error("not implemented");
}
