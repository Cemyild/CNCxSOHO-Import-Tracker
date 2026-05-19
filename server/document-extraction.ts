// server/document-extraction.ts
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import { analyzePdfWithClaude, analyzeText } from './claude';

export interface ExtractedProduct {
  tempId: string;
  style: string;
  color?: string;
  category?: string;
  fabric_content?: string;
  cost: string;
  unit_count: number;
  country_of_origin?: string;
  hts_code?: string;
  total_value?: string;
  matchStatus: string;
}

export interface InvoiceMetadata {
  invoice_no?: string;
  invoice_date?: string;
  shipper?: string;
}

export interface ExtractionResult {
  products: ExtractedProduct[];
  invoiceMetadata?: InvoiceMetadata;
}

const PDF_PROMPT = `This is a commercial invoice PDF. Return a single JSON object with two top-level keys: "invoice" and "products".

"invoice" — invoice header info (use null for any field that isn't present):
- invoice_no: invoice number / document number
- invoice_date: invoice date in YYYY-MM-DD format
- shipper: shipper / sender / exporter / consignor company name

"products" — array of line items. Each item has these fields (use null if not found):
- style: Style No. column
- color: Color column
- category: Style Description column
- hts_code: HTS CODE column
- fabric_content: Composition Of Material column
- country_of_origin: Made In column (2-letter country code)
- unit_count: Qty column (integer)
- cost: Unit Price column (decimal number, no currency symbol)
- total_value: Amount column (decimal number, no currency symbol)

Return ONLY a valid JSON object shaped like { "invoice": {...}, "products": [...] }. No markdown fences, no extra text.`;

function mapToExtractedProduct(item: any): ExtractedProduct {
  const cost = parseFloat(String(item.cost ?? '0'));
  const units = parseInt(String(item.unit_count ?? '0'), 10);
  const validCost = isNaN(cost) || cost < 0 ? 0 : cost;
  const validUnits = isNaN(units) || units < 1 ? 0 : units;

  const rawTotal = parseFloat(String(item.total_value ?? ''));
  const totalValue = isNaN(rawTotal)
    ? (validCost * validUnits).toFixed(2)
    : rawTotal.toFixed(2);

  return {
    tempId: crypto.randomUUID(),
    style: String(item.style).trim(),
    color: item.color ? String(item.color).trim() : undefined,
    category: item.category ? String(item.category).trim() : undefined,
    fabric_content: item.fabric_content ? String(item.fabric_content).trim() : undefined,
    country_of_origin: item.country_of_origin ? String(item.country_of_origin).trim() : undefined,
    hts_code: item.hts_code ? String(item.hts_code).trim() : undefined,
    cost: validCost.toFixed(2),
    unit_count: validUnits,
    total_value: totalValue,
    matchStatus: 'unmatched',
  };
}

function parseInvoiceMetadata(invoice: any): InvoiceMetadata | undefined {
  if (!invoice || typeof invoice !== 'object') return undefined;
  const m: InvoiceMetadata = {
    invoice_no: trimOrUndef(invoice.invoice_no),
    invoice_date: trimOrUndef(invoice.invoice_date),
    shipper: trimOrUndef(invoice.shipper),
  };
  if (!m.invoice_no && !m.invoice_date && !m.shipper) return undefined;
  return m;
}

