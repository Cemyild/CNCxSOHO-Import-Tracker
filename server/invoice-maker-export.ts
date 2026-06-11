// Builds a Commercial Invoice + Packing List xlsx from the template at
// server/templates/ci-pl-template.xlsx (a verbatim copy of a real ALO
// invoice).
//
// The workbook is edited at the sheet-XML level via JSZip — exceljs
// load+writeBuffer corrupts these supplier files (learned the hard way),
// so we never round-trip the whole workbook through a library.
//
// Template geometry (rows are 1-based):
//   Invoice sheet (sheet1.xml):  header row 19, item rows 20-24 (5),
//     grand total 25, certification 27, summary J30-J33, signature 38.
//   Packing List (sheet2.xml):   header row 18, pallet rows 19-20 (2),
//     grand total 21, certification 23, summary H29-H32 (formulas into
//     the Invoice sheet), signature 35.
// Inserting/removing item rows shifts everything below; merges, formulas,
// cross-sheet references and the <dimension> are updated accordingly.

import JSZip from "jszip";
import fs from "fs";
import path from "path";

export type ExportLineItem = {
  styleNo: string;
  styleDescription: string;
  htsCode: string;
  composition: string;
  madeIn: string;
  qty: number;
  uom: string;
  currency: string;
  unitPrice: number;
};

export type ExportPallet = {
  dimension: string;
  qty: number;
  grossWt: number;
};

export type ExportPayload = {
  shipperId?: string; // picks the signature/stamp images, e.g. "alo-llc"
  shipperAddress: string;
  importerAddress: string;
  deliveryAddress: string;
  invoiceNo: string;
  invoiceDate: string | null; // "yyyy-mm-dd"
  invoiceReference: string;
  poOrderNo: string;
  portOfLoading: string;
  finalDestination: string;
  paymentTerm: string;
  shipmentMode: string;
  shipmentTerm: string;
  whInvoiceRef: string;
  goodsDescription: string;
  totalCartons: number | null;
  lineItems: ExportLineItem[];
  pallets: ExportPallet[];
};

const TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "server/templates/ci-pl-template.xlsx",
);

// Per-shipper signature images live here as <shipperId>-stamp.png and
// <shipperId>-signature.png. Missing files simply mean "no image embedded",
// so e.g. ALO Hong Kong exports stay unsigned until its images are provided.
const SIGNATURES_DIR = path.resolve(
  process.cwd(),
  "server/templates/signatures",
);

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;"); // literal CR would be normalized away by XML parsers
}

