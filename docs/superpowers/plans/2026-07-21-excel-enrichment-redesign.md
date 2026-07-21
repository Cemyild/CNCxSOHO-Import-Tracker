# Excel Enrichment Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Procedures page "Enrich Data (Excel)" button actually work against the real customs-broker report, filling empty/zero fields on existing procedures with a visible detection-confirmation step and an unmatched-rows report.

**Architecture:** The single 360-line `server/excel-enrichment.ts` (which mixes parsing, column mapping, matching, diffing and HTTP, and contains dead code plus two contradictory mapping implementations) is replaced by five pure, independently testable modules under `server/enrichment/`, plus a thin HTTP layer. The client gains a detection-summary step between upload and preview.

**Tech Stack:** TypeScript, Express, Drizzle ORM (PostgreSQL), `xlsx` (SheetJS), multer, React + TanStack Query, shadcn/ui, react-i18next, vitest.

**Spec:** [`docs/superpowers/specs/2026-07-21-excel-enrichment-redesign-design.md`](../specs/2026-07-21-excel-enrichment-redesign-design.md)

## Global Constraints

- **Never run `npm run db:push`.** The DB has schema drift (status columns are real PG enums while `shared/schema.ts` declares them as `text`). New columns go in `db/manual-ddl/NNN_*.sql` as idempotent DDL; `scripts/apply-manual-ddl.ts` applies them on deploy.
- **Next manual-DDL number is `002`** (existing: `000_agent_audit_log_indexes.sql`, `001_procedures_tareks_notes.sql`).
- **Tests:** vitest. Config `vitest.config.ts` includes only `server/**/*.test.ts` and `shared/**/*.test.ts`. Run with `npm run test`. Test files live next to their source (existing pattern: `server/document-router.test.ts`).
- **Path aliases:** `@shared` → `./shared`, `@` → `./client/src` (configured in both `vite.config.ts` and `vitest.config.ts`).
- **`npm run check` is permanently red** (~1450 errors, all from the corrupted `server/pdf-data-transformer.ts`). Do not treat it as a gate. Verify types only via `npm run build`.
- **Client write requests must use `apiRequest`** from `@/lib/queryClient` — raw `fetch` does not carry the Bearer token. `apiRequest` is FormData-aware and already calls `throwIfResNotOk`.
- **Auth middleware:** `requireRole(...allowed: Role[])` from `server/auth-middleware.ts`. Returns 401 when not logged in, 403 when role not permitted.
- **All user-facing strings go through i18n** — the app is 100% translated; add keys to BOTH `client/src/locales/tr.json` and `client/src/locales/en.json`.
- **Local dev server:** `npm run dev` is broken on Windows. Use `node --env-file=.env --import tsx server/index.ts` (port 5000, hard-coded).
- **Never commit** the root-level `.xlsx` working files. Only the deliberately copied test fixture is committed.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/enrichment/types.ts` | Shared TypeScript types for the whole pipeline. No logic. |
| `server/enrichment/normalize.ts` | Turn one raw Excel cell into a clean value or `null`: junk detection, text, number, date, customs-office name. |
| `server/enrichment/column-profile.ts` | Header normalization, the field→candidate-headers dictionary, building a `ColumnProfile`, and applying it to data rows. |
| `server/enrichment/parse-workbook.ts` | Pick the sheet, find the header row, extract data rows, skip title/total/blank rows. |
| `server/enrichment/match.ts` | Bind rows to procedures (invoice_no → +amount → amount), merge AN/IM duplicate rows. |
| `server/enrichment/diff.ts` | Decide which fields are empty-or-zero and compute the change list. |
| `server/excel-enrichment.ts` | Three HTTP endpoints only: `/analyze`, `/preview`, `/apply`. Auth + field whitelist. |
| `server/enrichment/__fixtures__/soho-enrich-ornek.xlsx` | Committed copy of the real broker report used by tests. |
| `client/src/components/ExcelDataEnrichment.tsx` | Dialog shell + three-step state machine. |
| `client/src/components/enrichment/EnrichmentDetectionStep.tsx` | Detection summary UI (sheet, header row, mapped/unused columns). |
| `client/src/components/enrichment/EnrichmentPreviewStep.tsx` | Changes table + unmatched-rows report. |
| `db/manual-ddl/002_procedures_customs_file_no.sql` | Adds `procedures.customs_file_no`. |
| `client/src/pages/procedure-details.tsx` | Renders the new broker file number. |
| `client/src/pages/add-procedure.tsx`, `edit-procedure.tsx` | Make the new field editable. |

Dependency order (each task depends only on earlier ones):
`types` → `normalize` → `column-profile` → `parse-workbook` → `match` → `diff` → DB column → HTTP → client → cleanup.

---

### Task 1: Shared types and value normalization

**Files:**
- Create: `server/enrichment/types.ts`
- Create: `server/enrichment/normalize.ts`
- Test: `server/enrichment/normalize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type EnrichField` — the 13 target fields.
  - `isJunk(value: unknown): boolean`
  - `cleanText(value: unknown): string | null`
  - `cleanNumber(value: unknown): number | null`
  - `cleanDate(value: unknown): string | null` — always `YYYY-MM-DD` or `null`
  - `normalizeCustoms(value: unknown): string | null`

- [ ] **Step 1: Create the shared types file**

Create `server/enrichment/types.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `server/enrichment/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isJunk,
  cleanText,
  cleanNumber,
  cleanDate,
  normalizeCustoms,
} from "./normalize";

describe("isJunk", () => {
  it("treats blanks and placeholder marks as no-value", () => {
    for (const v of [null, undefined, "", "   ", "-", "--", ".", "X", "x", "N/A"]) {
      expect(isJunk(v), `expected ${JSON.stringify(v)} to be junk`).toBe(true);
    }
  });

  it("keeps real values, including zero", () => {
    for (const v of ["Erenköy", 0, "0", 46.692, "STN1", "USD"]) {
      expect(isJunk(v), `expected ${JSON.stringify(v)} to be kept`).toBe(false);
    }
  });
});

describe("cleanText", () => {
  it("trims and stringifies", () => {
    expect(cleanText("  55559417 ")).toBe("55559417");
    expect(cleanText(1)).toBe("1");
  });

  it("returns null for junk", () => {
    expect(cleanText("-")).toBeNull();
    expect(cleanText("   ")).toBeNull();
  });
});

describe("cleanNumber", () => {
  it("parses plain numbers", () => {
    expect(cleanNumber(46.692)).toBe(46.692);
    expect(cleanNumber("1234.56")).toBe(1234.56);
    expect(cleanNumber(0)).toBe(0);
  });

  it("parses Turkish decimal comma", () => {
    expect(cleanNumber("3510,98")).toBe(3510.98);
  });

  it("parses thousands separator plus decimal comma", () => {
    expect(cleanNumber("1.234,56")).toBe(1234.56);
  });

  it("returns null for junk and unparseable text", () => {
    expect(cleanNumber("-")).toBeNull();
    expect(cleanNumber("abc")).toBeNull();
  });
});

describe("cleanDate", () => {
  it("converts dd.mm.yyyy to ISO", () => {
    expect(cleanDate("03.07.2026")).toBe("2026-07-03");
    expect(cleanDate("13.07.2026")).toBe("2026-07-13");
  });

  it("accepts slash and dash separators", () => {
    expect(cleanDate("03/07/2026")).toBe("2026-07-03");
    expect(cleanDate("03-07-2026")).toBe("2026-07-03");
  });

  it("passes ISO dates through", () => {
    expect(cleanDate("2026-07-03")).toBe("2026-07-03");
  });

  it("converts Excel serial numbers", () => {
    // 46206 is 2026-07-03 in Excel's 1900 date system.
    expect(cleanDate(46206)).toBe("2026-07-03");
  });

  it("rejects the lone dot that the BEYAN TARİHİ column uses for 'not declared yet'", () => {
    expect(cleanDate(".")).toBeNull();
  });

  it("rejects junk and unparseable text", () => {
    expect(cleanDate("")).toBeNull();
    expect(cleanDate("bugün")).toBeNull();
    expect(cleanDate("32.01.2026")).toBeNull();
  });
});

describe("normalizeCustoms", () => {
  it("maps the long official office name to the short form the app already uses", () => {
    expect(normalizeCustoms("ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ")).toBe("Erenköy");
    expect(normalizeCustoms("MURATBEY GÜMRÜK MÜDÜRLÜĞÜ")).toBe("Muratbey");
    expect(normalizeCustoms("İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ")).toBe(
      "Istanbul Airport",
    );
    expect(normalizeCustoms("AMBARLI GÜMRÜK MÜDÜRLÜĞÜ")).toBe("Ambarlı");
    expect(normalizeCustoms("GEMLİK GÜMRÜK MÜDÜRLÜĞÜ")).toBe("Gemlik");
  });

  it("returns unknown offices unchanged so nothing is silently lost", () => {
    expect(normalizeCustoms("HALKALI GÜMRÜK MÜDÜRLÜĞÜ")).toBe(
      "HALKALI GÜMRÜK MÜDÜRLÜĞÜ",
    );
  });

  it("returns null for junk", () => {
    expect(normalizeCustoms("-")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run server/enrichment/normalize.test.ts`
Expected: FAIL — `Failed to resolve import "./normalize"`.

- [ ] **Step 4: Write the implementation**

Create `server/enrichment/normalize.ts`:

```ts
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

function foldTurkish(text: string): string {
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run server/enrichment/normalize.test.ts`
Expected: PASS — 5 describe blocks, 17 tests.

- [ ] **Step 6: Commit**

```bash
git add server/enrichment/types.ts server/enrichment/normalize.ts server/enrichment/normalize.test.ts
git commit -m "feat(enrichment): add shared types and cell value normalizers"
```

---

### Task 2: Column profile — header dictionary and row extraction

**Files:**
- Create: `server/enrichment/column-profile.ts`
- Test: `server/enrichment/column-profile.test.ts`

