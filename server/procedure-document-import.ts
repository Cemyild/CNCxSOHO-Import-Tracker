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
import { extractTaxes, type TaxData } from "./extractors/tax";
import { uploadFile, getFile } from "./object-storage";

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
      currency?: string;
    };
  } | null;
  customsTaxes?: TaxData | null;
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

function pickTaxFields(t: TaxData): AnalyzeDocumentResult["taxes"] {
  return {
    customsTax: t.customsTax,
    additionalCustomsTax: t.additionalCustomsTax,
    kkdf: t.kkdf,
    vat: t.vat,
    stampTax: t.stampTax,
  };
}

function hasNonZeroTax(t: TaxData): boolean {
  return !!(t.customsTax || t.additionalCustomsTax || t.kkdf || t.vat || t.stampTax);
}

export function combineExtractionResults(
  parts: CombineParts,
): AnalyzeDocumentResult {
  const { pdfFile, groups, customs, expenseResult, expensePageMap, productResult, customsTaxes } =
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
    currency: productResult?.invoiceMetadata?.currency || "USD",
  };

  const taxes =
    customsTaxes && hasNonZeroTax(customsTaxes)
      ? pickTaxFields(customsTaxes)
      : expenseResult?.taxes ?? {
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
  const [customs, expenseResult, productResult, customsTaxes] = await Promise.all([
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
    customsSplit.pageMap.length
      ? extractTaxes(customsSplit.buffer).catch((e) => {
          console.error("[analyze-document] customs tax extraction failed:", e);
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
    customsTaxes,
  });
}

// ---------------------------------------------------------------------------
// CreateFromDocumentInput + buildCreateInserts (pure, TDD-tested)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// attachPages helper (best-effort, NOT in transaction)
// ---------------------------------------------------------------------------

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
    const { storage } = await import("./storage");
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

// ---------------------------------------------------------------------------
// createProcedureFromDocument — atomic DB write + best-effort attachments
// ---------------------------------------------------------------------------

export async function createProcedureFromDocument(
  input: CreateFromDocumentInput,
): Promise<{ reference: string; attachments: { ok: number; failed: number } }> {
  const userId = input.userId || 3;
  const inserts = buildCreateInserts(input, userId);

  // Lazy-import DB and schema to avoid top-level initialization during testing.
  const { db } = await import("./db");
  const {
    procedures,
    taxes: taxesTable,
    importExpenses,
    importServiceInvoices,
    taxCalculations,
    taxCalculationItems,
  } = await import("@shared/schema");

  // Pre-reset sequences to avoid PK collisions (best effort).
  for (const seq of ["procedures_id_seq", "taxes_id_seq"]) {
    try {
      await (db as any).execute(
        `SELECT setval('${seq}', (SELECT COALESCE(MAX(id),0) FROM ${seq.replace("_id_seq", "")}) + 1, false)`,
      );
    } catch { /* ignore */ }
  }

  // 1) Atomic DB write. Capture inserted rows via RETURNING so attachment can
  // match each draft to its saved id by index — a single multi-row INSERT ...
  // RETURNING yields rows in the same order as the VALUES list (Postgres
  // guarantees this), so we never rely on an unordered SELECT.
  const created = await db.transaction(async (tx) => {
    const [procedure] = await tx.insert(procedures).values(inserts.procedureValues as any).returning();

    if (inserts.taxValues) {
      await tx.insert(taxesTable).values(inserts.taxValues as any);
    }

    let expenseRows: any[] = [];
    if (inserts.expenseValues.length) {
      expenseRows = await tx.insert(importExpenses).values(inserts.expenseValues as any).returning();
    }

    let serviceRows: any[] = [];
    if (inserts.serviceInvoiceValues.length) {
      serviceRows = await tx.insert(importServiceInvoices).values(inserts.serviceInvoiceValues as any).returning();
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
        } as any)
        .returning();
      await tx
        .insert(taxCalculationItems)
        .values(inserts.productItems.map((it) => ({ ...it, tax_calculation_id: calc.id })) as any);
    }

    return { procedure, expenseRows, serviceRows };
  });

  // 2) Best-effort document attachment (NOT part of the transaction)
  let ok = 0;
  let failed = 0;
  try {
    const { buffer: pdfBuffer } = await getFile(input.pdfObjectKey);

    // Attach each expense's source page. created.expenseRows[i] corresponds to
    // input.expenses[i] (RETURNING preserves VALUES order).
    for (let i = 0; i < input.expenses.length; i++) {
      const exp = input.expenses[i];
      const row = created.expenseRows[i];
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
      const row = created.serviceRows[i];
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
        expenseType: "import_document", expenseId: created.procedure.id,
        importDocumentType: doc.importDocumentType,
        filenameHint: `${doc.importDocumentType}.pdf`, userId,
      })) ? ok++ : failed++;
    }
  } catch (e) {
    console.error("[create-from-document] attachment phase error:", e);
  }

  return { reference: input.reference, attachments: { ok, failed } };
}