function inlineStrCell(ref: string, sAttr: string, text: string): string {
  if (!text) return `<c r="${ref}"${sAttr}/>`;
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escXml(text)}</t></is></c>`;
}

function numCell(ref: string, sAttr: string, n: number | null): string {
  if (n === null || !Number.isFinite(n)) return `<c r="${ref}"${sAttr}/>`;
  return `<c r="${ref}"${sAttr}><v>${n}</v></c>`;
}

function formulaCell(
  ref: string,
  sAttr: string,
  formula: string,
  cached: number,
): string {
  return `<c r="${ref}"${sAttr}><f>${formula}</f><v>${cached}</v></c>`;
}

// Replace the cell `ref` in the sheet XML, preserving its style attribute.
function setCell(
  xml: string,
  ref: string,
  build: (sAttr: string) => string,
): string {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`Template cell ${ref} not found`);
  const sMatch = m[1].match(/ s="(\d+)"/);
  const sAttr = sMatch ? ` s="${sMatch[1]}"` : "";
  return xml.replace(re, build(sAttr).replace(/\$/g, "$$$$"));
}

const setInline = (xml: string, ref: string, text: string) =>
  setCell(xml, ref, (s) => inlineStrCell(ref, s, text));
const setNum = (xml: string, ref: string, n: number | null) =>
  setCell(xml, ref, (s) => numCell(ref, s, n));
const setFormula = (xml: string, ref: string, f: string, cached: number) =>
  setCell(xml, ref, (s) => formulaCell(ref, s, f, cached));

// Extract per-column style ids of an existing row, e.g. { B: "64", C: "43" }.
function rowStyles(xml: string, rowNum: number): Record<string, string> {
  const m = xml.match(new RegExp(`<row r="${rowNum}"[^>]*>([\\s\\S]*?)</row>`));
  if (!m) throw new Error(`Template row ${rowNum} not found`);
  const styles: Record<string, string> = {};
  for (const cm of m[1].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*? s="(\d+)")?/g)) {
    styles[cm[1]] = cm[2] ?? "";
  }
  return styles;
}

function rowAttrs(xml: string, rowNum: number): string {
  const m = xml.match(new RegExp(`<row r="${rowNum}"([^>]*)>`));
  if (!m) throw new Error(`Template row ${rowNum} not found`);
  return m[1];
}

const sA = (styles: Record<string, string>, col: string) =>
  styles[col] !== undefined && styles[col] !== ""
    ? ` s="${styles[col]}"`
    : "";

// Shift every row reference >= fromRow by delta: <row r=>, <c r=> and merges.
function shiftRows(xml: string, fromRow: number, delta: number): string {
  if (delta === 0) return xml;
  xml = xml.replace(/<row r="(\d+)"/g, (m, r) => {
    const n = Number(r);
    return n >= fromRow ? `<row r="${n + delta}"` : m;
  });
  xml = xml.replace(/<c r="([A-Z]+)(\d+)"/g, (m, col, r) => {
    const n = Number(r);
    return n >= fromRow ? `<c r="${col}${n + delta}"` : m;
  });
  xml = xml.replace(
    /<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g,
    (m, c1, r1, c2, r2) => {
      const n1 = Number(r1) >= fromRow ? Number(r1) + delta : Number(r1);
      const n2 = Number(r2) >= fromRow ? Number(r2) + delta : Number(r2);
      return `<mergeCell ref="${c1}${n1}:${c2}${n2}"/>`;
    },
  );
  return xml;
}

function setDimension(xml: string, lastCol: string, lastRow: number): string {
  return xml.replace(
    /<dimension ref="[^"]*"\/>/,
    `<dimension ref="B1:${lastCol}${lastRow}"/>`,
  );
}

function refreshMergeCount(xml: string): string {
  const count = (xml.match(/<mergeCell /g) || []).length;
  return xml.replace(/<mergeCells count="\d+">/, `<mergeCells count="${count}">`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function excelDateSerial(iso: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round(ms / 86_400_000) + 25_569;
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

const INV = {
  firstItemRow: 20,
  templateItemCount: 5,
  grandTotalRow: 25, // = insertion point for shifting
  summaryRows: { grossWeight: 30, cbm: 31, cartons: 32, pallets: 33 },
};

const PL = {
  firstPalletRow: 19,
  templatePalletCount: 2,
  grandTotalRow: 21,
  summaryRows: { grossWeight: 29, cbm: 30, cartons: 31, pallets: 32 },
};

function buildInvoiceSheet(xml: string, p: ExportPayload): string {
  const n = p.lineItems.length;
  const delta = n - INV.templateItemCount;
  const lastItemRow = INV.firstItemRow + n - 1;

  const grossWeight = round2(p.pallets.reduce((a, x) => a + x.grossWt, 0));
  const totalPallets = p.pallets.reduce((a, x) => a + x.qty, 0);
  const cbm = round2(computeCbm(p.pallets));

  // --- 1. header block (fixed rows, original coordinates)
  xml = setInline(xml, "B4", p.shipperAddress);
  const invNoNum = Number(p.invoiceNo);
  xml =
    p.invoiceNo.trim() !== "" && Number.isFinite(invNoNum)
      ? setNum(xml, "E4", invNoNum)
      : setInline(xml, "E4", p.invoiceNo.trim());
  const dateSerial = p.invoiceDate ? excelDateSerial(p.invoiceDate) : null;
  xml = setNum(xml, "H4", dateSerial);
  xml = setInline(xml, "E6", p.invoiceReference);
  xml = setInline(xml, "E8", p.poOrderNo);
  xml = setInline(xml, "B10", p.importerAddress);
  xml = setInline(xml, "E10", p.deliveryAddress);
  xml = setInline(xml, "B14", p.portOfLoading);
  xml = setInline(xml, "C14", p.finalDestination);
  xml = setInline(xml, "E14", p.paymentTerm);
  xml = setInline(xml, "B16", p.shipmentMode);
  xml = setInline(xml, "C16", p.shipmentTerm);
  xml = setInline(
    xml,
    "E16",
    p.whInvoiceRef.trim() ? `W/H Invoice REF NO: ${p.whInvoiceRef.trim()}` : "",
  );
  xml = setInline(xml, "B18", p.goodsDescription);

  // --- 2. grand total + summary (original coordinates; shifted later)
  const totalQty = p.lineItems.reduce((a, li) => a + li.qty, 0);
  const totalAmount = round2(
    p.lineItems.reduce((a, li) => a + li.qty * li.unitPrice, 0),
  );
  xml = setFormula(
    xml,
    "G25",
    `SUM(G${INV.firstItemRow}:G${lastItemRow})`,
    totalQty,
  );
  xml = setFormula(
    xml,
    "K25",
    `SUM(K${INV.firstItemRow}:K${lastItemRow})`,
    totalAmount,
  );
  xml = setNum(xml, "J30", grossWeight || null);
  xml = setNum(xml, "J31", cbm || null); // replaces the template's hand-typed fraction formula
  xml = setNum(xml, "J32", p.totalCartons);
  xml = setNum(xml, "J33", totalPallets || null);

  // --- 3. shift everything below the item block while it still has 5 rows
  xml = shiftRows(xml, INV.grandTotalRow, delta);

  // --- 4. rebuild the item block
  const midStyles = rowStyles(xml, INV.firstItemRow); // row 20: normal item row
  const lastStyles = rowStyles(xml, INV.firstItemRow + 4); // row 24: thick bottom border
  const midAttrs = rowAttrs(xml, INV.firstItemRow);
  const lastAttrs = rowAttrs(xml, INV.firstItemRow + 4);

  const itemRowXml = (rowNum: number, li: ExportLineItem, isLast: boolean) => {
    const st = isLast ? lastStyles : midStyles;
    const attrs = isLast ? lastAttrs : midAttrs;
    const amount = round2(li.qty * li.unitPrice);
    return (
      `<row r="${rowNum}"${attrs}>` +
      inlineStrCell(`B${rowNum}`, sA(st, "B"), li.styleNo) +
      inlineStrCell(`C${rowNum}`, sA(st, "C"), li.styleDescription) +
      inlineStrCell(`D${rowNum}`, sA(st, "D"), li.htsCode) +
      inlineStrCell(`E${rowNum}`, sA(st, "E"), li.composition) +
      inlineStrCell(`F${rowNum}`, sA(st, "F"), li.madeIn) +
      numCell(`G${rowNum}`, sA(st, "G"), li.qty) +
      inlineStrCell(`H${rowNum}`, sA(st, "H"), li.uom) +
      inlineStrCell(`I${rowNum}`, sA(st, "I"), li.currency) +
      numCell(`J${rowNum}`, sA(st, "J"), li.unitPrice) +
      formulaCell(
        `K${rowNum}`,
        sA(st, "K"),
        `G${rowNum}*J${rowNum}`,
        amount,
      ) +
      `</row>`
    );
  };

  const newBlock = p.lineItems
    .map((li, i) =>
      itemRowXml(INV.firstItemRow + i, li, i === p.lineItems.length - 1),
    )
    .join("");

  const blockRe = new RegExp(
    `<row r="${INV.firstItemRow}"[\\s\\S]*?<row r="${INV.firstItemRow + 4}"[^>]*>[\\s\\S]*?</row>`,
  );
  if (!blockRe.test(xml)) throw new Error("Invoice item block not found");
  xml = xml.replace(blockRe, newBlock.replace(/\$/g, "$$$$"));

  // --- 5. dimension
  xml = setDimension(xml, "K", 39 + delta);
  return xml;
}

function buildPackingListSheet(
  xml: string,
  p: ExportPayload,
  invDelta: number,
): string {
  const m = p.pallets.length;
  const delta = m - PL.templatePalletCount;
  const lastPalletRow = PL.firstPalletRow + m - 1;

  // --- 1. header block (static copies of the invoice values)
  xml = setInline(xml, "B4", p.shipperAddress);
  xml = setInline(xml, "B8", p.importerAddress);
  xml = setInline(xml, "E8", p.deliveryAddress);
  xml = setInline(xml, "B13", p.portOfLoading);
  xml = setInline(xml, "C13", p.finalDestination);
  xml = setInline(xml, "B15", p.shipmentMode);
  xml = setInline(xml, "C15", p.shipmentTerm);
  // E4 / E6 / H4 / B17 keep their cross-sheet formulas (=Invoice!...) since
  // the invoice header rows never move.

  // --- 2. grand total + the right-hand summary formulas
  const totalPallets = p.pallets.reduce((a, x) => a + x.qty, 0);
  const totalWeight = round2(p.pallets.reduce((a, x) => a + x.grossWt, 0));
  xml = setFormula(
    xml,
    "C21",
    `SUM(C${PL.firstPalletRow}:C${lastPalletRow})`,
    totalPallets,
  );
  xml = setFormula(
    xml,
    "D21",
    `SUM(D${PL.firstPalletRow}:D${lastPalletRow})`,
    totalWeight,
  );

  const inv = INV.summaryRows;
  const grossWeight = round2(p.pallets.reduce((a, x) => a + x.grossWt, 0));
  const cbm = round2(computeCbm(p.pallets));
  xml = setFormula(xml, "H29", `Invoice!J${inv.grossWeight + invDelta}`, grossWeight);
  xml = setFormula(xml, "H30", `Invoice!J${inv.cbm + invDelta}`, cbm);
  xml = setFormula(xml, "H31", `Invoice!J${inv.cartons + invDelta}`, p.totalCartons ?? 0);
  xml = setFormula(xml, "H32", `Invoice!J${inv.pallets + invDelta}`, totalPallets);

  // --- 3. shift rows below the pallet block
  xml = shiftRows(xml, PL.grandTotalRow, delta);

  // --- 4. rebuild the pallet block
  const firstStyles = rowStyles(xml, PL.firstPalletRow); // row 19
  const midStyles = rowStyles(xml, PL.firstPalletRow + 1); // row 20
  const firstAttrs = rowAttrs(xml, PL.firstPalletRow);
  const midAttrs = rowAttrs(xml, PL.firstPalletRow + 1);

  const palletRowXml = (rowNum: number, pal: ExportPallet, isFirst: boolean) => {
    const st = isFirst ? firstStyles : midStyles;
    const attrs = isFirst ? firstAttrs : midAttrs;
    return (
      `<row r="${rowNum}"${attrs}>` +
      inlineStrCell(`B${rowNum}`, sA(st, "B"), pal.dimension) +
      numCell(`C${rowNum}`, sA(st, "C"), pal.qty) +
      numCell(`D${rowNum}`, sA(st, "D"), pal.grossWt) +
      `<c r="E${rowNum}"${sA(st, "E")}/>` +
      `<c r="F${rowNum}"${sA(st, "F")}/>` +
      `<c r="G${rowNum}"${sA(st, "G")}/>` +
      `<c r="H${rowNum}"${sA(st, "H")}/>` +
      `<c r="I${rowNum}"${sA(st, "I")}/>` +
      `<c r="J${rowNum}"${sA(st, "J")}/>` +
      `</row>`
    );
  };

  const newBlock = p.pallets
    .map((pal, i) => palletRowXml(PL.firstPalletRow + i, pal, i === 0))
    .join("");
  const blockRe = new RegExp(
    `<row r="${PL.firstPalletRow}"[\\s\\S]*?<row r="${PL.firstPalletRow + 1}"[^>]*>[\\s\\S]*?</row>`,
  );
  if (!blockRe.test(xml)) throw new Error("Packing list pallet block not found");
  xml = xml.replace(blockRe, newBlock.replace(/\$/g, "$$$$"));

  // --- 5. rebuild the E:G merges of the pallet block.
  // The template merges E19:G19 and E20:G20; row 20's merge no longer exists
  // when m == 1 and additional rows need their own merges when m > 2.
  xml = xml.replace(/<mergeCell ref="E(?:19|20):G(?:19|20)"\/>/g, "");
  const palletMerges = Array.from(
    { length: m },
    (_, i) =>
      `<mergeCell ref="E${PL.firstPalletRow + i}:G${PL.firstPalletRow + i}"/>`,
  ).join("");
  xml = xml.replace(/<mergeCells count="\d+">/, (mm) => mm + palletMerges);
  xml = refreshMergeCount(xml);

  // --- 6. dimension
  xml = setDimension(xml, "J", 35 + delta);
  return xml;
}

function computeCbm(pallets: ExportPallet[]): number {
  // dimension strings look like "106.68x121.92x114.3" (cm); CBM = L*W*H*qty / 1e6
  let total = 0;
  for (const p of pallets) {
    const parts = p.dimension.split(/x/i).map((s) => Number(s.trim()));
    if (parts.length === 3 && parts.every((v) => Number.isFinite(v) && v > 0)) {
      total += (parts[0] * parts[1] * parts[2] * p.qty) / 1_000_000;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Signature / stamp images
// ---------------------------------------------------------------------------

type AnchorSpec = {
  col: number; // 0-based
  row: number; // 0-based
  cx: number; // EMU
  cy: number; // EMU
};

function oneCellAnchor(spec: AnchorSpec, picId: number, relId: string): string {
  return (
    `<xdr:oneCellAnchor>` +
    `<xdr:from><xdr:col>${spec.col}</xdr:col><xdr:colOff>0</xdr:colOff>` +
    `<xdr:row>${spec.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${spec.cx}" cy="${spec.cy}"/>` +
    `<xdr:pic><xdr:nvPicPr>` +
    `<xdr:cNvPr id="${picId}" name="Signature ${picId}"/>` +
    `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>` +
    `</xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${spec.cx}" cy="${spec.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    `</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
  );
}

