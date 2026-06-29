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
