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

// When appending would run past the last reserved table row, grow the table in
// place instead of failing. The strategy mirrors what dragging the table's
// bottom handle down does in Excel:
//   1. Clone the last reserved row (styles + structured-reference formulas kept,
//      any stray data stripped) into `addCount` fresh empty rows.
//   2. Slide the trailing border row (the thick line just under the table) down
//      below the new rows so it stays at the bottom.
//   3. Widen table ref + autoFilter ref in tableN.xml, the sheet <dimension>,
//      and any conditional-formatting ranges that pointed at the old table end.
// Structured references (Tablo1[[#This Row],…]) carry no row number, so cloned
// rows compute correctly without rewriting a single formula.
const ROW_BUFFER = 100;

async function extendMasterTable(
  zip: JSZip,
  sheetXml: string,
  tableEndRow: number,
  addCount: number,
): Promise<string> {
  const newTableEnd = tableEndRow + addCount;

  // 1. Locate the template row (the last reserved table row).
  const templateRe = new RegExp(`<row r="${tableEndRow}"[\\s\\S]*?<\\/row>`);
  const templateMatch = sheetXml.match(templateRe);
  if (!templateMatch) {
    throw new Error(`Cannot extend table: template row ${tableEndRow} not found in sheet`);
  }
  const templateBlock = templateMatch[0];

  // Locate the trailing border row directly beneath the table (may be absent).
  const borderRowNum = tableEndRow + 1;
  const borderRe = new RegExp(`<row r="${borderRowNum}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/row>)`);
  const borderMatch = sheetXml.match(borderRe);

  // 2. Strip data cells from the template so cloned rows start empty; keep cell
  //    styles and formula cells untouched.
  const cleanTemplate = templateBlock.replace(
    /<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g,
    (full, ref, attrs, content) => {
      if (/<f[\s>]/.test(content)) return full; // preserve formula cells verbatim
      const cleanAttrs = attrs.replace(/\s+t="[^"]*"/g, '');
      return `<c r="${ref}"${cleanAttrs}/>`;
    },
  );

  // 3. Clone the template into addCount new rows (tableEndRow+1 … newTableEnd).
  const cellRefRe = new RegExp(`r="([A-Z]*)${tableEndRow}"`, 'g');
  let inserted = '';
  for (let k = tableEndRow + 1; k <= newTableEnd; k++) {
    inserted += cleanTemplate.replace(cellRefRe, (_m, col) => `r="${col}${k}"`);
  }

  // 4. Insert new rows and push the border row (if any) below them.
  let newLastRow: number;
  if (borderMatch) {
    const newBorderRowNum = newTableEnd + 1;
    const movedBorder = borderMatch[0].replace(
      new RegExp(`^(<row )r="${borderRowNum}"`),
      `$1r="${newBorderRowNum}"`,
    );
    sheetXml = sheetXml.replace(borderMatch[0], inserted + movedBorder);
    newLastRow = newBorderRowNum;
  } else {
    sheetXml = sheetXml.replace(templateBlock, templateBlock + inserted);
    newLastRow = newTableEnd;
  }

  // 5. Update the sheet <dimension> to the new last row.
  sheetXml = sheetXml.replace(
    /(<dimension ref="[A-Z]+\d+:[A-Z]+)\d+"/,
    `$1${newLastRow}"`,
  );

  // 6. Update conditional-formatting ranges (in the tail after </sheetData> so
  //    the template row's own cells are never touched) that ended at the old
  //    table end.
  const sdEnd = sheetXml.indexOf('</sheetData>');
  if (sdEnd !== -1) {
    const head = sheetXml.slice(0, sdEnd);
    let tail = sheetXml.slice(sdEnd);
    tail = tail.replace(/sqref="([^"]*)"/g, (_m, refs: string) => {
      const updated = refs.replace(
        new RegExp(`([A-Z]+)${tableEndRow}\\b`, 'g'),
        `$1${newTableEnd}`,
      );
      return `sqref="${updated}"`;
    });
    sheetXml = head + tail;
  }

  // 7. Extend the table definition (ref + autoFilter ref) in the matching table file.
  const tableFiles = Object.keys(zip.files).filter(name => /^xl\/tables\/table\d+\.xml$/.test(name));
  for (const name of tableFiles) {
    let tableXml = await zip.files[name].async('string');
    const endM = tableXml.match(/ref="[A-Z]+\d+:[A-Z]+(\d+)"/);
    if (endM && parseInt(endM[1], 10) === tableEndRow) {
      tableXml = tableXml.replace(
        /ref="([A-Z]+\d+:[A-Z]+)\d+"/g,
        `ref="$1${newTableEnd}"`,
      );
      zip.file(name, tableXml);
    }
  }

  // 8. Drop calcChain.xml. The freshly cloned rows contain formula cells that
  //    the stored calc chain doesn't list, and a stale calc chain makes Excel
  //    show a "we recovered records" prompt on open. calcChain is only a
  //    recalculation-order cache — Excel rebuilds it automatically — so removing
  //    it (and its content-type / relationship references) is safe and silent.
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    const ct = zip.file('[Content_Types].xml');
    if (ct) {
      const ctXml = (await ct.async('string')).replace(
        /<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/g,
        '',
      );
      zip.file('[Content_Types].xml', ctXml);
    }
    const rels = zip.file('xl/_rels/workbook.xml.rels');
    if (rels) {
      const relsXml = (await rels.async('string')).replace(
        /<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/g,
        '',
      );
      zip.file('xl/_rels/workbook.xml.rels', relsXml);
    }
  }

  return sheetXml;
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

  let tableEndRow = await findTableEndRow(zip);

  // Target rows must lie within the table's reserved range so structured
  // references like Tablo1[[#This Row],…] stay valid. If the append would run
  // past the last reserved row, grow the table in place (adding a buffer so we
  // don't have to extend on every single append) rather than failing.
  const maxTarget = lastRefRow + rows.length;
  if (tableEndRow != null && maxTarget > tableEndRow) {
    const deficit = maxTarget - tableEndRow;
    const addCount = deficit + ROW_BUFFER;
    sheetXml = await extendMasterTable(zip, sheetXml, tableEndRow, addCount);
    tableEndRow += addCount;
  }

  const writeRows: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    writeRows.push(lastRefRow + 1 + i);
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