function parseClaudeInvoiceResponse(jsonText: string): ExtractionResult {
  // Find outermost JSON object first; fall back to bare array (legacy/defensive)
  const objStart = jsonText.indexOf('{');
  const objEnd = jsonText.lastIndexOf('}');
  const arrStart = jsonText.indexOf('[');
  const arrEnd = jsonText.lastIndexOf(']');

  let raw: any;
  if (objStart !== -1 && objEnd > objStart) {
    try {
      raw = JSON.parse(jsonText.slice(objStart, objEnd + 1));
    } catch (e) {
      throw new Error(`[v2] JSON.parse failed: ${e}. First 300 chars: ${jsonText.slice(0, 300)}`);
    }
  } else if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      raw = JSON.parse(jsonText.slice(arrStart, arrEnd + 1));
    } catch (e) {
      throw new Error(`[v2] JSON.parse failed: ${e}. First 300 chars: ${jsonText.slice(0, 300)}`);
    }
  } else {
    throw new Error(`[v2] No JSON found. First 300 chars: ${jsonText.slice(0, 300)}`);
  }

  let productsArr: any[];
  let invoiceMetadata: InvoiceMetadata | undefined;
  if (Array.isArray(raw)) {
    productsArr = raw;
  } else if (raw && typeof raw === 'object') {
    productsArr = Array.isArray(raw.products)
      ? raw.products
      : (Object.values(raw).find(v => Array.isArray(v)) as any[] | undefined) ?? [];
    invoiceMetadata = parseInvoiceMetadata(raw.invoice);
  } else {
    throw new Error(`[v2] Unexpected JSON shape. First 300 chars: ${jsonText.slice(0, 300)}`);
  }

  const products = productsArr
    .filter((item: any) => item && typeof item.style === 'string' && item.style.trim())
    .map(mapToExtractedProduct);

  return { products, invoiceMetadata };
}

export async function extractFromPdf(buffer: Buffer): Promise<ExtractionResult> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty file buffer provided');
  }
  const base64Data = buffer.toString('base64');
  // Note: model omitted to use DEFAULT_MODEL_STR (Sonnet 4.6) — larger output
  // budget than Haiku 4.5 (which silently truncates at ~8K tokens and breaks
  // JSON parsing for invoices with >50 line items).
  const response = await analyzePdfWithClaude({
    base64Data,
    prompt: PDF_PROMPT,
    maxTokens: 32768,
    temperature: 0,
  });
  return parseClaudeInvoiceResponse(response);
}

function trimOrUndef(val: any): string | undefined {
  if (val == null || val === '') return undefined;
  const s = String(val).trim();
  return s === '' ? undefined : s;
}

const EXCEL_PROMPT = `The data below is a commercial invoice exported from Excel and converted to CSV. The sheet may contain header/metadata rows (invoice number, date, shipper info) above the product table, and totals/subtotal/footer rows after it. Identify the product line items and return a single JSON object with two top-level keys: "invoice" and "products".

"invoice" — invoice header info (use null for any field that isn't present):
- invoice_no: invoice number / document number
- invoice_date: invoice date in YYYY-MM-DD format
- shipper: shipper / sender / exporter / consignor company name

"products" — array of line items. Each item has these fields (use null if not found):
- style: Style No. column
- color: Color column
- category: Style Description column
- hts_code: HTS CODE column
- fabric_content: Composition Of Material column
- country_of_origin: Made In column (2-letter country code)
- unit_count: Qty column (integer)
- cost: Unit Price column (decimal number, no currency symbol)
- total_value: Amount column (decimal number, no currency symbol)

Skip non-product rows (titles, addresses, totals, subtotals, grand total, notes). Only include real product line items.

Return ONLY a valid JSON object shaped like { "invoice": {...}, "products": [...] }. No markdown fences, no extra text.`;

export async function extractFromExcel(buffer: Buffer): Promise<ExtractionResult> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty file buffer provided');
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    throw new Error(`Invalid or corrupt Excel file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel file contains no sheets');
  const worksheet = workbook.Sheets[sheetName];
  const csv = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false }).trim();
  if (!csv) return { products: [] };

  // Model arg omitted → DEFAULT_MODEL_STR (Sonnet 4.6). Haiku 4.5 truncates at
  // ~8K output tokens which malforms JSON for large invoices (the original
  // symptom was "JSON.parse failed at position ~39000" — a cutoff, not a
  // model bug).
  const response = await analyzeText(
    `${EXCEL_PROMPT}\n\nCSV:\n${csv}`,
    undefined,
    0,
    32768,
  );
  return parseClaudeInvoiceResponse(response);
}
