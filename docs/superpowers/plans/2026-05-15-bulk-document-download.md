# Bulk Document Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Bulk Download" page that lets users download import documents as an organized ZIP in four modes: single procedure (dropdown), multi-select (checkboxes), date range (filtered by `import_dec_date`), or everything (one click).

**Architecture:** Synchronous server-side streaming ZIP via `archiver`. The server fetches each file sequentially from Hetzner S3-compatible object storage (via `getFile` in `server/object-storage.ts`) and appends it to a streamed ZIP piped directly to the response. Pure utility functions (date parsing, folder-name building, filename dedup, manifest CSV) live alongside the route handlers in `server/bulk-download.ts` and are exercised by a stand-alone `tsx` test script — the project has no test framework, so we use the same one-off-script convention used by `scripts/migrate-*.ts`.

**Tech Stack:** Node.js + Express + Drizzle ORM (PostgreSQL/Neon) on the backend; React 18 + TanStack Query + Wouter + shadcn/ui on the frontend. New runtime dependency: `archiver`.

---

## Spec reference

Full design: `docs/superpowers/specs/2026-05-15-bulk-document-download-design.md` (in this repo).

## File structure

**New:**
- `server/bulk-download.ts` — utility functions + two route handlers (`registerBulkDownloadRoutes(app)`)
- `scripts/test-bulk-download-utils.ts` — assertion-based test runner for the pure utilities
- `client/src/pages/bulk-download.tsx` — page component with four tab modes

**Modified:**
- `server/routes.ts` — mount the new routes inside `registerRoutes`
- `client/src/App.tsx` — register `/bulk-download` route
- `client/src/lib/nav-items.tsx` — append nav item
- `package.json` — add `archiver` + `@types/archiver`

---

## Task 1: Add archiver dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install archiver and its types**

Run from the repo root:

```bash
npm install archiver@^7.0.1
npm install --save-dev @types/archiver@^6.0.2
```

Expected: both lines appear in `package.json`. `node_modules/archiver/package.json` exists.

- [ ] **Step 2: Verify the install — quick smoke import**

Run:

```bash
npx tsx -e "import('archiver').then(m => console.log('archiver loaded:', typeof m.default))"
```

Expected stdout contains `archiver loaded: function`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add archiver dependency for bulk download streaming ZIP"
```

---

## Task 2: Scaffold server/bulk-download.ts and the test runner

**Files:**
- Create: `server/bulk-download.ts`
- Create: `scripts/test-bulk-download-utils.ts`

- [ ] **Step 1: Create the scaffolded utility module**

Write to `server/bulk-download.ts`:

```ts
import type { Express, Request, Response } from "express";

// ── Pure utilities (exported for testing) ──────────────────────────────────

/**
 * Lenient parser for procedures.import_dec_date (text column with no enforced format).
 * Accepts: yyyy-mm-dd, dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy.
 * Returns null for null/empty/unparseable input.
 */
export function parseImportDecDate(_text: string | null | undefined): Date | null {
  throw new Error("not implemented");
}

/**
 * Format a Date as dd.mm.yyyy (used inside ZIP folder names — slash is illegal there).
 */
export function formatDateDot(_d: Date): string {
  throw new Error("not implemented");
}

/**
 * Format a Date as dd/mm/yyyy (used in UI strings and the manifest CSV).
 */
export function formatDateSlash(_d: Date): string {
  throw new Error("not implemented");
}

/**
 * Replace illegal filesystem/ZIP characters (/ \ : * ? " < > |) with _ and collapse runs of _.
 */
export function sanitizePathSegment(_s: string): string {
  throw new Error("not implemented");
}

/**
 * Build the per-procedure folder name: "<reference> - <dec_no> - <dd.mm.yyyy>".
 * Missing fields are simply omitted (no placeholder), separator " - " collapses.
 */
export function buildProcedureFolderName(_args: {
  reference: string;
  importDecNumber: string | null;
  importDecDate: string | null;
}): string {
  throw new Error("not implemented");
}

/**
 * Map expense_documents.expenseType to the subfolder name inside a procedure folder.
 */
export function subfolderForExpenseType(_t: string): string {
  throw new Error("not implemented");
}

/**
 * Deduplicate filenames within the same target folder by suffixing " (2)", " (3)" ...
 * Input items are returned in the same order with a new `name` field.
 */
