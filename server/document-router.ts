import { PDFDocument } from "pdf-lib";
import { analyzePdfWithClaude } from "./claude";

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
  // c.type is a validated PageType (parseClassificationResponse coerces unknown values to "other"), so the membership guard is purely defensive.
  for (const c of classifications) {
    if (groups[c.type]) groups[c.type].push(c.page);
  }
  for (const t of PAGE_TYPES) groups[t].sort((a, b) => a - b);
  return groups;
}

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
