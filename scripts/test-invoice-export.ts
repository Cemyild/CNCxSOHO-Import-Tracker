// End-to-end test of the commercial invoice export builder.
// Test 1: rebuild TR00025 from its own data and diff against the original.
// Test 2: rebuild TR00026 (72 items, 10 pallets) and verify row shifting.

import fs from "fs";
import XLSX from "xlsx";
import {
  buildCommercialInvoiceXlsx,
  type ExportPayload,
  type ExportLineItem,
  type ExportPallet,
} from "../server/invoice-maker-export";

const OUT_DIR = "test-output";
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

function readSheetCells(ws: XLSX.WorkSheet): Map<string, unknown> {
  const cells = new Map<string, unknown>();
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (cell && cell.v !== undefined) cells.set(addr, cell.v);
    }
  }
  return cells;
}

function diffSheets(
  label: string,
  orig: XLSX.WorkSheet,
  built: XLSX.WorkSheet,
  expectedDiffs: string[],
): number {
  const a = readSheetCells(orig);
  const b = readSheetCells(built);
  const keys = new Set([...a.keys(), ...b.keys()]);
  let unexpected = 0;
  for (const k of Array.from(keys).sort()) {
    const va = a.get(k);
    const vb = b.get(k);
    const same =
      typeof va === "number" && typeof vb === "number"
        ? Math.abs(va - vb) < 1e-9
        : String(va ?? "") === String(vb ?? "");
    if (!same) {
      const tag = expectedDiffs.includes(k) ? "(expected)" : "*** UNEXPECTED";
      if (!expectedDiffs.includes(k)) unexpected++;
      console.log(
        `  [${label}] ${k}: ${tag}\n     orig:  ${JSON.stringify(va)}\n     built: ${JSON.stringify(vb)}`,
      );
    }
  }
  return unexpected;
}

function ciToLineItems(ws: XLSX.WorkSheet): ExportLineItem[] {
  // read item rows between header (B19="Style No.") and "Grand Total"
  const items: ExportLineItem[] = [];
  for (let r = 20; r < 200; r++) {
    const b = ws[`B${r}`];
    if (!b || b.v === "Grand Total") break;
    items.push({
      styleNo: String(ws[`B${r}`]?.v ?? ""),
      styleDescription: String(ws[`C${r}`]?.v ?? ""),
      htsCode: String(ws[`D${r}`]?.v ?? ""),
      composition: String(ws[`E${r}`]?.v ?? ""),
      madeIn: String(ws[`F${r}`]?.v ?? ""),
      qty: Number(ws[`G${r}`]?.v ?? 0),
      uom: String(ws[`H${r}`]?.v ?? "PCS"),
      currency: String(ws[`I${r}`]?.v ?? "USD"),
      unitPrice: Number(ws[`J${r}`]?.v ?? 0),
    });
  }
  return items;
}

function plToPallets(ws: XLSX.WorkSheet, firstRow: number): ExportPallet[] {
  const pallets: ExportPallet[] = [];
  for (let r = firstRow; r < 200; r++) {
    const b = ws[`B${r}`];
    if (!b || String(b.v).startsWith("GRAND TOTAL")) break;
    pallets.push({
      dimension: String(b.v),
      qty: Number(ws[`C${r}`]?.v ?? 0),
      grossWt: Number(ws[`D${r}`]?.v ?? 0),
    });
  }
  return pallets;
}

