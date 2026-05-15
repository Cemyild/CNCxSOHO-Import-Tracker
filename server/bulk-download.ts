import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { procedures, expenseDocuments } from "@shared/schema";
import { inArray, eq } from "drizzle-orm";
import { getFile } from "./object-storage";

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

const MANIFEST_COLUMNS: (keyof ManifestRow)[] = [
  "procedureReference",
  "importDecNumber",
  "importDecDate",
  "shipper",
  "category",
  "originalFilename",
  "pathInZip",
  "fileSizeBytes",
  "status",
];

const MANIFEST_HEADER = [
  "procedure_reference",
  "import_dec_number",
  "import_dec_date",
  "shipper",
  "category",
  "original_filename",
  "path_in_zip",
  "file_size_bytes",
  "status",
].join(",");

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Render a list of manifest rows as a UTF-8 BOM-prefixed CSV Buffer.
 * Columns are listed in the spec. CSV escaping: wrap in "..." if the value
 * contains ',' '"' '\n' '\r'; escape internal '"' as '""'.
 */
export function buildManifestCsv(rows: ManifestRow[]): Buffer {
  const formatted = rows.map((r) => {
    const decDateOut = r.importDecDate
      ? (() => {
          const d = parseImportDecDate(r.importDecDate);
          return d ? formatDateSlash(d) : r.importDecDate;
        })()
      : "";
    return [
      r.procedureReference,
      r.importDecNumber ?? "",
      decDateOut,
      r.shipper ?? "",
      r.category,
      r.originalFilename,
      r.pathInZip,
      r.fileSizeBytes,
      r.status,
    ]
      .map(csvCell)
      .join(",");
  });
  const body = [MANIFEST_HEADER, ...formatted].join("\r\n") + "\r\n";
  return Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(body, "utf-8")]);
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

// ── Request validation ─────────────────────────────────────────────────────

export const bulkDownloadRequestSchema = z
  .object({
    mode: z.enum(["single", "multi", "dateRange", "all"]),
    procedureIds: z.array(z.number().int().positive()).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "single") {
      if (!data.procedureIds || data.procedureIds.length !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "single mode requires exactly one procedureId" });
      }
    }
    if (data.mode === "multi") {
      if (!data.procedureIds || data.procedureIds.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "multi mode requires at least one procedureId" });
      }
    }
    if (data.mode === "dateRange") {
      if (!data.dateFrom || !data.dateTo) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dateRange mode requires dateFrom and dateTo" });
      }
    }
  });

export type BulkDownloadRequest = z.infer<typeof bulkDownloadRequestSchema>;

// ── Procedure resolver ─────────────────────────────────────────────────────

export interface ResolvedProcedures {
  procedures: Array<{
    id: number;
    reference: string;
    importDecNumber: string | null;
    importDecDate: string | null;
    shipper: string | null;
  }>;
  excludedNoDecDate: number;
}

export async function resolveProcedureIds(req: BulkDownloadRequest): Promise<ResolvedProcedures> {
  // Load the slim columns we need from procedures
  const allRows = await db
    .select({
      id: procedures.id,
      reference: procedures.reference,
      importDecNumber: procedures.import_dec_number,
      importDecDate: procedures.import_dec_date,
      shipper: procedures.shipper,
    })
    .from(procedures);

  // Drop rows with no reference — they can't appear in a ZIP path anyway
  const withRef = allRows
    .filter((r) => r.reference != null && r.reference.trim() !== "")
    .map((r) => ({
      id: r.id,
      reference: r.reference as string,
      importDecNumber: r.importDecNumber,
      importDecDate: r.importDecDate,
      shipper: r.shipper,
    }));

  if (req.mode === "single" || req.mode === "multi") {
    const ids = new Set(req.procedureIds ?? []);
    return { procedures: withRef.filter((r) => ids.has(r.id)), excludedNoDecDate: 0 };
  }

  if (req.mode === "all") {
    return { procedures: withRef, excludedNoDecDate: 0 };
  }

  // dateRange
  const from = parseImportDecDate(req.dateFrom ?? null);
  const to = parseImportDecDate(req.dateTo ?? null);
  if (!from || !to) return { procedures: [], excludedNoDecDate: 0 };

  const fromTs = from.getTime();
  const toTs = to.getTime();
  let excluded = 0;
  const matched = withRef.filter((r) => {
    const d = parseImportDecDate(r.importDecDate);
    if (!d) {
      excluded++;
      return false;
    }
    const ts = d.getTime();
    return ts >= fromTs && ts <= toTs;
  });

  return { procedures: matched, excludedNoDecDate: excluded };
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerBulkDownloadRoutes(app: Express): void {
  app.post("/api/bulk-download/count", async (req: Request, res: Response) => {
    try {
      const parsed = bulkDownloadRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }
      const body = parsed.data;
      const { procedures: matched, excludedNoDecDate } = await resolveProcedureIds(body);

      if (matched.length === 0) {
        return res.json({ procedureCount: 0, fileCount: 0, totalBytes: 0, excludedNoDecDate });
      }

      const docs = await db
        .select({
          procedureReference: expenseDocuments.procedureReference,
          fileSize: expenseDocuments.fileSize,
        })
        .from(expenseDocuments)
        .where(inArray(expenseDocuments.procedureReference, matched.map((m) => m.reference)));

      const refSet = new Set(docs.map((d) => d.procedureReference));
      const totalBytes = docs.reduce((sum, d) => sum + (d.fileSize ?? 0), 0);

      return res.json({
        procedureCount: matched.filter((m) => refSet.has(m.reference)).length,
        fileCount: docs.length,
        totalBytes,
        excludedNoDecDate,
      });
    } catch (err) {
      console.error("bulk-download/count error:", err);
      return res.status(500).json({ error: "Internal error", details: String(err) });
    }
  });
}