export function dedupFilenames<T extends { originalFilename: string }>(_items: T[]): (T & { name: string })[] {
  throw new Error("not implemented");
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
export function buildZipFilename(_args: {
  mode: "single" | "multi" | "dateRange" | "all";
  singleReference?: string;
  dateFrom?: string;
  dateTo?: string;
  today: Date;
}): string {
  throw new Error("not implemented");
}

// ── Route registration (filled in later tasks) ─────────────────────────────

export function registerBulkDownloadRoutes(_app: Express): void {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Create the failing test runner**

Write to `scripts/test-bulk-download-utils.ts`:

```ts
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
```

- [ ] **Step 3: Run the test runner to confirm everything fails**

```bash
npx tsx scripts/test-bulk-download-utils.ts
```

Expected: all tests throw `not implemented`, runner reports failures and exits with code 1.

- [ ] **Step 4: Commit**

```bash
git add server/bulk-download.ts scripts/test-bulk-download-utils.ts
git commit -m "feat(bulk-download): scaffold module + standalone test runner"
```

---

## Task 3: Implement parseImportDecDate, formatDateDot, formatDateSlash

**Files:**
- Modify: `server/bulk-download.ts` (replace the three function bodies)

- [ ] **Step 1: Implement the date helpers**

Replace the bodies of `parseImportDecDate`, `formatDateDot`, `formatDateSlash`:

```ts
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

export function formatDateDot(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function formatDateSlash(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
```

- [ ] **Step 2: Run the tests — date helpers should now pass**

```bash
npx tsx scripts/test-bulk-download-utils.ts
```

Expected: all assertions in `parseImportDecDate` and `formatDateDot / formatDateSlash` groups PASS. Other groups still FAIL.

- [ ] **Step 3: Commit**

```bash
git add server/bulk-download.ts
git commit -m "feat(bulk-download): implement date parser and dd.mm.yyyy / dd/mm/yyyy formatters"
```

---

## Task 4: Implement sanitizePathSegment, buildProcedureFolderName, subfolderForExpenseType

**Files:**
- Modify: `server/bulk-download.ts`

- [ ] **Step 1: Implement the three functions**

Replace their bodies:

```ts
export function sanitizePathSegment(s: string): string {
  return s
    .replace(/[\/\\:\*\?"<>|]/g, "_")
    .replace(/_+/g, "_")
    .trim();
}

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

export function subfolderForExpenseType(t: string): string {
  return SUBFOLDER_MAP[t] ?? "99-Other";
}
```

- [ ] **Step 2: Run the tests — folder/subfolder groups should pass**

```bash
npx tsx scripts/test-bulk-download-utils.ts
```

Expected: `sanitizePathSegment`, `buildProcedureFolderName`, `subfolderForExpenseType` groups all PASS. `dedupFilenames`, `buildManifestCsv`, `buildZipFilename` still fail.

- [ ] **Step 3: Commit**

```bash
git add server/bulk-download.ts
git commit -m "feat(bulk-download): implement path sanitizer, folder-name builder, subfolder map"
```

---

## Task 5: Implement dedupFilenames and buildZipFilename

**Files:**
- Modify: `server/bulk-download.ts`

- [ ] **Step 1: Implement both**

Replace their bodies:

```ts
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
```

- [ ] **Step 2: Run tests**

```bash
npx tsx scripts/test-bulk-download-utils.ts
```

Expected: `dedupFilenames` and `buildZipFilename` groups PASS. Only `buildManifestCsv` still fails.

- [ ] **Step 3: Commit**

```bash
git add server/bulk-download.ts
git commit -m "feat(bulk-download): implement filename dedup and zip-filename builder"
```

---

## Task 6: Implement buildManifestCsv

**Files:**
- Modify: `server/bulk-download.ts`

- [ ] **Step 1: Implement the CSV builder**

Replace the body of `buildManifestCsv`:

```ts
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
  return Buffer.concat([Buffer.from("﻿", "utf-8"), Buffer.from(body, "utf-8")]);
}
```

- [ ] **Step 2: Run tests — all should pass**

```bash
npx tsx scripts/test-bulk-download-utils.ts
```

Expected: final line reads `ALL PASS` and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add server/bulk-download.ts
git commit -m "feat(bulk-download): implement manifest CSV builder with BOM and proper escaping"
```

---

## Task 7: Implement the request validator and procedure resolver

**Files:**
- Modify: `server/bulk-download.ts`

The two endpoints share the same request shape and resolution logic. We add zod validation and a `resolveProcedureIds` function that returns the procedures we will pack plus the `excludedNoDecDate` count for the count endpoint.

- [ ] **Step 1: Add imports and the validator at the top of the file**

Insert after the existing imports in `server/bulk-download.ts`:

```ts
import { z } from "zod";
import { db } from "./db";
import { procedures, expenseDocuments } from "@shared/schema";
import { inArray, eq } from "drizzle-orm";
import { getFile } from "./object-storage";
```

Then below the existing utilities (before `registerBulkDownloadRoutes`), add the schema:

```ts
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
```

- [ ] **Step 2: Add the resolver below the schema**

```ts
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
```

- [ ] **Step 3: Type-check the module**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no new errors related to `server/bulk-download.ts`. (Pre-existing errors elsewhere in the codebase are unchanged.)

- [ ] **Step 4: Commit**

```bash
git add server/bulk-download.ts
git commit -m "feat(bulk-download): add zod validator and procedure resolver (4 modes)"
```

---

## Task 8: Implement POST /api/bulk-download/count

**Files:**
- Modify: `server/bulk-download.ts`

- [ ] **Step 1: Replace registerBulkDownloadRoutes with a partial implementation that only mounts the count endpoint**

```ts
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
```

- [ ] **Step 2: Mount the route in server/routes.ts**

In `server/routes.ts`, find the import block near the top (around line 1-50, where `db` and other modules are imported) and add:

```ts
import { registerBulkDownloadRoutes } from "./bulk-download";
```

Then near the end of `registerRoutes(app)` — just before the final `return httpServer;` line — add:

```ts
  registerBulkDownloadRoutes(app);
```

- [ ] **Step 3: Start the dev server and smoke test with curl**

In one terminal:

```bash
npm run dev
```

Wait for `serving on port 5000` (or similar).

In another terminal, hit the count endpoint with an `all` body:

```bash
curl -s -X POST http://localhost:5000/api/bulk-download/count \
  -H 'Content-Type: application/json' \
  -b 'connect.sid=<session-cookie-from-browser>' \
  -d '{"mode":"all"}' | jq
```

Expected: JSON like `{ "procedureCount": 30, "fileCount": 410, "totalBytes": 123456789, "excludedNoDecDate": 0 }` (numbers depend on real data). If you get `Unauthorized`, log in via the browser first and copy the `connect.sid` cookie from DevTools.

Then test a `dateRange` body to verify the `excludedNoDecDate` count appears:

```bash
curl -s -X POST http://localhost:5000/api/bulk-download/count \
  -H 'Content-Type: application/json' \
  -b 'connect.sid=<session-cookie>' \
  -d '{"mode":"dateRange","dateFrom":"2024-01-01","dateTo":"2024-12-31"}' | jq
```

Expected: `excludedNoDecDate` is a non-negative integer; `procedureCount` ≤ total procedures.

Test a malformed body returns 400:

```bash
curl -s -X POST http://localhost:5000/api/bulk-download/count \
  -H 'Content-Type: application/json' \
  -b 'connect.sid=<session-cookie>' \
  -d '{"mode":"single"}' -w '\nHTTP %{http_code}\n'
```

Expected: `HTTP 400`, body contains the message about `single mode requires exactly one procedureId`.

- [ ] **Step 4: Commit**

```bash
git add server/bulk-download.ts server/routes.ts
git commit -m "feat(bulk-download): POST /api/bulk-download/count preview endpoint"
```

---

## Task 9: Implement POST /api/bulk-download (streaming ZIP)

**Files:**
- Modify: `server/bulk-download.ts`

- [ ] **Step 1: Add the archiver import and the streaming endpoint**

At the top of `server/bulk-download.ts` (with the other imports):

```ts
import archiver from "archiver";
```

In `registerBulkDownloadRoutes(app)`, after the count endpoint, add:

```ts
  app.post("/api/bulk-download", async (req: Request, res: Response) => {
    const parsed = bulkDownloadRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const body = parsed.data;

    let resolved: ResolvedProcedures;
    try {
      resolved = await resolveProcedureIds(body);
    } catch (err) {
      console.error("bulk-download resolve error:", err);
      return res.status(500).json({ error: "Failed to resolve procedures", details: String(err) });
    }

    if (resolved.procedures.length === 0) {
      return res.status(400).json({ error: "No procedures match the filter" });
    }

    // Fetch document metadata for all matched procedures in one query
    const docs = await db
      .select()
      .from(expenseDocuments)
      .where(inArray(expenseDocuments.procedureReference, resolved.procedures.map((p) => p.reference)));

    if (docs.length === 0) {
      return res.status(400).json({ error: "No documents found for the selected procedures" });
    }

    // Index procedures by reference for fast folder-name lookup
    const procByRef = new Map(resolved.procedures.map((p) => [p.reference, p]));

    // Group documents by (procedureReference, expenseType) and dedup names inside each bucket
    interface PlannedFile {
      doc: typeof docs[number];
      pathInZip: string;
    }
    const planned: PlannedFile[] = [];

    const grouped = new Map<string, typeof docs>();
    for (const d of docs) {
      const key = `${d.procedureReference}::${d.expenseType}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(d);
    }

    for (const [key, group] of grouped) {
      const [ref, expenseType] = key.split("::");
      const proc = procByRef.get(ref);
      if (!proc) continue;
      const folder = buildProcedureFolderName({
        reference: proc.reference,
        importDecNumber: proc.importDecNumber,
        importDecDate: proc.importDecDate,
      });
      const subfolder = subfolderForExpenseType(expenseType);
      const deduped = dedupFilenames(group);
      for (const d of deduped) {
        planned.push({ doc: d, pathInZip: `${folder}/${subfolder}/${d.name}` });
      }
    }

    // Compute filename and headers
    const today = new Date();
    const zipFilename = buildZipFilename({
      mode: body.mode,
      singleReference: body.mode === "single" ? procByRef.get(resolved.procedures[0].reference)?.reference : undefined,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      today,
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.on("warning", (err) => console.warn("archiver warning:", err));
    archive.on("error", (err) => {
      console.error("archiver error:", err);
      // Once we've started piping we can't change the status code; just end the stream.
      try { res.end(); } catch {}
    });
    archive.pipe(res);

    // Sequentially fetch each file from S3 object storage and append to the archive.
    const manifestRows: ManifestRow[] = [];
    for (const p of planned) {
      const proc = procByRef.get(p.doc.procedureReference);
      const baseRow: ManifestRow = {
        procedureReference: p.doc.procedureReference,
        importDecNumber: proc?.importDecNumber ?? null,
        importDecDate: proc?.importDecDate ?? null,
        shipper: proc?.shipper ?? null,
        category: subfolderForExpenseType(p.doc.expenseType),
        originalFilename: p.doc.originalFilename,
        pathInZip: p.pathInZip,
        fileSizeBytes: p.doc.fileSize ?? 0,
        status: "OK",
      };
      try {
        const { buffer } = await getFile(p.doc.objectKey);
        archive.append(buffer, { name: p.pathInZip });
        manifestRows.push(baseRow);
      } catch (err) {
        console.warn(`bulk-download: failed to fetch ${p.doc.objectKey}: ${err}`);
        manifestRows.push({ ...baseRow, status: `ERROR: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // Append manifest as the very last entry, then finalize
    archive.append(buildManifestCsv(manifestRows), { name: "manifest.csv" });
    await archive.finalize();
  });
```

- [ ] **Step 2: Smoke-test from curl — single procedure**

The dev server should still be running from Task 8. Pick a real procedure ID from your DB (e.g. via the procedures page in the browser, or `psql`).

```bash
curl -X POST http://localhost:5000/api/bulk-download \
  -H 'Content-Type: application/json' \
  -b 'connect.sid=<session-cookie>' \
  -d '{"mode":"single","procedureIds":[1]}' \
  --output /tmp/bulk-test.zip -w '\nHTTP %{http_code}, %{size_download} bytes\n'
```

Expected: `HTTP 200`, non-zero size, and the file is a valid ZIP:

```bash
unzip -l /tmp/bulk-test.zip
```

Should list `manifest.csv` plus paths like `CNCALO-1 - .../01-Import-Documents/Invoice.pdf`.

- [ ] **Step 3: Smoke-test — date range and all**

```bash
curl -X POST http://localhost:5000/api/bulk-download \
  -H 'Content-Type: application/json' \
  -b 'connect.sid=<session-cookie>' \
  -d '{"mode":"dateRange","dateFrom":"2024-01-01","dateTo":"2024-06-30"}' \
  --output /tmp/bulk-range.zip

unzip -l /tmp/bulk-range.zip | tail -20
```

Expected: a ZIP with multiple procedure folders, `manifest.csv` at root.

Test "no procedures match" → 400:

```bash
curl -s -X POST http://localhost:5000/api/bulk-download \
  -H 'Content-Type: application/json' \
  -b 'connect.sid=<session-cookie>' \
  -d '{"mode":"dateRange","dateFrom":"1999-01-01","dateTo":"1999-12-31"}' \
  -w '\nHTTP %{http_code}\n'
```

Expected: `HTTP 400`, body contains `No procedures match the filter`.

- [ ] **Step 4: Open the manifest in Excel to verify Turkish characters**

```bash
unzip -p /tmp/bulk-range.zip manifest.csv > /tmp/manifest.csv
open /tmp/manifest.csv  # macOS — adapt for Windows: "start /tmp/manifest.csv" or open in Excel directly
```

Expected: header row visible, Turkish characters in `shipper` render correctly (not as `Ã` mojibake).

- [ ] **Step 5: Commit**

```bash
git add server/bulk-download.ts
git commit -m "feat(bulk-download): POST /api/bulk-download streaming ZIP endpoint"
```

---

## Task 10: Scaffold the frontend page, add route, add nav entry

**Files:**
- Create: `client/src/pages/bulk-download.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/lib/nav-items.tsx`

- [ ] **Step 1: Create the page scaffold with four empty tabs**

Write to `client/src/pages/bulk-download.tsx`:

```tsx
import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";

type Mode = "single" | "multi" | "dateRange" | "all";

export default function BulkDownloadPage() {
  const [mode, setMode] = useState<Mode>("single");

  return (
    <PageLayout title="Bulk Document Download">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Bulk Document Download</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="multi">Multi-select</TabsTrigger>
              <TabsTrigger value="dateRange">Date Range</TabsTrigger>
              <TabsTrigger value="all">Everything</TabsTrigger>
            </TabsList>

            <TabsContent value="single">
              <p className="text-sm text-muted-foreground p-4">Single procedure tab — TODO</p>
            </TabsContent>
            <TabsContent value="multi">
              <p className="text-sm text-muted-foreground p-4">Multi-select tab — TODO</p>
            </TabsContent>
            <TabsContent value="dateRange">
              <p className="text-sm text-muted-foreground p-4">Date range tab — TODO</p>
            </TabsContent>
            <TabsContent value="all">
              <p className="text-sm text-muted-foreground p-4">Everything tab — TODO</p>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm text-muted-foreground">Selection: —</div>
            <Button disabled>
              <Download className="mr-2 h-4 w-4" />
              Download ZIP
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
```

- [ ] **Step 2: Register the route in client/src/App.tsx**

In `client/src/App.tsx`, find the import block near the top with the other `@/pages/*` imports and add:

```tsx
import BulkDownloadPage from "@/pages/bulk-download";
```

Then inside the `<Switch>` block (anywhere before the catch-all `<Route component={NotFound} />`), add:

```tsx
      <Route path="/bulk-download">
        {() => (
          <ProtectedRoute>
            <BulkDownloadPage />
          </ProtectedRoute>
        )}
      </Route>
```

- [ ] **Step 3: Add the nav item**

In `client/src/lib/nav-items.tsx`, add `Archive` to the lucide import line:

```ts
import {
  Archive,
  BarChart2,
  Calculator,
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  Sparkles,
  Warehouse,
} from "lucide-react";
```

Then add this entry in `defaultNavItems` between `"Reports"` and `"Ask CNC?"`:

```ts
  { title: "Bulk Download", url: "/bulk-download", icon: Archive },
```

- [ ] **Step 4: Visual check**

The dev server should already be running. Open `http://localhost:5000/bulk-download` in the browser. Expected:

- Sidebar shows the new "Bulk Download" item with an archive box icon.
- Page shows four tabs and a disabled Download button.
- Clicking tabs switches between the four placeholder bodies.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/bulk-download.tsx client/src/App.tsx client/src/lib/nav-items.tsx
git commit -m "feat(bulk-download): scaffold frontend page, route, and nav entry"
```

---

## Task 11: Wire up the shared request builder and count preview

We need both a shared body builder used by all four tabs and a TanStack Query that hits `/api/bulk-download/count` whenever the body changes. The summary footer updates from this.

**Files:**
- Modify: `client/src/pages/bulk-download.tsx`

- [ ] **Step 1: Add the body builder, count query, and helpers**

Replace the contents of `client/src/pages/bulk-download.tsx` with:

```tsx
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Mode = "single" | "multi" | "dateRange" | "all";

interface BulkBody {
  mode: Mode;
  procedureIds?: number[];
  dateFrom?: string;
  dateTo?: string;
}

interface CountResult {
  procedureCount: number;
  fileCount: number;
  totalBytes: number;
  excludedNoDecDate: number;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function parseFilenameFromContentDisposition(h: string | null): string | null {
  if (!h) return null;
  const m = /filename="?([^"]+)"?/.exec(h);
  return m ? m[1] : null;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isBodyReady(body: BulkBody): boolean {
  switch (body.mode) {
    case "single":
      return (body.procedureIds?.length ?? 0) === 1;
    case "multi":
      return (body.procedureIds?.length ?? 0) >= 1;
    case "dateRange":
      return !!(body.dateFrom && body.dateTo);
    case "all":
      return true;
  }
}

export default function BulkDownloadPage() {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("single");
  const [singleId, setSingleId] = useState<number | null>(null);
  const [multiIds, setMultiIds] = useState<number[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [downloading, setDownloading] = useState(false);

  const body: BulkBody = useMemo(() => {
    switch (mode) {
      case "single":
        return { mode, procedureIds: singleId != null ? [singleId] : [] };
      case "multi":
        return { mode, procedureIds: multiIds };
      case "dateRange":
        return { mode, dateFrom, dateTo };
      case "all":
        return { mode };
    }
  }, [mode, singleId, multiIds, dateFrom, dateTo]);

  const ready = isBodyReady(body);

  const { data: count } = useQuery<CountResult>({
    queryKey: ["/api/bulk-download/count", body],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/bulk-download/count", body);
      return await res.json();
    },
    enabled: ready,
  });

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch("/api/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
      const blob = await res.blob();
      const filename = parseFilenameFromContentDisposition(res.headers.get("content-disposition")) ?? "CNCxSOHO-Documents.zip";
      triggerBlobDownload(blob, filename);
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  const summaryText = !ready
    ? "Make a selection to see what will be downloaded"
    : count
      ? `${count.procedureCount} procedure${count.procedureCount === 1 ? "" : "s"} · ${count.fileCount} file${count.fileCount === 1 ? "" : "s"} · ~${formatBytes(count.totalBytes)}` +
        (count.excludedNoDecDate > 0 ? `  ·  ${count.excludedNoDecDate} excluded (no declaration date)` : "")
      : "Calculating…";

  return (
    <PageLayout title="Bulk Document Download">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Bulk Document Download</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="multi">Multi-select</TabsTrigger>
              <TabsTrigger value="dateRange">Date Range</TabsTrigger>
              <TabsTrigger value="all">Everything</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="pt-4">
              <p className="text-sm text-muted-foreground">Single procedure tab — implemented in Task 12</p>
            </TabsContent>
            <TabsContent value="multi" className="pt-4">
              <p className="text-sm text-muted-foreground">Multi-select tab — implemented in Task 13</p>
            </TabsContent>
            <TabsContent value="dateRange" className="pt-4">
              <p className="text-sm text-muted-foreground">Date range tab — implemented in Task 14</p>
            </TabsContent>
            <TabsContent value="all" className="pt-4">
              <p className="text-sm">Download every procedure's documents in one ZIP.</p>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm text-muted-foreground">{summaryText}</div>
            <Button disabled={!ready || downloading} onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              {downloading ? "Preparing…" : "Download ZIP"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
```

- [ ] **Step 2: Visual check — "Everything" mode end-to-end**

Reload `/bulk-download`. Click the "Everything" tab. The summary should populate with real numbers (e.g. `30 procedures · 410 files · ~123 MB`). Click Download ZIP.

Expected: browser downloads `CNCxSOHO-Documents-All-15.05.2026.zip`. Open it; verify the structure matches the spec.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/bulk-download.tsx
git commit -m "feat(bulk-download): wire request builder, count preview, and Everything mode"
```

---

## Task 12: Implement the Single mode tab

**Files:**
- Modify: `client/src/pages/bulk-download.tsx`

We need a fetched list of all procedures with their reference + shipper so the user can search and pick one.

- [ ] **Step 1: Add the procedure list query and Single tab content**

In `client/src/pages/bulk-download.tsx`, at the top with the existing imports add:

```tsx
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
```

Inside the component, below the existing `useQuery` for count, add a query that fetches the procedure list once:

```tsx
  interface ProcedureListItem {
    id: number;
    reference: string;
    shipper: string | null;
    import_dec_date: string | null;
  }

  const { data: procedureList = [] } = useQuery<ProcedureListItem[]>({
    queryKey: ["/api/procedures"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/procedures");
      const rows = await res.json();
      return rows.map((r: any) => ({
        id: r.id,
        reference: r.reference ?? `#${r.id}`,
        shipper: r.shipper ?? null,
        import_dec_date: r.import_dec_date ?? null,
      }));
    },
  });

  const singleSelected = procedureList.find((p) => p.id === singleId) ?? null;
  const [singleOpen, setSingleOpen] = useState(false);
```

Then replace the placeholder in `<TabsContent value="single">` with:

```tsx
            <TabsContent value="single" className="pt-4 space-y-2">
              <label className="text-sm font-medium">Procedure</label>
              <Popover open={singleOpen} onOpenChange={setSingleOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                  >
                    {singleSelected
                      ? `${singleSelected.reference}${singleSelected.shipper ? " — " + singleSelected.shipper : ""}`
                      : "Pick a procedure…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(640px,90vw)] p-0">
                  <Command>
                    <CommandInput placeholder="Search reference or shipper…" />
                    <CommandList>
                      <CommandEmpty>No matches.</CommandEmpty>
                      <CommandGroup>
                        {procedureList.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.reference} ${p.shipper ?? ""}`}
                            onSelect={() => {
                              setSingleId(p.id);
                              setSingleOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", singleId === p.id ? "opacity-100" : "opacity-0")} />
                            <span className="font-mono mr-2">{p.reference}</span>
                            {p.shipper && <span className="text-muted-foreground">— {p.shipper}</span>}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </TabsContent>
```

- [ ] **Step 2: Visual + functional check**

Open `/bulk-download`, stay on the Single tab. Click the combobox, search for a known procedure (e.g. `CNCALO-1`), select it. The summary footer should update (e.g. `1 procedure · 13 files · ~28 MB`). Click Download ZIP and verify the resulting file has exactly that one procedure folder.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/bulk-download.tsx
git commit -m "feat(bulk-download): implement Single mode with searchable combobox"
```

---

## Task 13: Implement the Multi-select mode tab

**Files:**
- Modify: `client/src/pages/bulk-download.tsx`

A scrollable list of procedures with checkboxes, a search input, and "Select all visible" / "Clear" buttons.

- [ ] **Step 1: Add Checkbox import and the multi-select state**

Add to the imports:

```tsx
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
```

Inside the component, add a search-term state and a filtered list:

```tsx
  const [multiSearch, setMultiSearch] = useState("");
  const filteredForMulti = useMemo(() => {
    const q = multiSearch.trim().toLowerCase();
    if (!q) return procedureList;
    return procedureList.filter(
      (p) =>
        p.reference.toLowerCase().includes(q) || (p.shipper ?? "").toLowerCase().includes(q),
    );
  }, [procedureList, multiSearch]);

  const allFilteredSelected =
    filteredForMulti.length > 0 && filteredForMulti.every((p) => multiIds.includes(p.id));
```

Replace the placeholder in `<TabsContent value="multi">` with:

```tsx
            <TabsContent value="multi" className="pt-4 space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Search reference or shipper…"
                  value={multiSearch}
                  onChange={(e) => setMultiSearch(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (allFilteredSelected) {
                      const filteredIds = new Set(filteredForMulti.map((p) => p.id));
                      setMultiIds(multiIds.filter((id) => !filteredIds.has(id)));
                    } else {
                      const merged = new Set([...multiIds, ...filteredForMulti.map((p) => p.id)]);
                      setMultiIds(Array.from(merged));
                    }
                  }}
                >
                  {allFilteredSelected ? "Deselect visible" : "Select visible"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMultiIds([])} disabled={multiIds.length === 0}>
                  Clear
                </Button>
              </div>

              <div className="max-h-[360px] overflow-y-auto border rounded-md divide-y">
                {filteredForMulti.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">No procedures match.</div>
                )}
                {filteredForMulti.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={multiIds.includes(p.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          if (!multiIds.includes(p.id)) setMultiIds([...multiIds, p.id]);
                        } else {
                          setMultiIds(multiIds.filter((id) => id !== p.id));
                        }
                      }}
                    />
                    <span className="font-mono text-sm w-32">{p.reference}</span>
                    <span className="text-sm text-muted-foreground flex-1 truncate">{p.shipper ?? "—"}</span>
                  </label>
                ))}
              </div>

              <div className="text-xs text-muted-foreground">
                {multiIds.length} selected ({filteredForMulti.length} visible / {procedureList.length} total)
              </div>
            </TabsContent>
```

- [ ] **Step 2: Visual + functional check**

On the Multi-select tab: type a search term, verify the list filters. Click "Select visible". The summary updates. Click Download ZIP. Resulting file contains exactly the selected procedure folders.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/bulk-download.tsx
git commit -m "feat(bulk-download): implement Multi-select mode with search and bulk controls"
```

---

## Task 14: Implement the Date Range mode tab

**Files:**
- Modify: `client/src/pages/bulk-download.tsx`

The simplest of the three remaining tabs: two date inputs + a note about excluded procedures.

- [ ] **Step 1: Add the date-range tab body**

Native `<input type="date">` is the lightest option and matches what's already used in `expenses-new.tsx`. Use ISO `yyyy-mm-dd` internally, display dd/mm/yyyy via the browser's localized input rendering.

Replace `<TabsContent value="dateRange">`:

```tsx
            <TabsContent value="dateRange" className="pt-4 space-y-3">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium block mb-1">From (Import Declaration Date)</label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    max={dateTo || undefined}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium block mb-1">To</label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    min={dateFrom || undefined}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Procedures without an Import Declaration Date are excluded from this filter.
              </p>
            </TabsContent>
```

- [ ] **Step 2: Visual + functional check**

Open the Date Range tab. Pick a range that you know covers some procedures. The summary should show non-zero counts; if any procedures lack a declaration date, the `… excluded (no declaration date)` note should appear in the footer.

Click Download. Verify the ZIP only contains procedures whose `import_dec_date` falls in the range.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/bulk-download.tsx
git commit -m "feat(bulk-download): implement Date Range mode filtering on import_dec_date"
```

---

## Task 15: Confirmation dialog for downloads over 500 MB

**Files:**
- Modify: `client/src/pages/bulk-download.tsx`

For very large downloads we ask the user to confirm — easy to remove later if it gets in the way.

- [ ] **Step 1: Add a confirmation gate to handleDownload**

The project already has `ConfirmDialog` at `client/src/components/ui/confirmation-dialog.tsx`. Inspect its exact API by reading the first 30 lines of that file (the prop names you'll need are something like `title`, `description`, `confirmText`, `open`, `onConfirm`, `onOpenChange`). If the existing API differs, adapt the snippet below.

For simplicity we use the native `window.confirm` here — no new components, zero risk of API mismatch. Replace the existing `handleDownload` body's first line:

```tsx
  async function handleDownload() {
    if (count && count.totalBytes > 500 * 1024 * 1024) {
      const mb = Math.round(count.totalBytes / (1024 * 1024));
      const proceed = window.confirm(
        `This will download about ${mb} MB and may take several minutes. Continue?`,
      );
      if (!proceed) return;
    }
    setDownloading(true);
    // … rest unchanged
```

- [ ] **Step 2: Functional check**

If your dataset doesn't exceed 500 MB, temporarily lower the threshold to `10 * 1024 * 1024` and verify the dialog appears for the Everything mode. Restore to 500 MB after testing.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/bulk-download.tsx
git commit -m "feat(bulk-download): confirm before downloading >500 MB"
```

---

## Task 16: End-to-end manual verification

**Files:** (none — this is a verification task)

Walk through every spec scenario one last time, with the dev server running. Mark each item ✅ or note the bug.

- [ ] **Step 1: Single mode** — pick CNCALO-1, download, open the ZIP. Confirm:
  - Top folder is `CNCALO-1 - <dec_no> - <dd.mm.yyyy>/` (or fewer parts if dec fields missing)
  - Subfolders `01-Import-Documents/`, `02-Expense-Receipts/`, etc. only exist when non-empty
  - File names are clean (no `1745672508892-` timestamp prefix)
  - `manifest.csv` at root opens cleanly in Excel; Turkish characters render correctly
- [ ] **Step 2: Multi mode** — pick three procedures, download, confirm each appears as its own top-level folder
- [ ] **Step 3: Date range** — pick a range you know covers some procedures, confirm the "N excluded" footer note appears if any procedures have null `import_dec_date`
- [ ] **Step 4: Everything** — confirm the full archive contains all procedures with documents
- [ ] **Step 5: Missing dec fields** — find a procedure in the DB whose `import_dec_number` AND `import_dec_date` are both null, run Single mode for it; folder name is just `<reference>/`
- [ ] **Step 6: Duplicate filenames** — manually create two uploads with the same filename in the same procedure (or use SQL to inject duplicates into `expense_documents.originalFilename`), download, confirm the ZIP has `Name.pdf` and `Name (2).pdf`
- [ ] **Step 7: S3 fetch failure** — pick a known document, temporarily rename its objectKey in the DB so `getFile` fails, run a download, confirm:
  - The ZIP still produces (does not 500)
  - That row in `manifest.csv` has `status` starting with `ERROR:`
  - Other files in the archive are intact
- [ ] **Step 8: Empty subfolders** — verify a procedure that only has import_documents produces a ZIP folder with only `01-Import-Documents/` inside (no empty `02-`, `03-`, `04-`)
- [ ] **Step 9: ZIP filename** — verify the downloaded filename matches the spec table for each mode
- [ ] **Step 10: Auth gate** — log out, hit `/bulk-download`, confirm `ProtectedRoute` redirects to login

If anything fails, file the bug as a TODO in this checklist and fix it in a follow-up commit before declaring done.

- [ ] **Step 11: Final commit (only if any fixes were made during verification)**

```bash
git add -A
git commit -m "fix(bulk-download): address issues found during end-to-end verification"
```