function serialToIso(serial: number): string {
  const ms = (serial - 25569) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function test1() {
  console.log("\n========== TEST 1: TR00025 round-trip ==========");
  const orig = XLSX.read(
    fs.readFileSync("attached_assets/TR00025 Commercial Invoice.xlsx"),
    { type: "buffer" },
  );
  const inv = orig.Sheets["Invoice"];
  const pl = orig.Sheets["Packing List - Pallets"];

  const payload: ExportPayload = {
    shipperAddress: String(inv["B4"].v),
    importerAddress: String(inv["B10"].v),
    deliveryAddress: String(inv["E10"].v),
    invoiceNo: String(inv["E4"].v),
    invoiceDate: serialToIso(Number(inv["H4"].v)),
    invoiceReference: String(inv["E6"].v),
    poOrderNo: String(inv["E8"].v),
    portOfLoading: String(inv["B14"].v),
    finalDestination: String(inv["C14"].v),
    paymentTerm: String(inv["E14"].v),
    shipmentMode: String(inv["B16"].v),
    shipmentTerm: String(inv["C16"].v),
    whInvoiceRef: String(inv["E16"].v).replace(/^W\/H Invoice REF NO: /, ""),
    goodsDescription: String(inv["B18"].v),
    totalCartons: Number(inv["J32"].v),
    lineItems: ciToLineItems(inv),
    pallets: plToPallets(pl, 19),
  };

  const buffer = await buildCommercialInvoiceXlsx(payload);
  fs.writeFileSync(`${OUT_DIR}/TR00025-rebuilt.xlsx`, buffer);

  const rebuilt = XLSX.read(buffer, { type: "buffer", cellFormula: true });
  console.log("Sheets:", rebuilt.SheetNames.join(", "));

  // Known intentional diffs: J30 (real pallet sum vs hand-rounded 174),
  // J31 (real CBM vs hand-typed 364/167), and the PL mirrors H29/H30.
  const u1 = diffSheets(
    "Invoice",
    inv,
    rebuilt.Sheets["Invoice"],
    ["J30", "J31"],
  );
  const u2 = diffSheets(
    "PackingList",
    pl,
    rebuilt.Sheets["Packing List - Pallets"],
    ["H29", "H30"],
  );

  // Formula spot checks
  const k20 = rebuilt.Sheets["Invoice"]["K20"];
  const g25 = rebuilt.Sheets["Invoice"]["G25"];
  console.log("K20 formula:", k20?.f, "| value:", k20?.v);
  console.log("G25 formula:", g25?.f, "| value:", g25?.v);
  console.log(
    "PL H29 formula:",
    rebuilt.Sheets["Packing List - Pallets"]["H29"]?.f,
  );

  console.log(
    u1 + u2 === 0
      ? "TEST 1 PASS (no unexpected diffs)"
      : `TEST 1 FAIL: ${u1 + u2} unexpected diffs`,
  );
  return u1 + u2 === 0;
}

async function test2() {
  console.log("\n========== TEST 2: TR00026 scale (72 items, 10 pallets) ==========");
  const orig = XLSX.read(fs.readFileSync("attached_assets/TR00026 CI PL.xlsx"), {
    type: "buffer",
  });
  const inv = orig.Sheets["Invoice"];
  const pl = orig.Sheets["Packing List - Pallets"];

  const payload: ExportPayload = {
    shipperAddress: String(inv["B4"].v),
    importerAddress: String(inv["B10"].v),
    deliveryAddress: String(inv["E10"].v),
    invoiceNo: String(inv["E4"].v),
    invoiceDate: serialToIso(Number(inv["H4"].v)),
    invoiceReference: String(inv["E6"].v),
    poOrderNo: String(inv["E8"]?.v ?? ""),
    portOfLoading: String(inv["B14"].v),
    finalDestination: String(inv["C14"].v),
    paymentTerm: String(inv["E14"].v),
    shipmentMode: String(inv["B16"].v),
    shipmentTerm: String(inv["C16"].v),
    whInvoiceRef: "30974860, 30667791, 30972768",
    goodsDescription: String(inv["B18"].v),
    totalCartons: 13,
    lineItems: ciToLineItems(inv),
    pallets: plToPallets(pl, 19),
  };
  console.log(
    `items: ${payload.lineItems.length}, pallets: ${payload.pallets.length}`,
  );

  const buffer = await buildCommercialInvoiceXlsx(payload);
  fs.writeFileSync(`${OUT_DIR}/TR00026-rebuilt.xlsx`, buffer);

  const rb = XLSX.read(buffer, { type: "buffer", cellFormula: true });
  const rInv = rb.Sheets["Invoice"];
  const rPl = rb.Sheets["Packing List - Pallets"];

  const n = payload.lineItems.length; // 72
  const gtRow = 19 + n + 1; // 92
  const checks: [string, unknown, unknown][] = [
    ["Invoice GT label", rInv[`B${gtRow}`]?.v, "Grand Total"],
    ["Invoice GT qty formula", rInv[`G${gtRow}`]?.f, `SUM(G20:G${19 + n})`],
    ["Invoice GT qty", rInv[`G${gtRow}`]?.v, 7628],
    [
      "Invoice cert row",
      rInv[`B${gtRow + 2}`]?.v,
      "I/We hereby certify that the information on this invoice is true and correct and that the contents of this shipment are as stated above.",
    ],
    ["Invoice gross wt", rInv[`J${gtRow + 5}`]?.v, 2996],
    ["Invoice cartons", rInv[`J${gtRow + 7}`]?.v, 13],
    ["Invoice pallets", rInv[`J${gtRow + 8}`]?.v, 15],
    [
      "Invoice signature",
      rInv[`B${gtRow + 13}`]?.v,
      "Signed by …………………….(Affix Company Stamp here)",
    ],
    ["Invoice !ref", rInv["!ref"], `B1:K${39 + (n - 5)}`],
  ];

  const m = payload.pallets.length; // 10
  const plGt = 19 + m; // 29
  checks.push(
    ["PL GT label", rPl[`B${plGt}`]?.v, "GRAND TOTAL"],
    ["PL GT count formula", rPl[`C${plGt}`]?.f, `SUM(C19:C${18 + m})`],
    ["PL GT count", rPl[`C${plGt}`]?.v, 15],
    ["PL GT weight", rPl[`D${plGt}`]?.v, 2996],
    [
      "PL H29-shifted formula",
      rPl[`H${29 + (m - 2)}`]?.f,
      `Invoice!J${30 + (n - 5)}`,
    ],
    ["PL !ref", rPl["!ref"], `B1:J${35 + (m - 2)}`],
  );

  let fail = 0;
  for (const [name, got, want] of checks) {
    const ok =
      typeof got === "number" && typeof want === "number"
        ? Math.abs(got - want) < 1e-9
        : String(got) === String(want);
    if (!ok) fail++;
    console.log(`  ${ok ? "OK " : "FAIL"} ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  }

  // merges sanity
  const merges = (rPl["!merges"] || []).map((mm: XLSX.Range) =>
    XLSX.utils.encode_range(mm),
  );
  const palletMergesOk = Array.from({ length: m }, (_, i) => `E${19 + i}:G${19 + i}`)
    .every((ref) => merges.includes(ref));
  console.log(`  ${palletMergesOk ? "OK " : "FAIL"} PL pallet E:G merges present`);
  if (!palletMergesOk) fail++;

  console.log(fail === 0 ? "TEST 2 PASS" : `TEST 2 FAIL: ${fail} checks failed`);
  return fail === 0;
}

(async () => {
  const ok1 = await test1();
  const ok2 = await test2();
  process.exit(ok1 && ok2 ? 0 : 1);
})();
