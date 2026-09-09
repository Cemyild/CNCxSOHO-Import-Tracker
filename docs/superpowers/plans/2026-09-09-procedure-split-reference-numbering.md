# Split Referans Numaralandırma — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tax calculation'dan ürün çıkarıldığında kaynak procedure `CNCALO-108 / 1`, çıkarılanlardan oluşan yeni procedure `CNCALO-108 / 2` referansını alsın; procedure referansı bağlı kayıtları koparmadan değiştirilebilsin.

**Architecture:** İki yeni sunucu modülü — biri saf numaralandırma mantığı (`procedure-split-reference.ts`), biri referansı tüm bağlı tablolarda tek transaction'da değiştiren servis (`procedure-reference-rename.ts`). Mevcut `create-procedure` endpoint'i `sourceProcedureId` geldiğinde split modunda çalışır. Procedure düzenleme sayfasındaki referans kilidi açılır ve aynı rename servisine bağlanır.

**Tech Stack:** TypeScript, Express, Drizzle ORM (`@neondatabase/serverless`), React + wouter + TanStack Query, vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-09-09-procedure-split-reference-numbering-design.md`

## Global Constraints

- **Referans formatı:** `<kök> / <N>` — slash'ın iki yanında **birer boşluk**. Yazma her zaman bu formatta; okuma `CNCALO-108/1`, `CNCALO-108 /1`, `CNCALO-108 / 1` varyasyonlarına toleranslı.
- **Cascade'li üç tabloya elle dokunulmaz:** `taxes`, `import_expenses`, `import_service_invoices` — canlı veritabanında `ON UPDATE CASCADE` FK'ları var, `procedures.reference` güncellenince kendiliğinden takip ederler. Bu tablolar `MANUAL_REFERENCE_TABLES` listesinde **yer almaz**.
- **Elle güncellenecek altı tablo:** `invoice_line_items`, `invoice_line_items_config`, `expense_documents`, `payments`, `payment_distributions`, `procedure_status_details`.
- **S3 nesneleri taşınmaz.** `expense_documents.object_key` olduğu gibi kalır.
- **Geriye dönük uyumluluk:** `POST /api/tax-calculation/calculations/:id/create-procedure` gövdesinde `sourceProcedureId` yoksa endpoint bugünkü davranışını **aynen** sürdürür (MCP aracı `server/mcp/tools/taxes.ts:873` bu yolu kullanıyor).
- **i18n:** Kullanıcıya görünen her yeni metin hem `client/src/locales/tr.json` hem `client/src/locales/en.json` içine eklenir. Hardcoded metin yazılmaz.
- **Yazma istekleri `apiRequest` kullanır** (ham `fetch` POST/PUT/PATCH/DELETE token taşımaz → 401).
- **`npm run check` bu repoda kırık** (`server/pdf-data-transformer.ts` bozuk, ~1450 hata veriyor). Typecheck'i doğrulama aracı olarak kullanma; `npx vitest run <dosya>` kullan.
- **`npm run db:push` YASAK.** Bu iş şema değişikliği gerektirmiyor; hiçbir DDL yazılmayacak.
- **Yerel sunucu:** `npm run dev` Windows'ta kırık. Gerekirse `node --env-file=.env --import tsx server/index.ts` (port 5000).
- **`.env` içindeki `DATABASE_URL` CANLI veritabanına bakıyor.** Hiçbir görevde canlı veriye yazan script çalıştırılmaz; yalnızca Task 6'daki doğrulama scripti (salt okunur) vardır.

---

### Task 1: Numaralandırma mantığı (saf fonksiyonlar)

**Files:**
- Create: `server/procedure-split-reference.ts`
- Test: `server/procedure-split-reference.test.ts`

**Interfaces:**
- Consumes: (yok — bu ilk görev)
- Produces:
  - `parseReference(ref: string): { root: string; part: number | null }`
  - `formatSplitReference(root: string, part: number): string`
  - `isSiblingOf(root: string, candidate: string): boolean`
  - `planSplit(sourceRef: string, siblings: string[]): SplitPlan`
  - `likeEscape(value: string): string`
  - `interface SplitPlan { root: string; sourceRename: { from: string; to: string } | null; newReference: string }`

- [ ] **Step 1: Write the failing test**

`server/procedure-split-reference.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseReference,
  formatSplitReference,
  isSiblingOf,
  planSplit,
  likeEscape,
} from "./procedure-split-reference";

describe("parseReference", () => {
  it("splits the canonical spaced form", () => {
    expect(parseReference("CNCALO-108 / 1")).toEqual({ root: "CNCALO-108", part: 1 });
  });

  it("splits legacy unspaced and half-spaced forms", () => {
    expect(parseReference("CNCALO-108/1")).toEqual({ root: "CNCALO-108", part: 1 });
    expect(parseReference("CNCALO-83 /1")).toEqual({ root: "CNCALO-83", part: 1 });
  });

  it("trims trailing whitespace left by old data", () => {
    expect(parseReference("CNCALO-85 /1 ")).toEqual({ root: "CNCALO-85", part: 1 });
  });

  it("keeps roots that contain spaces and dashes", () => {
    expect(parseReference("CNCALO-33 - GARMENTS/1")).toEqual({
      root: "CNCALO-33 - GARMENTS",
      part: 1,
    });
    expect(parseReference("CNCALO-42 -GARMENTS/3")).toEqual({
      root: "CNCALO-42 -GARMENTS",
      part: 3,
    });
  });

  it("reports no part for a plain reference", () => {
    expect(parseReference("CNCALO-108")).toEqual({ root: "CNCALO-108", part: null });
  });
});

