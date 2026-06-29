# Create Procedure PDF Auto-Fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create Procedure sayfasında tek bir birleşik PDF yükleyince beyanname
başlığı, vergiler, ithalat masrafları, hizmet faturaları ve ürün kalemleri otomatik
çıkarılsın; kullanıcı önizleyip onaylayınca prosedür + tüm kalemler tek seferde
kaydedilsin ve ilgili belgeler doğru yerlere iliştirilsin. **Hesaplama yapılmaz.**

**Architecture:** "Sınıflandır → yönlendir → topla-kaydet". PDF bir kez S3'e
yüklenir; ucuz Haiku ile sayfa-tipleri sınıflandırılır; `pdf-lib` ile tipe göre
alt-PDF'lere bölünür; her alt-PDF mevcut ince-ayarlı okuyuculara (beyanname,
akıllı masraf, ürün) gönderilir; sonuçlar birleştirilip önizlemeye döner.
"Oluştur" tek bir DB transaction'ında prosedür + alt kayıtları yazar, sonra
en-iyi-çaba ile orijinal sayfaları kayıtlara iliştirir.

**Tech Stack:** Express + Drizzle (Postgres) + TypeScript (ESM), React + react-hook-form +
react-i18next, Anthropic SDK (`claude-sonnet-4-6` okuyucular, `claude-haiku-4-5-20251001`
sınıflandırıcı), `pdf-lib` (sayfa bölme), Hetzner S3 (`object-storage.ts`), Vitest (yeni, birim test).

## Global Constraints

- **Hesaplama YASAK:** vergi/masraf/ürün hesaplaması (cif, customs_tax, vat_base, costMultiplier vb.) hiçbir yerde tetiklenmez. Sadece belgedeki gerçek rakamlar ham olarak kaydedilir. `calculateAllItems` ÇAĞRILMAZ.
- **DB değişikliği YOK:** yeni tablo/kolon/migration eklenmez. Mevcut tablolar kullanılır.
- **MCP YASAK:** hiçbir MCP write/extract tool'u kullanılmaz; her şey app endpoint'leri içinde.
- **PDF limiti:** 20MB (mevcut `pdfUpload` multer limiti ile tutarlı, `application/pdf` filtresi).
- **Auth:** yeni Claude-çağıran endpoint'ler `requireClaudeAuth` middleware'i ile korunur (mevcut analiz endpoint'leriyle aynı).
- **Modeller:** okuyucular `claude-sonnet-4-6` (varsayılan), sınıflandırıcı `claude-haiku-4-5-20251001`. Anthropic çağrıları `temperature: 0`.
- **createdBy varsayılanı:** `req.body.user?.id || 3` (mevcut handler deseni; 3 = admin).
- **ESM + path alias:** `@shared/*` ve `@/*`; `import` uzantısız (TS NodeNext değil, mevcut import stiline uy: `import { x } from "./y"`).
- **Tarih formatı:** DB'ye her zaman `YYYY-MM-DD` string yazılır (timezone'dan kaçın).
- **Proxy zaman aşımı:** prod nginx ~60s `proxy_read_timeout`; analiz adımı okuyucuları PARALEL çalıştırarak < 60s hedefler.
- **Doğrulama komutu:** `npm run check` (tsc). Birim testler: `npx vitest run`. Windows'ta `npm run dev` kırık; sunucuyu manuel başlatma için `node --env-file=.env --import tsx server/index.ts` (port 5000).

---

## File Structure

**Yeni dosyalar (server):**
- `server/document-router.ts` — saf yardımcılar: sayfa sınıflandırma yanıt-parser'ı, `classifyPdfPages`, `splitPdfByPages`, `remapPageNumber`, `groupPagesByType` + tipler.
- `server/extractors/customs-declaration.ts` — `extractCustomsDeclaration(buffer)` (routes.ts'ten taşınan beyanname promptu + parse).
- `server/extractors/expense-receipt.ts` — `extractExpenseReceipt(buffer)` (routes.ts'ten taşınan akıllı masraf promptu + normalize).
- `server/procedure-document-import.ts` — `analyzeProcedureDocument`, `combineExtractionResults`, `buildCreateInserts`, `createProcedureFromDocument` + tipler.

**Yeni dosyalar (test):**
- `vitest.config.ts`
- `server/document-router.test.ts`
- `server/procedure-document-import.test.ts`

**Değişecek dosyalar (server):**
- `server/routes.ts` — (a) 2 mevcut handler'ı yeni extractor fonksiyonlarını kullanacak şekilde sadeleştir; (b) 2 yeni endpoint ekle: `POST /api/procedures/analyze-document`, `POST /api/procedures/create-from-document`.
- `package.json` — `vitest` devDependency + `"test": "vitest run"` script.

**Değişecek dosyalar (client):**
- `client/src/pages/add-procedure.tsx` — üstte PDF dropzone + analiz çağrısı + sonuçla formu/önizlemeyi doldurma + "Oluştur" akışı.
- `client/src/components/procedure-import/DocumentImportReview.tsx` — vergiler/masraflar/hizmet faturaları/ürünler için düzenlenebilir önizleme bileşeni.
- `client/src/locales/tr.json`, `client/src/locales/en.json` — `procedureImport.*` çevirileri.

---

## PHASE 1 — Backend

### Task 0: Vitest test altyapısı

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts + devDependencies)

**Interfaces:**
- Produces: `npx vitest run` komutu; `*.test.ts` dosyaları çalışır.

- [ ] **Step 1: Vitest kur**

Run:
```bash
npm install -D vitest@^2.1.9
```
Expected: `package.json` devDependencies'e `vitest` eklenir, hata yok.

- [ ] **Step 2: `vitest.config.ts` oluştur**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
      "@": path.resolve(__dirname, "./client/src"),
    },
  },
});
```

- [ ] **Step 3: `package.json` scripts'e test ekle**

`"check": "tsc"` satırının altına ekle:
```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Geçici doğrulama testi yaz**

Create `server/_smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Testi çalıştır, geçtiğini doğrula**

Run: `npx vitest run server/_smoke.test.ts`
Expected: 1 passed.

- [ ] **Step 6: Geçici testi sil ve commit**

```bash
rm server/_smoke.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(test): add vitest test infrastructure"
```

---

### Task 1: PDF sayfa yardımcıları (`document-router.ts` — bölme/eşleme)

**Files:**
- Create: `server/document-router.ts`
- Test: `server/document-router.test.ts`

**Interfaces:**
- Produces:
  - `type PageType = 'customs_declaration' | 'expense_tax_service' | 'commercial_invoice' | 'packing_list' | 'awb' | 'other'`
  - `interface PageClassification { page: number; type: PageType }`
  - `splitPdfByPages(buffer: Buffer, pages: number[]): Promise<{ buffer: Buffer; pageMap: number[] }>` — `pageMap[i]` = alt-PDF'in (i+1). sayfasının orijinal PDF'teki 1-indexli sayfa no'su.
  - `remapPageNumber(subPage: number, pageMap: number[]): number | null` — alt-PDF sayfa no (1-indexli) → orijinal sayfa no; aralık dışındaysa `null`.
  - `groupPagesByType(classifications: PageClassification[]): Record<PageType, number[]>` — her tip için artan sıralı orijinal sayfa no listesi.

- [ ] **Step 1: Failing test yaz**

Create `server/document-router.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  splitPdfByPages,
  remapPageNumber,
  groupPagesByType,
  type PageClassification,
} from "./document-router";

async function makePdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

describe("splitPdfByPages", () => {
  it("extracts only requested pages and returns the original-page map", async () => {
    const src = await makePdf(5);
    const { buffer, pageMap } = await splitPdfByPages(src, [2, 4]);
    const out = await PDFDocument.load(buffer);
    expect(out.getPageCount()).toBe(2);
    expect(pageMap).toEqual([2, 4]);
  });

  it("ignores out-of-range and de-duplicates while preserving order", async () => {
    const src = await makePdf(3);
    const { pageMap } = await splitPdfByPages(src, [3, 99, 1, 1]);
    expect(pageMap).toEqual([3, 1]);
  });
});

describe("remapPageNumber", () => {
  it("maps sub-pdf page to original page", () => {
    expect(remapPageNumber(1, [2, 4])).toBe(2);
    expect(remapPageNumber(2, [2, 4])).toBe(4);
    expect(remapPageNumber(3, [2, 4])).toBeNull();
  });
});

