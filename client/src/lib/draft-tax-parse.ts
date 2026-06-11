// Parses an ALO "Draft Tax File" Excel and groups its SKU-level rows into
// commercial invoice line items.
//
// Draft columns (header row is auto-detected): PO#, Order #, HTS Codes (US),
// Country of Origin, Item Number, Style, Color, Category, Fabric Content,
// Cost, Unit (= qty), Total Value, TR HS CODE (usually empty), ...
//
// Grouping rule (verified against TR00025 draft vs. its commercial invoice):
// one CI line per unique Style + Country of Origin + Cost combination, with
// quantities summed. Country of origin is NOT trimmed on purpose — the
// original files distinguish "CN" from "CN " and the CI mirrors that.

import * as XLSX from "xlsx";

export type InvoiceLineItem = {
  id: string;
  styleNo: string;
  styleDescription: string;
  htsCode: string; // TR HS code written to the CI's HTS CODE column
  composition: string;
  madeIn: string;
  qty: string;
  uom: string;
  currency: string;
  unitPrice: string;
  hsSource?: "draft" | "db" | "manual";
};

export type DraftParseResult = {
  lineItems: InvoiceLineItem[];
  poNumbers: string[];
  skuRowCount: number;
};

let idCounter = 0;
export function nextLineItemId(): string {
  idCounter += 1;
  return `li-${Date.now()}-${idCounter}`;
}

export function emptyLineItem(): InvoiceLineItem {
  return {
    id: nextLineItemId(),
    styleNo: "",
    styleDescription: "",
    htsCode: "",
    composition: "",
    madeIn: "",
    qty: "",
    uom: "PCS",
    currency: "USD",
    unitPrice: "",
    hsSource: "manual",
  };
}

function norm(h: unknown): string {
  return String(h ?? "").trim().toLowerCase();
}

export function parseDraftTaxFile(data: ArrayBuffer): DraftParseResult {
  const wb = XLSX.read(data, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws["!ref"]) {
    throw new Error("First sheet is empty");
  }
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];

  // Header row: first row (among the first 10) containing both a "style"
  // and a "cost" header. TR00025 has it on row 1, TR00023 on row 2.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] || []).map(norm);
    if (cells.includes("style") && cells.includes("cost")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      'Could not find the header row (expected columns "Style" and "Cost")',
    );
  }

  const headers = (rows[headerIdx] || []).map(norm);
  const col = {
    po: headers.findIndex((h) => h.startsWith("po")),
    style: headers.findIndex((h) => h === "style"),
    category: headers.findIndex((h) => h.includes("category")),
    fabric: headers.findIndex((h) => h.includes("fabric")),
    // exact match: TR00023 also has a "TRANSPORT COST USD" column
    cost: headers.findIndex((h) => h === "cost"),
    unit: headers.findIndex((h) => h === "unit"),
    origin: headers.findIndex((h) => h.includes("country")),
    trHs: headers.findIndex((h) => h.includes("tr hs")),
  };
  if (col.style === -1 || col.cost === -1 || col.unit === -1) {
    throw new Error('Missing required columns ("Style", "Cost", "Unit")');
  }

  type Group = {
    item: InvoiceLineItem;
    qty: number;
  };
  const groups = new Map<string, Group>();
  const poNumbers: string[] = [];
  let skuRowCount = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const style = String(row[col.style] ?? "").trim();
    const qty = Number(row[col.unit]);
    if (!style || !Number.isFinite(qty) || qty <= 0) continue;
    skuRowCount++;

    const po = col.po !== -1 ? String(row[col.po] ?? "").trim() : "";
    if (po && !poNumbers.includes(po)) poNumbers.push(po);

    const cost = Number(row[col.cost]);
    const madeIn = col.origin !== -1 ? String(row[col.origin] ?? "") : "";
    const key = [style, madeIn, cost].join("\x1F");

    const existing = groups.get(key);
    if (existing) {
      existing.qty += qty;
    } else {
      const trHs =
        col.trHs !== -1 ? String(row[col.trHs] ?? "").trim() : "";
      groups.set(key, {
        qty,
        item: {
          id: nextLineItemId(),
          styleNo: style,
          styleDescription:
            col.category !== -1 ? String(row[col.category] ?? "").trim() : "",
          htsCode: trHs,
          composition:
            col.fabric !== -1 ? String(row[col.fabric] ?? "").trim() : "",
          madeIn,
          qty: "0",
          uom: "PCS",
          currency: "USD",
          unitPrice: Number.isFinite(cost) ? String(cost) : "",
          hsSource: trHs ? "draft" : undefined,
        },
      });
    }
  }

  // Sort A→Z by style number; rows of the same style keep their draft order
  // (Array.prototype.sort is stable).
  const lineItems = Array.from(groups.values())
    .map((g) => ({
      ...g.item,
      qty: String(g.qty),
    }))
    .sort((a, b) =>
      a.styleNo < b.styleNo ? -1 : a.styleNo > b.styleNo ? 1 : 0,
    );

  return { lineItems, poNumbers, skuRowCount };
}
