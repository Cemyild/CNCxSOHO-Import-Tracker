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