describe("formatSplitReference", () => {
  it("always writes the spaced form", () => {
    expect(formatSplitReference("CNCALO-108", 2)).toBe("CNCALO-108 / 2");
    expect(formatSplitReference("CNCALO-108 ", 2)).toBe("CNCALO-108 / 2");
  });
});

describe("isSiblingOf", () => {
  it("accepts the root itself and its numbered forms", () => {
    expect(isSiblingOf("CNCALO-108", "CNCALO-108")).toBe(true);
    expect(isSiblingOf("CNCALO-108", "CNCALO-108 /2")).toBe(true);
    expect(isSiblingOf("CNCALO-108", "CNCALO-108/3")).toBe(true);
  });

  it("rejects a longer number that merely starts the same", () => {
    expect(isSiblingOf("CNCALO-108", "CNCALO-1080")).toBe(false);
    expect(isSiblingOf("CNCALO-108", "CNCALO-1080 / 1")).toBe(false);
    expect(isSiblingOf("CNCALO-10", "CNCALO-108")).toBe(false);
  });
});

describe("planSplit", () => {
  it("renames an unnumbered source to / 1 and gives the new one / 2", () => {
    const plan = planSplit("CNCALO-120", ["CNCALO-120"]);
    expect(plan.sourceRename).toEqual({ from: "CNCALO-120", to: "CNCALO-120 / 1" });
    expect(plan.newReference).toBe("CNCALO-120 / 2");
  });

  it("does not reuse a number that already exists (real CNCALO-108 data)", () => {
    const plan = planSplit("CNCALO-108", ["CNCALO-108", "CNCALO-108 /2"]);
    expect(plan.sourceRename).toEqual({ from: "CNCALO-108", to: "CNCALO-108 / 1" });
    expect(plan.newReference).toBe("CNCALO-108 / 3");
  });

  it("leaves an already numbered source alone", () => {
    const plan = planSplit("CNCALO-108 / 1", ["CNCALO-108 / 1", "CNCALO-108 / 2"]);
    expect(plan.sourceRename).toBeNull();
    expect(plan.newReference).toBe("CNCALO-108 / 3");
  });

  it("ignores non-siblings when picking the next number", () => {
    const plan = planSplit("CNCALO-108", ["CNCALO-108", "CNCALO-1080 / 9"]);
    expect(plan.newReference).toBe("CNCALO-108 / 2");
  });
});

