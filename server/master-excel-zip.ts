// server/master-excel-zip.ts
//
// Append rows to the master IMPORT LIST xlsx WITHOUT going through exceljs's
// load+write round-trip (which corrupts sheet1.xml — Excel reports
// "Replaced Part: /xl/worksheets/sheet1.xml part with XML error" and discards
// the worksheet contents). Instead, treat the file as a plain ZIP and edit
// only the sheet1.xml string in place: every other part of the workbook
// (styles, calcChain, table defs, themes, drawings, printer settings,
// hyperlinks, etc.) is preserved bit-for-bit.

import JSZip from 'jszip';
import type { CellValue } from './master-excel-helper';

const SHEET1_PATH = 'xl/worksheets/sheet1.xml';

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(64 + ((n - 1) % 26) + 1) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function excelSerialDate(d: Date): number {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((utc - epoch) / (24 * 60 * 60 * 1000));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Find the highest row number whose column A cell has a value (not self-closing/empty).
// A-cell variants we recognise:
//   <c r="A5"/>                        — empty self-closing (skip)
//   <c r="A5" s="1"/>                  — empty self-closing (skip)
//   <c r="A5"></c>                     — empty content (skip)
//   <c r="A5" s="1"><v>...</v></c>     — has value (count)
//   <c r="A5" t="s"><v>n</v></c>       — shared string (count)
//   <c r="A5" t="inlineStr">…</c>      — inline string (count)
function findLastRefRow(sheetXml: string): number {
  const re = /<c r="A(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sheetXml))) {
    const r = parseInt(m[1], 10);
    const content = m[3];
    if (content !== undefined && content.trim() !== '') {
      if (r > last) last = r;
    }
  }
  return last;
}

// Read the table end row from xl/tables/table1.xml ref="A4:BH193".
async function findTableEndRow(zip: JSZip): Promise<number | null> {
  const tablesFolder = zip.folder('xl/tables');
  if (!tablesFolder) return null;
  // Iterate any tableN.xml file
  const files = Object.keys(zip.files).filter(name => /^xl\/tables\/table\d+\.xml$/.test(name));
  for (const name of files) {
    const xml = await zip.files[name].async('string');
    const m = xml.match(/ref="[A-Z]+\d+:[A-Z]+(\d+)"/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// Build the replacement <c> tag for a single cell, preserving the original
// style/attribute string. Returns null if the cell currently holds a formula
// (we never overwrite formula cells).
function buildCellReplacement(
  fullMatch: string,
  attrs: string,
  content: string | undefined,
  cellRef: string,
  value: CellValue
): string | null {
  // Skip if has formula
  if (content && /<f[\s>]/.test(content)) return null;
  // Strip any existing t="..." since we'll set it explicitly
  const cleanAttrs = attrs.replace(/\s+t="[^"]*"/g, '');
  if (typeof value === 'number') {
    return `<c r="${cellRef}"${cleanAttrs}><v>${value}</v></c>`;
  }
  if (value instanceof Date) {
    return `<c r="${cellRef}"${cleanAttrs}><v>${excelSerialDate(value)}</v></c>`;
  }
  // String
  return `<c r="${cellRef}"${cleanAttrs} t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
}

function writeCellInXml(sheetXml: string, rowNum: number, colNum: number, value: CellValue): string {
  if (value === null || value === undefined || value === '') return sheetXml;

  const cellRef = `${colLetter(colNum)}${rowNum}`;
  const cellRe = new RegExp(`<c r="${cellRef}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`);
  const m = cellRe.exec(sheetXml);
  if (!m) return sheetXml; // cell does not exist in the row template
  const replacement = buildCellReplacement(m[0], m[1], m[2], cellRef, value);
  if (!replacement) return sheetXml;
  return sheetXml.replace(m[0], replacement);
}

export interface AppendResult {
  buffer: Buffer;
  lastRefRow: number;
  writeRows: number[];
  tableEndRow: number | null;
}

export async function appendRowsToMasterXlsx(
  inputBuffer: Buffer,
  rows: CellValue[][],
): Promise<AppendResult> {
  const zip = await JSZip.loadAsync(inputBuffer);
  const sheetFile = zip.file(SHEET1_PATH);
  if (!sheetFile) throw new Error(`Workbook is missing ${SHEET1_PATH}`);
  let sheetXml = await sheetFile.async('string');

  const lastRefRow = findLastRefRow(sheetXml);
  if (lastRefRow < 3) {
    throw new Error(`Could not find a reference row in IMPORT LIST (lastRefRow=${lastRefRow})`);
  }

  const tableEndRow = await findTableEndRow(zip);

  // Resolve target row numbers — they must lie within the table's reserved range
  // for structured references like Tablo1[[#This Row],…] to remain valid.
  const writeRows: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const target = lastRefRow + 1 + i;
    if (tableEndRow != null && target > tableEndRow) {
      throw new Error(
        `Master sheet has no more reserved rows in the table (lastRefRow=${lastRefRow}, tableEndRow=${tableEndRow}, needed=${rows.length}). Extend the table in the master file.`,
      );
    }
    writeRows.push(target);
  }

  // Write each row's values into the corresponding empty styled row
  for (let i = 0; i < rows.length; i++) {
    const target = writeRows[i];
    const data = rows[i];
    for (let c = 0; c < data.length; c++) {
      sheetXml = writeCellInXml(sheetXml, target, c + 1, data[c]);
    }
  }

  // Persist the modified sheet1.xml back into the zip
  zip.file(SHEET1_PATH, sheetXml);

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return {
    buffer: out,
    lastRefRow,
    writeRows,
    tableEndRow,
  };
}