describe("groupPagesByType", () => {
  it("buckets pages by type, sorted ascending", () => {
    const c: PageClassification[] = [
      { page: 3, type: "commercial_invoice" },
      { page: 1, type: "customs_declaration" },
      { page: 2, type: "expense_tax_service" },
      { page: 4, type: "commercial_invoice" },
    ];
    const g = groupPagesByType(c);
    expect(g.customs_declaration).toEqual([1]);
    expect(g.expense_tax_service).toEqual([2]);
    expect(g.commercial_invoice).toEqual([3, 4]);
    expect(g.awb).toEqual([]);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npx vitest run server/document-router.test.ts`
Expected: FAIL — "Cannot find module './document-router'".

- [ ] **Step 3: `document-router.ts`'in bölme/eşleme kısmını yaz**

```ts
import { PDFDocument } from "pdf-lib";

export type PageType =
  | "customs_declaration"
  | "expense_tax_service"
  | "commercial_invoice"
  | "packing_list"
  | "awb"
  | "other";

export const PAGE_TYPES: PageType[] = [
  "customs_declaration",
  "expense_tax_service",
  "commercial_invoice",
  "packing_list",
  "awb",
  "other",
];

export interface PageClassification {
  page: number; // 1-indexed original page
  type: PageType;
}

/**
 * Build a new PDF containing only `pages` (1-indexed) from `buffer`.
 * Out-of-range pages are skipped; duplicates removed; original order preserved.
 * Returns the sub-PDF buffer and `pageMap` where pageMap[i] is the original
 * 1-indexed page number of the (i+1)-th page in the sub-PDF.
 */
export async function splitPdfByPages(
  buffer: Buffer,
  pages: number[],
): Promise<{ buffer: Buffer; pageMap: number[] }> {
  const src = await PDFDocument.load(buffer);
  const total = src.getPageCount();

  const seen = new Set<number>();
  const valid: number[] = [];
  for (const p of pages) {
    if (Number.isInteger(p) && p >= 1 && p <= total && !seen.has(p)) {
      seen.add(p);
      valid.push(p);
    }
  }

  const out = await PDFDocument.create();
  if (valid.length > 0) {
    const copied = await out.copyPages(
      src,
      valid.map((p) => p - 1),
    );
    copied.forEach((pg) => out.addPage(pg));
  }
  const bytes = await out.save();
  return { buffer: Buffer.from(bytes), pageMap: valid };
}

export function remapPageNumber(
  subPage: number,
  pageMap: number[],
): number | null {
  if (!Number.isInteger(subPage) || subPage < 1 || subPage > pageMap.length) {
    return null;
  }
  return pageMap[subPage - 1];
}

export function groupPagesByType(
  classifications: PageClassification[],
): Record<PageType, number[]> {
  const groups = Object.fromEntries(
    PAGE_TYPES.map((t) => [t, [] as number[]]),
  ) as Record<PageType, number[]>;
  for (const c of classifications) {
    if (groups[c.type]) groups[c.type].push(c.page);
  }
  for (const t of PAGE_TYPES) groups[t].sort((a, b) => a - b);
  return groups;
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Run: `npx vitest run server/document-router.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/document-router.ts server/document-router.test.ts
git commit -m "feat(import): add pdf page split + page-map helpers"
```

---

### Task 2: Sayfa sınıflandırıcı (`document-router.ts` — parser + Haiku çağrısı)

**Files:**
- Modify: `server/document-router.ts`
- Test: `server/document-router.test.ts`

**Interfaces:**
- Produces:
  - `parseClassificationResponse(raw: string, pageCount: number): PageClassification[]` — Claude'un döndürdüğü ham metni temizleyip doğrular; geçersiz/eksik sayfaları `"other"` yapar; her sayfa 1..pageCount için tam bir liste döndürür.
  - `classifyPdfPages(buffer: Buffer): Promise<PageClassification[]>` — Haiku ile sınıflandırır.

- [ ] **Step 1: Failing test ekle (parser saf fonksiyonu)**

`server/document-router.test.ts` sonuna ekle:
```ts
import { parseClassificationResponse } from "./document-router";

describe("parseClassificationResponse", () => {
  it("parses a clean JSON array", () => {
    const raw = `[{"page":1,"type":"customs_declaration"},{"page":2,"type":"commercial_invoice"}]`;
    expect(parseClassificationResponse(raw, 2)).toEqual([
      { page: 1, type: "customs_declaration" },
      { page: 2, type: "commercial_invoice" },
    ]);
  });

  it("strips markdown fences and surrounding text", () => {
    const raw = "Here:\n```json\n[{\"page\":1,\"type\":\"awb\"}]\n```\n";
    expect(parseClassificationResponse(raw, 1)).toEqual([
      { page: 1, type: "awb" },
    ]);
  });

  it("fills missing pages with 'other' and coerces unknown types", () => {
    const raw = `[{"page":1,"type":"banana"}]`;
    expect(parseClassificationResponse(raw, 3)).toEqual([
      { page: 1, type: "other" },
      { page: 2, type: "other" },
      { page: 3, type: "other" },
    ]);
  });

  it("returns all-other on unparseable input", () => {
    expect(parseClassificationResponse("no json here", 2)).toEqual([
      { page: 1, type: "other" },
      { page: 2, type: "other" },
    ]);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npx vitest run server/document-router.test.ts`
Expected: FAIL — `parseClassificationResponse` is not a function.

- [ ] **Step 3: parser + classifier'ı `document-router.ts`'e ekle**

Dosyanın başına import ekle:
```ts
import { analyzePdfWithClaude } from "./claude";
```

Dosyanın sonuna ekle:
```ts
const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";

function isPageType(v: unknown): v is PageType {
  return typeof v === "string" && (PAGE_TYPES as string[]).includes(v);
}

/** Robustly parse Claude's page-classification response into a full list. */
export function parseClassificationResponse(
  raw: string,
  pageCount: number,
): PageClassification[] {
  const byPage = new Map<number, PageType>();
  try {
    let cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          const page = Number(entry?.page);
          if (Number.isInteger(page) && page >= 1 && page <= pageCount) {
            byPage.set(page, isPageType(entry?.type) ? entry.type : "other");
          }
        }
      }
    }
  } catch {
    // fall through to all-other
  }

  const result: PageClassification[] = [];
  for (let p = 1; p <= pageCount; p++) {
    result.push({ page: p, type: byPage.get(p) ?? "other" });
  }
  return result;
}

const CLASSIFIER_PROMPT = `You are classifying each page of a Turkish import-procedure PDF.
Return ONLY a JSON array, one object per page, no markdown, no extra text.
Each object: {"page": <1-indexed page number>, "type": <one of the labels>}.

LABELS:
- "customs_declaration": Turkish customs import declaration (Gümrük Giriş/İthalat Beyannamesi, GTIP/beyanname numarası, gümrük müdürlüğü).
- "expense_tax_service": expense receipts / cost statements (masraf makbuzu), tax receipts (vergi makbuzu), or service/commission invoices (komisyon/hizmet faturası) — anything that is a paid cost, tax, or a service invoice.
- "commercial_invoice": the seller's commercial invoice listing products (style, quantity, unit price, HS/HTS code).
- "packing_list": packing list (çeki listesi / koli listesi).
- "awb": air waybill (AWB / hava konşimentosu).
- "other": anything else.

Classify EVERY page from 1 to the last page. Output example:
[{"page":1,"type":"customs_declaration"},{"page":2,"type":"commercial_invoice"}]`;

/** Classify each page of the PDF using a cheap model (Haiku). */
export async function classifyPdfPages(
  buffer: Buffer,
): Promise<PageClassification[]> {
  const pageCount = (await PDFDocument.load(buffer)).getPageCount();
  const raw = await analyzePdfWithClaude({
    base64Data: buffer.toString("base64"),
    prompt: CLASSIFIER_PROMPT,
    maxTokens: 1500,
    temperature: 0,
    model: CLASSIFIER_MODEL,
  });
  return parseClassificationResponse(raw, pageCount);
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Run: `npx vitest run server/document-router.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run check`
Expected: hata yok (yeni dosya temiz derlenir).
```bash
git add server/document-router.ts server/document-router.test.ts
git commit -m "feat(import): add Haiku page classifier + robust parser"
```

---

### Task 3: Beyanname okuyucusunu fonksiyona taşı (`extractors/customs-declaration.ts`)

**Files:**
- Create: `server/extractors/customs-declaration.ts`
- Modify: `server/routes.ts` (`/api/procedures/analyze-customs-declaration` handler, ~10466-11068)

**Interfaces:**
- Produces:
  - `interface CustomsDeclarationData { shipper: string; package: number; weight: number; pieces: number; awbNumber: string; customs: string; importDeclarationNumber: string; importDeclarationDate: string; usdTlRate: number }`
  - `extractCustomsDeclaration(buffer: Buffer): Promise<CustomsDeclarationData>` — promptu çalıştırır, JSON temizler, Zod doğrular, "package" düzeltme kurallarını uygular. Parse/validation hatasında `Error` fırlatır.

- [ ] **Step 1: Extractor dosyasını oluştur (promptu routes.ts'ten birebir taşı)**

`server/extractors/customs-declaration.ts`:
```ts
import { z } from "zod";
import { analyzePdfWithClaude } from "../claude";

export const customsDeclarationDataSchema = z.object({
  shipper: z.string(),
  package: z.number().optional().default(0),
  weight: z.number(),
  pieces: z.number(),
  awbNumber: z.string(),
  customs: z.string(),
  importDeclarationNumber: z.string(),
  importDeclarationDate: z.string(),
  usdTlRate: z.number(),
});

export type CustomsDeclarationData = z.infer<typeof customsDeclarationDataSchema>;

// NOTE FOR IMPLEMENTER: copy the EXACT prompt string currently assigned to
// `const prompt = ...` inside the `/api/procedures/analyze-customs-declaration`
// handler in server/routes.ts (verbatim, do not paraphrase) and paste it here.
const CUSTOMS_DECLARATION_PROMPT = `__PASTE_EXACT_PROMPT_FROM_ROUTES_TS__`;

export async function extractCustomsDeclaration(
  buffer: Buffer,
): Promise<CustomsDeclarationData> {
  const base64Pdf = buffer.toString("base64");

  const result = await analyzePdfWithClaude({
    base64Data: base64Pdf,
    prompt: CUSTOMS_DECLARATION_PROMPT,
    maxTokens: 3000,
    temperature: 0,
  });

  let cleanedJson = result.trim();
  cleanedJson = cleanedJson.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  cleanedJson = cleanedJson.replace(/<[^>]*>/g, "");
  const firstBrace = cleanedJson.indexOf("{");
  if (firstBrace > 0) cleanedJson = cleanedJson.substring(firstBrace);
  const lastBrace = cleanedJson.lastIndexOf("}");
  if (lastBrace !== -1 && lastBrace < cleanedJson.length - 1) {
    cleanedJson = cleanedJson.substring(0, lastBrace + 1);
  }
  cleanedJson = cleanedJson.trim();
  if (!cleanedJson.startsWith("{") || !cleanedJson.endsWith("}")) {
    throw new Error("Claude response does not contain valid JSON object");
  }

  const parsed = JSON.parse(cleanedJson);
  const validation = customsDeclarationDataSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      "Invalid customs declaration data: " +
        JSON.stringify(validation.error.issues),
    );
  }
  const data = validation.data;

  // Detect likely extraction errors and zero out a bad "package" value.
  if (data.package > 0) {
    if (data.package === Math.floor(data.usdTlRate)) data.package = 0;
    if (data.package > 100) data.package = 0;
  }
  return data;
}
```

- [ ] **Step 2: Promptu birebir taşı**

`server/routes.ts` içindeki `/api/procedures/analyze-customs-declaration` handler'ında `const prompt = \`...\`` ile atanan TÜM şablon metnini kes, `customs-declaration.ts`'teki `CUSTOMS_DECLARATION_PROMPT` değişkenine yapıştır (`__PASTE_EXACT_PROMPT_FROM_ROUTES_TS__` yerine). Metni değiştirme.

- [ ] **Step 3: routes.ts handler'ını fonksiyona delege edecek şekilde sadeleştir**

`/api/procedures/analyze-customs-declaration` handler gövdesini şununla değiştir:
```ts
app.post("/api/procedures/analyze-customs-declaration", requireClaudeAuth, pdfUpload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "PDF file is required" });
    }
    if (req.file.size > 20 * 1024 * 1024) {
      return res.status(400).json({ error: "PDF file exceeds 20MB limit" });
    }
    const data = await extractCustomsDeclaration(req.file.buffer);
    res.json({ success: true, data });
  } catch (error) {
    console.error("[Customs Declaration PDF] Analysis error:", error);
    res.status(500).json({
      error: "Failed to analyze customs declaration document",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});
```

Eski `customsDeclarationDataSchema` tanımı routes.ts'te başka yerde kullanılmıyorsa kaldır (kullanılıyorsa `import { customsDeclarationDataSchema } from "./extractors/customs-declaration"` ile değiştir).

- [ ] **Step 4: Import ekle**

`server/routes.ts` üst import bloğuna ekle:
```ts
import { extractCustomsDeclaration } from "./extractors/customs-declaration";
```

- [ ] **Step 5: Typecheck**

Run: `npm run check`
Expected: hata yok.

- [ ] **Step 6: Commit**

```bash
git add server/extractors/customs-declaration.ts server/routes.ts
git commit -m "refactor(import): extract customs-declaration reader into reusable fn"
```

---

### Task 4: Akıllı masraf okuyucusunu fonksiyona taşı (`extractors/expense-receipt.ts`)

**Files:**
- Create: `server/extractors/expense-receipt.ts`
- Modify: `server/routes.ts` (`/api/expenses/analyze-pdf/expense-receipt` handler, ~9744-10145)

**Interfaces:**
- Produces:
  - `interface ExpenseReceiptItem { id: string; description: string; amount: number; currency: string; suggestedCategory: string; type: "tax" | "expense" | "service_invoice"; invoiceNumber: string; invoiceDate: string; receiptNumber: string; issuer: string; pageNumber: number | null }`
  - `interface ExpenseReceiptTaxes { customsTax: number; additionalCustomsTax: number; kkdf: number; vat: number; stampTax: number }`
  - `interface ExpenseReceiptResult { documentType: string; pageCount: number; items: ExpenseReceiptItem[]; taxes: ExpenseReceiptTaxes }`
  - `extractExpenseReceipt(buffer: Buffer): Promise<ExpenseReceiptResult>`

- [ ] **Step 1: Extractor dosyasını oluştur (promptu + normalize'i taşı)**

`server/extractors/expense-receipt.ts`:
```ts
import { analyzePdfWithClaude } from "../claude";

export interface ExpenseReceiptItem {
  id: string;
  description: string;
  amount: number;
  currency: string;
  suggestedCategory: string;
  type: "tax" | "expense" | "service_invoice";
  invoiceNumber: string;
  invoiceDate: string;
  receiptNumber: string;
  issuer: string;
  pageNumber: number | null;
}

export interface ExpenseReceiptTaxes {
  customsTax: number;
  additionalCustomsTax: number;
  kkdf: number;
  vat: number;
  stampTax: number;
}

export interface ExpenseReceiptResult {
  documentType: string;
  pageCount: number;
  items: ExpenseReceiptItem[];
  taxes: ExpenseReceiptTaxes;
}

const TAX_CATEGORIES = [
  "customs_tax",
  "additional_customs_tax",
  "kkdf",
  "vat",
  "stamp_tax",
];
const EXPENSE_CATEGORIES = [
  "export_registry_fee",
  "insurance",
  "awb_fee",
  "airport_storage_fee",
  "bonded_warehouse_storage_fee",
  "transportation",
  "international_transportation",
  "tareks_fee",
  "customs_inspection",
  "azo_test",
  "other",
];

function toNumber(v: any): number {
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

// NOTE FOR IMPLEMENTER: copy the EXACT prompt string currently assigned to
// `const prompt = ...` inside the `/api/expenses/analyze-pdf/expense-receipt`
// handler in server/routes.ts (verbatim) and paste it here.
const EXPENSE_RECEIPT_PROMPT = `__PASTE_EXACT_PROMPT_FROM_ROUTES_TS__`;

export async function extractExpenseReceipt(
  buffer: Buffer,
): Promise<ExpenseReceiptResult> {
  const result = await analyzePdfWithClaude({
    base64Data: buffer.toString("base64"),
    prompt: EXPENSE_RECEIPT_PROMPT,
    maxTokens: 8000,
    temperature: 0,
  });

  let cleanJson = result
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in Claude response");
  const parsed = JSON.parse(jsonMatch[0]);

  const documentType = parsed.documentType || "expense_receipt";
  const pageCount = parsed.pageCount || 1;
  const rawItems = parsed.items || parsed.expenses || [];
  const allCategories = [...TAX_CATEGORIES, ...EXPENSE_CATEGORIES];

  let items: ExpenseReceiptItem[];

  if (documentType === "service_invoice" || pageCount <= 2) {
    items = (Array.isArray(rawItems) ? rawItems : []).map(
      (item: any, index: number) => ({
        id: `temp-${index}`,
        description: item.description || "Service Invoice",
        amount: toNumber(item.amount),
        currency: item.currency || "TRY",
        suggestedCategory: "service_invoice",
        type: "service_invoice" as const,
        invoiceNumber: item.invoiceNumber || "",
        invoiceDate: item.invoiceDate || "",
        receiptNumber: item.receiptNumber || "",
        issuer: item.issuer || "",
        pageNumber: item.pageNumber || 1,
      }),
    );
  } else {
    items = (Array.isArray(rawItems) ? rawItems : []).map(
      (item: any, index: number) => {
        const category = allCategories.includes(item.suggestedCategory)
          ? item.suggestedCategory
          : "other";
        const isTax = TAX_CATEGORIES.includes(category);
        return {
          id: `temp-${index}`,
          description: item.description || "",
          amount: toNumber(item.amount),
          currency: item.currency || "TRY",
          suggestedCategory: category,
          type: isTax ? ("tax" as const) : ("expense" as const),
          invoiceNumber: item.invoiceNumber || "",
          invoiceDate: item.invoiceDate || "",
          receiptNumber: item.receiptNumber || "",
          issuer: item.issuer || "",
          pageNumber: item.pageNumber ?? null,
        };
      },
    );
  }

  const taxes: ExpenseReceiptTaxes = {
    customsTax: 0,
    additionalCustomsTax: 0,
    kkdf: 0,
    vat: 0,
    stampTax: 0,
  };
  if (parsed.taxes && typeof parsed.taxes === "object") {
    taxes.customsTax = toNumber(parsed.taxes.customsTax);
    taxes.additionalCustomsTax = toNumber(parsed.taxes.additionalCustomsTax);
    taxes.kkdf = toNumber(parsed.taxes.kkdf);
    taxes.vat = toNumber(parsed.taxes.vat);
    taxes.stampTax = toNumber(parsed.taxes.stampTax);
  }
  // Also fold any tax-typed items into the summary (matches existing behaviour).
  for (const item of items) {
    if (item.type !== "tax") continue;
    switch (item.suggestedCategory) {
      case "customs_tax": taxes.customsTax += item.amount; break;
      case "additional_customs_tax": taxes.additionalCustomsTax += item.amount; break;
      case "kkdf": taxes.kkdf += item.amount; break;
      case "vat": taxes.vat += item.amount; break;
      case "stamp_tax": taxes.stampTax += item.amount; break;
    }
  }

  return { documentType, pageCount, items, taxes };
}
```

> NOT: Mevcut endpoint, `parsed.taxes` zaten varsa item'lardan TEKRAR toplar (çift sayım riski). Yukarıdaki fonksiyon aynı davranışı korur (geriye-uyum); davranışı değiştirme. Orkestratör (Task 5) bunu olduğu gibi kullanır.

- [ ] **Step 2: Promptu birebir taşı**

`server/routes.ts` `/api/expenses/analyze-pdf/expense-receipt` handler'ındaki `const prompt = \`...\`` metnini kes, `EXPENSE_RECEIPT_PROMPT`'a yapıştır.

- [ ] **Step 3: routes.ts handler'ını sadeleştir (S3 yükleme korunur)**

Handler gövdesini şununla değiştir:
```ts
app.post("/api/expenses/analyze-pdf/expense-receipt", requireClaudeAuth, pdfUpload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "PDF file is required" });
    }
    if (req.file.size > 20 * 1024 * 1024) {
      return res.status(400).json({ error: "PDF file exceeds 20MB limit" });
    }

    const data = await extractExpenseReceipt(req.file.buffer);

    let pdfObjectKey: string | null = null;
    try {
      const sanitizedName = req.file.originalname?.replace(/[^a-zA-Z0-9.-]/g, '_') || 'expense-receipt.pdf';
      pdfObjectKey = await uploadFile(req.file.buffer, sanitizedName, 'application/pdf', 'expense-receipts');
    } catch (uploadError) {
      console.error("[Expense Receipt PDF] Failed to upload PDF:", uploadError);
      pdfObjectKey = null;
    }

    // Preserve the legacy response shape consumed by expense-entry.tsx
    const responseData: any = { ...data, expenses: data.items.filter((i) => i.type === "expense") };
    res.json({
      success: true,
      data: responseData,
      pdfFile: pdfObjectKey ? {
        objectKey: pdfObjectKey,
        originalFilename: req.file.originalname || 'expense-receipt.pdf',
        fileSize: req.file.size,
        fileType: 'application/pdf',
        pageCount: data.pageCount,
      } : null,
    });
  } catch (error) {
    console.error("[Expense Receipt PDF] Analysis error:", error);
    res.status(500).json({
      error: "Failed to analyze expense receipt document",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});
```

> Bu, `expense-entry.tsx`'in beklediği `data.items`, `data.taxes`, `data.expenses` ve `pdfFile` alanlarını korur (`client/src/pages/expense-entry.tsx:1053-1063`).

- [ ] **Step 4: Import ekle**

`server/routes.ts` üst import bloğuna:
```ts
import { extractExpenseReceipt } from "./extractors/expense-receipt";
```
(`uploadFile` zaten import edilmiş — üst blokta mevcut.)

- [ ] **Step 5: Typecheck**

Run: `npm run check`
Expected: hata yok.

- [ ] **Step 6: Manuel duman testi (mevcut özelliğin kırılmadığını doğrula)**

Sunucuyu başlat: `node --env-file=.env --import tsx server/index.ts`
Giriş yap, bir prosedürün "Add/Edit Expense" sayfasında bir masraf PDF'i yükle.
Expected: kalemler eskisi gibi tanınıyor (regresyon yok).

- [ ] **Step 7: Commit**

```bash
git add server/extractors/expense-receipt.ts server/routes.ts
git commit -m "refactor(import): extract expense-receipt reader into reusable fn"
```

---

### Task 5: Orkestratör — analiz + birleştirme (`procedure-document-import.ts`)

**Files:**
- Create: `server/procedure-document-import.ts`
- Test: `server/procedure-document-import.test.ts`

**Interfaces:**
- Consumes: `classifyPdfPages`, `groupPagesByType`, `splitPdfByPages`, `remapPageNumber` (Task 1-2); `extractCustomsDeclaration` (Task 3); `extractExpenseReceipt` (Task 4); `extractFromPdf` (`server/document-extraction.ts`, mevcut); `uploadFile`, `getFile` (`object-storage.ts`).
- Produces:
  - Tipler:
    ```ts
    interface ImportHeader { shipper: string; package: number; kg: number; piece: number; awbNumber: string; customs: string; importDeclarationNumber: string; importDeclarationDate: string; usdTlRate: number; invoice_no: string; invoice_date: string; amount: number; currency: string }
    interface ImportExpenseDraft { category: string; amount: number; currency: string; invoiceNumber: string; invoiceDate: string; issuer: string; documentNumber: string; originalPage: number | null }
    interface ImportServiceInvoiceDraft { amount: number; currency: string; invoiceNumber: string; date: string; notes: string; originalPage: number | null }
    interface ImportProductDraft { style: string; unit_count: number; cost: number; total_value: number; tr_hs_code: string; hts_code: string }
    interface ImportDocumentDraft { importDocumentType: string; originalPages: number[] }
    interface AnalyzeDocumentResult { pdfFile: { objectKey: string; originalFilename: string; fileSize: number; fileType: string; pageCount: number }; header: ImportHeader; taxes: { customsTax: number; additionalCustomsTax: number; kkdf: number; vat: number; stampTax: number }; expenses: ImportExpenseDraft[]; serviceInvoices: ImportServiceInvoiceDraft[]; products: ImportProductDraft[]; documents: ImportDocumentDraft[] }
    ```
  - `combineExtractionResults(parts): AnalyzeDocumentResult` — SAF; aşağıdaki şekilde test edilir.
  - `analyzeProcedureDocument(buffer: Buffer, originalname: string): Promise<AnalyzeDocumentResult>`

- [ ] **Step 1: Failing test (saf birleştirme fonksiyonu)**

`server/procedure-document-import.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { combineExtractionResults } from "./procedure-document-import";

describe("combineExtractionResults", () => {
  const pdfFile = {
    objectKey: "k",
    originalFilename: "f.pdf",
    fileSize: 1,
    fileType: "application/pdf",
    pageCount: 5,
  };

  it("maps header, taxes, expenses (remapped pages), service invoices, products, documents", () => {
    const out = combineExtractionResults({
      pdfFile,
      groups: {
        customs_declaration: [1],
        expense_tax_service: [2, 3],
        commercial_invoice: [4],
        packing_list: [5],
        awb: [],
        other: [],
      },
      customs: {
        shipper: "ACME", package: 3, weight: 120.5, pieces: 40,
        awbNumber: "12345", customs: "IST", importDeclarationNumber: "IM1",
        importDeclarationDate: "2026-01-02", usdTlRate: 42.3,
      },
      expenseResult: {
        documentType: "expense_receipt",
        pageCount: 2,
        items: [
          { id: "t0", description: "Nakliye", amount: 2500, currency: "TRY", suggestedCategory: "transportation", type: "expense", invoiceNumber: "A1", invoiceDate: "2026-01-03", receiptNumber: "R1", issuer: "Tasiyici", pageNumber: 2 },
          { id: "t1", description: "Komisyon", amount: 1000, currency: "TRY", suggestedCategory: "service_invoice", type: "service_invoice", invoiceNumber: "S1", invoiceDate: "2026-01-04", receiptNumber: "", issuer: "Komisyoncu", pageNumber: 1 },
        ],
        taxes: { customsTax: 15000, additionalCustomsTax: 0, kkdf: 0, vat: 8000, stampTax: 0 },
      },
      expensePageMap: [2, 3],
      productResult: {
        products: [
          { style: "A0054U", color: "", category: "Knit", fabric_content: "", cost: 4.07, unit_count: 300, country_of_origin: "TR", hts_code: "6117808000", total_value: 1221 },
        ],
        invoiceMetadata: { invoice_no: "INV-9", invoice_date: "2026-01-01", shipper: "ACME" },
      },
    });

    expect(out.header.shipper).toBe("ACME");
    expect(out.header.kg).toBe(120.5);
    expect(out.header.piece).toBe(40);
    expect(out.header.invoice_no).toBe("INV-9");
    expect(out.header.amount).toBe(1221); // sum of product totals
    expect(out.taxes.customsTax).toBe(15000);
    expect(out.expenses).toHaveLength(1);
    expect(out.expenses[0].category).toBe("transportation");
    expect(out.expenses[0].originalPage).toBe(3); // sub-page 2 -> original 3
    expect(out.serviceInvoices).toHaveLength(1);
    expect(out.serviceInvoices[0].date).toBe("2026-01-04");
    expect(out.serviceInvoices[0].originalPage).toBe(2); // sub-page 1 -> original 2
    expect(out.products[0].tr_hs_code).toBe("6117808000"); // falls back to hts_code
    expect(out.documents).toEqual([
      { importDocumentType: "import_declaration", originalPages: [1] },
      { importDocumentType: "invoice", originalPages: [4] },
      { importDocumentType: "packing_list", originalPages: [5] },
    ]);
  });

  it("handles all-null extractions gracefully", () => {
    const out = combineExtractionResults({
      pdfFile,
      groups: { customs_declaration: [], expense_tax_service: [], commercial_invoice: [], packing_list: [], awb: [], other: [1,2,3,4,5] },
      customs: null,
      expenseResult: null,
      expensePageMap: [],
      productResult: null,
    });
    expect(out.header.shipper).toBe("");
    expect(out.expenses).toEqual([]);
    expect(out.serviceInvoices).toEqual([]);
    expect(out.products).toEqual([]);
    expect(out.documents).toEqual([]);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npx vitest run server/procedure-document-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: `procedure-document-import.ts` — tipler + `combineExtractionResults`**

```ts
import {
  classifyPdfPages,
  groupPagesByType,
  splitPdfByPages,
  remapPageNumber,
  type PageType,
} from "./document-router";
import { extractCustomsDeclaration, type CustomsDeclarationData } from "./extractors/customs-declaration";
import { extractExpenseReceipt, type ExpenseReceiptResult } from "./extractors/expense-receipt";
import { extractFromPdf } from "./document-extraction";
import { uploadFile } from "./object-storage";

export interface ImportHeader {
  shipper: string; package: number; kg: number; piece: number;
  awbNumber: string; customs: string; importDeclarationNumber: string;
  importDeclarationDate: string; usdTlRate: number;
  invoice_no: string; invoice_date: string; amount: number; currency: string;
}
export interface ImportExpenseDraft {
  category: string; amount: number; currency: string;
  invoiceNumber: string; invoiceDate: string; issuer: string;
  documentNumber: string; originalPage: number | null;
}
export interface ImportServiceInvoiceDraft {
  amount: number; currency: string; invoiceNumber: string; date: string;
  notes: string; originalPage: number | null;
}
export interface ImportProductDraft {
  style: string; unit_count: number; cost: number; total_value: number;
  tr_hs_code: string; hts_code: string;
}
export interface ImportDocumentDraft { importDocumentType: string; originalPages: number[] }
export interface PdfFileRef { objectKey: string; originalFilename: string; fileSize: number; fileType: string; pageCount: number }
export interface AnalyzeDocumentResult {
  pdfFile: PdfFileRef;
  header: ImportHeader;
  taxes: { customsTax: number; additionalCustomsTax: number; kkdf: number; vat: number; stampTax: number };
  expenses: ImportExpenseDraft[];
  serviceInvoices: ImportServiceInvoiceDraft[];
  products: ImportProductDraft[];
  documents: ImportDocumentDraft[];
}

interface CombineParts {
  pdfFile: PdfFileRef;
  groups: Record<PageType, number[]>;
  customs: CustomsDeclarationData | null;
  expenseResult: ExpenseReceiptResult | null;
  expensePageMap: number[];
  productResult: { products: any[]; invoiceMetadata?: { invoice_no?: string; invoice_date?: string; shipper?: string } } | null;
}

const DOC_TYPE_BY_PAGE_GROUP: Array<{ group: PageType; importDocumentType: string }> = [
  { group: "customs_declaration", importDocumentType: "import_declaration" },
  { group: "commercial_invoice", importDocumentType: "invoice" },
  { group: "packing_list", importDocumentType: "packing_list" },
  { group: "awb", importDocumentType: "awb" },
];

export function combineExtractionResults(parts: CombineParts): AnalyzeDocumentResult {
  const { pdfFile, groups, customs, expenseResult, expensePageMap, productResult } = parts;

  const products: ImportProductDraft[] = (productResult?.products ?? []).map((p: any) => ({
    style: p.style ?? "",
    unit_count: Number(p.unit_count) || 0,
    cost: Number(p.cost) || 0,
    total_value: Number(p.total_value) || 0,
    tr_hs_code: (p.tr_hs_code || p.hts_code || "") as string,
    hts_code: (p.hts_code || "") as string,
  }));

  const productTotal = products.reduce((s, p) => s + (p.total_value || 0), 0);

  const header: ImportHeader = {
    shipper: customs?.shipper || productResult?.invoiceMetadata?.shipper || "",
    package: customs?.package ?? 0,
    kg: customs?.weight ?? 0,
    piece: customs?.pieces ?? 0,
    awbNumber: customs?.awbNumber || "",
    customs: customs?.customs || "",
    importDeclarationNumber: customs?.importDeclarationNumber || "",
    importDeclarationDate: customs?.importDeclarationDate || "",
    usdTlRate: customs?.usdTlRate ?? 0,
    invoice_no: productResult?.invoiceMetadata?.invoice_no || "",
    invoice_date: productResult?.invoiceMetadata?.invoice_date || "",
    amount: productTotal,
    currency: "USD",
  };

  const taxes = expenseResult?.taxes ?? {
    customsTax: 0, additionalCustomsTax: 0, kkdf: 0, vat: 0, stampTax: 0,
  };

  const expenses: ImportExpenseDraft[] = [];
  const serviceInvoices: ImportServiceInvoiceDraft[] = [];
  for (const item of expenseResult?.items ?? []) {
    const originalPage = item.pageNumber != null ? remapPageNumber(item.pageNumber, expensePageMap) : null;
    if (item.type === "service_invoice") {
      serviceInvoices.push({
        amount: item.amount,
        currency: item.currency,
        invoiceNumber: item.invoiceNumber,
        date: item.invoiceDate,
        notes: item.description,
        originalPage,
      });
    } else if (item.type === "expense") {
      expenses.push({
        category: item.suggestedCategory,
        amount: item.amount,
        currency: item.currency,
        invoiceNumber: item.invoiceNumber,
        invoiceDate: item.invoiceDate,
        issuer: item.issuer,
        documentNumber: item.receiptNumber,
        originalPage,
      });
    }
    // 'tax' items are summarized in `taxes`, not added as line records.
  }

  const documents: ImportDocumentDraft[] = [];
  for (const { group, importDocumentType } of DOC_TYPE_BY_PAGE_GROUP) {
    const pages = groups[group] ?? [];
    if (pages.length > 0) documents.push({ importDocumentType, originalPages: pages });
  }

  return { pdfFile, header, taxes, expenses, serviceInvoices, products, documents };
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Run: `npx vitest run server/procedure-document-import.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: `analyzeProcedureDocument`'i ekle (paralel okuma + bölme)**

Aynı dosyanın sonuna ekle:
```ts
export async function analyzeProcedureDocument(
  buffer: Buffer,
  originalname: string,
): Promise<AnalyzeDocumentResult> {
  // 1) store the original PDF once
  const sanitized = (originalname || "procedure-document.pdf").replace(/[^a-zA-Z0-9.-]/g, "_");
  const objectKey = await uploadFile(buffer, sanitized, "application/pdf", "procedure-imports");

  // 2) classify pages (Haiku)
  const classifications = await classifyPdfPages(buffer);
  const groups = groupPagesByType(classifications);
  const pageCount = classifications.length;

  // 3) split per type
  const customsSplit = await splitPdfByPages(buffer, groups.customs_declaration);
  const expenseSplit = await splitPdfByPages(buffer, groups.expense_tax_service);
  const invoiceSplit = await splitPdfByPages(buffer, groups.commercial_invoice);

  // 4) route to readers in PARALLEL (any one failing must not kill the others)
  const [customs, expenseResult, productResult] = await Promise.all([
    customsSplit.pageMap.length
      ? extractCustomsDeclaration(customsSplit.buffer).catch((e) => {
          console.error("[analyze-document] customs extraction failed:", e);
          return null;
        })
      : Promise.resolve(null),
    expenseSplit.pageMap.length
      ? extractExpenseReceipt(expenseSplit.buffer).catch((e) => {
          console.error("[analyze-document] expense extraction failed:", e);
          return null;
        })
      : Promise.resolve(null),
    invoiceSplit.pageMap.length
      ? extractFromPdf(invoiceSplit.buffer).catch((e) => {
          console.error("[analyze-document] product extraction failed:", e);
          return null;
        })
      : Promise.resolve(null),
  ]);

  return combineExtractionResults({
    pdfFile: {
      objectKey,
      originalFilename: originalname || "procedure-document.pdf",
      fileSize: buffer.length,
      fileType: "application/pdf",
      pageCount,
    },
    groups,
    customs,
    expenseResult,
    expensePageMap: expenseSplit.pageMap,
    productResult,
  });
}
```

> `extractFromPdf`'in dönüş tipi `server/document-extraction.ts`'te `{ products: ExtractedProduct[]; invoiceMetadata?: ... }` şeklindedir; `combineExtractionResults` `any[]` kabul eder, uyum sorunu yoktur. Eğer `extractFromPdf` named export değilse, `document-extraction.ts`'teki export'a göre import'u düzelt.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run check`
Expected: hata yok.
```bash
git add server/procedure-document-import.ts server/procedure-document-import.test.ts
git commit -m "feat(import): add analyze orchestrator (classify+route+combine)"
```

---

### Task 6: `POST /api/procedures/analyze-document` endpoint

**Files:**
- Modify: `server/routes.ts`

**Interfaces:**
- Consumes: `analyzeProcedureDocument` (Task 5).
- Produces: `POST /api/procedures/analyze-document` (multipart `pdf`) → `{ success: true, result: AnalyzeDocumentResult }`.

- [ ] **Step 1: Import ekle**

`server/routes.ts` üst import bloğuna:
```ts
import { analyzeProcedureDocument, createProcedureFromDocument } from "./procedure-document-import";
```
(`createProcedureFromDocument` Task 7'de eklenecek; import'u şimdi yazıp Task 7'de fonksiyonu eklemek tsc hatası verir — bu yüzden bu adımda SADECE `analyzeProcedureDocument`'i import et, Task 8'de `createProcedureFromDocument`'i import satırına ekle.)

Bu adımda:
```ts
import { analyzeProcedureDocument } from "./procedure-document-import";
```

- [ ] **Step 2: Endpoint'i ekle**

`/api/procedures/analyze-customs-declaration` endpoint'inin hemen ardına ekle:
```ts
app.post("/api/procedures/analyze-document", requireClaudeAuth, pdfUpload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "PDF file is required" });
    }
    if (req.file.size > 20 * 1024 * 1024) {
      return res.status(400).json({ error: "PDF file exceeds 20MB limit" });
    }
    const result = await analyzeProcedureDocument(req.file.buffer, req.file.originalname || "procedure-document.pdf");
    res.json({ success: true, result });
  } catch (error) {
    console.error("[Procedure Document Analyze] error:", error);
    res.status(500).json({
      error: "Failed to analyze procedure document",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: hata yok.

- [ ] **Step 4: Manuel duman testi**

Sunucu çalışırken (giriş yapılmış oturum/Bearer ile), örnek bir birleşik PDF ile:
```bash
curl -s -X POST http://localhost:5000/api/procedures/analyze-document \
  -H "Authorization: Bearer <TOKEN>" \
  -F "pdf=@/path/to/combined.pdf" | head -c 1200
```
Expected: `{"success":true,"result":{...header...taxes...expenses...products...documents...}}`. (Token: giriş sonrası tarayıcı devtools'tan veya mevcut oturum cookie'siyle de denenebilir.)

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat(import): add POST /api/procedures/analyze-document"
```

---

### Task 7: Atomik kayıt mantığı (`createProcedureFromDocument` + `buildCreateInserts`)

**Files:**
- Modify: `server/procedure-document-import.ts`
- Test: `server/procedure-document-import.test.ts`

**Interfaces:**
- Consumes: `db` (`./db`), tablolar (`@shared/schema`), `getFile`/`uploadFile` (`./object-storage`), `splitPdfByPages` (`./document-router`), `storage` (`./storage`).
- Produces:
  - `interface CreateFromDocumentInput { reference: string; header: ImportHeader; taxes: AnalyzeDocumentResult["taxes"] | null; expenses: ImportExpenseDraft[]; serviceInvoices: ImportServiceInvoiceDraft[]; products: ImportProductDraft[]; documents: ImportDocumentDraft[]; pdfObjectKey: string; pdfOriginalFilename: string; userId?: number }`
  - `buildCreateInserts(input: CreateFromDocumentInput, userId: number): { procedureValues: any; taxValues: any | null; expenseValues: any[]; serviceInvoiceValues: any[]; productItems: any[] }` — SAF; `tax_calculation_id` HARİÇ ürün item alanlarını üretir.
  - `createProcedureFromDocument(input: CreateFromDocumentInput): Promise<{ reference: string; attachments: { ok: number; failed: number } }>`

- [ ] **Step 1: Failing test (saf `buildCreateInserts`)**

`server/procedure-document-import.test.ts` sonuna ekle:
```ts
import { buildCreateInserts, type CreateFromDocumentInput } from "./procedure-document-import";

const baseInput: CreateFromDocumentInput = {
  reference: "TR00099",
  header: {
    shipper: "ACME", package: 3, kg: 120.5, piece: 40, awbNumber: "12345",
    customs: "IST", importDeclarationNumber: "IM1", importDeclarationDate: "2026-01-02",
    usdTlRate: 42.3, invoice_no: "INV-9", invoice_date: "2026-01-01", amount: 1221, currency: "USD",
  },
  taxes: { customsTax: 15000, additionalCustomsTax: 0, kkdf: 0, vat: 8000, stampTax: 0 },
  expenses: [
    { category: "transportation", amount: 2500, currency: "TRY", invoiceNumber: "A1", invoiceDate: "2026-01-03", issuer: "Tasiyici", documentNumber: "R1", originalPage: 3 },
  ],
  serviceInvoices: [
    { amount: 1000, currency: "TRY", invoiceNumber: "S1", date: "2026-01-04", notes: "Komisyon", originalPage: 2 },
  ],
  products: [
    { style: "A0054U", unit_count: 300, cost: 4.07, total_value: 1221, tr_hs_code: "6117808000", hts_code: "6117808000" },
  ],
  documents: [{ importDocumentType: "import_declaration", originalPages: [1] }],
  pdfObjectKey: "k",
  pdfOriginalFilename: "f.pdf",
};

describe("buildCreateInserts", () => {
  it("maps header to procedure values with reference and createdBy", () => {
    const r = buildCreateInserts(baseInput, 3);
    expect(r.procedureValues.reference).toBe("TR00099");
    expect(r.procedureValues.shipper).toBe("ACME");
    expect(r.procedureValues.kg).toBe("120.5");
    expect(r.procedureValues.piece).toBe(40);
    expect(r.procedureValues.usdtl_rate).toBe("42.3");
    expect(r.procedureValues.import_dec_number).toBe("IM1");
    expect(r.procedureValues.createdBy).toBe(3);
  });

  it("includes tax values only when a non-zero tax exists", () => {
    expect(buildCreateInserts(baseInput, 3).taxValues).not.toBeNull();
    const zeroTax = { ...baseInput, taxes: { customsTax: 0, additionalCustomsTax: 0, kkdf: 0, vat: 0, stampTax: 0 } };
    expect(buildCreateInserts(zeroTax, 3).taxValues).toBeNull();
    expect(buildCreateInserts({ ...baseInput, taxes: null }, 3).taxValues).toBeNull();
  });

  it("maps expenses and service invoices as insert rows", () => {
    const r = buildCreateInserts(baseInput, 3);
    expect(r.expenseValues[0]).toMatchObject({ procedureReference: "TR00099", category: "transportation", amount: "2500", currency: "TRY", documentNumber: "R1", createdBy: 3 });
    expect(r.serviceInvoiceValues[0]).toMatchObject({ procedureReference: "TR00099", amount: "1000", invoiceNumber: "S1", date: "2026-01-04", createdBy: 3 });
  });

  it("maps products to tax_calculation_items WITHOUT tax_calculation_id, line_number 1-based", () => {
    const r = buildCreateInserts(baseInput, 3);
    expect(r.productItems[0]).toMatchObject({ line_number: 1, style: "A0054U", unit_count: 300, cost: "4.07", total_value: "1221", tr_hs_code: "6117808000" });
    expect(r.productItems[0].tax_calculation_id).toBeUndefined();
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npx vitest run server/procedure-document-import.test.ts`
Expected: FAIL — `buildCreateInserts` is not a function.

- [ ] **Step 3: `buildCreateInserts`'i ekle**

`procedure-document-import.ts` sonuna ekle (önce import'ları genişlet):
```ts
import { db } from "./db";
import { getFile } from "./object-storage";
import { storage } from "./storage";
import {
  procedures,
  taxes as taxesTable,
  importExpenses,
  importServiceInvoices,
  taxCalculations,
  taxCalculationItems,
} from "@shared/schema";

export interface CreateFromDocumentInput {
  reference: string;
  header: ImportHeader;
  taxes: AnalyzeDocumentResult["taxes"] | null;
  expenses: ImportExpenseDraft[];
  serviceInvoices: ImportServiceInvoiceDraft[];
  products: ImportProductDraft[];
  documents: ImportDocumentDraft[];
  pdfObjectKey: string;
  pdfOriginalFilename: string;
  userId?: number;
}

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export function buildCreateInserts(input: CreateFromDocumentInput, userId: number) {
  const ref = input.reference;
  const h = input.header;

  const procedureValues = {
    reference: ref,
    shipper: h.shipper || null,
    invoice_no: h.invoice_no || null,
    invoice_date: h.invoice_date || null,
    amount: s(h.amount || 0),
    currency: h.currency || "USD",
    package: h.package ? String(h.package) : null,
    kg: h.kg ? String(h.kg) : null,
    piece: h.piece || null,
    awb_number: h.awbNumber || null,
    customs: h.customs || null,
    import_dec_number: h.importDeclarationNumber || null,
    import_dec_date: h.importDeclarationDate || null,
    usdtl_rate: h.usdTlRate ? String(h.usdTlRate) : null,
    createdBy: userId,
  };

  let taxValues: any = null;
  if (input.taxes) {
    const t = input.taxes;
    const anyTax = t.customsTax || t.additionalCustomsTax || t.kkdf || t.vat || t.stampTax;
    if (anyTax) {
      taxValues = {
        procedureReference: ref,
        customsTax: s(t.customsTax || 0),
        additionalCustomsTax: s(t.additionalCustomsTax || 0),
        kkdf: s(t.kkdf || 0),
        vat: s(t.vat || 0),
        stampTax: s(t.stampTax || 0),
        createdBy: userId,
      };
    }
  }

  const expenseValues = input.expenses.map((e) => ({
    procedureReference: ref,
    category: e.category,
    amount: s(e.amount || 0),
    currency: e.currency || "TRY",
    invoiceNumber: e.invoiceNumber || null,
    invoiceDate: e.invoiceDate || null,
    documentNumber: e.documentNumber || null,
    policyNumber: null,
    issuer: e.issuer || null,
    notes: null,
    createdBy: userId,
  }));

  const serviceInvoiceValues = input.serviceInvoices.map((si) => ({
    procedureReference: ref,
    amount: s(si.amount || 0),
    currency: si.currency || "TRY",
    invoiceNumber: si.invoiceNumber,
    date: si.date,
    notes: si.notes || null,
    createdBy: userId,
  }));

  const productItems = input.products.map((p, i) => ({
    line_number: i + 1,
    style: p.style,
    cost: s(p.cost || 0),
    unit_count: p.unit_count || 0,
    total_value: s(p.total_value || 0),
    tr_hs_code: p.tr_hs_code || null,
    hts_code: p.hts_code || null,
  }));

  return { procedureValues, taxValues, expenseValues, serviceInvoiceValues, productItems };
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Run: `npx vitest run server/procedure-document-import.test.ts`
Expected: PASS.

- [ ] **Step 5: `createProcedureFromDocument`'i ekle (transaction + iliştirme)**

`procedure-document-import.ts` sonuna ekle:
```ts
async function attachPages(opts: {
  pdfBuffer: Buffer;
  originalPages: number[];
  procedureReference: string;
  expenseType: "import_expense" | "service_invoice" | "import_document";
  expenseId: number;
  importDocumentType?: string;
  filenameHint: string;
  userId: number;
}): Promise<boolean> {
  try {
    const { buffer } = await splitPdfByPages(opts.pdfBuffer, opts.originalPages);
    const objectKey = await uploadFile(buffer, opts.filenameHint, "application/pdf", opts.procedureReference);
    const doc: any = {
      procedureReference: opts.procedureReference,
      expenseType: opts.expenseType,
      expenseId: opts.expenseId,
      originalFilename: opts.filenameHint,
      objectKey,
      fileSize: buffer.length,
      fileType: "application/pdf",
      uploadedBy: opts.userId,
    };
    if (opts.importDocumentType) doc.importDocumentType = opts.importDocumentType;
    await storage.uploadExpenseDocument(doc);
    return true;
  } catch (e) {
    console.error("[create-from-document] attach failed:", e);
    return false;
  }
}

export async function createProcedureFromDocument(
  input: CreateFromDocumentInput,
): Promise<{ reference: string; attachments: { ok: number; failed: number } }> {
  const userId = input.userId || 3;
  const inserts = buildCreateInserts(input, userId);

  // Pre-reset sequences to avoid PK collisions (best effort, matches existing handlers).
  for (const seq of ["procedures_id_seq", "taxes_id_seq"]) {
    try {
      await db.execute(
        `SELECT setval('${seq}', (SELECT COALESCE(MAX(id),0) FROM ${seq.replace("_id_seq", "")}) + 1, false)`,
      );
    } catch { /* ignore */ }
  }

  // 1) Atomic DB write
  const created = await db.transaction(async (tx) => {
    const [procedure] = await tx.insert(procedures).values(inserts.procedureValues).returning();

    if (inserts.taxValues) {
      await tx.insert(taxesTable).values(inserts.taxValues);
    }
    if (inserts.expenseValues.length) {
      await tx.insert(importExpenses).values(inserts.expenseValues);
    }
    if (inserts.serviceInvoiceValues.length) {
      await tx.insert(importServiceInvoices).values(inserts.serviceInvoiceValues);
    }
    if (inserts.productItems.length) {
      const [calc] = await tx
        .insert(taxCalculations)
        .values({
          reference: input.reference,
          procedure_id: procedure.id,
          invoice_no: input.header.invoice_no || null,
          total_value: String(input.header.amount || 0),
          total_quantity: input.products.reduce((sum, p) => sum + (p.unit_count || 0), 0),
          currency_rate: input.header.usdTlRate ? String(input.header.usdTlRate) : "0",
          status: "draft",
        })
        .returning();
      await tx
        .insert(taxCalculationItems)
        .values(inserts.productItems.map((it) => ({ ...it, tax_calculation_id: calc.id })));
    }
    return procedure;
  });

  // 2) Best-effort document attachment (NOT part of the transaction)
  let ok = 0;
  let failed = 0;
  try {
    const { buffer: pdfBuffer } = await getFile(input.pdfObjectKey);

    // Re-read saved expense / service-invoice rows to get their ids for attachment.
    const savedExpenses = await db
      .select()
      .from(importExpenses)
      .where(eqRef(importExpenses, input.reference));
    const savedServiceInvoices = await db
      .select()
      .from(importServiceInvoices)
      .where(eqRef(importServiceInvoices, input.reference));

    // Attach each expense's source page (match by order — inserts preserve order).
    for (let i = 0; i < input.expenses.length; i++) {
      const exp = input.expenses[i];
      const row = savedExpenses[i];
      if (exp.originalPage && row) {
        (await attachPages({
          pdfBuffer, originalPages: [exp.originalPage], procedureReference: input.reference,
          expenseType: "import_expense", expenseId: row.id,
          filenameHint: `expense-${exp.category}-p${exp.originalPage}.pdf`, userId,
        })) ? ok++ : failed++;
      }
    }
    for (let i = 0; i < input.serviceInvoices.length; i++) {
      const si = input.serviceInvoices[i];
      const row = savedServiceInvoices[i];
      if (si.originalPage && row) {
        (await attachPages({
          pdfBuffer, originalPages: [si.originalPage], procedureReference: input.reference,
          expenseType: "service_invoice", expenseId: row.id,
          filenameHint: `service-invoice-${si.invoiceNumber}-p${si.originalPage}.pdf`, userId,
        })) ? ok++ : failed++;
      }
    }
    // Attach classified documents to "Import Documents".
    for (const doc of input.documents) {
      (await attachPages({
        pdfBuffer, originalPages: doc.originalPages, procedureReference: input.reference,
        expenseType: "import_document", expenseId: created.id, importDocumentType: doc.importDocumentType,
        filenameHint: `${doc.importDocumentType}.pdf`, userId,
      })) ? ok++ : failed++;
    }
  } catch (e) {
    console.error("[create-from-document] attachment phase error:", e);
  }

  return { reference: input.reference, attachments: { ok, failed } };
}
```

Dosyanın import bloğuna `eq` ekle ve `eqRef` yardımcı fonksiyonunu tanımla. En üstteki import'lara:
```ts
import { eq } from "drizzle-orm";
```
ve dosyada (fonksiyonların dışında) bir yardımcı:
```ts
// helper: build a procedureReference equality on a table that has that column
function eqRef(table: { procedureReference: any }, ref: string) {
  return eq(table.procedureReference, ref);
}
```

> NOT: İliştirmede masraf/hizmet faturası kayıtları, EKLENME SIRASIYLA eşleştirilir (Drizzle bulk insert sırayı korur; `savedExpenses[i]` ↔ `input.expenses[i]`). Bu, `originalPage` doğru kayda gitsin diye yeterlidir.

- [ ] **Step 6: Typecheck**

Run: `npm run check`
Expected: hata yok. (Hata çıkarsa: `eqRef`'in tip imzasını `any` ile gevşet; ya da doğrudan `eq(importExpenses.procedureReference, input.reference)` kullan.)

- [ ] **Step 7: Birim testleri tekrar çalıştır + commit**

Run: `npx vitest run`
Expected: tüm testler PASS.
```bash
git add server/procedure-document-import.ts server/procedure-document-import.test.ts
git commit -m "feat(import): add atomic createProcedureFromDocument + attachments"
```

---

### Task 8: `POST /api/procedures/create-from-document` endpoint

**Files:**
- Modify: `server/routes.ts`

**Interfaces:**
- Consumes: `createProcedureFromDocument` (Task 7).
- Produces: `POST /api/procedures/create-from-document` (JSON body = `CreateFromDocumentInput` + opsiyonel `user`) → `{ success: true, reference, attachments }`.

- [ ] **Step 1: Import satırını genişlet**

Task 6'da eklenen import'u şu hale getir:
```ts
import { analyzeProcedureDocument, createProcedureFromDocument } from "./procedure-document-import";
```

- [ ] **Step 2: Endpoint'i ekle**

`/api/procedures/analyze-document`'in ardına ekle:
```ts
app.post("/api/procedures/create-from-document", requireClaudeAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.reference || typeof body.reference !== "string" || !body.reference.trim()) {
      return res.status(400).json({ error: "reference is required" });
    }
    if (!body.pdfObjectKey) {
      return res.status(400).json({ error: "pdfObjectKey is required" });
    }
    const userId = body.user?.id || 3;

    const result = await createProcedureFromDocument({
      reference: body.reference.trim(),
      header: body.header,
      taxes: body.taxes ?? null,
      expenses: Array.isArray(body.expenses) ? body.expenses : [],
      serviceInvoices: Array.isArray(body.serviceInvoices) ? body.serviceInvoices : [],
      products: Array.isArray(body.products) ? body.products : [],
      documents: Array.isArray(body.documents) ? body.documents : [],
      pdfObjectKey: body.pdfObjectKey,
      pdfOriginalFilename: body.pdfOriginalFilename || "procedure-document.pdf",
      userId,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isDup = msg.includes("duplicate key") || msg.includes("unique constraint");
    res.status(isDup ? 409 : 500).json({
      error: isDup ? "A procedure with this reference already exists" : "Failed to create procedure from document",
      details: msg,
    });
  }
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: hata yok.

- [ ] **Step 4: Manuel uçtan uca testi**

Task 6'daki analyze çıktısını (header/taxes/expenses/serviceInvoices/products/documents/pdfFile.objectKey) al, bir `reference` ekle ve gönder:
```bash
curl -s -X POST http://localhost:5000/api/procedures/create-from-document \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"reference":"TEST-IMPORT-1","pdfObjectKey":"<objectKey>","header":{...},"taxes":{...},"expenses":[...],"serviceInvoices":[...],"products":[...],"documents":[...]}'
```
Expected: `{"success":true,"reference":"TEST-IMPORT-1","attachments":{"ok":N,"failed":0}}`.
Doğrula: `/api/procedures` listesinde görünüyor; `/api/taxes/procedure/TEST-IMPORT-1`, `/api/import-expenses/procedure/TEST-IMPORT-1`, `/api/service-invoices/procedure/TEST-IMPORT-1`, `/api/procedures/TEST-IMPORT-1/products` dolu; prosedür detayında belgeler iliştirilmiş.
Temizlik: test prosedürünü sil (cascade alt kayıtları siler).

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat(import): add POST /api/procedures/create-from-document"
```

---

## PHASE 2 — Frontend

### Task 9: Create Procedure'e PDF dropzone + analiz bağlantısı

**Files:**
- Modify: `client/src/pages/add-procedure.tsx`

**Interfaces:**
- Consumes: `POST /api/procedures/analyze-document`.
- Produces: sayfada `analyzeResult` state'i (`AnalyzeDocumentResult` şeklinde) ve başlık form alanlarının otomatik doldurulması.

- [ ] **Step 1: PDF yükleme bileşenini ve state'i ekle**

`add-procedure.tsx` üstüne import:
```tsx
import { PdfUploadDropzone } from "@/components/ui/pdf-upload-dropzone";
import { DocumentImportReview, type AnalyzeDocumentResult } from "@/components/procedure-import/DocumentImportReview";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
```
Bileşen içinde state:
```tsx
const { toast } = useToast();
const [isAnalyzing, setIsAnalyzing] = useState(false);
const [analyzeResult, setAnalyzeResult] = useState<AnalyzeDocumentResult | null>(null);
```

- [ ] **Step 2: Yükleme handler'ı**

```tsx
const handleDocumentUpload = async (file: File) => {
  setIsAnalyzing(true);
  try {
    const formData = new FormData();
    formData.append("pdf", file);
    const res = await apiRequest("POST", "/api/procedures/analyze-document", formData);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.details || err.error || "Analyze failed");
    }
    const { result } = await res.json();
    setAnalyzeResult(result as AnalyzeDocumentResult);

    // Prefill the header form fields (react-hook-form `form` instance in this page).
    const h = result.header;
    form.setValue("shipper", h.shipper || "");
    form.setValue("invoice_no", h.invoice_no || "");
    form.setValue("invoice_date", h.invoice_date || "");
    form.setValue("amount", h.amount ? String(h.amount) : "");
    form.setValue("currency", h.currency || "USD");
    form.setValue("piece", h.piece ? String(h.piece) : "");
    form.setValue("package", h.package ? String(h.package) : "");
    form.setValue("kg", h.kg ? String(h.kg) : "");
    form.setValue("awb_number", h.awbNumber || "");
    form.setValue("customs", h.customs || "");
    form.setValue("import_dec_number", h.importDeclarationNumber || "");
    form.setValue("import_dec_date", h.importDeclarationDate || "");
    form.setValue("usdtl_rate", h.usdTlRate ? String(h.usdTlRate) : "");

    toast({ title: t("procedureImport.toastAnalyzedTitle"), description: t("procedureImport.toastAnalyzedDesc") });
  } catch (e: any) {
    toast({ title: t("procedureImport.toastAnalyzeFailedTitle"), description: e.message, variant: "destructive" });
  } finally {
    setIsAnalyzing(false);
  }
};
```

> NOT: `form` ve `t` bu sayfada zaten tanımlı (mevcut react-hook-form formu ve `useTranslation`). Alan adlarını mevcut `procedureFormSchema`'ya göre doğrula (`client/src/pages/add-procedure.tsx:82-103`); herhangi bir alan adı farklıysa ona göre eşle.

- [ ] **Step 3: Dropzone'u formun üstüne yerleştir**

Sayfa JSX'inde, mevcut form kartının hemen üstüne ekle:
```tsx
<Card className="mb-4">
  <CardHeader>
    <CardTitle>{t("procedureImport.uploadTitle")}</CardTitle>
    <CardDescription>{t("procedureImport.uploadDescription")}</CardDescription>
  </CardHeader>
  <CardContent>
    <PdfUploadDropzone onFileSelect={handleDocumentUpload} isLoading={isAnalyzing} />
  </CardContent>
</Card>
```

> `PdfUploadDropzone`'un prop arayüzünü `client/src/components/ui/pdf-upload-dropzone.tsx`'ten doğrula (prop adı `onFileSelect`/`onUpload` ve `isLoading`/`isAnalyzing` farklı olabilir); doğru prop adlarını kullan.

- [ ] **Step 4: Typecheck + manuel**

Run: `npm run check`
Manuel: sayfada PDF yükle → başlık alanları dolmalı, hata yoksa devam.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/add-procedure.tsx
git commit -m "feat(import): add document upload + header autofill to add-procedure"
```

---

### Task 10: Önizleme/inceleme bileşeni + "Oluştur" akışı

**Files:**
- Create: `client/src/components/procedure-import/DocumentImportReview.tsx`
- Modify: `client/src/pages/add-procedure.tsx`

**Interfaces:**
- Consumes: `POST /api/procedures/create-from-document`; `analyzeResult` ve formdaki `reference`.
- Produces: `DocumentImportReview` bileşeni — vergiler/masraflar/hizmet faturaları/ürünleri düzenlenebilir gösterir; "Oluştur" çağrısını yapar; `onCreated(reference)` callback'i tetikler.
  - Export edilen tip: `AnalyzeDocumentResult` (backend `AnalyzeDocumentResult` ile aynı şekil — frontend kopyası).

- [ ] **Step 1: Bileşeni oluştur**

`client/src/components/procedure-import/DocumentImportReview.tsx`:
```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface AnalyzeDocumentResult {
  pdfFile: { objectKey: string; originalFilename: string; fileSize: number; fileType: string; pageCount: number };
  header: {
    shipper: string; package: number; kg: number; piece: number; awbNumber: string;
    customs: string; importDeclarationNumber: string; importDeclarationDate: string;
    usdTlRate: number; invoice_no: string; invoice_date: string; amount: number; currency: string;
  };
  taxes: { customsTax: number; additionalCustomsTax: number; kkdf: number; vat: number; stampTax: number };
  expenses: Array<{ category: string; amount: number; currency: string; invoiceNumber: string; invoiceDate: string; issuer: string; documentNumber: string; originalPage: number | null }>;
  serviceInvoices: Array<{ amount: number; currency: string; invoiceNumber: string; date: string; notes: string; originalPage: number | null }>;
  products: Array<{ style: string; unit_count: number; cost: number; total_value: number; tr_hs_code: string; hts_code: string }>;
  documents: Array<{ importDocumentType: string; originalPages: number[] }>;
}

interface Props {
  result: AnalyzeDocumentResult;
  getReference: () => string;        // reads the reference field from the page form
  getHeader: () => AnalyzeDocumentResult["header"]; // reads (possibly edited) header from the form
  onCreated: (reference: string) => void;
}

export function DocumentImportReview({ result, getReference, getHeader, onCreated }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [taxes, setTaxes] = useState(result.taxes);
  const [expenses, setExpenses] = useState(result.expenses);
  const [serviceInvoices, setServiceInvoices] = useState(result.serviceInvoices);
  const [products, setProducts] = useState(result.products);
  const [isSaving, setIsSaving] = useState(false);

  const num = (v: string) => (v === "" ? 0 : parseFloat(v) || 0);

  const handleCreate = async () => {
    const reference = getReference().trim();
    if (!reference) {
      toast({ title: t("procedureImport.referenceRequiredTitle"), description: t("procedureImport.referenceRequiredDesc"), variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        reference,
        header: getHeader(),
        taxes,
        expenses,
        serviceInvoices,
        products,
        documents: result.documents,
        pdfObjectKey: result.pdfFile.objectKey,
        pdfOriginalFilename: result.pdfFile.originalFilename,
      };
      const res = await apiRequest("POST", "/api/procedures/create-from-document", payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || "Create failed");
      }
      const data = await res.json();
      toast({ title: t("procedureImport.createdTitle"), description: t("procedureImport.createdDesc", { ok: data.attachments?.ok ?? 0, failed: data.attachments?.failed ?? 0 }) });
      onCreated(reference);
    } catch (e: any) {
      toast({ title: t("procedureImport.createFailedTitle"), description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Taxes */}
      <Card>
        <CardHeader><CardTitle>{t("procedureImport.taxesTitle")}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(["customsTax","additionalCustomsTax","kkdf","vat","stampTax"] as const).map((k) => (
            <div key={k}>
              <label className="text-sm">{t(`procedureImport.tax.${k}`)}</label>
              <Input type="number" value={String(taxes[k] ?? 0)} onChange={(e) => setTaxes({ ...taxes, [k]: num(e.target.value) })} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Import expenses */}
      <Card>
        <CardHeader><CardTitle>{t("procedureImport.expensesTitle")}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("procedureImport.col.category")}</TableHead>
              <TableHead>{t("procedureImport.col.amount")}</TableHead>
              <TableHead>{t("procedureImport.col.currency")}</TableHead>
              <TableHead>{t("procedureImport.col.invoiceNumber")}</TableHead>
              <TableHead>{t("procedureImport.col.page")}</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {expenses.map((e, i) => (
                <TableRow key={i}>
                  <TableCell>{t(`procedureImport.category.${e.category}`, e.category)}</TableCell>
                  <TableCell><Input type="number" value={String(e.amount)} onChange={(ev) => { const c=[...expenses]; c[i]={...e, amount:num(ev.target.value)}; setExpenses(c); }} /></TableCell>
                  <TableCell>{e.currency}</TableCell>
                  <TableCell><Input value={e.invoiceNumber} onChange={(ev) => { const c=[...expenses]; c[i]={...e, invoiceNumber:ev.target.value}; setExpenses(c); }} /></TableCell>
                  <TableCell>{e.originalPage ?? "-"}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" onClick={() => setExpenses(expenses.filter((_, j) => j !== i))}>{t("procedureImport.remove")}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Service invoices */}
      <Card>
        <CardHeader><CardTitle>{t("procedureImport.serviceInvoicesTitle")}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("procedureImport.col.invoiceNumber")}</TableHead>
              <TableHead>{t("procedureImport.col.amount")}</TableHead>
              <TableHead>{t("procedureImport.col.currency")}</TableHead>
              <TableHead>{t("procedureImport.col.date")}</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {serviceInvoices.map((si, i) => (
                <TableRow key={i}>
                  <TableCell><Input value={si.invoiceNumber} onChange={(ev) => { const c=[...serviceInvoices]; c[i]={...si, invoiceNumber:ev.target.value}; setServiceInvoices(c); }} /></TableCell>
                  <TableCell><Input type="number" value={String(si.amount)} onChange={(ev) => { const c=[...serviceInvoices]; c[i]={...si, amount:num(ev.target.value)}; setServiceInvoices(c); }} /></TableCell>
                  <TableCell>{si.currency}</TableCell>
                  <TableCell><Input type="date" value={si.date} onChange={(ev) => { const c=[...serviceInvoices]; c[i]={...si, date:ev.target.value}; setServiceInvoices(c); }} /></TableCell>
                  <TableCell><Button variant="ghost" size="sm" onClick={() => setServiceInvoices(serviceInvoices.filter((_, j) => j !== i))}>{t("procedureImport.remove")}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Products */}
      <Card>
        <CardHeader><CardTitle>{t("procedureImport.productsTitle")}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("procedureImport.col.style")}</TableHead>
              <TableHead>{t("procedureImport.col.unit")}</TableHead>
              <TableHead>{t("procedureImport.col.cost")}</TableHead>
              <TableHead>{t("procedureImport.col.totalValue")}</TableHead>
              <TableHead>{t("procedureImport.col.trHsCode")}</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {products.map((p, i) => (
                <TableRow key={i}>
                  <TableCell><Input value={p.style} onChange={(ev) => { const c=[...products]; c[i]={...p, style:ev.target.value}; setProducts(c); }} /></TableCell>
                  <TableCell><Input type="number" value={String(p.unit_count)} onChange={(ev) => { const c=[...products]; c[i]={...p, unit_count:parseInt(ev.target.value)||0}; setProducts(c); }} /></TableCell>
                  <TableCell><Input type="number" value={String(p.cost)} onChange={(ev) => { const c=[...products]; c[i]={...p, cost:num(ev.target.value)}; setProducts(c); }} /></TableCell>
                  <TableCell><Input type="number" value={String(p.total_value)} onChange={(ev) => { const c=[...products]; c[i]={...p, total_value:num(ev.target.value)}; setProducts(c); }} /></TableCell>
                  <TableCell><Input value={p.tr_hs_code} onChange={(ev) => { const c=[...products]; c[i]={...p, tr_hs_code:ev.target.value}; setProducts(c); }} /></TableCell>
                  <TableCell><Button variant="ghost" size="sm" onClick={() => setProducts(products.filter((_, j) => j !== i))}>{t("procedureImport.remove")}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleCreate} disabled={isSaving}>
          {isSaving ? t("procedureImport.creating") : t("procedureImport.createButton")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `add-procedure.tsx`'e önizlemeyi bağla**

Analiz sonucu varsa, formun altına render et:
```tsx
{analyzeResult && (
  <DocumentImportReview
    result={analyzeResult}
    getReference={() => form.getValues("reference")}
    getHeader={() => ({
      shipper: form.getValues("shipper") || "",
      package: Number(form.getValues("package")) || 0,
      kg: Number(form.getValues("kg")) || 0,
      piece: Number(form.getValues("piece")) || 0,
      awbNumber: form.getValues("awb_number") || "",
      customs: form.getValues("customs") || "",
      importDeclarationNumber: form.getValues("import_dec_number") || "",
      importDeclarationDate: form.getValues("import_dec_date") || "",
      usdTlRate: Number(form.getValues("usdtl_rate")) || 0,
      invoice_no: form.getValues("invoice_no") || "",
      invoice_date: form.getValues("invoice_date") || "",
      amount: Number(form.getValues("amount")) || 0,
      currency: form.getValues("currency") || "USD",
    })}
    onCreated={(reference) => setLocation(`/procedures`)}
  />
)}
```

> `setLocation` bu sayfada zaten kullanılıyor (`add-procedure.tsx:192`). İstenirse `/procedures` yerine prosedür detayına yönlendir.

- [ ] **Step 3: Typecheck + manuel**

Run: `npm run check`
Manuel: PDF yükle → önizleme dolu gelir → reference gir → "Oluştur" → prosedür listede + detayda vergiler/masraflar/hizmet/ürünler + belgeler.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/procedure-import/DocumentImportReview.tsx client/src/pages/add-procedure.tsx
git commit -m "feat(import): add review UI + create-from-document flow"
```

---

### Task 11: i18n çevirileri (TR/EN)

**Files:**
- Modify: `client/src/locales/tr.json`, `client/src/locales/en.json`

**Interfaces:**
- Produces: `procedureImport.*` anahtarları her iki dilde.

- [ ] **Step 1: `tr.json`'a `procedureImport` bloğu ekle**

Üst seviye bir anahtar olarak (örn. `"nav"`'dan sonra) ekle:
```json
  "procedureImport": {
    "uploadTitle": "PDF yükle ve otomatik doldur",
    "uploadDescription": "Beyanname, fatura, masraf ve hizmet faturalarını içeren tek bir PDF yükleyin; sistem doldursun.",
    "toastAnalyzedTitle": "Belge okundu",
    "toastAnalyzedDesc": "Bilgiler aşağıda; kontrol edip 'Oluştur'a basın.",
    "toastAnalyzeFailedTitle": "Okuma başarısız",
    "referenceRequiredTitle": "Referans gerekli",
    "referenceRequiredDesc": "Lütfen önce bir referans numarası girin.",
    "createdTitle": "Prosedür oluşturuldu",
    "createdDesc": "{{ok}} belge iliştirildi, {{failed}} başarısız.",
    "createFailedTitle": "Oluşturma başarısız",
    "taxesTitle": "Vergiler",
    "expensesTitle": "İthalat Masrafları",
    "serviceInvoicesTitle": "Hizmet Faturaları",
    "productsTitle": "Ürünler",
    "remove": "Kaldır",
    "createButton": "Oluştur",
    "creating": "Oluşturuluyor...",
    "tax": { "customsTax": "Gümrük Vergisi", "additionalCustomsTax": "Ek Gümrük", "kkdf": "KKDF", "vat": "KDV", "stampTax": "Damga" },
    "col": { "category": "Kategori", "amount": "Tutar", "currency": "Para Birimi", "invoiceNumber": "Fatura No", "date": "Tarih", "page": "Sayfa", "style": "Model", "unit": "Adet", "cost": "Birim Fiyat", "totalValue": "Toplam", "trHsCode": "TR HS Kodu" }
  },
```

- [ ] **Step 2: `en.json`'a karşılığını ekle**

```json
  "procedureImport": {
    "uploadTitle": "Upload PDF & auto-fill",
    "uploadDescription": "Upload a single PDF containing the declaration, invoice, expenses and service invoices; the system fills everything in.",
    "toastAnalyzedTitle": "Document read",
    "toastAnalyzedDesc": "Details are below; review and click 'Create'.",
    "toastAnalyzeFailedTitle": "Read failed",
    "referenceRequiredTitle": "Reference required",
    "referenceRequiredDesc": "Please enter a reference number first.",
    "createdTitle": "Procedure created",
    "createdDesc": "{{ok}} documents attached, {{failed}} failed.",
    "createFailedTitle": "Create failed",
    "taxesTitle": "Taxes",
    "expensesTitle": "Import Expenses",
    "serviceInvoicesTitle": "Service Invoices",
    "productsTitle": "Products",
    "remove": "Remove",
    "createButton": "Create",
    "creating": "Creating...",
    "tax": { "customsTax": "Customs Tax", "additionalCustomsTax": "Add. Customs", "kkdf": "KKDF", "vat": "VAT", "stampTax": "Stamp" },
    "col": { "category": "Category", "amount": "Amount", "currency": "Currency", "invoiceNumber": "Invoice No", "date": "Date", "page": "Page", "style": "Style", "unit": "Unit", "cost": "Unit Price", "totalValue": "Total", "trHsCode": "TR HS Code" }
  },
```

- [ ] **Step 3: Typecheck + manuel dil kontrolü**

Run: `npm run check`
Manuel: Dil TR ve EN iken önizleme etiketleri doğru görünmeli; eksik anahtar (ham `procedureImport.x` metni) olmamalı.

- [ ] **Step 4: Commit**

```bash
git add client/src/locales/tr.json client/src/locales/en.json
git commit -m "feat(i18n): add procedureImport translations (TR/EN)"
```

---

### Task 12: Uçtan uca manuel doğrulama + temizlik

**Files:** yok (doğrulama).

- [ ] **Step 1: Tüm birim testleri**

Run: `npx vitest run`
Expected: hepsi PASS.

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: hata yok.

- [ ] **Step 3: Tam akış**

Sunucuyu başlat (`node --env-file=.env --import tsx server/index.ts`), giriş yap, **Create Procedure**'e git:
1. Birleşik bir test PDF'i yükle (repodaki örneklerden bir beyanname+fatura+masraf birleşimi; yoksa elde birkaç sayfayı tek PDF'te birleştir).
2. Başlık alanlarının dolduğunu, önizlemede vergi/masraf/hizmet/ürünlerin geldiğini gör.
3. Bir referans gir (örn. `TEST-E2E-1`), gerekli düzeltmeleri yap, "Oluştur"a bas.
4. `/procedures` listesinde göründüğünü; detayda vergiler, masraflar, hizmet faturaları, **Products** bölümü (TR HS dahil) ve **Import Documents** + masraf kayıtlarında iliştirilmiş sayfaların olduğunu doğrula.
5. Hesaplama yapılmadığını doğrula (ürün/vergi rakamları belgedeki ham değerler; cif/customs_tax gibi hesaplanan alanlar 0).

- [ ] **Step 4: Hata/uç durum kontrolü**
- Yanlış referans (mevcut bir referansla) → 409 "already exists" döner, yarım prosedür oluşmaz.
- Beyanname içermeyen PDF → başlık boş gelir, kullanıcı elle doldurabilir; akış kırılmaz.

- [ ] **Step 5: Test verisini temizle**

Oluşturulan test prosedürlerini sil (cascade alt kayıtları temizler).

- [ ] **Step 6: Final commit (gerekiyorsa)**

```bash
git add -A
git commit -m "test(import): e2e verification notes for pdf auto-fill" --allow-empty
```

---

## Self-Review (plan yazarı tarafından yapıldı)

**Spec kapsamı:** Spec'in her bölümü bir task'a bağlı —
- Başlık (beyanname+fatura) → Task 3,5,7,9 ✓
- Vergiler → Task 4,5,7 ✓
- İthalat masrafları → Task 4,5,7 ✓
- Hizmet faturaları → Task 4,5,7 ✓
- Ürünler (style/HS/adet/tutar, hesaplama yok) → Task 5,7 (taxCalculationItems ham insert) ✓
- Sınıflandır→yönlendir→topla → Task 1,2,5 ✓
- Önizle-sonra-kaydet → Task 9,10 ✓
- Atomik kayıt → Task 7 (db.transaction) ✓
- Belge iliştirme (kalem + Import Documents) → Task 7 (`attachPages`) ✓
- "Şu sayfayı tekrar tara" emniyet kemeri → mevcut `single-page` endpoint var; v1 önizlemesinde opsiyonel buton — **kapsama dahil edilmedi (YAGNI/v1.5)**; gerekirse Task 10'a eklenebilir. Spec'te emniyet kemeri olarak anılıyor, zorunlu değil.
- Proxy 60s → Task 5 paralel okuma ile azaltıldı; not edildi.

**Placeholder taraması:** Kod adımlarında gerçek kod var. İki yerde bilinçli "verbatim taşı" talimatı var (Task 3 & 4 promptları) — bunlar placeholder değil, mevcut kodun birebir taşınması; tam talimat verildi.

**Tip tutarlılığı:** `AnalyzeDocumentResult`, `CreateFromDocumentInput`, `ImportHeader` vb. tipler tasklar arası tutarlı; `combineExtractionResults` çıktısı `analyzeProcedureDocument` ve endpoint'te aynı şekilde kullanılıyor; frontend kopyası backend şekliyle birebir.
