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
