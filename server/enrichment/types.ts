/** The procedure columns this feature is allowed to write. */
export type EnrichField =
  | "invoice_no"
  | "invoice_date"
  | "amount"
  | "currency"
  | "usdtl_rate"
  | "import_dec_number"
  | "import_dec_date"
  | "customs"
  | "shipper"
  | "package"
  | "kg"
  | "freight_amount"
  | "customs_file_no";

/** How each field's raw cell value must be cleaned. */
export type FieldKind = "text" | "number" | "date" | "customs";

export const FIELD_KIND: Record<EnrichField, FieldKind> = {
  invoice_no: "text",
  invoice_date: "date",
  amount: "number",
  currency: "text",
  usdtl_rate: "number",
  import_dec_number: "text",
  import_dec_date: "date",
  customs: "customs",
  shipper: "text",
  package: "text",
  kg: "number",
  freight_amount: "number",
  customs_file_no: "text",
};

/** Fields whose DB value counts as "empty" when it is 0. */
export const NUMERIC_FIELDS: EnrichField[] = [
  "amount",
  "kg",
  "usdtl_rate",
  "freight_amount",
];

export type EnrichValue = string | number | null;

/** One raw data row straight out of the sheet. */
export interface RawRow {
  /** 1-based row number exactly as Excel shows it. */
  excelRowNumber: number;
  cells: unknown[];
}

export type SkipReason = "total_row" | "empty_row" | "no_mapped_values";

export interface SkippedRow {
  excelRowNumber: number;
  reason: SkipReason;
}

export interface ParsedWorkbook {
  sheetName: string;
  availableSheets: string[];
  /** 0-based index of the header row inside the sheet. */
  headerRowIndex: number;
  headers: string[];
  dataRows: RawRow[];
  skippedRows: SkippedRow[];
}

export interface MappedColumn {
  field: EnrichField;
  colIndex: number;
  header: string;
}

/** A header that maps to a field but lost to a higher-priority candidate. */
export interface UnusedColumn {
  field: EnrichField;
  colIndex: number;
  header: string;
  winnerHeader: string;
}

export interface ColumnProfile {
  mapped: MappedColumn[];
  unusedCandidates: UnusedColumn[];
  unmappedHeaders: string[];
}

/** One data row after the profile and normalizers have been applied. */
export interface EnrichRow {
  excelRowNumber: number;
  values: Partial<Record<EnrichField, EnrichValue>>;
}

export type MatchMethod = "invoice_no" | "invoice_no+amount" | "amount";

export interface MatchedGroup {
  procedureId: number;
  reference: string;
  matchMethod: MatchMethod;
  /** Every Excel row that folded into this procedure (AN + IM). */
  excelRowNumbers: number[];
  values: Partial<Record<EnrichField, EnrichValue>>;
}

export type UnmatchedReason = "not_found" | "ambiguous" | "no_key";

export interface UnmatchedRow {
  excelRowNumber: number;
  customsFileNo: string | null;
  reason: UnmatchedReason;
  /** Human-readable explanation, already localized-agnostic (values only). */
  invoiceNo: string | null;
  amount: number | null;
  /** References of the candidates when reason === "ambiguous". */
  candidates: string[];
}

export interface MatchResult {
  matched: MatchedGroup[];
  unmatched: UnmatchedRow[];
}

export interface FieldChange {
  field: EnrichField;
  oldValue: EnrichValue;
  newValue: string;
}
