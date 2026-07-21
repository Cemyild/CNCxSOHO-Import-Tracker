import * as XLSX from "xlsx";
import { countRecognizedHeaders } from "./column-profile";
import type { ParsedWorkbook, RawRow, SkippedRow } from "./types";

export interface ParseOverrides {
  sheetName?: string;
  headerRowIndex?: number;
}

export class EnrichmentParseError extends Error {
  constructor(
    public code: "no_data" | "no_headers" | "sheet_not_found",
    message: string,
    /** For `no_headers`: the headers that were actually seen. */
    public detectedHeaders: string[] = [],
    /** For `sheet_not_found`: the sheets that do contain data. */
    public availableSheets: string[] = [],
  ) {
    super(message);
    this.name = "EnrichmentParseError";
  }
}

/** How far down the sheet we look for the header row. */
const HEADER_SEARCH_DEPTH = 10;
/** Fewer recognized columns than this means "this is not the report". */
const MIN_RECOGNIZED_HEADERS = 3;

function sheetToRows(sheet: XLSX.WorkSheet): unknown[][] {
  if (!sheet["!ref"]) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true,
  }) as unknown[][];
}

function isBlank(cell: unknown): boolean {
  return cell === null || cell === undefined || String(cell).trim() === "";
}

/** The report ends with a "TOPLAM KAYIT : 24" summary line. */
function isTotalRow(row: unknown[]): boolean {
  const first = row.find((cell) => !isBlank(cell));
  if (first === undefined) return false;
  return String(first).toLocaleUpperCase("tr-TR").includes("TOPLAM");
}

/** Scores each candidate header row and returns the best one. */
function findHeaderRow(rows: unknown[][]): { index: number; score: number } {
  let best = { index: 0, score: -1 };
  const depth = Math.min(rows.length, HEADER_SEARCH_DEPTH);
  for (let i = 0; i < depth; i++) {
    const score = countRecognizedHeaders(rows[i] ?? []);
    if (score > best.score) best = { index: i, score };
  }
  return best;
}

export function parseWorkbook(
  buffer: Buffer,
  overrides: ParseOverrides = {},
): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const availableSheets = workbook.SheetNames;

  const populated = availableSheets
    .map((name) => ({ name, rows: sheetToRows(workbook.Sheets[name]) }))
    .filter((sheet) => sheet.rows.length > 0);

  if (populated.length === 0) {
    throw new EnrichmentParseError("no_data", "Workbook contains no data rows");
  }

  // Pick the sheet whose best candidate header row recognizes the most
  // columns. The real report keeps its data on the SECOND sheet.
  let chosen = overrides.sheetName
    ? populated.find((sheet) => sheet.name === overrides.sheetName)
    : undefined;

  if (overrides.sheetName && !chosen) {
    throw new EnrichmentParseError(
      "sheet_not_found",
      `Requested sheet "${overrides.sheetName}" does not exist or contains no data`,
      [],
      populated.map((sheet) => sheet.name),
    );
  }

  if (!chosen) {
    chosen = populated.reduce((best, sheet) =>
      findHeaderRow(sheet.rows).score > findHeaderRow(best.rows).score ? sheet : best,
    );
  }

  const headerRowIndex =
    overrides.headerRowIndex ?? findHeaderRow(chosen.rows).index;
  const headers = (chosen.rows[headerRowIndex] ?? []).map((h) =>
    isBlank(h) ? "" : String(h),
  );

  if (countRecognizedHeaders(headers) < MIN_RECOGNIZED_HEADERS) {
    throw new EnrichmentParseError(
      "no_headers",
      "No recognizable columns found in this workbook",
      headers.filter((h) => h !== ""),
    );
  }

  const dataRows: RawRow[] = [];
  const skippedRows: SkippedRow[] = [];

  for (let i = headerRowIndex + 1; i < chosen.rows.length; i++) {
    const cells = chosen.rows[i] ?? [];
    const excelRowNumber = i + 1; // sheet index is 0-based, Excel is 1-based

    if (cells.every(isBlank)) {
      skippedRows.push({ excelRowNumber, reason: "empty_row" });
      continue;
    }
    if (isTotalRow(cells)) {
      skippedRows.push({ excelRowNumber, reason: "total_row" });
      continue;
    }
    dataRows.push({ excelRowNumber, cells });
  }

  return {
    sheetName: chosen.name,
    availableSheets,
    headerRowIndex,
    headers,
    dataRows,
    skippedRows,
  };
}