describe("likeEscape", () => {
  it("escapes SQL LIKE wildcards", () => {
    expect(likeEscape("A_B%C")).toBe("A\\_B\\%C");
    expect(likeEscape("CNCALO-108")).toBe("CNCALO-108");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/procedure-split-reference.test.ts`
Expected: FAIL — `Failed to resolve import "./procedure-split-reference"`

- [ ] **Step 3: Write minimal implementation**

`server/procedure-split-reference.ts`:

```ts
/**
 * Reference numbering for split procedures.
 *
 * When products are removed from a tax calculation into a new one, both the
 * source and the new procedure get a " / N" suffix so the two parts of the same
 * shipment are recognisable: CNCALO-108 becomes CNCALO-108 / 1 and the new one
 * becomes CNCALO-108 / 2.
 *
 * Everything here is pure. The database-backed planner lives in Task 3's
 * loadSplitPlan, further down this same file.
 */

export interface ParsedReference {
  /** The reference without its " / N" suffix. */
  root: string;
  /** The suffix number, or null when the reference carries none. */
  part: number | null;
}

export interface SplitPlan {
  root: string;
  /** Set only when the source has no number yet and must become " / 1". */
  sourceRename: { from: string; to: string } | null;
  newReference: string;
}

const PART_PATTERN = /^(.+?)\s*\/\s*(\d+)$/;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Escape the wildcards a SQL LIKE pattern would otherwise interpret. */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Read a reference into root + part, tolerating every legacy spacing variant
 * present in live data ("CNCALO-4/1", "CNCALO-83 /1", "CNCALO-49 / 1").
 */
export function parseReference(ref: string): ParsedReference {
  const trimmed = String(ref ?? '').trim();
  const match = trimmed.match(PART_PATTERN);
  if (!match) return { root: trimmed, part: null };
  return { root: match[1].trim(), part: Number(match[2]) };
}

/** Write the canonical spaced form. New references always go through here. */
export function formatSplitReference(root: string, part: number): string {
  return `${root.trim()} / ${part}`;
}

/**
 * Is `candidate` the same shipment as `root`?
 *
 * Guards against prefix collisions: the root "CNCALO-108" must not swallow
 * "CNCALO-1080".
 */
export function isSiblingOf(root: string, candidate: string): boolean {
  const trimmedRoot = root.trim();
  const trimmedCandidate = String(candidate ?? '').trim();
  if (trimmedCandidate === trimmedRoot) return true;
  return new RegExp(`^${escapeRegex(trimmedRoot)}\\s*/\\s*\\d+$`).test(trimmedCandidate);
}

/**
 * Decide the two references a split produces.
 *
 * `siblings` is every candidate reference sharing the root; non-siblings are
 * filtered out here, so callers may over-fetch.
 */
export function planSplit(sourceRef: string, siblings: string[]): SplitPlan {
  const source = String(sourceRef ?? '').trim();
  const { root, part } = parseReference(source);

  // An unnumbered sibling counts as part 1 — that is the number it is about to
  // be given.
  const usedParts = siblings
    .filter((sibling) => isSiblingOf(root, sibling))
    .map((sibling) => parseReference(sibling).part ?? 1);

  const highest = usedParts.length > 0 ? Math.max(...usedParts) : (part ?? 1);

  return {
    root,
    sourceRename: part === null ? { from: source, to: formatSplitReference(root, 1) } : null,
    newReference: formatSplitReference(root, highest + 1),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/procedure-split-reference.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add server/procedure-split-reference.ts server/procedure-split-reference.test.ts
git commit -m "$(cat <<'EOF'
feat(split): reference numbering rules for split procedures

Pure helpers that read a procedure reference into root + part, tolerate
the legacy spacing variants in live data, and decide which numbers a
split assigns. Guards against prefix collisions so CNCALO-108 does not
treat CNCALO-1080 as a sibling.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Güvenli yeniden adlandırma servisi

**Files:**
- Create: `server/procedure-reference-rename.ts`
- Test: `server/procedure-reference-rename.test.ts`

**Interfaces:**
- Consumes: (Task 1'den bağımsız — ortak bağımlılık yok)
- Produces:
  - `renameProcedureReference(oldRef: string, newRef: string, tx?: Tx): Promise<RenameResult>`
  - `countReferenceUsage(ref: string): Promise<Record<string, number>>`
  - `planTaxCalculationAlignment(linked: LinkedCalculation[], from: string, to: string): LinkedCalculation[]`
  - `assertRenameInputs(oldRef: string, newRef: string): { from: string; to: string }`
  - `MANUAL_REFERENCE_TABLES` (readonly Drizzle tablo dizisi)
  - `interface RenameResult { procedureId: number; from: string; to: string; updated: Record<string, number> }`
  - `interface LinkedCalculation { id: number; reference: string | null }`

- [ ] **Step 1: Write the failing test**

`server/procedure-reference-rename.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  MANUAL_REFERENCE_TABLES,
  planTaxCalculationAlignment,
  assertRenameInputs,
} from "./procedure-reference-rename";

describe("MANUAL_REFERENCE_TABLES", () => {
  it("lists exactly the six tables without a cascading foreign key", () => {
    expect(MANUAL_REFERENCE_TABLES.map(getTableName).sort()).toEqual([
      "expense_documents",
      "invoice_line_items",
      "invoice_line_items_config",
      "payment_distributions",
      "payments",
      "procedure_status_details",
    ]);
  });

  it("excludes the cascading tables, which the database updates itself", () => {
    const names = MANUAL_REFERENCE_TABLES.map(getTableName);
    expect(names).not.toContain("taxes");
    expect(names).not.toContain("import_expenses");
    expect(names).not.toContain("import_service_invoices");
  });
});

describe("planTaxCalculationAlignment", () => {
  it("aligns a lone linked calculation even when its spelling differs", () => {
    const linked = [{ id: 303, reference: "CNCALO-108 /1" }];
    expect(planTaxCalculationAlignment(linked, "CNCALO-108", "CNCALO-108 / 1")).toEqual([
      { id: 303, reference: "CNCALO-108 /1" },
    ]);
  });

  it("touches only the exact match when several calculations are linked", () => {
    const linked = [
      { id: 1, reference: "CNCALO-108" },
      { id: 2, reference: "CNCALO-108 /1" },
    ];
    expect(planTaxCalculationAlignment(linked, "CNCALO-108", "CNCALO-108 / 1")).toEqual([
      { id: 1, reference: "CNCALO-108" },
    ]);
  });

  it("skips a calculation that already carries the target reference", () => {
    const linked = [{ id: 5, reference: "CNCALO-108 / 1" }];
    expect(planTaxCalculationAlignment(linked, "CNCALO-108", "CNCALO-108 / 1")).toEqual([]);
  });

  it("returns nothing when no calculation is linked", () => {
    expect(planTaxCalculationAlignment([], "CNCALO-108", "CNCALO-108 / 1")).toEqual([]);
  });
});

describe("assertRenameInputs", () => {
  it("trims both references", () => {
    expect(assertRenameInputs(" CNCALO-108 ", " CNCALO-108 / 1 ")).toEqual({
      from: "CNCALO-108",
      to: "CNCALO-108 / 1",
    });
  });

  it("rejects an empty current reference", () => {
    expect(() => assertRenameInputs("   ", "CNCALO-108 / 1")).toThrow(/current reference/i);
  });

  it("rejects an empty new reference", () => {
    expect(() => assertRenameInputs("CNCALO-108", "  ")).toThrow(/new reference/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/procedure-reference-rename.test.ts`
Expected: FAIL — `Failed to resolve import "./procedure-reference-rename"`

- [ ] **Step 3: Write minimal implementation**

`server/procedure-reference-rename.ts`:

```ts
import { eq, getTableName, sql } from "drizzle-orm";
import { db } from "./db";
import {
  procedures,
  invoiceLineItems,
  invoiceLineItemsConfig,
  expenseDocuments,
  payments,
  paymentDistributions,
  procedureStatusDetails,
  taxCalculations,
  taxes,
  importExpenses,
  importServiceInvoices,
} from "@shared/schema";

/**
 * Renaming a procedure reference, safely.
 *
 * procedures.reference is not just a label — ten tables carry it as text.
 * Three of them (taxes, import_expenses, import_service_invoices) have real
 * foreign keys with ON UPDATE CASCADE in the production database and follow a
 * rename on their own. The other six do not, and are updated here by hand.
 * Everything happens in one transaction: either the whole reference moves or
 * nothing does.
 */

/**
 * Tables carrying procedure_reference WITHOUT a cascading foreign key.
 *
 * Do NOT add taxes / import_expenses / import_service_invoices here — the
 * database already updates those, and a second write would be redundant.
 */
export const MANUAL_REFERENCE_TABLES = [
  invoiceLineItems,
  invoiceLineItemsConfig,
  expenseDocuments,
  payments,
  paymentDistributions,
  procedureStatusDetails,
] as const;

/** Tables the database updates for us; counted for reporting, never written. */
const CASCADING_REFERENCE_TABLES = [taxes, importExpenses, importServiceInvoices] as const;

export interface RenameResult {
  procedureId: number;
  from: string;
  to: string;
  /** Rows rewritten per table. Cascading tables are absent — they self-update. */
  updated: Record<string, number>;
}

export interface LinkedCalculation {
  id: number;
  reference: string | null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Trim and validate both ends of a rename. */
export function assertRenameInputs(oldRef: string, newRef: string): { from: string; to: string } {
  const from = String(oldRef ?? "").trim();
  const to = String(newRef ?? "").trim();
  if (!from) throw new Error("renameProcedureReference: current reference is empty");
  if (!to) throw new Error("renameProcedureReference: new reference is empty");
  return { from, to };
}

/**
 * Which linked tax calculations should take the new reference?
 *
 * tax_calculations.reference is UNIQUE and holds its own copy of the text. When
 * exactly one calculation is linked we align it even if it spells the reference
 * differently (live data has "CNCALO-108 /1" against a "CNCALO-108" procedure).
 * With several linked, only an exact match is safe to touch.
 */
export function planTaxCalculationAlignment(
  linked: LinkedCalculation[],
  from: string,
  to: string,
): LinkedCalculation[] {
  const candidates =
    linked.length === 1 ? linked : linked.filter((calc) => calc.reference === from);
  return candidates.filter((calc) => calc.reference !== to);
}

export async function renameProcedureReference(
  oldRef: string,
  newRef: string,
  tx?: Tx,
): Promise<RenameResult> {
  const { from, to } = assertRenameInputs(oldRef, newRef);

  const run = async (t: Tx): Promise<RenameResult> => {
    const [source] = await t.select().from(procedures).where(eq(procedures.reference, from));
    if (!source) throw new Error(`Procedure not found: ${from}`);

    if (to !== from) {
      const [clash] = await t
        .select({ id: procedures.id })
        .from(procedures)
        .where(eq(procedures.reference, to));
      if (clash) throw new Error(`Reference already in use: ${to}`);
    }

    const updated: Record<string, number> = {};

    // The cascading three follow this write on their own.
    await t
      .update(procedures)
      .set({ reference: to, updatedAt: new Date() })
      .where(eq(procedures.id, source.id));

    for (const table of MANUAL_REFERENCE_TABLES) {
      const rows = await t
        .update(table)
        .set({ procedureReference: to })
        .where(eq(table.procedureReference, from))
        .returning({ id: table.id });
      updated[getTableName(table)] = rows.length;
    }

    const linked = await t
      .select({ id: taxCalculations.id, reference: taxCalculations.reference })
      .from(taxCalculations)
      .where(eq(taxCalculations.procedure_id, source.id));

    const toAlign = planTaxCalculationAlignment(linked, from, to);
    for (const calc of toAlign) {
      await t.update(taxCalculations).set({ reference: to }).where(eq(taxCalculations.id, calc.id));
    }
    updated.tax_calculations = toAlign.length;

    return { procedureId: source.id, from, to, updated };
  };

  return tx ? run(tx) : db.transaction(run);
}

/** Row counts per table for a reference — feeds the confirmation dialog. */
export async function countReferenceUsage(ref: string): Promise<Record<string, number>> {
  const reference = String(ref ?? "").trim();
  const counts: Record<string, number> = {};

  for (const table of [...MANUAL_REFERENCE_TABLES, ...CASCADING_REFERENCE_TABLES]) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.procedureReference, reference));
    counts[getTableName(table)] = row?.n ?? 0;
  }

  const [calcRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(taxCalculations)
    .where(eq(taxCalculations.reference, reference));
  counts.tax_calculations = calcRow?.n ?? 0;

  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/procedure-reference-rename.test.ts`
Expected: PASS — 9 tests

**Beklenen tökezleme:** `MANUAL_REFERENCE_TABLES` bir `as const` tuple olduğu için
döngü içindeki `table` bir union tip alır ve `t.update(table).set({ procedureReference: to })`
Drizzle'ın aşırı yüklenmiş imzalarıyla tip hatası verebilir. Bu bir çalışma zamanı
sorunu değil — altı tablonun hepsinde `procedure_reference` (text) ve `id` (serial)
kolonları var. Tip hatası çıkarsa döngü değişkenini şöyle daralt:

```ts
    for (const table of MANUAL_REFERENCE_TABLES) {
      const target = table as (typeof MANUAL_REFERENCE_TABLES)[number];
      const rows = await t
        .update(target)
        .set({ procedureReference: to })
        .where(eq(target.procedureReference, from))
        .returning({ id: target.id });
      updated[getTableName(target)] = rows.length;
    }
```

Bu da yetmezse tabloları tek tek yazmak yerine listeyi koru ve döngüde `any`
kullan — listenin tek kaynak olması, tip kesinliğinden daha değerli: bir tablo
unutulursa veri kopar, tip hatası kopmaz. `npm run check` bu repoda zaten kırık
olduğu için doğrulama vitest ile yapılır.

- [ ] **Step 5: Commit**

```bash
git add server/procedure-reference-rename.ts server/procedure-reference-rename.test.ts
git commit -m "$(cat <<'EOF'
feat(procedures): transactional procedure reference rename

procedures.reference is a text key ten tables depend on. Three carry a
cascading FK and follow a rename themselves; the other six are rewritten
here inside the same transaction, along with the linked tax calculation's
own copy of the reference.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Sunucu tarafı split modu

**Files:**
- Modify: `server/procedure-split-reference.ts` (dosya sonuna `loadSplitPlan` eklenir)
- Modify: `server/routes.ts:6474-6595` (`create-procedure` endpoint'i)
- Modify: `server/routes.ts` (`app.get("/api/procedures/:id", ...)` — satır 902 — hemen **öncesine** iki yeni GET route eklenir)

**Interfaces:**
- Consumes: Task 1'den `parseReference`, `planSplit`, `likeEscape`, `SplitPlan`; Task 2'den `renameProcedureReference`, `countReferenceUsage`
- Produces:
  - `loadSplitPlan(procedureId: number): Promise<{ source: typeof procedures.$inferSelect; plan: SplitPlan }>`
  - `GET /api/procedures/:id/split-reference-preview` → `{ sourceCurrent, sourceAfter, nextReference }`
  - `GET /api/procedures/:id/reference-impact` → `{ reference, counts, total }`
  - `POST .../create-procedure` gövdesi artık isteğe bağlı `sourceProcedureId: number` kabul eder

- [ ] **Step 1: Write the failing test**

`server/procedure-split-reference.test.ts` dosyasının **sonuna** ekle:

```ts
describe("loadSplitPlan export", () => {
  it("is exported so routes can plan a split from a procedure id", async () => {
    const mod = await import("./procedure-split-reference");
    expect(typeof mod.loadSplitPlan).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/procedure-split-reference.test.ts`
Expected: FAIL — `expected "undefined" to be "function"`

- [ ] **Step 3: Add loadSplitPlan**

`server/procedure-split-reference.ts` dosyasının **başına** şu importları ekle:

```ts
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { procedures } from "@shared/schema";
```

ve dosyanın **sonuna** ekle:

```ts
/**
 * Load a procedure and work out what a split from it would be numbered.
 *
 * The LIKE only narrows candidates; planSplit does the real sibling filtering,
 * so a prefix collision such as CNCALO-1080 cannot leak in.
 */
export async function loadSplitPlan(
  procedureId: number,
): Promise<{ source: typeof procedures.$inferSelect; plan: SplitPlan }> {
  const [source] = await db.select().from(procedures).where(eq(procedures.id, procedureId));
  if (!source) throw new Error(`Procedure not found: ${procedureId}`);
  if (!source.reference) throw new Error(`Procedure ${procedureId} has no reference`);

  const { root } = parseReference(source.reference);
  const candidates = await db
    .select({ reference: procedures.reference })
    .from(procedures)
    .where(sql`${procedures.reference} LIKE ${`${likeEscape(root)}%`} ESCAPE '\\'`);

  const siblings = candidates
    .map((row) => row.reference)
    .filter((reference): reference is string => Boolean(reference));

  return { source, plan: planSplit(source.reference, siblings) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/procedure-split-reference.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: Add the two read-only routes**

`server/routes.ts` içinde satır 902'deki `app.get("/api/procedures/:id", ...)` satırının **hemen öncesine** ekle. (Express route'ları sırayla eşleştirir; `:id` route'u `/split-reference-preview`'ü yutmaz çünkü path segment sayısı farklı, ama okunabilirlik için yine de önce koyuyoruz.)

```ts
  // What would a split from this procedure be numbered? Read-only preview.
  app.get("/api/procedures/:id/split-reference-preview", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid procedure id" });

      const { source, plan } = await loadSplitPlan(id);
      res.json({
        sourceCurrent: source.reference,
        sourceAfter: plan.sourceRename?.to ?? source.reference,
        nextReference: plan.newReference,
      });
    } catch (error) {
      console.error("[Split preview] failed:", error);
      res.status(404).json({
        message: "Failed to preview split reference",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // How many rows would a rename of this procedure's reference rewrite?
  app.get("/api/procedures/:id/reference-impact", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid procedure id" });

      const procedure = await storage.getProcedure(id);
      if (!procedure?.reference) {
        return res.status(404).json({ message: "Procedure not found" });
      }

      const counts = await countReferenceUsage(procedure.reference);
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      res.json({ reference: procedure.reference, counts, total });
    } catch (error) {
      console.error("[Reference impact] failed:", error);
      res.status(500).json({
        message: "Failed to count reference usage",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
```

`server/routes.ts` import bloğuna ekle (dosyanın en üstündeki mevcut import'ların yanına):

```ts
import { loadSplitPlan } from "./procedure-split-reference";
import { renameProcedureReference, countReferenceUsage } from "./procedure-reference-rename";
```

- [ ] **Step 6: Wire split mode into create-procedure**

`server/routes.ts:6474` `create-procedure` handler'ında, `const inherited = req.body.inheritedProcedure ?? null;` satırının **hemen ardına** ekle:

```ts
        // Split mode: the client passes the source procedure so the two parts
        // of the shipment get " / N" references. Absent for a plain
        // create-procedure call (the MCP tool uses that path) — keep the old
        // behaviour untouched there.
        const sourceProcedureId = Number(req.body.sourceProcedureId) || null;
        let splitPlan: Awaited<ReturnType<typeof loadSplitPlan>>["plan"] | null = null;
        if (sourceProcedureId) {
          try {
            ({ plan: splitPlan } = await loadSplitPlan(sourceProcedureId));
            console.log('[Create Procedure] Split plan:', splitPlan);
          } catch (e) {
            console.error('[Create Procedure] Split planning failed, using calculation reference:', e);
          }
        }
        const targetReference = splitPlan?.newReference ?? calculation.reference;
```

Ardından aynı handler içinde `calculation.reference` kullanan **üç** yeri `targetReference` ile değiştir:

1. `procedureData` nesnesi: `reference: calculation.reference,` → `reference: targetReference,`
2. Line item map'i: `procedureReference: calculation.reference,` → `procedureReference: targetReference,`
3. `updateTaxCalculation` çağrısı — bugün yalnızca `procedure_id` yazıyor; referansı da yazacak şekilde değiştir:

```ts
        await storage.updateTaxCalculation(id, {
          procedure_id: procedure.id,
          ...(targetReference !== calculation.reference ? { reference: targetReference } : {}),
        });
```

Son olarak, `res.json({ procedure, lineItemsCreated: taxItems.length });` satırının **hemen öncesine** kaynağın yeniden adlandırılmasını ekle:

```ts
        // Rename the source LAST: if anything above failed we have not touched
        // it, and if this fails we are merely back to today's behaviour (a
        // numbered new procedure next to an unnumbered source), fixable from
        // the edit page.
        let sourceRenamed: string | null = null;
        if (splitPlan?.sourceRename) {
          try {
            const result = await renameProcedureReference(
              splitPlan.sourceRename.from,
              splitPlan.sourceRename.to,
            );
            sourceRenamed = result.to;
            console.log('[Create Procedure] ✅ Source renamed:', result.from, '→', result.to, result.updated);
          } catch (e) {
            console.error('[Create Procedure] ⚠️ Source rename failed:', e);
          }
        }
```

ve yanıtı genişlet:

```ts
        res.json({
          procedure,
          lineItemsCreated: taxItems.length,
          sourceRenamed,
        });
```

- [ ] **Step 7: Verify the server still boots**

Run: `node --env-file=.env --import tsx server/index.ts`
Expected: Başlangıç logları görünür ve süreç port 5000'de ayakta kalır (hata/stack trace yok). `Ctrl+C` ile durdur.

Ardından: `npx vitest run server/`
Expected: PASS — mevcut testlerin hiçbiri bozulmamış.

- [ ] **Step 8: Commit**

```bash
git add server/procedure-split-reference.ts server/procedure-split-reference.test.ts server/routes.ts
git commit -m "$(cat <<'EOF'
feat(split): number split references on the server

create-procedure now takes an optional sourceProcedureId. When present it
plans the split numbering, creates the new procedure as "<root> / N", and
renames the source to "<root> / 1" afterwards. Without it the endpoint
behaves exactly as before, so the MCP path is unaffected.

Adds two read-only routes: a split preview and a rename impact count.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Split akışının arayüz tarafı

**Files:**
- Modify: `client/src/pages/tax-calculation-edit.tsx:723-790` (`handleCreateNewCalculationWithRemovedItems`)
- Modify: `client/src/pages/tax-calculation-new.tsx:83` (yeni ref), `:103-155` (sessionStorage okuma), `:258-280` (`create-procedure` çağrısı)

**Interfaces:**
- Consumes: Task 3'ten `GET /api/procedures/:id/split-reference-preview` ve `create-procedure`'ın `sourceProcedureId` gövde alanı
- Produces: sessionStorage `newCalculationFromRemoved` nesnesine iki yeni alan — `sourceProcedureId: number | null`, ve `reference` artık `-SPLIT` yerine hesaplanmış `<kök> / N`

- [ ] **Step 1: Fetch the preview in the edit page**

`client/src/pages/tax-calculation-edit.tsx` içinde, `handleCreateNewCalculationWithRemovedItems` fonksiyonundaki `inheritedProcedure` bloğunun **hemen ardına** (yani `const removedItemsData = ...` satırının öncesine) ekle:

```ts
    // Ask the server what this split will be numbered. If the source has no
    // linked procedure, or the call fails, fall back to the old "-SPLIT" label
    // so the flow never breaks — the server decides the real reference anyway
    // when the procedure is created.
    let splitReference = invoiceData.reference ? `${invoiceData.reference}-SPLIT` : "";
    if (sourceProcedureId) {
      try {
        const previewRes = await fetch(`/api/procedures/${sourceProcedureId}/split-reference-preview`);
        if (previewRes.ok) {
          const preview = await previewRes.json();
          if (preview?.nextReference) splitReference = preview.nextReference;
        }
      } catch (e) {
        console.error('[Split] Failed to preview split reference:', e);
      }
    }
```

Ardından `newCalcData` nesnesindeki referans satırını değiştir:

```ts
      reference: splitReference,
```

ve aynı nesneye `sourceProcedureId` ekle (`inheritedProcedure,` satırının hemen ardına):

```ts
      sourceProcedureId: sourceProcedureId ?? null,
```

- [ ] **Step 2: Carry the source id through the new page**

`client/src/pages/tax-calculation-new.tsx:83` — `inheritedProcedureRef` tanımının **hemen ardına** ekle:

```ts
  const sourceProcedureIdRef = useRef<number | null>(null);
```

`:121` — `inheritedProcedureRef.current = parsed.inheritedProcedure ?? null;` satırının **hemen ardına** ekle:

```ts
          sourceProcedureIdRef.current = parsed.sourceProcedureId ?? null;
```

- [ ] **Step 3: Send it with create-procedure**

`client/src/pages/tax-calculation-new.tsx:261` civarındaki `create-procedure` çağrısını değiştir:

```ts
          const procRes = await apiRequest(
            "POST",
            `/api/tax-calculation/calculations/${calculation.id}/create-procedure`,
            { inheritedProcedure, sourceProcedureId: sourceProcedureIdRef.current },
          );
```

- [ ] **Step 4: Verify by hand**

Sunucuyu başlat: `node --env-file=.env --import tsx server/index.ts`

Tarayıcıda bir tax calculation aç → düzenle → bir ürünü çıkar → kaydet → çıkan diyalogda "yeni hesaplama oluştur"u seç.

Beklenen: yeni hesaplama sayfasındaki referans alanı `-SPLIT` yerine `<kök> / N` gösterir. Hesaplamayı kaydettiğinde yeni procedure o referansla oluşur ve kaynak procedure `<kök> / 1` olur.

**Bu adım canlı veritabanına yazar.** Test için üzerinde çalışılabilecek bir procedure'ı önce kullanıcıya sor; kendi başına gerçek bir kayıt üzerinde split başlatma.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/tax-calculation-edit.tsx client/src/pages/tax-calculation-new.tsx
git commit -m "$(cat <<'EOF'
feat(split): carry the source procedure through the split flow

The edit page now previews the split reference instead of labelling it
"-SPLIT", and passes the source procedure id along so create-procedure can
number both parts. Falls back to the old label if the preview call fails.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Referans kilidinin açılması

**Files:**
- Modify: `client/src/pages/edit-procedure.tsx:289-297` (referans alanı), `:175-205` (mutation), onay diyaloğu eklenir
- Modify: `server/routes.ts:1113-1131` (`PUT /api/procedures/:reference` handler'ının güncelleme kısmı)
- Modify: `client/src/locales/tr.json:1151`, `client/src/locales/en.json:1151` (`procedurePages.edit` bloğu)

**Interfaces:**
- Consumes: Task 2'den `renameProcedureReference`; Task 3'ten `GET /api/procedures/:id/reference-impact`
- Produces: `PUT /api/procedures/:reference` artık gövdedeki `reference` alanının değişmesini destekler

- [ ] **Step 1: Route the rename through the service**

`server/routes.ts` içinde `PUT /api/procedures/:reference` handler'ında, `const procedureId = existingProcedures[0].id;` satırının **hemen ardına** ekle:

```ts
      // A changed reference must go through the rename service — a plain
      // UPDATE would cascade to three tables and orphan the other six.
      const requestedReference = String(processedData.reference ?? "").trim();
      if (requestedReference && requestedReference !== reference) {
        try {
          await renameProcedureReference(reference, requestedReference);
        } catch (renameError) {
          console.error("[PUT /api/procedures/:reference] Rename failed:", renameError);
          return res.status(409).json({
            message: "Failed to rename procedure reference",
            error: renameError instanceof Error ? renameError.message : String(renameError),
          });
        }
      }
      delete processedData.reference;
```

`delete processedData.reference;` kritik: rename servisi referansı zaten yazdı; `storage.updateProcedure`'ın onu ikinci kez düz UPDATE ile yazmasına izin verilmez.

- [ ] **Step 2: Unlock the field and add the confirmation**

`client/src/pages/edit-procedure.tsx:294` — `disabled` prop'unu kaldır:

```tsx
                          <Input placeholder={t("procedurePages.form.referencePlaceholder")} {...field} />
```

`:296` — açıklamayı değiştir:

```tsx
                        <FormDescription>{t("procedurePages.edit.referenceRenameHint")}</FormDescription>
```

Bileşenin state'lerinin yanına (`updateMutation` tanımının **öncesine**) ekle:

```tsx
  const [pendingRename, setPendingRename] = useState<{
    data: ProcedureFormData;
    total: number;
  } | null>(null);
```

`onSubmit`'i değiştir:

```tsx
  const onSubmit = async (data: ProcedureFormData) => {
    const nextReference = data.reference.trim();
    if (nextReference === procedureReference) {
      updateMutation.mutate(data);
      return;
    }

    // Renaming rewrites every row that carries this reference — show how many
    // before doing it.
    let total = 0;
    try {
      const res = await apiRequest("GET", `/api/procedures/${procedure!.id}/reference-impact`);
      const impact = await res.json();
      total = impact?.total ?? 0;
    } catch (e) {
      console.error("Failed to load reference impact:", e);
    }
    setPendingRename({ data, total });
  };
```

Formun JSX'inin **sonuna** (en dıştaki kapanış etiketinin hemen öncesine) onay diyaloğunu ekle:

```tsx
      <AlertDialog open={pendingRename !== null} onOpenChange={(open) => !open && setPendingRename(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("procedurePages.edit.renameConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("procedurePages.edit.renameConfirmBody", {
                from: procedureReference,
                to: pendingRename?.data.reference.trim() ?? "",
                count: pendingRename?.total ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRename) updateMutation.mutate(pendingRename.data);
                setPendingRename(null);
              }}
            >
              {t("procedurePages.edit.renameConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

Import bloğuna ekle:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
```

`updateMutation`'ın `onSuccess`'inde yönlendirme yapılıyor; referans değiştiğinde de `/procedures`'a dönüldüğü için ek düzeltme gerekmez.

- [ ] **Step 3: Add the translations**

`client/src/locales/tr.json` — `procedurePages.edit` bloğunda `"referenceLocked"` satırını değiştir ve üç anahtar ekle:

```json
      "referenceRenameHint": "Referansı değiştirirsen bu referansa bağlı tüm kayıtlar da güncellenir.",
      "renameConfirmTitle": "Referans değiştirilsin mi?",
      "renameConfirmBody": "{{from}} → {{to}}. Bu referansa bağlı {{count}} kayıt da güncellenecek. Bu işlem geri alınamaz.",
      "renameConfirmAction": "Evet, değiştir",
```

`client/src/locales/en.json` — aynı blokta:

```json
      "referenceRenameHint": "Changing the reference also updates every record linked to it.",
      "renameConfirmTitle": "Change the reference?",
      "renameConfirmBody": "{{from}} → {{to}}. {{count}} linked records will be updated too. This cannot be undone.",
      "renameConfirmAction": "Yes, change it",
```

`"referenceLocked"` anahtarını **sil** — artık kullanılmıyor.

Kontrol et: `grep -rn "referenceLocked" client/src/` hiçbir sonuç döndürmemeli.

- [ ] **Step 4: Verify by hand**

Sunucuyu başlat, procedure listesinden bir kayıt düzenle. Beklenen:

- Referans alanı artık yazılabilir.
- Referansı değiştirip kaydete bastığında onay diyaloğu çıkar ve etkilenecek kayıt sayısını gösterir.
- İptal edersen hiçbir şey değişmez.
- Onaylarsan kayıt yeni referansla listede görünür.

**Bu adım canlı veritabanına yazar.** Gerçek bir referansı değiştirmeden önce kullanıcıdan hangi kayıtla test edilebileceğini sor.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/edit-procedure.tsx server/routes.ts client/src/locales/tr.json client/src/locales/en.json
git commit -m "$(cat <<'EOF'
feat(procedures): allow editing a procedure reference

The field was locked because a plain UPDATE would orphan the six tables
that carry the reference without a cascading FK. It now routes through the
rename service, behind a confirmation that reports how many linked rows
the change rewrites.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: CNCALO-108'in düzeltilmesi ve doğrulanması

**Files:**
- Create: `scripts/verify-split-references.mjs` (salt okunur doğrulama)

**Interfaces:**
- Consumes: Task 5'te açılan düzenleme yolu
- Produces: (kod yüzeyi yok — bu bir veri düzeltmesi ve doğrulaması)

- [ ] **Step 1: Write the read-only verification script**

`scripts/verify-split-references.mjs`:

```js
/**
 * Read-only check of a split reference family.
 *
 *   node --env-file=.env scripts/verify-split-references.mjs CNCALO-108
 *
 * Prints the procedures sharing the root, the tax calculations linked to them,
 * and the row counts each reference carries across the tables that store it as
 * text. Writes nothing.
 */
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const root = process.argv[2];
if (!root) {
  console.error('Usage: node --env-file=.env scripts/verify-split-references.mjs <root reference>');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const procs = await pool.query(
  `SELECT id, reference FROM procedures WHERE reference LIKE $1 ORDER BY id`,
  [`${root}%`],
);
console.log(`Procedures matching "${root}":`);
for (const row of procs.rows) console.log(`  #${row.id} ${JSON.stringify(row.reference)}`);

const calcs = await pool.query(
  `SELECT id, reference, procedure_id FROM tax_calculations WHERE reference LIKE $1 ORDER BY id`,
  [`${root}%`],
);
console.log(`\nTax calculations matching "${root}":`);
for (const row of calcs.rows) {
  console.log(`  #${row.id} ${JSON.stringify(row.reference)} → procedure ${row.procedure_id}`);
}

const TABLES = [
  'invoice_line_items',
  'invoice_line_items_config',
  'expense_documents',
  'payments',
  'payment_distributions',
  'procedure_status_details',
  'taxes',
  'import_expenses',
  'import_service_invoices',
];

console.log('\nRows per reference:');
for (const row of procs.rows) {
  const counts = [];
  for (const table of TABLES) {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE procedure_reference = $1`,
      [row.reference],
    );
    if (r.rows[0].n > 0) counts.push(`${table}=${r.rows[0].n}`);
  }
  console.log(`  ${JSON.stringify(row.reference)}: ${counts.join(', ') || 'no linked rows'}`);
}

await pool.end();
```

- [ ] **Step 2: Record the before state**

Run: `node --env-file=.env scripts/verify-split-references.mjs CNCALO-108`

Expected (bugünkü canlı veri):

```
Procedures matching "CNCALO-108":
  #263 "CNCALO-108"
  #273 "CNCALO-108 /2"

Tax calculations matching "CNCALO-108":
  #303 "CNCALO-108 /1" → procedure 263
  #313 "CNCALO-108 /2" → procedure 273

Rows per reference:
  "CNCALO-108": invoice_line_items=81, expense_documents=6
  ...
```

Çıktıyı kaydet — sonraki adımda karşılaştıracaksın.

- [ ] **Step 3: Rename CNCALO-108 through the UI**

Bu adım **kullanıcı tarafından** yapılır, script ile değil.

Uygulamada procedure #263'ü düzenle → referansı `CNCALO-108` yerine `CNCALO-108 / 1` yaz → onay diyaloğunda etkilenecek kayıt sayısının **87 civarında** (81 fatura kalemi + 6 belge) olduğunu doğrula → onayla.

- [ ] **Step 4: Verify the after state**

Run: `node --env-file=.env scripts/verify-split-references.mjs CNCALO-108`

Expected:

```
Procedures matching "CNCALO-108":
  #263 "CNCALO-108 / 1"
  #273 "CNCALO-108 /2"

Tax calculations matching "CNCALO-108":
  #303 "CNCALO-108 / 1" → procedure 263
  #313 "CNCALO-108 /2" → procedure 273

Rows per reference:
  "CNCALO-108 / 1": invoice_line_items=81, expense_documents=6
  ...
```

Doğrulanması gerekenler: 81 ve 6 sayıları **taşınmış**, kaybolmamış; `CNCALO-108` adında hiçbir satır kalmamış; hesaplama #303 de yeni formata hizalanmış.

Sayılar tutmuyorsa **durdur ve bildir** — `MANUAL_REFERENCE_TABLES` listesinde eksik bir tablo var demektir.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-split-references.mjs
git commit -m "$(cat <<'EOF'
chore(split): read-only verification script for reference families

Prints the procedures, tax calculations and linked row counts for a split
root so a rename can be checked before and after.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Uygulama sonrası

Deploy: `git push origin main` VPS'e otomatik dağıtır. Şema değişikliği olmadığı için `db/manual-ddl/` altına hiçbir şey eklenmez.

Deploy sonrası duman testi: bir procedure'dan split yap, iki referansın `<kök> / 1` ve `<kök> / N` olduğunu ve masraf/belge sayılarının korunduğunu `scripts/verify-split-references.mjs` ile doğrula.
