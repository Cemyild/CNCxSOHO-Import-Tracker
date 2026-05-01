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
  const response = await analyzePdfWithClaude({
    base64Data,
    prompt: PDF_PROMPT,
    maxTokens: 16384,
    temperature: 0,
    model: 'claude-haiku-4-5-20251001',
  });
  return parseClaudeInvoiceResponse(response);
}

function parseNumericCell(val: any): number {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return isFinite(val) ? val : 0;
  let s = String(val).trim();
  s = s.replace(/[$€£¥₺\s]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot && lastComma !== -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function trimOrUndef(val: any): string | undefined {
  if (val == null || val === '') return undefined;
  const s = String(val).trim();
  return s === '' ? undefined : s;
}

type FieldKey =
  | 'style' | 'color' | 'category' | 'hts_code' | 'fabric_content'
  | 'country_of_origin' | 'unit_count' | 'cost' | 'total_value';

const FIELD_KEYS: FieldKey[] = [
  'style', 'color', 'category', 'hts_code', 'fabric_content',
  'country_of_origin', 'unit_count', 'cost', 'total_value',
];

function parseColumnMapping(jsonText: string, headers: string[]): Partial<Record<FieldKey, number>> {
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`[v2] Mapping object not found. First 300 chars: ${jsonText.slice(0, 300)}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch (e) {
    throw new Error(`[v2] Mapping JSON.parse failed: ${e}. First 300 chars: ${jsonText.slice(0, 300)}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[v2] Mapping is not an object');
  }

  const mapping: Partial<Record<FieldKey, number>> = {};
  const lowerHeaders = headers.map(h => h.toLowerCase());

  for (const field of FIELD_KEYS) {
    const target = parsed[field];
    if (target == null) continue;
    if (typeof target === 'number' && Number.isInteger(target) && target >= 0 && target < headers.length) {
      mapping[field] = target;
      continue;
    }
    if (typeof target === 'string') {
      const idx = lowerHeaders.indexOf(target.toLowerCase());
      if (idx !== -1) mapping[field] = idx;
    }
  }
  return mapping;
}

export async function extractFromExcel(buffer: Buffer): Promise<ExtractionResult> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty file buffer provided');
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new Error('Invalid or corrupt Excel file');
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel file contains no sheets');
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

  if (rows.length < 2) return { products: [] };

  const headers = rows[0].map((h: any) => String(h ?? '').trim());
  const dataRows = rows.slice(1).filter(r => r.some(cell => cell != null && cell !== ''));
  if (dataRows.length === 0) return { products: [] };

  const sampleRows = dataRows.slice(0, 3);
  const mappingPrompt = `You are mapping Excel column headers to product fields.

Target fields: ${FIELD_KEYS.join(', ')}.

For each target field, return either the column index (0-based integer) of the matching Excel header, or null if no column matches.

Excel headers (with their indices):
${headers.map((h, i) => `  ${i}: ${JSON.stringify(h)}`).join('\n')}

Sample rows for context:
${sampleRows.map(r => '  ' + JSON.stringify(r)).join('\n')}

Return ONLY a JSON object like:
{"style": 0, "color": 1, "category": null, "hts_code": 5, "fabric_content": null, "country_of_origin": 6, "unit_count": 3, "cost": 4, "total_value": 7}

No markdown, no extra text.`;

  const response = await analyzeText(mappingPrompt, undefined, 0, 512, 'claude-haiku-4-5-20251001');
  const mapping = parseColumnMapping(response, headers);

  const styleIdx = mapping.style;
  if (styleIdx === undefined) {
    throw new Error('Could not identify a "style" column in the Excel file');
  }

  const products: ExtractedProduct[] = [];
  for (const row of dataRows) {
    const get = (field: FieldKey): any => {
      const idx = mapping[field];
      return idx === undefined ? undefined : row[idx];
    };

    const style = trimOrUndef(get('style'));
    if (!style) continue;

    const cost = parseNumericCell(get('cost'));
    const validCost = cost < 0 ? 0 : cost;
    const unitsRaw = parseInt(String(get('unit_count') ?? '0'), 10);
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
  return { products };
}
