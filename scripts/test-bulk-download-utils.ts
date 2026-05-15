/*
 * Standalone assertion runner for server/bulk-download.ts utilities.
 * Run with: npx tsx scripts/test-bulk-download-utils.ts
 *
 * Matches the project's existing convention (one-off scripts in scripts/).
 * No test framework is installed — this is intentional. Each PASS prints,
 * each FAIL prints and the process exits non-zero.
 */
import {
  parseImportDecDate,
  formatDateDot,
  formatDateSlash,
  sanitizePathSegment,
  buildProcedureFolderName,
  subfolderForExpenseType,
  dedupFilenames,
  buildManifestCsv,
  buildZipFilename,
} from "../server/bulk-download";

let failures = 0;
function eq<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.error(`  FAIL  ${label}`);
    console.error(`        expected: ${JSON.stringify(expected)}`);
    console.error(`        actual:   ${JSON.stringify(actual)}`);
  }
}
function group(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}

// ─── parseImportDecDate ────────────────────────────────────────────────────
group("parseImportDecDate", () => {
  eq(parseImportDecDate("2024-03-15")?.toISOString().slice(0, 10), "2024-03-15", "yyyy-mm-dd");
  eq(parseImportDecDate("15/03/2024")?.toISOString().slice(0, 10), "2024-03-15", "dd/mm/yyyy");
  eq(parseImportDecDate("15.03.2024")?.toISOString().slice(0, 10), "2024-03-15", "dd.mm.yyyy");
  eq(parseImportDecDate("15-03-2024")?.toISOString().slice(0, 10), "2024-03-15", "dd-mm-yyyy");
  eq(parseImportDecDate(null), null, "null input");
  eq(parseImportDecDate(""), null, "empty string");
  eq(parseImportDecDate("   "), null, "whitespace only");
  eq(parseImportDecDate("nonsense"), null, "garbage input");
  eq(parseImportDecDate("31/02/2024"), null, "invalid date (Feb 31)");
});

// ─── formatDateDot / formatDateSlash ──────────────────────────────────────
group("formatDateDot / formatDateSlash", () => {
  const d = new Date(Date.UTC(2024, 2, 5)); // 5 March 2024
  eq(formatDateDot(d), "05.03.2024", "dot format with leading zeros");
  eq(formatDateSlash(d), "05/03/2024", "slash format with leading zeros");
});

// ─── sanitizePathSegment ───────────────────────────────────────────────────
group("sanitizePathSegment", () => {
  eq(sanitizePathSegment("hello/world"), "hello_world", "single slash");
  eq(sanitizePathSegment(`a/b\\c:d*e?f"g<h>i|j`), "a_b_c_d_e_f_g_h_i_j", "all illegal chars");
  eq(sanitizePathSegment("a///b"), "a_b", "collapse multiple _");
  eq(sanitizePathSegment("  spaced  "), "spaced", "trim whitespace");
  eq(sanitizePathSegment("clean"), "clean", "no-op when clean");
});

// ─── buildProcedureFolderName ──────────────────────────────────────────────
group("buildProcedureFolderName", () => {
  eq(
    buildProcedureFolderName({ reference: "CNCALO-1", importDecNumber: "25341200IM010527", importDecDate: "15/03/2024" }),
    "CNCALO-1 - 25341200IM010527 - 15.03.2024",
    "both fields present",
  );
  eq(
    buildProcedureFolderName({ reference: "CNCALO-1", importDecNumber: "25341200IM010527", importDecDate: null }),
    "CNCALO-1 - 25341200IM010527",
    "only dec number",
  );
  eq(
    buildProcedureFolderName({ reference: "CNCALO-1", importDecNumber: null, importDecDate: "15/03/2024" }),
    "CNCALO-1 - 15.03.2024",
    "only dec date",
  );
  eq(
    buildProcedureFolderName({ reference: "CNCALO-1", importDecNumber: null, importDecDate: null }),
    "CNCALO-1",
    "reference only",
  );
  eq(
    buildProcedureFolderName({ reference: "CNCALO-1", importDecNumber: "BAD/NUMBER", importDecDate: null }),
    "CNCALO-1 - BAD_NUMBER",
    "sanitizes dec number",
  );
  eq(
    buildProcedureFolderName({ reference: "CNCALO-1", importDecNumber: null, importDecDate: "nonsense" }),
    "CNCALO-1 - nonsense",
    "unparseable date falls through sanitized",
  );
});