**Interfaces:**
- Consumes: `EnrichField`, `FIELD_KIND`, `ColumnProfile`, `MappedColumn`, `UnusedColumn`, `EnrichRow`, `RawRow` from `./types`; `cleanText`, `cleanNumber`, `cleanDate`, `normalizeCustoms` from `./normalize`.
- Produces:
  - `normalizeHeader(header: unknown): string`
  - `FIELD_CANDIDATES: Record<EnrichField, string[]>`
  - `buildColumnProfile(headers: unknown[]): ColumnProfile`
  - `countRecognizedHeaders(headers: unknown[]): number`
  - `applyProfile(rows: RawRow[], profile: ColumnProfile): EnrichRow[]`

- [ ] **Step 1: Write the failing test**

Create `server/enrichment/column-profile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeHeader,
  buildColumnProfile,
  countRecognizedHeaders,
  applyProfile,
} from "./column-profile";
import type { RawRow } from "./types";

/**
 * A faithful slice of the real report's header row, keeping the original
 * column indices so ordering bugs surface.
 */
function realHeaders(): string[] {
  const headers: string[] = new Array(80).fill("");
  headers[0] = "DOSYA NO";
  headers[3] = "GONDEREN";
  headers[5] = "KOLİ";
  headers[8] = "GUM.";
  headers[10] = "BEYAN TARİHİ";
  headers[11] = "BEYAN NO";
  headers[12] = "FAT.BEDELİ";
  headers[13] = "DÖVİZ";
  headers[14] = "DÖVİZ KURU";
  headers[16] = "KAP";
  headers[22] = "NAVLUN";
  headers[45] = "BRUT KG.";
  headers[54] = "FATURA NO";
  headers[55] = "FATURA TARİHİ";
  headers[75] = "FATURA TARİHİ(0100)";
  headers[76] = "FATURA NO(0100)";
  return headers;
}

function colFor(field: string) {
  const profile = buildColumnProfile(realHeaders());
  return profile.mapped.find((m) => m.field === field);
}

describe("normalizeHeader", () => {
  it("strips case, Turkish diacritics and punctuation", () => {
    expect(normalizeHeader("FATURA NO(0100)")).toBe("faturano0100");
    expect(normalizeHeader("GUM.")).toBe("gum");
    expect(normalizeHeader("BRUT KG.")).toBe("brutkg");
    expect(normalizeHeader("DÖVİZ KURU")).toBe("dovizkuru");
    expect(normalizeHeader("KOLİ")).toBe("koli");
    expect(normalizeHeader("FAT.BEDELİ")).toBe("fatbedeli");
    expect(normalizeHeader("FATURA TARİHİ(0100)")).toBe("faturatarihi0100");
  });

  it("returns an empty string for blank headers", () => {
    expect(normalizeHeader(null)).toBe("");
    expect(normalizeHeader("")).toBe("");
  });
});

describe("buildColumnProfile", () => {
  it("uses FATURA NO(0100) for invoice_no, not FATURA NO", () => {
    // Verified against the live DB: FATURA NO matched 0/7 procedures,
    // FATURA NO(0100) matched 13/13.
    expect(colFor("invoice_no")?.colIndex).toBe(76);
    expect(colFor("invoice_no")?.header).toBe("FATURA NO(0100)");
  });

  it("uses FATURA TARİHİ(0100) for invoice_date, not FATURA TARİHİ", () => {
    expect(colFor("invoice_date")?.colIndex).toBe(75);
  });

  it("uses KOLİ for package, not the junk-filled KAP column", () => {
    expect(colFor("package")?.colIndex).toBe(5);
  });

  it("maps GUM. to customs", () => {
    expect(colFor("customs")?.colIndex).toBe(8);
  });

  it("maps the columns the old importer ignored entirely", () => {
    expect(colFor("amount")?.colIndex).toBe(12);
    expect(colFor("usdtl_rate")?.colIndex).toBe(14);
    expect(colFor("freight_amount")?.colIndex).toBe(22);
    expect(colFor("customs_file_no")?.colIndex).toBe(0);
  });

  it("reports losing candidates so the UI can warn about them", () => {
    const profile = buildColumnProfile(realHeaders());
    const unusedHeaders = profile.unusedCandidates.map((u) => u.header);
    expect(unusedHeaders).toContain("FATURA NO");
    expect(unusedHeaders).toContain("KAP");
    const invoiceLoser = profile.unusedCandidates.find(
      (u) => u.header === "FATURA NO",
    );
    expect(invoiceLoser?.winnerHeader).toBe("FATURA NO(0100)");
  });

  it("never maps two columns to the same field", () => {
    const profile = buildColumnProfile(realHeaders());
    const fields = profile.mapped.map((m) => m.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("lists headers it does not recognize", () => {
    const profile = buildColumnProfile(["DOSYA NO", "SEKTÖR", "PLAKASI"]);
    expect(profile.unmappedHeaders).toEqual(["SEKTÖR", "PLAKASI"]);
  });

  it("does not map fields that were deliberately left out of scope", () => {
    const profile = buildColumnProfile([
      "MAL TESLİM TARİHİ",
      "KONŞİMENTO NO",
      "NAKLİYECİ",
      "KALEM SAYISI",
    ]);
    expect(profile.mapped).toEqual([]);
  });
});

describe("countRecognizedHeaders", () => {
  it("counts distinct recognized fields, used for sheet and header-row detection", () => {
    expect(countRecognizedHeaders(realHeaders())).toBeGreaterThanOrEqual(12);
    expect(
      countRecognizedHeaders(["Alıcı : SOHO PERAK", "Baş. Kur. Tar. : 01.07.2026"]),
    ).toBe(0);
  });
});

describe("applyProfile", () => {
  it("cleans each cell with the normalizer its field requires", () => {
    const profile = buildColumnProfile(realHeaders());
    const cells: unknown[] = new Array(80).fill(null);
    cells[0] = "26-09933";
    cells[8] = "ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ";
    cells[10] = "03.07.2026";
    cells[11] = "26341200IM00162621";
    cells[12] = 1255.5;
    cells[14] = 46.692;
    cells[76] = 53598059;

    const rows: RawRow[] = [{ excelRowNumber: 3, cells }];
    const [row] = applyProfile(rows, profile);

    expect(row.excelRowNumber).toBe(3);
    expect(row.values.customs_file_no).toBe("26-09933");
    expect(row.values.customs).toBe("Erenköy");
    expect(row.values.import_dec_date).toBe("2026-07-03");
    expect(row.values.import_dec_number).toBe("26341200IM00162621");
    expect(row.values.amount).toBe(1255.5);
    expect(row.values.usdtl_rate).toBe(46.692);
    expect(row.values.invoice_no).toBe("53598059");
  });

  it("drops junk instead of storing it", () => {
    const profile = buildColumnProfile(realHeaders());
    const cells: unknown[] = new Array(80).fill(null);
    cells[10] = "."; // "not declared yet" marker
    cells[16] = "X"; // the KAP column's filler
    cells[12] = 5108.77;

    const [row] = applyProfile([{ excelRowNumber: 9, cells }], profile);

    expect(row.values.import_dec_date).toBeUndefined();
    expect(row.values.package).toBeUndefined();
    expect(row.values.amount).toBe(5108.77);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/enrichment/column-profile.test.ts`
Expected: FAIL — `Failed to resolve import "./column-profile"`.

- [ ] **Step 3: Write the implementation**

Create `server/enrichment/column-profile.ts`:

```ts
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
import { cleanDate, cleanNumber, cleanText, normalizeCustoms } from "./normalize";

/**
 * "FATURA NO(0100)" -> "faturano0100". Lower-cases, folds Turkish letters to
 * ASCII and drops everything that is not a letter or digit, so spacing and
 * punctuation in the broker's headers stop mattering.
 */
export function normalizeHeader(header: unknown): string {
  if (header === null || header === undefined) return "";
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
  };
  return String(header)
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]/g, "");
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/enrichment/column-profile.test.ts`
Expected: PASS — 4 describe blocks, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add server/enrichment/column-profile.ts server/enrichment/column-profile.test.ts
git commit -m "feat(enrichment): add priority-ordered column profile and row extraction"
```

---

### Task 3: Workbook parsing — sheet, header row, data rows

**Files:**
- Create: `server/enrichment/parse-workbook.ts`
- Create: `server/enrichment/__fixtures__/soho-enrich-ornek.xlsx` (copy of the real report)
- Test: `server/enrichment/parse-workbook.test.ts`

**Interfaces:**
- Consumes: `countRecognizedHeaders` from `./column-profile`; `ParsedWorkbook`, `RawRow`, `SkippedRow` from `./types`.
- Produces:
  - `parseWorkbook(buffer: Buffer, overrides?: ParseOverrides): ParsedWorkbook`
  - `interface ParseOverrides { sheetName?: string; headerRowIndex?: number }`
  - `class EnrichmentParseError extends Error` with `code: "no_data" | "no_headers"` and `detectedHeaders: string[]`

- [ ] **Step 1: Copy the real report in as a test fixture**

The working file lives at the repo root and is untracked. Copy it into the fixture folder under an ASCII name (the original has a space and a Turkish character, which makes shell invocation fragile):

```bash
mkdir -p server/enrichment/__fixtures__
cp "soho enrich örnek.xlsx" server/enrichment/__fixtures__/soho-enrich-ornek.xlsx
ls -la server/enrichment/__fixtures__/
```

Expected: one `.xlsx` file, roughly 40–120 KB.

- [ ] **Step 2: Write the failing test**

Create `server/enrichment/parse-workbook.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { parseWorkbook, EnrichmentParseError } from "./parse-workbook";

const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "soho-enrich-ornek.xlsx"),
);

