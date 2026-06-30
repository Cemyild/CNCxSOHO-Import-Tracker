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
  currency?: string;
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
- currency: currency code used for unit prices and totals (e.g. USD, EUR, TRY)

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
    currency: trimOrUndef(invoice.currency),
  };
  if (!m.invoice_no && !m.invoice_date && !m.shipper && !m.currency) return undefined;
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
  const response = await analyzePdfWithClaude({
    base64Data,
    prompt: PDF_PROMPT,
    maxTokens: 16384,
    temperature: 0,
    model: 'claude-haiku-4-5-20251001',
  });
  return parseClaudeInvoiceResponse(response);
}

function trimOrUndef(val: any): string | undefined {
  if (val == null || val === '') return undefined;
  const s = String(val).trim();
  return s === '' ? undefined : s;
}

// Excel cell numeric parser. Robust to:
//   "$17.14"         -> 17.14
//   "1,234.56"       -> 1234.56  (US format)
//   "1.234,56"       -> 1234.56  (EU format)
//   " USD 1,550.67 " -> 1550.67  (currency prefix + spaces)
//   "TL 12.500"      -> 12500
//   "(1,234.56)"     -> 1234.56  (accounting negative, but stripped to positive — we don't expect negatives in invoice line totals)
function parseNumericCell(val: any): number {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return isFinite(val) ? val : 0;
  let s = String(val).trim();
  // Strip everything that isn't a digit, dot, comma, or minus sign. This drops
  // currency symbols ($, €, etc.), currency codes (USD, EUR, TL, TRY, GBP, ...),
  // whitespace, and any other annotation cells often carry.
  s = s.replace(/[^\d.,\-]/g, '');
  if (!s) return 0;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot && lastComma !== -1) {
    // EU format: "1.234,56" -> "1234.56"
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // US format: "1,234.56" -> "1234.56"
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

type FieldKey =
  | 'style' | 'color' | 'category' | 'hts_code' | 'fabric_content'
  | 'country_of_origin' | 'unit_count' | 'cost' | 'total_value';

const FIELD_KEYS: FieldKey[] = [
  'style', 'color', 'category', 'hts_code', 'fabric_content',
  'country_of_origin', 'unit_count', 'cost', 'total_value',
];

interface ExcelHeaderAnalysis {
  header_row_index: number;
  invoice_no: string | null;
  invoice_date: string | null;
  shipper: string | null;
  mapping: Partial<Record<FieldKey, number>>;
}

function parseExcelHeaderAnalysis(jsonText: string, columnCount: number): ExcelHeaderAnalysis {
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`[v2] Header analysis object not found. First 300 chars: ${jsonText.slice(0, 300)}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch (e) {
    throw new Error(`[v2] Header analysis JSON.parse failed: ${e}. First 300 chars: ${jsonText.slice(0, 300)}`);
  }

  const headerRowIndex = Number.isInteger(parsed.header_row_index) && parsed.header_row_index >= 0
    ? parsed.header_row_index
    : 0;

  const mapping: Partial<Record<FieldKey, number>> = {};
  const rawMapping = parsed.mapping ?? {};
  for (const field of FIELD_KEYS) {
    const target = rawMapping[field];
    if (typeof target === 'number' && Number.isInteger(target) && target >= 0 && target < columnCount) {
      mapping[field] = target;
    }
  }

  return {
    header_row_index: headerRowIndex,
    invoice_no: trimOrUndef(parsed.invoice_no) ?? null,
    invoice_date: trimOrUndef(parsed.invoice_date) ?? null,
    shipper: trimOrUndef(parsed.shipper) ?? null,
    mapping,
  };
}

// extractFromExcel — restored to the column-mapping approach (cf. commit ef37d60)
// with added support for metadata rows above the header (added in 03e4e33 but
// implemented incorrectly there by dumping the entire CSV into Claude, which
// truncated at ~700 lines).
//
// Approach: send Claude only the first ~12 rows. Claude returns:
//   - header_row_index: which row is the column-header row (metadata above it)
//   - invoice_no / invoice_date / shipper: parsed from metadata rows (if any)
//   - mapping: column index for each product field
// Then we parse all data rows in JavaScript using that mapping. Claude's output
// stays under ~500 bytes regardless of how many product rows the file has,
// so JSON truncation is impossible and proxy timeouts are avoided.
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
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' }) as any[][];

  if (rows.length < 2) return { products: [] };

  // Sample the first 30 rows. Real commercial invoices often have 15-20 rows
  // of header/metadata (shipper details with multiline addresses, importer
  // details, port info, payment terms, etc.) above the actual product table.
  // A draft tax file typically has its header on row 2, so 30 covers both
  // extremes comfortably without bloating Claude's input.
  const sampleSize = Math.min(rows.length, 30);
  const sampleRows = rows.slice(0, sampleSize);
  const columnCount = Math.max(...sampleRows.map(r => r.length));

  const mappingPrompt = `You are analyzing the first rows of an Excel commercial invoice.

Many commercial invoices have a HEADER BLOCK at the top (metadata: Shipper, Importer, Invoice No, Invoice Date, PO numbers, port of loading, payment terms, etc.) followed by a COLUMN HEADER ROW (e.g. "Style No", "Style Description", "HTS CODE", "Qty", "Unit Price", "Amount"), then the product line items.

The header block can be anywhere from 0 rows (draft files) to 20+ rows (full commercial invoices with multiline addresses). DO NOT assume the column header is on row 2 — find it.

Inspect the rows below and return ONE JSON object with these keys:

{
  "header_row_index": <0-based row index of the COLUMN HEADER row — the row that LABELS the product table columns. Look for cells like "Style No", "Style Description", "HTS CODE", "Qty", "Unit Price", "Amount". This row's values are LABELS, not actual product data.>,
  "invoice_no": <invoice/document number from metadata rows above the header (string, no surrounding text), or null>,
  "invoice_date": <invoice date in YYYY-MM-DD format from metadata rows (convert "11-May-26" -> "2026-05-11"), or null>,
  "shipper": <shipper / exporter / sender / consignor company name from metadata rows (just the company name, NOT the full multiline address), or null>,
  "mapping": {
    "style": <0-based column index for Style No / Style / Item Style column, or null>,
    "color": <0-based column index for Color column, or null>,
    "category": <0-based column index for Style Description / Product Description / Category column, or null>,
    "hts_code": <0-based column index for HTS / HS / HTS CODE column, or null>,
    "fabric_content": <0-based column index for Composition / Material / Fabric Content column, or null>,
    "country_of_origin": <0-based column index for Made In / Country of Origin column, or null>,
    "unit_count": <0-based column index for Qty / Quantity column, or null>,
    "cost": <0-based column index for Unit Price column, or null>,
    "total_value": <0-based column index for Amount / Total / Total Value column, or null>
  }
}

Rows (with their 0-based row indices):
${sampleRows.map((r, i) => `  ${i}: ${JSON.stringify(r)}`).join('\n')}

Return ONLY the JSON object. No markdown fences, no commentary.`;

  const response = await analyzeText(
    mappingPrompt,
    undefined,
    0,
    1024,
    'claude-haiku-4-5-20251001',
  );
  const analysis = parseExcelHeaderAnalysis(response, columnCount);

  if (analysis.mapping.style === undefined) {
    throw new Error('Could not identify a "Style No" column in the Excel file');
  }

  const dataRows = rows.slice(analysis.header_row_index + 1)
    .filter(r => r.some(cell => cell != null && cell !== ''));

  const products: ExtractedProduct[] = [];
  for (const row of dataRows) {
    const get = (field: FieldKey): any => {
      const idx = analysis.mapping[field];
      return idx === undefined ? undefined : row[idx];
    };

    const style = trimOrUndef(get('style'));
    if (!style) continue;

    // Skip obvious footer rows (totals, subtotals, grand total)
    const styleLower = style.toLowerCase();
    if (styleLower === 'total' || styleLower === 'subtotal' || styleLower === 'grand total') continue;

    const cost = parseNumericCell(get('cost'));
    const validCost = cost < 0 ? 0 : cost;
    const unitsRaw = parseInt(String(get('unit_count') ?? '0').replace(/[,\s]/g, ''), 10);
    const validUnits = isNaN(unitsRaw) || unitsRaw < 1 ? 0 : unitsRaw;

    const rawTotal = parseNumericCell(get('total_value'));
    const totalValue = rawTotal > 0 ? rawTotal.toFixed(2) : (validCost * validUnits).toFixed(2);

    products.push({
      tempId: crypto.randomUUID(),
      style,
      color: trimOrUndef(get('color')),
      category: trimOrUndef(get('category')),
      fabric_content: trimOrUndef(get('fabric_content')),
      country_of_origin: trimOrUndef(get('country_of_origin')),
      hts_code: trimOrUndef(get('hts_code')),
      cost: validCost.toFixed(2),
      unit_count: validUnits,
      total_value: totalValue,
      matchStatus: 'unmatched',
    });
  }

  const invoiceMetadata: InvoiceMetadata = {
    invoice_no: analysis.invoice_no ?? undefined,
    invoice_date: analysis.invoice_date ?? undefined,
    shipper: analysis.shipper ?? undefined,
  };
  const hasMetadata = !!(invoiceMetadata.invoice_no || invoiceMetadata.invoice_date || invoiceMetadata.shipper);

  return {
    products,
    invoiceMetadata: hasMetadata ? invoiceMetadata : undefined,
  };
}