// ─── subfolderForExpenseType ───────────────────────────────────────────────
group("subfolderForExpenseType", () => {
  eq(subfolderForExpenseType("import_document"), "01-Import-Documents", "import_document");
  eq(subfolderForExpenseType("import_expense"), "02-Expense-Receipts", "import_expense");
  eq(subfolderForExpenseType("service_invoice"), "03-Service-Invoices", "service_invoice");
  eq(subfolderForExpenseType("tax"), "04-Tax-Documents", "tax");
  eq(subfolderForExpenseType("unknown_type"), "99-Other", "unknown falls back to 99-Other");
});

// ─── dedupFilenames ────────────────────────────────────────────────────────
group("dedupFilenames", () => {
  eq(
    dedupFilenames([
      { originalFilename: "Invoice.pdf" },
      { originalFilename: "Invoice.pdf" },
      { originalFilename: "Invoice.pdf" },
    ]).map((r) => r.name),
    ["Invoice.pdf", "Invoice (2).pdf", "Invoice (3).pdf"],
    "three duplicates suffixed",
  );
  eq(
    dedupFilenames([{ originalFilename: "noext" }, { originalFilename: "noext" }]).map((r) => r.name),
    ["noext", "noext (2)"],
    "no extension",
  );
  eq(
    dedupFilenames([{ originalFilename: "a.pdf" }, { originalFilename: "b.pdf" }]).map((r) => r.name),
    ["a.pdf", "b.pdf"],
    "no duplicates leaves names alone",
  );
});

// ─── buildManifestCsv ──────────────────────────────────────────────────────
group("buildManifestCsv", () => {
  const csv = buildManifestCsv([
    {
      procedureReference: "CNCALO-1",
      importDecNumber: "25341200IM010527",
      importDecDate: "15/03/2024",
      shipper: "ALO YOGA",
      category: "01-Import-Documents",
      originalFilename: "Invoice.pdf",
      pathInZip: "CNCALO-1 - 25341200IM010527 - 15.03.2024/01-Import-Documents/Invoice.pdf",
      fileSizeBytes: 12345,
      status: "OK",
    },
    {
      procedureReference: "CNCALO-2",
      importDecNumber: null,
      importDecDate: null,
      shipper: "He said \"hi, there\"",
      category: "02-Expense-Receipts",
      originalFilename: "weird,name.pdf",
      pathInZip: "CNCALO-2/02-Expense-Receipts/weird,name.pdf",
      fileSizeBytes: 0,
      status: "ERROR: not found",
    },
  ]);
  const txt = csv.toString("utf-8");
  eq(txt.charCodeAt(0), 0xfeff, "starts with UTF-8 BOM");
  eq(
    txt.includes(`procedure_reference,import_dec_number,import_dec_date,shipper,category,original_filename,path_in_zip,file_size_bytes,status`),
    true,
    "header row present",
  );
  eq(txt.includes(`CNCALO-1,25341200IM010527,15/03/2024,ALO YOGA,01-Import-Documents,Invoice.pdf,`), true, "row 1 unquoted");
  eq(txt.includes(`"He said ""hi, there"""`), true, "row 2 shipper escaped");
  eq(txt.includes(`"weird,name.pdf"`), true, "row 2 filename quoted for comma");
  eq(txt.includes(`ERROR: not found`), true, "row 2 status preserved");
});

// ─── buildZipFilename ──────────────────────────────────────────────────────
group("buildZipFilename", () => {
  const today = new Date(Date.UTC(2026, 4, 15)); // 15 May 2026
  eq(buildZipFilename({ mode: "single", singleReference: "CNCALO-1", today }), "CNCxSOHO-CNCALO-1-15.05.2026.zip", "single");
  eq(buildZipFilename({ mode: "multi", today }), "CNCxSOHO-Documents-15.05.2026.zip", "multi");
  eq(buildZipFilename({ mode: "all", today }), "CNCxSOHO-Documents-All-15.05.2026.zip", "all");
  eq(
    buildZipFilename({ mode: "dateRange", dateFrom: "2024-01-01", dateTo: "2024-12-31", today }),
    "CNCxSOHO-Documents-01.01.2024_31.12.2024.zip",
    "dateRange",
  );
});

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures > 0 ? 1 : 0);
