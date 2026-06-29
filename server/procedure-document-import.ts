import {
  classifyPdfPages,
  groupPagesByType,
  splitPdfByPages,
  remapPageNumber,
  type PageType,
} from "./document-router";
import {
  extractCustomsDeclaration,
  type CustomsDeclarationData,
} from "./extractors/customs-declaration";
import {
  extractExpenseReceipt,
  type ExpenseReceiptResult,
} from "./extractors/expense-receipt";
import { extractFromPdf } from "./document-extraction";
import { uploadFile } from "./object-storage";

export interface ImportHeader {
  shipper: string;
  package: number;
  kg: number;
  piece: number;
  awbNumber: string;
  customs: string;
  importDeclarationNumber: string;
  importDeclarationDate: string;
  usdTlRate: number;
  invoice_no: string;
  invoice_date: string;
  amount: number;
  currency: string;
}

export interface ImportExpenseDraft {
  category: string;
  amount: number;
  currency: string;
  invoiceNumber: string;
  invoiceDate: string;
  issuer: string;
  documentNumber: string;
  originalPage: number | null;
}

export interface ImportServiceInvoiceDraft {
  amount: number;
  currency: string;
  invoiceNumber: string;
  date: string;
  notes: string;
  originalPage: number | null;
}

export interface ImportProductDraft {
  style: string;
  unit_count: number;
  cost: number;
  total_value: number;
  tr_hs_code: string;
  hts_code: string;
}

export interface ImportDocumentDraft {
  importDocumentType: string;
  originalPages: number[];
}

export interface PdfFileRef {
  objectKey: string;
  originalFilename: string;
  fileSize: number;
  fileType: string;
  pageCount: number;
}

export interface AnalyzeDocumentResult {
  pdfFile: PdfFileRef;
  header: ImportHeader;
  taxes: {
    customsTax: number;
    additionalCustomsTax: number;
    kkdf: number;
    vat: number;
    stampTax: number;
  };
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
  productResult: {
    products: any[];
    invoiceMetadata?: {
      invoice_no?: string;
      invoice_date?: string;
      shipper?: string;
    };
  } | null;
}

const DOC_TYPE_BY_PAGE_GROUP: Array<{
  group: PageType;
  importDocumentType: string;
}> = [
  { group: "customs_declaration", importDocumentType: "import_declaration" },
  { group: "commercial_invoice", importDocumentType: "invoice" },
  { group: "packing_list", importDocumentType: "packing_list" },
  { group: "awb", importDocumentType: "awb" },
];

export function combineExtractionResults(
  parts: CombineParts,
): AnalyzeDocumentResult {
  const { pdfFile, groups, customs, expenseResult, expensePageMap, productResult } =
    parts;

  const products: ImportProductDraft[] = (productResult?.products ?? []).map(
    (p: any) => ({
      style: p.style ?? "",
      unit_count: Number(p.unit_count) || 0,
      cost: Number(p.cost) || 0,
      total_value: Number(p.total_value) || 0,
      tr_hs_code: (p.tr_hs_code || p.hts_code || "") as string,
      hts_code: (p.hts_code || "") as string,
    }),
  );

  const productTotal = products.reduce((s, p) => s + (p.total_value || 0), 0);

  const header: ImportHeader = {
    shipper:
      customs?.shipper || productResult?.invoiceMetadata?.shipper || "",
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
    customsTax: 0,
    additionalCustomsTax: 0,
    kkdf: 0,
    vat: 0,
    stampTax: 0,
  };

  const expenses: ImportExpenseDraft[] = [];
  const serviceInvoices: ImportServiceInvoiceDraft[] = [];

  for (const item of expenseResult?.items ?? []) {
    const originalPage =
      item.pageNumber != null
        ? remapPageNumber(item.pageNumber, expensePageMap)
        : null;

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

export async function analyzeProcedureDocument(
  buffer: Buffer,
  originalname: string,
): Promise<AnalyzeDocumentResult> {
  // 1) store the original PDF once
  const sanitized = (originalname || "procedure-document.pdf").replace(
    /[^a-zA-Z0-9.-]/g,
    "_",
  );
  const objectKey = await uploadFile(
    buffer,
    sanitized,
    "application/pdf",
    "procedure-imports",
  );

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