/** Builds a small in-memory workbook from arrays of rows. */
function makeWorkbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseWorkbook — real broker report", () => {
  it("skips the empty first sheet and picks the one with recognizable headers", () => {
    // The old importer read SheetNames[0] ("Sayfa1"), found it empty and
    // returned HTTP 400 — the feature never got past this point.
    const parsed = parseWorkbook(FIXTURE);
    expect(parsed.sheetName).toBe("İthalat Raporu");
    expect(parsed.availableSheets).toEqual(["Sayfa1", "İthalat Raporu"]);
  });

  it("finds the header row below the report title row", () => {
    const parsed = parseWorkbook(FIXTURE);
    expect(parsed.headerRowIndex).toBe(1);
    expect(parsed.headers[0]).toBe("DOSYA NO");
    expect(parsed.headers[54]).toBe("FATURA NO");
    expect(parsed.headers[76]).toBe("FATURA NO(0100)");
  });

  it("returns the 24 data rows and skips the TOPLAM footer", () => {
    const parsed = parseWorkbook(FIXTURE);
    expect(parsed.dataRows).toHaveLength(24);
    expect(parsed.skippedRows.some((r) => r.reason === "total_row")).toBe(true);
  });

  it("numbers rows the way Excel shows them", () => {
    const parsed = parseWorkbook(FIXTURE);
    // Header is sheet index 1 = Excel row 2, so data starts at Excel row 3.
    expect(parsed.dataRows[0].excelRowNumber).toBe(3);
    expect(parsed.dataRows[0].cells[0]).toBe("26-09933");
  });

  it("honours an explicit sheet and header row override", () => {
    const parsed = parseWorkbook(FIXTURE, {
      sheetName: "İthalat Raporu",
      headerRowIndex: 1,
    });
    expect(parsed.dataRows).toHaveLength(24);
  });
});