function drawingXml(anchors: string[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"` +
    ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    anchors.join("") +
    `</xdr:wsDr>`
  );
}

const CM = 360_000; // EMU per centimeter

// Width/height of a PNG from its IHDR chunk (bytes 16-23).
function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w > 0 && h > 0 ? { w, h } : null;
}

// Fixed target width in cm, height follows the image's aspect ratio.
function imageEmuSize(
  buf: Buffer,
  targetWidthCm: number,
): { cx: number; cy: number } {
  const cx = Math.round(targetWidthCm * CM);
  const dim = pngSize(buf);
  const ratio = dim ? dim.h / dim.w : 0.5;
  return { cx, cy: Math.round(cx * ratio) };
}

const SIGNATURE_WIDTH_CM = 6.5;
const STAMP_WIDTH_CM = 4.0;

// Signatures are embedded the way the user's hand-tuned reference file does
// it: on the Invoice sheet the images live INSIDE cells (Excel "Place in
// Cell" — rich value / _localImage), on the Packing List they stay as
// floating pictures above the "Signed by ..." line.
//
// In-cell cells (template coordinates, shifted by the item-row delta):
//   E29 → company stamp, C30 → authorized signature.
async function embedSignatures(
  zip: JSZip,
  shipperId: string,
  invDelta: number,
  plDelta: number,
): Promise<void> {
  const readImg = (name: string): Buffer | null => {
    const p = path.join(SIGNATURES_DIR, name);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  };
  const signature = readImg(`${shipperId}-signature.png`);
  const stamp = readImg(`${shipperId}-stamp.png`);
  if (!signature && !stamp) return;

  // In-cell order defines all rich-value indexes: vm="i+1" → rv[i] → rel[i].
  const inCell: { buf: Buffer; col: string; templateRow: number }[] = [];
  if (stamp) inCell.push({ buf: stamp, col: "E", templateRow: 29 });
  if (signature) inCell.push({ buf: signature, col: "C", templateRow: 30 });

  // --- media (shared by the in-cell values and the PL floating pictures)
  inCell.forEach((item, i) => {
    zip.file(`xl/media/image${i + 1}.png`, item.buf);
  });
  const mediaTarget = (buf: Buffer) =>
    `../media/image${inCell.findIndex((x) => x.buf === buf) + 1}.png`;

  // --- Invoice sheet: rich-value plumbing ---------------------------------
  zip.file(
    "xl/richData/richValueRel.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      inCell.map((_, i) => `<rel r:id="rIdRv${i + 1}"/>`).join("") +
      `</richValueRels>`,
  );
  zip.file(
    "xl/richData/_rels/richValueRel.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      inCell
        .map(
          (item, i) =>
            `<Relationship Id="rIdRv${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaTarget(item.buf)}"/>`,
        )
        .join("") +
      `</Relationships>`,
  );
  zip.file(
    "xl/richData/rdrichvalue.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="${inCell.length}">` +
      inCell.map((_, i) => `<rv s="0"><v>${i}</v><v>5</v></rv>`).join("") +
      `</rvData>`,
  );
  zip.file(
    "xl/richData/rdrichvaluestructure.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1">` +
      `<s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s>` +
      `</rvStructures>`,
  );
  zip.file(
    "xl/richData/rdRichValueTypes.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<rvTypesInfo xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<global><keyFlags><key name="_Self"><flag name="ExcludeFromFile" value="1"/><flag name="ExcludeFromCalcComparison" value="1"/></key></keyFlags></global>` +
      `</rvTypesInfo>`,
  );
  zip.file(
    "xl/metadata.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata">` +
      `<metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes>` +
      `<futureMetadata name="XLRICHVALUE" count="${inCell.length}">` +
      inCell
        .map(
          (_, i) =>
            `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${i}"/></ext></extLst></bk>`,
        )
        .join("") +
      `</futureMetadata>` +
      `<valueMetadata count="${inCell.length}">` +
      inCell.map((_, i) => `<bk><rc t="1" v="${i}"/></bk>`).join("") +
      `</valueMetadata></metadata>`,
  );

  // point the in-cell cells at their rich values
  let sheet1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  inCell.forEach((item, i) => {
    const ref = `${item.col}${item.templateRow + invDelta}`;
    sheet1 = setCell(
      sheet1,
      ref,
      (sAttr) => `<c r="${ref}"${sAttr} t="e" vm="${i + 1}"><v>#VALUE!</v></c>`,
    );
  });
  zip.file("xl/worksheets/sheet1.xml", sheet1);

  // workbook-level wiring for the metadata part
  let wbRels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  if (!/metadata\.xml/.test(wbRels)) {
    wbRels = wbRels.replace(
      "</Relationships>",
      `<Relationship Id="rIdInvMkMeta" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>`,
    );
    zip.file("xl/_rels/workbook.xml.rels", wbRels);
  }

  // --- Packing List: floating pictures, as in the reference file ----------
  const plAnchors: string[] = [];
  if (signature) {
    const size = imageEmuSize(signature, SIGNATURE_WIDTH_CM);
    plAnchors.push(
      oneCellAnchor(
        { col: 1, row: 29 + plDelta, ...size },
        1,
        `rIdPl${mediaTarget(signature).match(/image(\d+)/)![1]}`,
      ),
    );
  }
  if (stamp) {
    const size = imageEmuSize(stamp, STAMP_WIDTH_CM);
    plAnchors.push(
      oneCellAnchor(
        { col: 3, row: 28 + plDelta, ...size },
        2,
        `rIdPl${mediaTarget(stamp).match(/image(\d+)/)![1]}`,
      ),
    );
  }
  zip.file("xl/drawings/drawing1.xml", drawingXml(plAnchors));
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      inCell
        .map(
          (item, i) =>
            `<Relationship Id="rIdPl${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.png"/>`,
        )
        .join("") +
      `</Relationships>`,
  );

  let sheet2 = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  sheet2 = sheet2.replace(
    "</worksheet>",
    `<drawing r:id="rId99"/></worksheet>`,
  );
  zip.file("xl/worksheets/sheet2.xml", sheet2);
  let s2Rels = await zip
    .file("xl/worksheets/_rels/sheet2.xml.rels")!
    .async("string");
  s2Rels = s2Rels.replace(
    "</Relationships>",
    `<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
  );
  zip.file("xl/worksheets/_rels/sheet2.xml.rels", s2Rels);

  // --- content types -------------------------------------------------------
  let ct = await zip.file("[Content_Types].xml")!.async("string");
  if (!/Extension="png"/.test(ct)) {
    ct = ct.replace(
      /(<Types[^>]*>)/,
      `$1<Default Extension="png" ContentType="image/png"/>`,
    );
  }
  ct = ct.replace(
    "</Types>",
    `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
      `<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>` +
      `<Override PartName="/xl/richData/richValueRel.xml" ContentType="application/vnd.ms-excel.richvaluerel+xml"/>` +
      `<Override PartName="/xl/richData/rdrichvalue.xml" ContentType="application/vnd.ms-excel.rdrichvalue+xml"/>` +
      `<Override PartName="/xl/richData/rdrichvaluestructure.xml" ContentType="application/vnd.ms-excel.rdrichvaluestructure+xml"/>` +
      `<Override PartName="/xl/richData/rdRichValueTypes.xml" ContentType="application/vnd.ms-excel.rdrichvaluetypes+xml"/></Types>`,
  );
  zip.file("[Content_Types].xml", ct);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function buildCommercialInvoiceXlsx(
  payload: ExportPayload,
): Promise<Buffer> {
  if (payload.lineItems.length === 0) {
    throw new Error("At least one line item is required");
  }
  if (payload.pallets.length === 0) {
    throw new Error("At least one pallet row is required");
  }

  const template = fs.readFileSync(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(template);

  const invDelta = payload.lineItems.length - INV.templateItemCount;

  let sheet1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  sheet1 = buildInvoiceSheet(sheet1, payload);
  zip.file("xl/worksheets/sheet1.xml", sheet1);

  let sheet2 = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  sheet2 = buildPackingListSheet(sheet2, payload, invDelta);
  zip.file("xl/worksheets/sheet2.xml", sheet2);

  if (payload.shipperId) {
    const plDelta = payload.pallets.length - PL.templatePalletCount;
    await embedSignatures(zip, payload.shipperId, invDelta, plDelta);
  }

  // Formulas changed → drop the stale calc chain and force a recalc on open.
  zip.remove("xl/calcChain.xml");
  let contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  contentTypes = contentTypes.replace(
    /<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/,
    "",
  );
  zip.file("[Content_Types].xml", contentTypes);
  let workbook = await zip.file("xl/workbook.xml")!.async("string");
  if (/<calcPr/.test(workbook)) {
    workbook = workbook.replace(
      /<calcPr([^>]*?)\/>/,
      (m, attrs) =>
        `<calcPr${attrs.replace(/ fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`,
    );
  } else {
    workbook = workbook.replace(
      "</sheets>",
      `</sheets><calcPr fullCalcOnLoad="1"/>`,
    );
  }
  zip.file("xl/workbook.xml", workbook);
  let wbRels = await zip
    .file("xl/_rels/workbook.xml.rels")!
    .async("string");
  wbRels = wbRels.replace(/<Relationship [^>]*calcChain\.xml[^>]*\/>/, "");
  zip.file("xl/_rels/workbook.xml.rels", wbRels);

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  }) as Promise<Buffer>;
}
