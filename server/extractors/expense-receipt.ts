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

const EXPENSE_RECEIPT_PROMPT = `Count the pages in this PDF.

DOCUMENT TYPE RULES:
- 1-2 pages: SERVICE INVOICE → extract total amount only
- 3+ pages: EXPENSE RECEIPT → the FIRST PAGE lists ALL expenses, following pages contain invoices/receipts

=== SERVICE INVOICE (1-2 pages) ===
{
  "documentType": "service_invoice",
  "pageCount": <number>,
  "items": [{
    "description": "Service Invoice",
    "amount": <TOTAL>,
    "currency": "TRY",
    "suggestedCategory": "service_invoice",
    "type": "service_invoice",
    "invoiceNumber": "<from Fatura No field>",
    "invoiceDate": "<YYYY-MM-DD>",
    "receiptNumber": "",
    "issuer": "<company name>",
    "pageNumber": 1
  }],
  "taxes": {},
  "totalTaxFromExpenseReceipt": 0,
  "documentInfo": {}
}

=== EXPENSE RECEIPT (3+ pages) ===

**THE FIRST PAGE IS THE EXPENSE RECEIPT (Masraf Makbuzu)**
It contains a TABLE listing ALL expenses for this shipment. Each row typically has:
- Expense description (Açıklama): Nakliye, Ordino, Sigorta, Ardiye, Vergiler, etc.
- Amount (Tutar): The cost in TRY
- Document Number (Belge No / Makbuz No / Evrak No): The receipt/document number for this expense

**STEP 1: READ THE FIRST PAGE - EXTRACT EXPENSES WITH DOCUMENT NUMBERS**
Extract every SERVICE EXPENSE from page 1 (Nakliye, Ordino, Sigorta, Ardiye, TAREKS, etc.)
SKIP "Vergiler" or "Toplam Vergi" - this is just a total, NOT an individual item!
Record totalTaxFromExpenseReceipt = the "Vergiler" amount (for reference only)

**CRITICAL - EXTRACT DOCUMENT NUMBER FROM PAGE 1 TABLE:**
- Look for a column labeled "Belge No", "Makbuz No", "Evrak No", or "Document No" in the expense table on page 1
- Each expense row should have its own document number in this column
- Store this value in the "receiptNumber" field for each item
- This is DIFFERENT from invoiceNumber which comes from the individual invoice pages later

**STEP 2: FIND THE TAX RECEIPT PAGE - EXTRACT INDIVIDUAL TAXES**
CRITICAL: Search ALL pages to find the TAX RECEIPT (Vergi Makbuzu, Tahsilat Makbuzu, Gümrük Vergisi Tahakkuku).
The tax receipt shows a BREAKDOWN of each tax type with individual amounts:
- Gümrük Vergisi (Customs Tax) → suggestedCategory: "customs_tax"
- İlave Gümrük Vergisi (Additional Customs Tax) → suggestedCategory: "additional_customs_tax"
- KKDF → suggestedCategory: "kkdf"
- KDV / Katma Değer Vergisi (VAT) → suggestedCategory: "vat"
- Damga Vergisi (Stamp Tax) → suggestedCategory: "stamp_tax"

ADD EACH TAX AS A SEPARATE ITEM with type="tax". DO NOT add a "total tax" item!
IMPORTANT: Record the "pageNumber" (1-indexed) where each tax item was found!

**STEP 3: SCAN ALL OTHER PAGES FOR INVOICES/RECEIPTS**
For EACH expense from Step 1, search pages 2+ to find the matching invoice.
Match by: AMOUNT (Toplam/Genel Toplam) or by service description
CRITICAL: Record the "pageNumber" (1-indexed) where each matching invoice was found!

**HOW TO FIND INVOICE NUMBER (Fatura No) - MANDATORY FOR EACH EXPENSE:**
- Location: TOP-RIGHT area of invoice, document header, or anywhere on page
- SEARCH FOR THESE LABELS (look for ANY of these):
  * "Fatura No", "Fatura No:", "e-Fatura No:", "ETTN:", "Belge No:"
  * "Payment Advice No", "Makbuz No", "Makbuz No:"
  * "Invoice No", "Invoice Number", "Receipt No", "Document No"
- ACCEPT ANY FORMAT: numbers, letters, alphanumeric strings of any length
- Examples: "ABC2025000000001", "12345", "FA-2025-001", "MAKBUZ-123"
- RULE: If you find ANY labeled document/invoice number, ALWAYS extract it exactly as shown (trim whitespace only)
- DO NOT leave empty if a label with a value is visible on the page!

**HOW TO FIND INVOICE DATE (Fatura Tarihi) - MANDATORY FOR EACH EXPENSE:**
- Location: Near invoice number, document header, or anywhere on invoice page
- SEARCH FOR THESE LABELS (look for ANY of these):
  * "Fatura Tarihi", "Tarih", "Düzenleme Tarihi"
  * "Date", "Invoice Date", "Payment Date", "Issue Date"
- ACCEPT ANY DATE FORMAT you find:
  * DD.MM.YYYY (e.g., 04.12.2025)
  * DD/MM/YYYY (e.g., 04/12/2025)
  * DD-MM-YYYY (e.g., 04-12-2025)
  * YYYY-MM-DD (e.g., 2025-12-04)
  * DD.MM.YY (e.g., 04.12.25)
  * Text months (e.g., "4 Aralık 2025", "December 4, 2025")
- RULE: If you find ANY labeled date, ALWAYS extract it in DD.MM.YYYY format
- DO NOT leave empty if a date is visible on the invoice page!

**HOW TO FIND ISSUER:**
- Location: TOP of invoice in seller (Satıcı) section

EXPENSE CATEGORIES (type="expense"):
- export_registry_fee (İTKİB, İhracat Kayıt)
- insurance (Sigorta, Poliçe)
- awb_fee (Ordino, AWB, Hava Yolu)
- airport_storage_fee (Havalimanı Ardiye)
- bonded_warehouse_storage_fee (Antrepo Ardiye)
- transportation (Nakliye, Taşıma)
- international_transportation (Uluslararası Nakliye)
- tareks_fee (TAREKS, TSE)
- customs_inspection (Gümrük Muayene)
- azo_test (AZO Testi)
- other

TAX CATEGORIES (type="tax") - EACH MUST BE SEPARATE:
- customs_tax (Gümrük Vergisi)
- additional_customs_tax (İlave Gümrük Vergisi)
- kkdf (KKDF)
- vat (KDV)
- stamp_tax (Damga Vergisi)

OUTPUT FORMAT:
{
  "documentType": "expense_receipt",
  "pageCount": <number>,
  "items": [
    {
      "description": "Nakliye",
      "amount": 2500.00,
      "currency": "TRY",
      "suggestedCategory": "transportation",
      "type": "expense",
      "invoiceNumber": "ABC2025000000123",
      "invoiceDate": "04.12.2025",
      "receiptNumber": "",
      "issuer": "ABC Nakliyat Ltd.",
      "pageNumber": 3
    },
    {
      "description": "Gümrük Vergisi",
      "amount": 15000.00,
      "currency": "TRY",
      "suggestedCategory": "customs_tax",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    },
    {
      "description": "İlave Gümrük Vergisi",
      "amount": 500.00,
      "currency": "TRY",
      "suggestedCategory": "additional_customs_tax",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    },
    {
      "description": "KKDF",
      "amount": 1200.00,
      "currency": "TRY",
      "suggestedCategory": "kkdf",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    },
    {
      "description": "KDV",
      "amount": 8000.00,
      "currency": "TRY",
      "suggestedCategory": "vat",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    },
    {
      "description": "Damga Vergisi",
      "amount": 100.00,
      "currency": "TRY",
      "suggestedCategory": "stamp_tax",
      "type": "tax",
      "invoiceNumber": "",
      "invoiceDate": "",
      "receiptNumber": "",
      "issuer": "",
      "pageNumber": 2
    }
  ],
  "taxes": {
    "customsTax": 15000.00,
    "additionalCustomsTax": 500.00,
    "kkdf": 1200.00,
    "vat": 8000.00,
    "stampTax": 100.00
  },
  "totalTaxFromExpenseReceipt": 24800.00,
  "documentInfo": {}
}

CRITICAL RULES:
1. NEVER add "Vergiler" or "Toplam Vergi" as an item - it's just a total!
2. Find the TAX RECEIPT page and extract EACH tax type separately
3. Each tax (customs_tax, additional_customs_tax, kkdf, vat, stamp_tax) must be a SEPARATE item
4. For expenses, find: invoiceNumber, invoiceDate, issuer from matching invoice pages
5. Taxes go in both "items" array AND "taxes" object with individual amounts
6. ALWAYS include "pageNumber" for each item - the page (1-indexed) where each matching invoice was found
7. Return ONLY valid JSON
8. MANDATORY - Two types of document numbers:
   a) receiptNumber: Extract from PAGE 1's expense table - look for "Belge No", "Makbuz No", "Evrak No" column
   b) invoiceNumber: Extract from INDIVIDUAL INVOICE PAGES - look for "Fatura No", "Payment Advice No", etc.
   - NEVER confuse these - receiptNumber is from page 1 table, invoiceNumber is from invoice pages!
9. MANDATORY - Invoice dates:
   - invoiceDate: Look for "Fatura Tarihi", "Tarih", "Date", etc. on invoice pages
   - Extract in DD.MM.YYYY format
   - NEVER leave empty if a date is visible on the invoice page!`;

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