describe("parseWorkbook — synthetic edge cases", () => {
  it("throws no_data when every sheet is empty", () => {
    const buffer = makeWorkbook({ Sayfa1: [], Sayfa2: [] });
    expect(() => parseWorkbook(buffer)).toThrowError(EnrichmentParseError);
    try {
      parseWorkbook(buffer);
    } catch (error) {
      expect((error as EnrichmentParseError).code).toBe("no_data");
    }
  });

  it("throws no_headers and reports what it saw when nothing is recognizable", () => {
    const buffer = makeWorkbook({
      Sheet1: [
        ["Ad", "Soyad", "Şehir"],
        ["Ali", "Veli", "İstanbul"],
      ],
    });
    try {
      parseWorkbook(buffer);
      throw new Error("expected parseWorkbook to throw");
    } catch (error) {
      expect((error as EnrichmentParseError).code).toBe("no_headers");
      expect((error as EnrichmentParseError).detectedHeaders).toContain("Soyad");
    }
  });

  it("skips fully blank rows", () => {
    const buffer = makeWorkbook({
      Sheet1: [
        ["FATURA NO(0100)", "FAT.BEDELİ", "GUM."],
        ["53598059", 1255.5, "ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ"],
        [null, null, null],
        ["55559417", 8412.81, "ERENKÖY GÜMRÜK MÜDÜRLÜĞÜ"],
      ],
    });
    const parsed = parseWorkbook(buffer);
    expect(parsed.dataRows).toHaveLength(2);
    expect(parsed.skippedRows.some((r) => r.reason === "empty_row")).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run server/enrichment/parse-workbook.test.ts`
Expected: FAIL — `Failed to resolve import "./parse-workbook"`.

- [ ] **Step 4: Write the implementation**

Create `server/enrichment/parse-workbook.ts`:

```ts
import * as XLSX from "xlsx";
import { countRecognizedHeaders } from "./column-profile";
import type { ParsedWorkbook, RawRow, SkippedRow } from "./types";

export interface ParseOverrides {
  sheetName?: string;
  headerRowIndex?: number;
}

export class EnrichmentParseError extends Error {
  constructor(
    public code: "no_data" | "no_headers",
    message: string,
    public detectedHeaders: string[] = [],
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run server/enrichment/parse-workbook.test.ts`
Expected: PASS — 2 describe blocks, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add server/enrichment/parse-workbook.ts server/enrichment/parse-workbook.test.ts server/enrichment/__fixtures__/soho-enrich-ornek.xlsx
git commit -m "feat(enrichment): detect data sheet, header row and skip footer rows"
```

---

### Task 4: Matching and AN/IM row merging

**Files:**
- Create: `server/enrichment/match.ts`
- Test: `server/enrichment/match.test.ts`

**Interfaces:**
- Consumes: `EnrichRow`, `MatchResult`, `MatchedGroup`, `UnmatchedRow`, `MatchMethod`, `EnrichField`, `EnrichValue` from `./types`.
- Produces:
  - `interface MatchCandidate { id: number; reference: string | null; invoice_no: string | null; amount: string | number | null }`
  - `matchRows(rows: EnrichRow[], procedures: MatchCandidate[]): MatchResult`

- [ ] **Step 1: Write the failing test**

Create `server/enrichment/match.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchRows, type MatchCandidate } from "./match";
import type { EnrichRow } from "./types";

/** Real shapes taken from the live procedures table. */
const PROCEDURES: MatchCandidate[] = [
  { id: 91, reference: "CNCALO-91", invoice_no: "55559417", amount: "8412.81" },
  // Two procedures deliberately share one invoice number.
  { id: 83, reference: "CNCALO-83 /1", invoice_no: "54702017", amount: "396240.00" },
  { id: 84, reference: "CNCALO-83 / 2", invoice_no: "54702017", amount: "5108.77" },
  // No usable invoice number — only matchable on amount.
  { id: 98, reference: "CNCALO-98", invoice_no: null, amount: "291271.13" },
  // Stored with trailing whitespace, as some rows really are.
  { id: 95, reference: "CNCALO-95", invoice_no: " 33261192 ", amount: "2061.80" },
];

function row(excelRowNumber: number, values: EnrichRow["values"]): EnrichRow {
  return { excelRowNumber, values };
}

describe("matchRows", () => {
  it("matches on invoice number when it is unique", () => {
    const result = matchRows(
      [row(3, { invoice_no: "55559417", customs: "Erenköy" })],
      PROCEDURES,
    );
    expect(result.unmatched).toEqual([]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].procedureId).toBe(91);
    expect(result.matched[0].matchMethod).toBe("invoice_no");
  });

  it("trims whitespace on both sides before comparing", () => {
    const result = matchRows([row(3, { invoice_no: "33261192" })], PROCEDURES);
    expect(result.matched[0].procedureId).toBe(95);
  });

  it("breaks an invoice-number tie using the amount", () => {
    // The old importer used .find() and always wrote to CNCALO-83 /1.
    const result = matchRows(
      [row(24, { invoice_no: "54702017", amount: 5108.77 })],
      PROCEDURES,
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].reference).toBe("CNCALO-83 / 2");
    expect(result.matched[0].matchMethod).toBe("invoice_no+amount");
  });

  it("reports an ambiguous row instead of guessing when amount cannot break the tie", () => {
    const result = matchRows([row(24, { invoice_no: "54702017" })], PROCEDURES);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0].reason).toBe("ambiguous");
    expect(result.unmatched[0].candidates).toEqual([
      "CNCALO-83 /1",
      "CNCALO-83 / 2",
    ]);
  });

  it("falls back to amount when the row has no invoice number", () => {
    const result = matchRows([row(12, { amount: 291271.13 })], PROCEDURES);
    expect(result.matched[0].procedureId).toBe(98);
    expect(result.matched[0].matchMethod).toBe("amount");
  });

  it("tolerates sub-kuruş rounding on amount matches", () => {
    const result = matchRows([row(12, { amount: 291271.135 })], PROCEDURES);
    expect(result.matched[0].procedureId).toBe(98);
  });

  it("reports not_found when neither key hits", () => {
    const result = matchRows(
      [row(23, { invoice_no: "STN1", amount: 120, customs_file_no: "26-11128" })],
      PROCEDURES,
    );
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([
      {
        excelRowNumber: 23,
        customsFileNo: "26-11128",
        reason: "not_found",
        invoiceNo: "STN1",
        amount: 120,
        candidates: [],
      },
    ]);
  });

  it("reports no_key when the row carries neither invoice number nor amount", () => {
    const result = matchRows([row(30, { currency: "USD" })], PROCEDURES);
    expect(result.unmatched[0].reason).toBe("no_key");
  });

  it("merges the AN and IM rows of one shipment, preferring the IM declaration", () => {
    // Every shipment appears twice: once as the bonded-warehouse entry (AN)
    // and once as the import declaration (IM). The DB stores the IM one.
    const result = matchRows(
      [
        row(4, {
          invoice_no: "55559417",
          import_dec_number: "26341200AN00154190",
          import_dec_date: "2026-07-02",
          shipper: "ALO HONG KONG LTD",
        }),
        row(8, {
          invoice_no: "55559417",
          import_dec_number: "26341200IM00163105",
          import_dec_date: "2026-07-03",
          customs: "Erenköy",
        }),
      ],
      PROCEDURES,
    );

    expect(result.matched).toHaveLength(1);
    const group = result.matched[0];
    expect(group.procedureId).toBe(91);
    expect(group.excelRowNumbers).toEqual([4, 8]);
    expect(group.values.import_dec_number).toBe("26341200IM00163105");
    expect(group.values.import_dec_date).toBe("2026-07-03");
    // Non-declaration fields take the first non-empty value from either row.
    expect(group.values.shipper).toBe("ALO HONG KONG LTD");
    expect(group.values.customs).toBe("Erenköy");
  });

  it("keeps the only declaration when no row is an IM one", () => {
    const result = matchRows(
      [
        row(4, {
          invoice_no: "55559417",
          import_dec_number: "26341200AN00154190",
          import_dec_date: "2026-07-02",
        }),
      ],
      PROCEDURES,
    );
    expect(result.matched[0].values.import_dec_number).toBe("26341200AN00154190");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/enrichment/match.test.ts`
Expected: FAIL — `Failed to resolve import "./match"`.

- [ ] **Step 3: Write the implementation**

Create `server/enrichment/match.ts`:

```ts
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

function sameAmount(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) < AMOUNT_TOLERANCE;
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
    invoiceNo: (row.values.invoice_no as string | undefined) ?? null,
    amount: asNumber(row.values.amount),
    candidates: candidates.map((c) => c.reference ?? String(c.id)),
  };
}

/** Step 1: bind one row to at most one procedure. */
function matchOne(
  row: EnrichRow,
  procedures: MatchCandidate[],
): RowMatch | UnmatchedRow {
  const invoiceNo = row.values.invoice_no
    ? String(row.values.invoice_no).trim()
    : null;
  const amount = asNumber(row.values.amount);

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
        sameAmount(asNumber(p.amount), amount),
      );
      if (narrowed.length === 1) {
        return { row, procedure: narrowed[0], method: "invoice_no+amount" };
      }
      return unmatchedFrom(row, "ambiguous", byInvoice);
    }
  }

  if (amount !== null) {
    const byAmount = procedures.filter((p) =>
      sameAmount(asNumber(p.amount), amount),
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
    matchMethod: first.method,
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/enrichment/match.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add server/enrichment/match.ts server/enrichment/match.test.ts
git commit -m "feat(enrichment): match rows by invoice/amount and merge AN+IM rows"
```

---

### Task 5: Change computation (empty-or-zero rule)

**Files:**
- Create: `server/enrichment/diff.ts`
- Test: `server/enrichment/diff.test.ts`

**Interfaces:**
- Consumes: `EnrichField`, `EnrichValue`, `FieldChange`, `MatchedGroup`, `NUMERIC_FIELDS` from `./types`.
- Produces:
  - `isFillable(field: EnrichField, currentValue: unknown): boolean`
  - `computeChanges(group: MatchedGroup, procedure: Record<string, unknown>): FieldChange[]`

- [ ] **Step 1: Write the failing test**

Create `server/enrichment/diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isFillable, computeChanges } from "./diff";
import type { MatchedGroup } from "./types";

function group(values: MatchedGroup["values"]): MatchedGroup {
  return {
    procedureId: 91,
    reference: "CNCALO-91",
    matchMethod: "invoice_no",
    excelRowNumbers: [3],
    values,
  };
}

describe("isFillable", () => {
  it("treats missing, blank and placeholder values as fillable", () => {
    for (const v of [null, undefined, "", "   ", "-", "."]) {
      expect(isFillable("customs", v), `for ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("treats zero as fillable on numeric fields", () => {
    // freight_amount is 0 on 165 of 175 procedures; the old rule meant it
    // could never be enriched.
    expect(isFillable("freight_amount", "0.00")).toBe(true);
    expect(isFillable("usdtl_rate", 0)).toBe(true);
    expect(isFillable("kg", "0.0000")).toBe(true);
    expect(isFillable("amount", "0")).toBe(true);
  });

  it("treats zero as a real value on text fields", () => {
    expect(isFillable("package", "0")).toBe(false);
  });

  it("never touches a field that already holds a value", () => {
    expect(isFillable("customs", "Erenköy")).toBe(false);
    expect(isFillable("amount", "8412.81")).toBe(false);
    expect(isFillable("invoice_no", "55559417")).toBe(false);
  });
});

describe("computeChanges", () => {
  it("proposes only the empty fields and stringifies the new value", () => {
    const procedure = {
      id: 91,
      reference: "CNCALO-91",
      invoice_no: "55559417",
      customs: null,
      usdtl_rate: "0.0000",
      shipper: "ALO, LLC",
    };

    const changes = computeChanges(
      group({
        invoice_no: "55559417",
        customs: "Erenköy",
        usdtl_rate: 46.692,
        shipper: "ALO HONG KONG LTD",
      }),
      procedure,
    );

    expect(changes).toEqual([
      { field: "customs", oldValue: null, newValue: "Erenköy" },
      { field: "usdtl_rate", oldValue: "0.0000", newValue: "46.692" },
    ]);
  });

  it("returns nothing when the procedure is already complete", () => {
    const procedure = { customs: "Erenköy", shipper: "ALO, LLC" };
    expect(
      computeChanges(group({ customs: "Muratbey", shipper: "X Ltd" }), procedure),
    ).toEqual([]);
  });

  it("ignores fields the Excel row said nothing about", () => {
    const procedure = { customs: null, shipper: null };
    const changes = computeChanges(group({ customs: "Erenköy" }), procedure);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("customs");
  });

  it("ignores columns that are not enrichable fields", () => {
    const procedure = { id: 91, createdBy: 1, customs: null };
    const changes = computeChanges(
      // @ts-expect-error deliberately smuggling a non-enrich field in
      group({ customs: "Erenköy", createdBy: 999 }),
      procedure,
    );
    expect(changes.map((c) => c.field)).toEqual(["customs"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/enrichment/diff.test.ts`
Expected: FAIL — `Failed to resolve import "./diff"`.

- [ ] **Step 3: Write the implementation**

Create `server/enrichment/diff.ts`:

```ts
import {
  NUMERIC_FIELDS,
  type EnrichField,
  type FieldChange,
  type MatchedGroup,
} from "./types";
import { FIELD_CANDIDATES } from "./column-profile";
import { isJunk } from "./normalize";

const ENRICH_FIELDS = new Set(Object.keys(FIELD_CANDIDATES) as EnrichField[]);

/**
 * A field may be filled when the database holds nothing meaningful.
 *
 * "Nothing meaningful" covers NULL, empty/whitespace strings and the "-" / "."
 * placeholders that earlier imports wrote — plus a literal zero on numeric
 * columns, where 0 is a default rather than a measurement.
 */
export function isFillable(field: EnrichField, currentValue: unknown): boolean {
  if (isJunk(currentValue)) return true;
  if (NUMERIC_FIELDS.includes(field)) {
    const parsed = Number(currentValue);
    if (Number.isFinite(parsed) && parsed === 0) return true;
  }
  return false;
}

export function computeChanges(
  group: MatchedGroup,
  procedure: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [rawField, newValue] of Object.entries(group.values)) {
    const field = rawField as EnrichField;
    if (!ENRICH_FIELDS.has(field)) continue;
    if (newValue === undefined || newValue === null || newValue === "") continue;

    const currentValue = procedure[field];
    if (!isFillable(field, currentValue)) continue;

    changes.push({
      field,
      oldValue: (currentValue ?? null) as FieldChange["oldValue"],
      newValue: String(newValue),
    });
  }

  return changes;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/enrichment/diff.test.ts`
Expected: PASS — 2 describe blocks, 8 tests.

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `npm run test`
Expected: PASS — all pre-existing suites plus the four new enrichment suites.

- [ ] **Step 6: Commit**

```bash
git add server/enrichment/diff.ts server/enrichment/diff.test.ts
git commit -m "feat(enrichment): compute changes with the empty-or-zero fill rule"
```

---

### Task 6: Add the `customs_file_no` column

**Files:**
- Create: `db/manual-ddl/002_procedures_customs_file_no.sql`
- Modify: `shared/schema.ts:121-156` (the `procedures` table)

**Interfaces:**
- Consumes: nothing.
- Produces: `procedures.customs_file_no` — nullable `text`, readable as `customs_file_no` on `typeof procedures.$inferSelect`.

- [ ] **Step 1: Write the idempotent DDL**

Create `db/manual-ddl/002_procedures_customs_file_no.sql`:

```sql
-- procedures.customs_file_no: the broker's own file number ("26-09933"),
-- carried in the DOSYA NO column of the monthly import report. Populated by
-- the Excel enrichment flow and used as a cross-reference when corresponding
-- with the broker.
-- Applied as one-off DDL because `drizzle-kit push` is blocked by
-- pre-existing schema drift (see 000_*). Idempotent; safe to re-apply.
-- Source of truth for column shape: shared/schema.ts → procedures.

ALTER TABLE procedures ADD COLUMN IF NOT EXISTS customs_file_no TEXT;
```

- [ ] **Step 2: Add the column to the Drizzle schema**

In `shared/schema.ts`, inside the `procedures` table definition, add the column immediately after `import_dec_date` (line 138) so the ordering mirrors the DB:

```ts
  import_dec_number: text("import_dec_number"),
  import_dec_date: text("import_dec_date"),
  customs_file_no: text("customs_file_no"),
  usdtl_rate: decimal("usdtl_rate", { precision: 10, scale: 4 }),
```

- [ ] **Step 3: Apply the DDL to the local database**

Run: `node --env-file=.env --import tsx scripts/apply-manual-ddl.ts`
Expected: output naming `002_procedures_customs_file_no.sql` as applied, exit code 0. Re-running it must also succeed (idempotency check).

- [ ] **Step 4: Verify the column is readable through Drizzle**

Run:

```bash
node --env-file=.env --import tsx -e "import('./server/db.js').then(async (m) => { const { procedures } = await import('./shared/schema.js'); const [row] = await m.db.select().from(procedures).limit(1); console.log('customs_file_no' in row ? 'OK: column present' : 'FAIL: column missing'); process.exit(0); })"
```

Expected: `OK: column present`

- [ ] **Step 5: Commit**

```bash
git add db/manual-ddl/002_procedures_customs_file_no.sql shared/schema.ts
git commit -m "feat(procedures): add customs_file_no column for the broker file number"
```

---

### Task 7: Rewrite the HTTP endpoints

**Files:**
- Rewrite: `server/excel-enrichment.ts` (whole file — the current 360 lines are replaced)
- Modify: `server/routes.ts:196-197` (mount with auth)
- Test: `server/enrichment/pipeline.test.ts`

**Interfaces:**
- Consumes: `parseWorkbook`, `EnrichmentParseError` from `./enrichment/parse-workbook`; `buildColumnProfile`, `applyProfile`, `FIELD_CANDIDATES` from `./enrichment/column-profile`; `matchRows`, `MatchCandidate` from `./enrichment/match`; `computeChanges`, `isFillable` from `./enrichment/diff`; `requireRole` from `./auth-middleware`.
- Produces:
  - `runEnrichmentPipeline(buffer, procedures, overrides)` → `{ detection, matched, unmatched }` — the pure, DB-free core the routes and the pipeline test both call.
  - `POST /api/enrichment/analyze` → `{ detection }`
  - `POST /api/enrichment/preview` → `{ detection, matched, unmatched }`
  - `POST /api/enrichment/apply` → `{ results }`

- [ ] **Step 1: Write the failing end-to-end pipeline test**

Create `server/enrichment/pipeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runEnrichmentPipeline } from "../excel-enrichment";
import type { MatchCandidate } from "./match";

const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "soho-enrich-ornek.xlsx"),
);

/**
 * A fixed stand-in for the procedures table. Values are copied from the live
 * database so the assertions describe real behaviour, but the list is frozen
 * here so the test does not drift as new procedures are created.
 */
const PROCEDURES: MatchCandidate[] = [
  { id: 91, reference: "CNCALO-91", invoice_no: "55559417", amount: "8412.81" },
  { id: 94, reference: "CNCALO-94", invoice_no: "33260982", amount: "107990.86" },
  { id: 95, reference: "CNCALO-95", invoice_no: "33261192", amount: "2061.80" },
  { id: 96, reference: "CNCALO-96", invoice_no: "55955496", amount: "422666.50" },
  { id: 98, reference: "CNCALO-98", invoice_no: "56163133", amount: "291271.13" },
  { id: 83, reference: "CNCALO-83 /1", invoice_no: "54702017", amount: "396240.00" },
  { id: 84, reference: "CNCALO-83 / 2", invoice_no: "54702017", amount: "5108.77" },
];

describe("runEnrichmentPipeline against the real broker report", () => {
  const result = runEnrichmentPipeline(FIXTURE, PROCEDURES);

  it("reports what it detected", () => {
    expect(result.detection.sheetName).toBe("İthalat Raporu");
    expect(result.detection.headerRowIndex).toBe(1);
    expect(result.detection.dataRowCount).toBe(24);
    expect(result.detection.skippedRowCount).toBeGreaterThanOrEqual(1);
  });

  it("flags the losing duplicate columns in the detection summary", () => {
    const unused = result.detection.unusedCandidates.map((u) => u.header);
    expect(unused).toContain("FATURA NO");
    expect(unused).toContain("KAP");
  });

  it("collapses each shipment's AN and IM rows into a single update", () => {
    const cnc91 = result.matched.find((m) => m.reference === "CNCALO-91");
    expect(cnc91?.excelRowNumbers).toHaveLength(2);
    expect(String(cnc91?.values.import_dec_number)).toContain("IM");
  });

  it("writes ISO dates, short customs names and parsed rates", () => {
    const cnc91 = result.matched.find((m) => m.reference === "CNCALO-91");
    expect(cnc91?.values.import_dec_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cnc91?.values.customs).toBe("Erenköy");
    expect(typeof cnc91?.values.usdtl_rate).toBe("number");
  });

  it("routes the shared invoice number to the procedure whose amount agrees", () => {
    const references = result.matched.map((m) => m.reference);
    expect(references).toContain("CNCALO-83 / 2");
    expect(references).not.toContain("CNCALO-83 /1");
  });

  it("reports the row that matches nothing instead of dropping it", () => {
    const stray = result.unmatched.find((u) => u.customsFileNo === "26-11128");
    expect(stray).toBeDefined();
    expect(stray?.reason).toBe("not_found");
    expect(stray?.excelRowNumber).toBe(23);
  });

  it("never invents a match: every matched group points at a known procedure", () => {
    const knownIds = new Set(PROCEDURES.map((p) => p.id));
    for (const group of result.matched) {
      expect(knownIds.has(group.procedureId)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/enrichment/pipeline.test.ts`
Expected: FAIL — `runEnrichmentPipeline is not exported by "../excel-enrichment"`.

- [ ] **Step 3: Rewrite `server/excel-enrichment.ts`**

Replace the entire contents of `server/excel-enrichment.ts` with:

```ts
import { Router } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { procedures } from "@shared/schema";
import { requireRole } from "./auth-middleware";
import {
  EnrichmentParseError,
  parseWorkbook,
  type ParseOverrides,
} from "./enrichment/parse-workbook";
import {
  FIELD_CANDIDATES,
  applyProfile,
  buildColumnProfile,
} from "./enrichment/column-profile";
import { matchRows, type MatchCandidate } from "./enrichment/match";
import { computeChanges, isFillable } from "./enrichment/diff";
import type {
  EnrichField,
  MatchedGroup,
  UnmatchedRow,
  UnusedColumn,
} from "./enrichment/types";

const router = Router();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, /\.xlsx?$/i.test(file.originalname));
  },
});

/** Only these columns may ever be written by this feature. */
const ENRICH_FIELDS = new Set(Object.keys(FIELD_CANDIDATES) as EnrichField[]);

export interface DetectionSummary {
  sheetName: string;
  availableSheets: string[];
  headerRowIndex: number;
  dataRowCount: number;
  skippedRowCount: number;
  mapped: Array<{ field: EnrichField; colIndex: number; header: string }>;
  unusedCandidates: UnusedColumn[];
  unmappedHeaders: string[];
}

export interface PipelineResult {
  detection: DetectionSummary;
  matched: MatchedGroup[];
  unmatched: UnmatchedRow[];
}

/**
 * The whole read-only side of the feature, with no database or HTTP in it:
 * parse -> map columns -> clean values -> match -> merge. Both `/analyze`
 * and `/preview` run this; the pipeline test runs it against a fixture.
 */
export function runEnrichmentPipeline(
  buffer: Buffer,
  candidates: MatchCandidate[],
  overrides: ParseOverrides = {},
): PipelineResult {
  const parsed = parseWorkbook(buffer, overrides);
  const profile = buildColumnProfile(parsed.headers);
  const rows = applyProfile(parsed.dataRows, profile);
  const { matched, unmatched } = matchRows(rows, candidates);

  return {
    detection: {
      sheetName: parsed.sheetName,
      availableSheets: parsed.availableSheets,
      headerRowIndex: parsed.headerRowIndex,
      dataRowCount: parsed.dataRows.length,
      skippedRowCount: parsed.skippedRows.length,
      mapped: profile.mapped,
      unusedCandidates: profile.unusedCandidates,
      unmappedHeaders: profile.unmappedHeaders,
    },
    matched,
    unmatched,
  };
}

function readOverrides(body: Record<string, unknown>): ParseOverrides {
  const overrides: ParseOverrides = {};
  if (typeof body.sheetName === "string" && body.sheetName !== "") {
    overrides.sheetName = body.sheetName;
  }
  const headerRowIndex = Number(body.headerRowIndex);
  if (Number.isInteger(headerRowIndex) && headerRowIndex >= 0) {
    overrides.headerRowIndex = headerRowIndex;
  }
  return overrides;
}

function handleParseError(error: unknown, res: any): boolean {
  if (error instanceof EnrichmentParseError) {
    res.status(400).json({
      code: error.code,
      message: error.message,
      detectedHeaders: error.detectedHeaders,
    });
    return true;
  }
  return false;
}

/** Step 1 of the UI: what did we find in this workbook? */
router.post(
  "/analyze",
  requireRole("admin"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      const { detection } = runEnrichmentPipeline(
        req.file.buffer,
        [],
        readOverrides(req.body ?? {}),
      );
      console.log(
        `[Enrichment] analyze: sheet="${detection.sheetName}" headerRow=${detection.headerRowIndex} rows=${detection.dataRowCount} mapped=${detection.mapped.length}`,
      );
      res.json({ detection });
    } catch (error) {
      if (handleParseError(error, res)) return;
      console.error("[Enrichment] analyze failed:", error);
      res.status(500).json({ message: "Failed to analyze Excel file" });
    }
  },
);

/** Step 2 of the UI: which procedures would change, and what stayed behind? */
router.post(
  "/preview",
  requireRole("admin"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      // One read serves both jobs: matching needs id/reference/invoice/amount,
      // the diff needs every column of the winning rows.
      const full = await db.select().from(procedures);
      const candidates: MatchCandidate[] = full.map((p) => ({
        id: p.id,
        reference: p.reference,
        invoice_no: p.invoice_no,
        amount: p.amount,
      }));

      const { detection, matched, unmatched } = runEnrichmentPipeline(
        req.file.buffer,
        candidates,
        readOverrides(req.body ?? {}),
      );

      const byId = new Map(full.map((p) => [p.id, p as Record<string, unknown>]));

      const withChanges = matched
        .map((group) => {
          const procedure = byId.get(group.procedureId);
          if (!procedure) return null;
          return { ...group, changes: computeChanges(group, procedure) };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .filter((item) => item.changes.length > 0);

      console.log(
        `[Enrichment] preview: matched=${matched.length} withChanges=${withChanges.length} unmatched=${unmatched.length}`,
      );
      res.json({ detection, matched: withChanges, unmatched });
    } catch (error) {
      if (handleParseError(error, res)) return;
      console.error("[Enrichment] preview failed:", error);
      res.status(500).json({ message: "Failed to process Excel file" });
    }
  },
);

/** Step 3: write the changes the user ticked. */
router.post("/apply", requireRole("admin"), async (req, res) => {
  const { updates } = req.body ?? {};
  if (!Array.isArray(updates)) {
    return res.status(400).json({ message: "Invalid updates format" });
  }

  const results: Array<{
    id: number;
    status: "success" | "not_found" | "skipped" | "error";
    applied?: string[];
    skipped?: string[];
  }> = [];

  for (const update of updates) {
    const procedureId = Number(update?.procedureId);
    const changes = update?.changes;
    if (!Number.isInteger(procedureId) || !changes || typeof changes !== "object") {
      continue;
    }

    try {
      const [procedure] = await db
        .select()
        .from(procedures)
        .where(eq(procedures.id, procedureId));

      if (!procedure) {
        results.push({ id: procedureId, status: "not_found" });
        continue;
      }

      const applied: string[] = [];
      const skipped: string[] = [];
      const patch: Record<string, string> = {};

      for (const [rawField, value] of Object.entries(changes)) {
        const field = rawField as EnrichField;
        if (!ENRICH_FIELDS.has(field)) {
          console.warn(`[Enrichment] apply: rejected unknown field "${rawField}"`);
          continue;
        }
        // Re-check against the current row: someone may have filled this in
        // between preview and apply.
        if (!isFillable(field, (procedure as Record<string, unknown>)[field])) {
          skipped.push(field);
          continue;
        }
        patch[field] = String(value);
        applied.push(field);
      }

      if (applied.length === 0) {
        results.push({ id: procedureId, status: "skipped", applied, skipped });
        continue;
      }

      await db
        .update(procedures)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(procedures.id, procedureId));

      results.push({ id: procedureId, status: "success", applied, skipped });
    } catch (error) {
      console.error(`[Enrichment] apply failed for #${procedureId}:`, error);
      results.push({ id: procedureId, status: "error" });
    }
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  console.log(`[Enrichment] apply: ${succeeded}/${results.length} updated`);
  res.json({ message: "Updates applied", results });
});

export default router;
```

- [ ] **Step 4: Run the pipeline test**

Run: `npx vitest run server/enrichment/pipeline.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Confirm the router mount still reads correctly**

`server/routes.ts:196-197` already mounts the router and needs no change, because authorization now lives on each route inside the router:

```ts
  // Register Excel Enrichment Router (each route is admin-gated internally)
  app.use("/api/enrichment", excelEnrichmentRouter);
```

Update only the comment on line 196 to the text above.

- [ ] **Step 6: Verify the build and full suite**

Run: `npm run build`
Expected: succeeds (Vite client build + esbuild server bundle).

Run: `npm run test`
Expected: PASS — all suites.

- [ ] **Step 7: Commit**

```bash
git add server/excel-enrichment.ts server/enrichment/pipeline.test.ts server/routes.ts
git commit -m "feat(enrichment): rewrite endpoints around the new pipeline, gate on admin"
```

---

### Task 8: Client — detection step, preview step, unmatched report

**Files:**
- Rewrite: `client/src/components/ExcelDataEnrichment.tsx`
- Create: `client/src/components/enrichment/EnrichmentDetectionStep.tsx`
- Create: `client/src/components/enrichment/EnrichmentPreviewStep.tsx`
- Modify: `client/src/components/ui/procedures-table.tsx:847-848` (admin gate)
- Modify: `client/src/locales/tr.json` (`taxCalcComp.enrichment`)
- Modify: `client/src/locales/en.json` (`taxCalcComp.enrichment`)

**Interfaces:**
- Consumes: `POST /api/enrichment/analyze`, `/preview`, `/apply` from Task 7; `apiRequest` from `@/lib/queryClient`.
- Produces: no exports beyond the three components.

- [ ] **Step 1: Add the new i18n keys (Turkish)**

In `client/src/locales/tr.json`, replace the `taxCalcComp.enrichment` object with:

```json
"enrichment": {
  "triggerButton": "Veriyi Zenginleştir (Excel)",
  "title": "Excel'den Veri Zenginleştirme",
  "description": "Gümrükçü ithalat raporunu yükleyin. Sistem eksik ve sıfır duran alanları doldurur; dolu alanlara dokunmaz.",
  "clickToUpload": "Yüklemek için tıklayın veya sürükleyip bırakın",
  "excelFilesHint": "Excel dosyaları (.xlsx, .xls)",
  "selectFile": "Dosya Seç",
  "analyzing": "Analiz ediliyor...",
  "analyzeFile": "Dosyayı Analiz Et",
  "detectionTitle": "Tespit Edilen Yapı",
  "detectionSheet": "Sayfa",
  "detectionHeaderRow": "Başlık satırı",
  "detectionDataRows": "Veri satırı",
  "detectionSkipped": "{{count}} satır atlandı (toplam/boş satır)",
  "detectionMapped": "Eşlenen sütunlar ({{count}})",
  "detectionUnused": "Kullanılmayan sütun: \"{{header}}\" — bunun yerine \"{{winner}}\" kullanıldı",
  "detectionUnmapped": "Tanınmayan {{count}} sütun yok sayıldı",
  "detectionContinue": "Devam Et",
  "backToUpload": "Yüklemeye Geri Dön",
  "backToDetection": "Tespite Geri Dön",
  "loadingPreview": "Değişiklikler hesaplanıyor...",
  "recordsToUpdate": "Güncellenecek {{count}} kayıt bulundu",
  "selected": "Seçili: {{count}}",
  "reference": "Referans",
  "matchMethod": "Eşleştirme Yöntemi",
  "changesHeader": "Değişiklikler (Alan: Eski → Yeni)",
  "mergedRows": "Excel satırı: {{rows}}",
  "empty": "(boş)",
  "matchedBy_invoice_no": "Fatura No",
  "matchedBy_amount": "Tutar",
  "matchedBy_invoice_noamount": "Fatura No + Tutar",
  "unmatchedTitle": "Eşleşmeyen satırlar ({{count}})",
  "unmatchedRow": "Excel satır {{row}}",
  "unmatchedFile": "Dosya No: {{file}}",
  "unmatchedReason_not_found": "Fatura No \"{{invoice}}\" bulunamadı; {{amount}} tutarıyla da eşleşme yok.",
  "unmatchedReason_ambiguous": "Birden fazla kayıt uyuyor: {{candidates}}",
  "unmatchedReason_no_key": "Eşleştirme için fatura no veya tutar bilgisi yok.",
  "applyUpdates": "{{count}} Güncellemeyi Uygula",
  "updating": "Güncelleniyor...",
  "noMatchesTitle": "Eşleşme bulunamadı",
  "noMatchesDesc": "Excel dosyasındaki hiçbir satır mevcut kayıtlarla eşleştirilemedi ya da doldurulacak boş alan yok.",
  "enrichedSuccess": "{{count}} kayıt güncellendi.",
  "failedToProcess": "Excel dosyası işlenemedi.",
  "failedToApply": "Güncellemeler uygulanamadı.",
  "errorNoData": "Dosyada veri bulunamadı.",
  "errorNoHeaders": "Bu dosya beklenen rapor formatında değil. Bulunan başlıklar: {{headers}}"
}
```

- [ ] **Step 2: Add the matching English keys**

In `client/src/locales/en.json`, replace the `taxCalcComp.enrichment` object with:

```json
"enrichment": {
  "triggerButton": "Enrich Data (Excel)",
  "title": "Enrich Data from Excel",
  "description": "Upload the customs broker's import report. Empty and zero-valued fields are filled; fields that already hold a value are left untouched.",
  "clickToUpload": "Click to upload or drag and drop",
  "excelFilesHint": "Excel files (.xlsx, .xls)",
  "selectFile": "Select File",
  "analyzing": "Analyzing...",
  "analyzeFile": "Analyze File",
  "detectionTitle": "Detected Structure",
  "detectionSheet": "Sheet",
  "detectionHeaderRow": "Header row",
  "detectionDataRows": "Data rows",
  "detectionSkipped": "{{count}} row(s) skipped (total/blank rows)",
  "detectionMapped": "Mapped columns ({{count}})",
  "detectionUnused": "Unused column: \"{{header}}\" — \"{{winner}}\" was used instead",
  "detectionUnmapped": "{{count}} unrecognized column(s) ignored",
  "detectionContinue": "Continue",
  "backToUpload": "Back to Upload",
  "backToDetection": "Back to Detection",
  "loadingPreview": "Calculating changes...",
  "recordsToUpdate": "{{count}} record(s) to update",
  "selected": "Selected: {{count}}",
  "reference": "Reference",
  "matchMethod": "Match Method",
  "changesHeader": "Changes (Field: Old → New)",
  "mergedRows": "Excel row(s): {{rows}}",
  "empty": "(empty)",
  "matchedBy_invoice_no": "Invoice No",
  "matchedBy_amount": "Amount",
  "matchedBy_invoice_noamount": "Invoice No + Amount",
  "unmatchedTitle": "Unmatched rows ({{count}})",
  "unmatchedRow": "Excel row {{row}}",
  "unmatchedFile": "File No: {{file}}",
  "unmatchedReason_not_found": "Invoice No \"{{invoice}}\" not found; no match on amount {{amount}} either.",
  "unmatchedReason_ambiguous": "More than one record matches: {{candidates}}",
  "unmatchedReason_no_key": "Row has neither an invoice number nor an amount to match on.",
  "applyUpdates": "Apply {{count}} Update(s)",
  "updating": "Updating...",
  "noMatchesTitle": "No matches found",
  "noMatchesDesc": "No row in the Excel file matched an existing record, or there were no empty fields to fill.",
  "enrichedSuccess": "{{count}} record(s) updated.",
  "failedToProcess": "Could not process the Excel file.",
  "failedToApply": "Could not apply the updates.",
  "errorNoData": "No data found in the file.",
  "errorNoHeaders": "This file is not in the expected report format. Headers found: {{headers}}"
}
```

- [ ] **Step 3: Create the detection step component**

Create `client/src/components/enrichment/EnrichmentDetectionStep.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface UnusedColumn {
  field: string;
  colIndex: number;
  header: string;
  winnerHeader: string;
}

export interface DetectionSummary {
  sheetName: string;
  availableSheets: string[];
  headerRowIndex: number;
  dataRowCount: number;
  skippedRowCount: number;
  mapped: Array<{ field: string; colIndex: number; header: string }>;
  unusedCandidates: UnusedColumn[];
  unmappedHeaders: string[];
}

export function EnrichmentDetectionStep({
  detection,
}: {
  detection: DetectionSummary;
}) {
  const { t } = useTranslation();

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-1">
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <div className="mb-2 font-medium">
            {t("taxCalcComp.enrichment.detectionTitle")}
          </div>
          <dl className="grid grid-cols-[160px_1fr] gap-y-1">
            <dt className="text-muted-foreground">
              {t("taxCalcComp.enrichment.detectionSheet")}
            </dt>
            <dd className="font-mono">{detection.sheetName}</dd>
            <dt className="text-muted-foreground">
              {t("taxCalcComp.enrichment.detectionHeaderRow")}
            </dt>
            <dd className="font-mono">{detection.headerRowIndex + 1}</dd>
            <dt className="text-muted-foreground">
              {t("taxCalcComp.enrichment.detectionDataRows")}
            </dt>
            <dd className="font-mono">{detection.dataRowCount}</dd>
          </dl>
          {detection.skippedRowCount > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("taxCalcComp.enrichment.detectionSkipped", {
                count: detection.skippedRowCount,
              })}
            </p>
          )}
        </div>

        <div className="rounded-md border">
          <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
            {t("taxCalcComp.enrichment.detectionMapped", {
              count: detection.mapped.length,
            })}
          </div>
          <ul className="divide-y">
            {detection.mapped.map((column) => (
              <li
                key={column.field}
                className="flex items-center gap-2 px-3 py-1.5 text-sm"
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                <span className="font-mono text-xs">{column.header}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="font-medium">{column.field}</span>
              </li>
            ))}
          </ul>
        </div>

        {detection.unusedCandidates.length > 0 && (
          <ul className="flex flex-col gap-1">
            {detection.unusedCandidates.map((unused) => (
              <li
                key={`${unused.field}-${unused.colIndex}`}
                className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("taxCalcComp.enrichment.detectionUnused", {
                  header: unused.header,
                  winner: unused.winnerHeader,
                })}
              </li>
            ))}
          </ul>
        )}

        {detection.unmappedHeaders.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("taxCalcComp.enrichment.detectionUnmapped", {
              count: detection.unmappedHeaders.length,
            })}
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 4: Create the preview step component**

Create `client/src/components/enrichment/EnrichmentPreviewStep.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PreviewChange {
  field: string;
  oldValue: unknown;
  newValue: string;
}

export interface PreviewItem {
  procedureId: number;
  reference: string;
  matchMethod: string;
  excelRowNumbers: number[];
  changes: PreviewChange[];
}

export interface UnmatchedItem {
  excelRowNumber: number;
  customsFileNo: string | null;
  reason: "not_found" | "ambiguous" | "no_key";
  invoiceNo: string | null;
  amount: number | null;
  candidates: string[];
}

export function EnrichmentPreviewStep({
  items,
  unmatched,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  items: PreviewItem[];
  unmatched: UnmatchedItem[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onToggleAll: () => void;
}) {
  const { t } = useTranslation();

  const methodLabel = (method: string) =>
    t(`taxCalcComp.enrichment.matchedBy_${method.replace("+", "")}`, {
      defaultValue: method,
    });

  const unmatchedReason = (row: UnmatchedItem) => {
    if (row.reason === "ambiguous") {
      return t("taxCalcComp.enrichment.unmatchedReason_ambiguous", {
        candidates: row.candidates.join(", "),
      });
    }
    if (row.reason === "no_key") {
      return t("taxCalcComp.enrichment.unmatchedReason_no_key");
    }
    return t("taxCalcComp.enrichment.unmatchedReason_not_found", {
      invoice: row.invoiceNo ?? "—",
      amount: row.amount ?? "—",
    });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-muted-foreground">
          {t("taxCalcComp.enrichment.recordsToUpdate", { count: items.length })}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("taxCalcComp.enrichment.selected", { count: selectedIds.length })}
        </span>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-md border">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={
                      selectedIds.length === items.length && items.length > 0
                    }
                    onCheckedChange={onToggleAll}
                  />
                </TableHead>
                <TableHead>{t("taxCalcComp.enrichment.reference")}</TableHead>
                <TableHead>{t("taxCalcComp.enrichment.matchMethod")}</TableHead>
                <TableHead>
                  {t("taxCalcComp.enrichment.changesHeader")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.procedureId}
                  className={
                    selectedIds.includes(item.procedureId) ? "" : "opacity-50"
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.includes(item.procedureId)}
                      onCheckedChange={() => onToggle(item.procedureId)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {item.reference}
                    {item.excelRowNumbers.length > 1 && (
                      <div className="text-xs font-normal text-muted-foreground">
                        {t("taxCalcComp.enrichment.mergedRows", {
                          rows: item.excelRowNumbers.join(" + "),
                        })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      {methodLabel(item.matchMethod)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {item.changes.map((change) => (
                        <div
                          key={change.field}
                          className="grid grid-cols-[140px_1fr] items-center gap-2 text-sm"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {change.field}:
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-xs text-red-400 line-through">
                              {change.oldValue
                                ? String(change.oldValue)
                                : t("taxCalcComp.enrichment.empty")}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span className="font-medium text-green-600">
                              {change.newValue}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      {unmatched.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            {t("taxCalcComp.enrichment.unmatchedTitle", {
              count: unmatched.length,
            })}
          </div>
          <ScrollArea className="max-h-32">
            <ul className="divide-y divide-amber-200">
              {unmatched.map((row) => (
                <li key={row.excelRowNumber} className="px-3 py-2 text-xs">
                  <span className="font-medium text-amber-900">
                    {t("taxCalcComp.enrichment.unmatchedRow", {
                      row: row.excelRowNumber,
                    })}
                  </span>
                  {row.customsFileNo && (
                    <span className="ml-2 text-amber-800">
                      {t("taxCalcComp.enrichment.unmatchedFile", {
                        file: row.customsFileNo,
                      })}
                    </span>
                  )}
                  <div className="text-amber-800">{unmatchedReason(row)}</div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite the dialog shell**

Replace the entire contents of `client/src/components/ExcelDataEnrichment.tsx` with:

```tsx
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  EnrichmentDetectionStep,
  type DetectionSummary,
} from "@/components/enrichment/EnrichmentDetectionStep";
import {
  EnrichmentPreviewStep,
  type PreviewItem,
  type UnmatchedItem,
} from "@/components/enrichment/EnrichmentPreviewStep";

type Step = "upload" | "detection" | "preview";

interface ExcelDataEnrichmentProps {
  onSuccess?: () => void;
}

export function ExcelDataEnrichment({ onSuccess }: ExcelDataEnrichmentProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [detection, setDetection] = useState<DetectionSummary | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { t } = useTranslation();

  const reset = () => {
    setStep("upload");
    setFile(null);
    setDetection(null);
    setItems([]);
    setUnmatched([]);
    setSelectedIds([]);
  };

  /** Turns a server error body into a message the user can act on. */
  const describeError = async (error: unknown): Promise<string> => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no_data")) {
      return t("taxCalcComp.enrichment.errorNoData");
    }
    if (message.includes("no_headers")) {
      const headers = message.match(/"detectedHeaders":\[(.*?)\]/)?.[1] ?? "";
      return t("taxCalcComp.enrichment.errorNoHeaders", {
        headers: headers.replace(/"/g, "").slice(0, 200),
      });
    }
    return t("taxCalcComp.enrichment.failedToProcess");
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await apiRequest("POST", "/api/enrichment/analyze", form);
      const data = await response.json();
      setDetection(data.detection);
      setStep("detection");
    } catch (error) {
      toast({
        title: t("common.error"),
        description: await describeError(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!file || !detection) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sheetName", detection.sheetName);
      form.append("headerRowIndex", String(detection.headerRowIndex));
      const response = await apiRequest("POST", "/api/enrichment/preview", form);
      const data = await response.json();

      setItems(data.matched ?? []);
      setUnmatched(data.unmatched ?? []);
      setSelectedIds((data.matched ?? []).map((m: PreviewItem) => m.procedureId));

      if ((data.matched ?? []).length === 0) {
        toast({
          title: t("taxCalcComp.enrichment.noMatchesTitle"),
          description: t("taxCalcComp.enrichment.noMatchesDesc"),
          variant: "destructive",
        });
      }
      setStep("preview");
    } catch (error) {
      toast({
        title: t("common.error"),
        description: await describeError(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setLoading(true);
    try {
      const updates = items
        .filter((item) => selectedIds.includes(item.procedureId))
        .map((item) => ({
          procedureId: item.procedureId,
          changes: Object.fromEntries(
            item.changes.map((change) => [change.field, change.newValue]),
          ),
        }));

      const response = await apiRequest("POST", "/api/enrichment/apply", {
        updates,
      });
      const result = await response.json();
      const succeeded = (result.results ?? []).filter(
        (r: { status: string }) => r.status === "success",
      ).length;

      toast({
        title: t("common.success"),
        description: t("taxCalcComp.enrichment.enrichedSuccess", {
          count: succeeded,
        }),
      });

      setOpen(false);
      reset();
      onSuccess?.();
    } catch {
      toast({
        title: t("common.error"),
        description: t("taxCalcComp.enrichment.failedToApply"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id: number) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const toggleAll = () =>
    setSelectedIds((prev) =>
      prev.length === items.length ? [] : items.map((item) => item.procedureId),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          {t("taxCalcComp.enrichment.triggerButton")}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("taxCalcComp.enrichment.title")}</DialogTitle>
          <DialogDescription>
            {t("taxCalcComp.enrichment.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden p-1">
          {step === "upload" && (
            <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed bg-muted/50">
              <div className="rounded-full border bg-background p-4 shadow-sm">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium">
                  {t("taxCalcComp.enrichment.clickToUpload")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("taxCalcComp.enrichment.excelFilesHint")}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button onClick={() => fileInputRef.current?.click()}>
                {t("taxCalcComp.enrichment.selectFile")}
              </Button>
              {file && (
                <div className="flex items-center gap-2 rounded border bg-background px-3 py-1 text-sm">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  {file.name}
                </div>
              )}
            </div>
          )}

          {step === "detection" && detection && (
            <EnrichmentDetectionStep detection={detection} />
          )}

          {step === "preview" && (
            <EnrichmentPreviewStep
              items={items}
              unmatched={unmatched}
              selectedIds={selectedIds}
              onToggle={toggleSelection}
              onToggleAll={toggleAll}
            />
          )}
        </div>

        <DialogFooter>
          {step === "upload" && (
            <Button onClick={handleAnalyze} disabled={!file || loading}>
              {loading
                ? t("taxCalcComp.enrichment.analyzing")
                : t("taxCalcComp.enrichment.analyzeFile")}
            </Button>
          )}
          {step === "detection" && (
            <div className="flex w-full justify-between">
              <Button variant="ghost" onClick={reset}>
                {t("taxCalcComp.enrichment.backToUpload")}
              </Button>
              <Button onClick={handlePreview} disabled={loading}>
                {loading
                  ? t("taxCalcComp.enrichment.loadingPreview")
                  : t("taxCalcComp.enrichment.detectionContinue")}
              </Button>
            </div>
          )}
          {step === "preview" && (
            <div className="flex w-full justify-between">
              <Button variant="ghost" onClick={() => setStep("detection")}>
                {t("taxCalcComp.enrichment.backToDetection")}
              </Button>
              <Button
                onClick={handleApply}
                disabled={selectedIds.length === 0 || loading}
              >
                {loading
                  ? t("taxCalcComp.enrichment.updating")
                  : t("taxCalcComp.enrichment.applyUpdates", {
                      count: selectedIds.length,
                    })}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Gate the button on admin**

In `client/src/components/ui/procedures-table.tsx`, replace lines 847-848:

```tsx
          {/* Add button for creating a new procedure - Admin only */}
          <ExcelDataEnrichment onSuccess={() => refetch()} />
```

with:

```tsx
          {/* Excel enrichment and procedure creation - Admin only */}
          {isAdmin && <ExcelDataEnrichment onSuccess={() => refetch()} />}
```

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript or Vite errors in the touched files.

- [ ] **Step 8: Verify both locale files parse and stayed in sync**

Run:

```bash
node -e "const tr=require('./client/src/locales/tr.json').taxCalcComp.enrichment, en=require('./client/src/locales/en.json').taxCalcComp.enrichment; const a=Object.keys(tr).sort(), b=Object.keys(en).sort(); const miss=a.filter(k=>!b.includes(k)).concat(b.filter(k=>!a.includes(k))); console.log(a.length+' keys'); console.log(miss.length? 'FAIL, only in one file: '+miss.join(', ') : 'OK: tr and en match');"
```

Expected: a key count followed by `OK: tr and en match`.

- [ ] **Step 9: Manual end-to-end check**

Start the dev server: `node --env-file=.env --import tsx server/index.ts`

Then, signed in as an admin, on the Procedures page:
1. Click **Enrich Data (Excel)** and select `soho enrich örnek.xlsx`.
2. Click **Analyze File** — the detection screen must show sheet `İthalat Raporu`, header row `2`, `24` data rows, and amber warnings for `FATURA NO` and `KAP`.
3. Click **Continue** — the preview must list procedures with changes and one unmatched row for file no `26-11128`.
4. Untick everything except one record, click **Apply**, and confirm the toast reports `1`.
5. Reload the page and confirm that record now shows the filled values, with dates rendered as normal dates and customs as a short name.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/ExcelDataEnrichment.tsx client/src/components/enrichment/ client/src/components/ui/procedures-table.tsx client/src/locales/tr.json client/src/locales/en.json
git commit -m "feat(enrichment): add detection step, unmatched report and admin gating"
```

---

### Task 9: Surface `customs_file_no` in the procedure UI

The column added in Task 6 is written by the enricher but invisible until it
is rendered and editable. Without this task the broker file number cannot be
used for what it was requested: cross-referencing when corresponding with the
broker.

**Files:**
- Modify: `client/src/pages/procedure-details.tsx:110-131` (interface) and `:1074-1086` (declaration block)
- Modify: `client/src/pages/add-procedure.tsx:94-107` (schema), `:138-150` (defaults), `:574-586` (field)
- Modify: `client/src/pages/edit-procedure.tsx:91-100` (schema), `:124-133` (defaults), `:159-168` (reset), `:529-541` (field)
- Modify: `client/src/locales/tr.json`, `client/src/locales/en.json`

**Interfaces:**
- Consumes: `procedures.customs_file_no` from Task 6.
- Produces: nothing exported. `PUT /api/procedures/:reference` already spreads `req.body` into the update, so the new field reaches the database without a server change.

- [ ] **Step 1: Add the labels to both locale files**

In `client/src/locales/tr.json`, inside `procedurePages.form` (next to `importDecNumber`, around line 1053), add:

```json
      "customsFileNo": "Gümrükçü Dosya No",
      "customsFileNoPlaceholder": "Gümrükçünün dosya numarası (örn. 26-09933)",
```

and inside `procedurePages.details` (next to `declarationNumberField`, around line 1166), add:

```json
      "customsFileNoField": "Gümrükçü Dosya No:",
```

In `client/src/locales/en.json`, add to the same two objects:

```json
      "customsFileNo": "Broker File No",
      "customsFileNoPlaceholder": "Broker's file number (e.g. 26-09933)",
```

```json
      "customsFileNoField": "Broker File No:",
```

- [ ] **Step 2: Show it on the details page**

In `client/src/pages/procedure-details.tsx`, add the field to the local `Procedure` interface, right after `import_dec_date` (line 122):

```ts
  import_dec_number: string;
  import_dec_date: string | null;
  customs_file_no: string | null;
```

Then, in the "Import Declaration" block, add a third entry after the declaration-date entry (after line 1084):

```tsx
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.declarationDateField")}</span>
                    <p className="font-medium">{formatDateWithFallback(procedure.import_dec_date)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t("procedurePages.details.customsFileNoField")}</span>
                    <p className="font-medium">{procedure.customs_file_no || t("procedurePages.details.notAvailable")}</p>
                  </div>
```

- [ ] **Step 3: Add the field to the Add Procedure form**

In `client/src/pages/add-procedure.tsx`:

Schema — after `import_dec_number` (line 102):

```ts
  import_dec_number: z.string().optional(),
  customs_file_no: z.string().optional(),
```

Defaults — after `import_dec_number: ""` (line 146):

```ts
      import_dec_number: "",
      customs_file_no: "",
```

Form field — immediately after the Import Declaration Number `FormField` block (after line 587):

```tsx
                  {/* Broker File No */}
                  <FormField
                    control={form.control}
                    name="customs_file_no"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("procedurePages.form.customsFileNo")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.customsFileNoPlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
```

- [ ] **Step 4: Add the field to the Edit Procedure form**

In `client/src/pages/edit-procedure.tsx`:

Schema — after `import_dec_number` (line 96):

```ts
  import_dec_number: z.string().optional(),
  customs_file_no: z.string().optional(),
```

Defaults — after `import_dec_number: ""` (line 129):

```ts
      import_dec_number: "",
      customs_file_no: "",
```

Reset from the loaded procedure — after the `import_dec_number` line (line 164):

```ts
        import_dec_number: procedure.import_dec_number || "",
        customs_file_no: procedure.customs_file_no || "",
```

Form field — immediately after the Import Declaration Number `FormField` block (after line 541):

```tsx
                  {/* Broker File No */}
                  <FormField
                    control={form.control}
                    name="customs_file_no"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("procedurePages.form.customsFileNo")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("procedurePages.form.customsFileNoPlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
```

- [ ] **Step 5: Verify the locale files stayed in sync**

Run:

```bash
node -e "const tr=require('./client/src/locales/tr.json'), en=require('./client/src/locales/en.json'); const ok=['procedurePages.form.customsFileNo','procedurePages.form.customsFileNoPlaceholder','procedurePages.details.customsFileNoField'].every(p=>p.split('.').reduce((o,k)=>o?.[k],tr)&&p.split('.').reduce((o,k)=>o?.[k],en)); console.log(ok?'OK: all three keys present in tr and en':'FAIL: missing key');"
```

Expected: `OK: all three keys present in tr and en`

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Manual check**

With the dev server running (`node --env-file=.env --import tsx server/index.ts`):
1. Open a procedure whose `customs_file_no` the enricher filled — the details page shows it under **Import Declaration**.
2. Open **Edit** on that procedure — the field is pre-filled; change it, save, and confirm the new value persists after a reload.
3. Open **Add Procedure** — the field is present and empty.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/procedure-details.tsx client/src/pages/add-procedure.tsx client/src/pages/edit-procedure.tsx client/src/locales/tr.json client/src/locales/en.json
git commit -m "feat(procedures): show and edit the broker file number"
```

---

### Task 10: Remove the superseded code

**Files:**
- Delete: `debug-excel.ts`
- Delete: `debug-excel-db.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Confirm nothing imports the debug scripts**

Run:

```bash
grep -rn "debug-excel" --include="*.ts" --include="*.tsx" --include="*.json" . | grep -v node_modules
```

Expected: only the two files' own paths, or no output at all. If anything imports them, stop and report instead of deleting.

- [ ] **Step 2: Delete them**

These were one-off scripts written while diagnosing the original importer; the fixture-backed tests now cover the same ground.

```bash
git rm --cached debug-excel.ts debug-excel-db.ts 2>/dev/null; rm -f debug-excel.ts debug-excel-db.ts
```

- [ ] **Step 3: Confirm the dead mapping function is gone**

`mapExcelRowToDbFields` was removed in Task 7 when `server/excel-enrichment.ts` was rewritten. Verify:

```bash
grep -rn "mapExcelRowToDbFields\|COLUMN_MAPPING" --include="*.ts" server/ | grep -v node_modules
```

Expected: no output.

- [ ] **Step 4: Run the full suite and build one last time**

Run: `npm run test`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(enrichment): drop one-off excel debug scripts"
```

---

## Deployment

Pushing to `main` deploys automatically to the VPS. The deploy runs
`scripts/apply-manual-ddl.ts`, which applies
`002_procedures_customs_file_no.sql`. A DDL failure aborts the deploy, so
confirm the DDL applied cleanly against the local database (Task 6, Step 3)
before pushing.

No new secrets or environment variables are required.
