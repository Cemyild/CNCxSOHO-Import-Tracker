// server/document-extraction.ts
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import { analyzeImage, analyzeText } from './claude';

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

const PDF_PROMPT = `This is a commercial invoice PDF. Extract all product line items and return a JSON array.
Each item must have these fields (use null if not found):
- style: Style No. column
- color: Color column
- category: Style Description column
- hts_code: HTS CODE column
- fabric_content: Composition Of Material column
- country_of_origin: Made In column (2-letter country code)
- unit_count: Qty column (integer)
- cost: Unit Price column (decimal number, no currency symbol)
- total_value: Amount column (decimal number, no currency symbol)

Return ONLY a valid JSON array with no extra text.`;

function parseClaudeProducts(jsonText: string): ExtractedProduct[] {
  const cleaned = jsonText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let raw: any[];
  try {
    raw = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found in Claude response');
    raw = JSON.parse(match[0]);
  }

  if (!Array.isArray(raw)) throw new Error('Claude response is not a JSON array');

  return raw
    .filter(item => item && typeof item.style === 'string' && item.style.trim())
    .map((item) => {
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
    });
}

export async function extractFromPdf(buffer: Buffer): Promise<ExtractedProduct[]> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty file buffer provided');
  }
  const base64Data = buffer.toString('base64');
  const response = await analyzeImage(base64Data, 'application/pdf', PDF_PROMPT);
  return parseClaudeProducts(response);
}

export async function extractFromExcel(buffer: Buffer): Promise<ExtractedProduct[]> {
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

  if (rows.length < 2) return [];

  const headers = rows[0].map((h: any) => String(h ?? '').trim());
  const dataRows = rows.slice(1).filter(r => r.some(cell => cell != null && cell !== ''));

  if (dataRows.length > 500) {
    console.warn(`extractFromExcel: ${dataRows.length} data rows found; only the first 500 will be sent to Claude.`);
  }

  const excelPrompt = `The following is Excel spreadsheet data with headers and rows.
Map each column to the appropriate field and return a JSON array of product objects.
Target fields: style, color, category, hts_code, fabric_content, country_of_origin, unit_count, cost, total_value.
Skip rows where style is empty or missing.
cost and total_value must be plain decimal numbers without currency symbols.
unit_count must be a plain integer.
Return ONLY a valid JSON array with no extra text.

Headers: ${JSON.stringify(headers)}
Rows: ${JSON.stringify(dataRows.slice(0, 500))}`;

  const response = await analyzeText(excelPrompt, undefined, 0, 4096, 'claude-3-5-haiku-20241022');
  return parseClaudeProducts(response);
}
