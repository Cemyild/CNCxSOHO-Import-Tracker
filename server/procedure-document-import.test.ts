import { describe, it, expect } from "vitest";
import { combineExtractionResults, buildCreateInserts, type CreateFromDocumentInput } from "./procedure-document-import";

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

  it("uses customsTaxes when provided with non-zero values, ignoring expenseResult.taxes", () => {
    const out = combineExtractionResults({
      pdfFile,
      groups: { customs_declaration: [1], expense_tax_service: [2], commercial_invoice: [], packing_list: [], awb: [], other: [] },
      customs: null,
      expenseResult: {
        documentType: "expense_receipt",
        pageCount: 1,
        items: [],
        taxes: { customsTax: 99999, additionalCustomsTax: 0, kkdf: 0, vat: 0, stampTax: 0 },
      },
      expensePageMap: [2],
      productResult: null,
      customsTaxes: {
        declarationNumber: "2026-001",
        declarationDate: "2026-01-10",
        currency: "TRY",
        customsTax: 5000,
        additionalCustomsTax: 1200,
        kkdf: 800,
        vat: 9500,
        stampTax: 150,
      },
    });
    expect(out.taxes.customsTax).toBe(5000);
    expect(out.taxes.additionalCustomsTax).toBe(1200);
    expect(out.taxes.kkdf).toBe(800);
    expect(out.taxes.vat).toBe(9500);
    expect(out.taxes.stampTax).toBe(150);
  });

  it("falls back to expenseResult.taxes when customsTaxes is null", () => {
    const out = combineExtractionResults({
      pdfFile,
      groups: { customs_declaration: [1], expense_tax_service: [2], commercial_invoice: [], packing_list: [], awb: [], other: [] },
      customs: null,
      expenseResult: {
        documentType: "expense_receipt",
        pageCount: 1,
        items: [],
        taxes: { customsTax: 15000, additionalCustomsTax: 0, kkdf: 0, vat: 8000, stampTax: 0 },
      },
      expensePageMap: [2],
      productResult: null,
      customsTaxes: null,
    });
    expect(out.taxes.customsTax).toBe(15000);
    expect(out.taxes.vat).toBe(8000);
  });

  it("uses invoice currency from productResult.invoiceMetadata when present", () => {
    const out = combineExtractionResults({
      pdfFile,
      groups: { customs_declaration: [], expense_tax_service: [], commercial_invoice: [1], packing_list: [], awb: [], other: [] },
      customs: null,
      expenseResult: null,
      expensePageMap: [],
      productResult: {
        products: [],
        invoiceMetadata: { invoice_no: "INV-1", invoice_date: "2026-01-01", shipper: "X", currency: "EUR" },
      },
    });
    expect(out.header.currency).toBe("EUR");
  });

  it("falls back to USD when invoiceMetadata has no currency", () => {
    const out = combineExtractionResults({
      pdfFile,
      groups: { customs_declaration: [], expense_tax_service: [], commercial_invoice: [], packing_list: [], awb: [], other: [] },
      customs: null,
      expenseResult: null,
      expensePageMap: [],
      productResult: null,
    });
    expect(out.header.currency).toBe("USD");
  });
});

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
