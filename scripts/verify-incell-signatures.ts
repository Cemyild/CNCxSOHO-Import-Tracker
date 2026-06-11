// Verifies the in-cell signature embedding against the user's reference
// layout: stamp in E29+delta, signature in C30+delta (vm cells), richData
// parts present, PL keeps floating pictures, and both parsers still open it.

import fs from "fs";
import crypto from "crypto";
import JSZip from "jszip";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import {
  buildCommercialInvoiceXlsx,
  type ExportPayload,
} from "../server/invoice-maker-export";

const md5 = (b: Buffer) => crypto.createHash("md5").update(b).digest("hex");

function makePayload(n: number): ExportPayload {
  return {
    shipperId: "alo-llc",
    shipperAddress: "ALO, LLC",
    importerAddress: "S",
    deliveryAddress: "U",
    invoiceNo: `INCELL${n}`,
    invoiceDate: "2026-06-11",
    invoiceReference: "",
    poOrderNo: "",
    portOfLoading: "LA",
    finalDestination: "IST",
    paymentTerm: "AT 30 DAYS",
    shipmentMode: "AIR",
    shipmentTerm: "EX-WORKS",
    whInvoiceRef: "",
    goodsDescription: "FOOTWEAR",
    totalCartons: 1,
    lineItems: Array.from({ length: n }, (_, i) => ({
      styleNo: `S${i}`,
      styleDescription: "d",
      htsCode: "1",
      composition: "c",
      madeIn: "CN",
      qty: 1,
      uom: "PCS",
      currency: "USD",
      unitPrice: 1,
    })),
    pallets: [{ dimension: "100x100x100", qty: 1, grossWt: 10 }],
  };
}

async function check(n: number) {
  console.log(`\n--- ${n} item(s), invDelta=${n - 5} ---`);
  const buf = await buildCommercialInvoiceXlsx(makePayload(n));
  fs.writeFileSync(`test-output/incell-${n}.xlsx`, buf);
  const zip = await JSZip.loadAsync(buf);
  const s1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");

  const stampRef = `E${29 + (n - 5)}`;
  const sigRef = `C${30 + (n - 5)}`;
  const stampCell = s1.match(new RegExp(`<c r="${stampRef}"[^>]*>`));
  const sigCell = s1.match(new RegExp(`<c r="${sigRef}"[^>]*>`));

  const results: [string, boolean][] = [
    [`stamp cell ${stampRef} has vm="1"`, !!stampCell && /vm="1"/.test(stampCell[0])],
    [`signature cell ${sigRef} has vm="2"`, !!sigCell && /vm="2"/.test(sigCell[0])],
    ["sheet1 has NO floating drawing", !/<drawing /.test(s1)],
    ["metadata.xml present", !!zip.file("xl/metadata.xml")],
    ["richValueRel.xml present", !!zip.file("xl/richData/richValueRel.xml")],
    ["rdrichvalue.xml present", !!zip.file("xl/richData/rdrichvalue.xml")],
  ];

  // media bytes must equal the on-disk PNGs (image1=stamp, image2=signature)
  const stampDisk = fs.readFileSync("server/templates/signatures/alo-llc-stamp.png");
  const sigDisk = fs.readFileSync("server/templates/signatures/alo-llc-signature.png");
  const img1 = await zip.file("xl/media/image1.png")!.async("nodebuffer");
  const img2 = await zip.file("xl/media/image2.png")!.async("nodebuffer");
  results.push(["image1 = stamp bytes", md5(img1) === md5(stampDisk)]);
  results.push(["image2 = signature bytes", md5(img2) === md5(sigDisk)]);

  const s2 = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  results.push(["sheet2 still has floating drawing", /<drawing r:id="rId99"\/>/.test(s2)]);
  results.push(["drawing1.xml (PL) present", !!zip.file("xl/drawings/drawing1.xml")]);

  const wbRels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  results.push(["workbook rels has sheetMetadata", /sheetMetadata/.test(wbRels)]);

  // parsers
  const wb = XLSX.read(buf, { type: "buffer" });
  results.push(["xlsx parses (2 sheets)", wb.SheetNames.length === 2]);
  const ewb = new ExcelJS.Workbook();
  await ewb.xlsx.load(buf as unknown as ArrayBuffer);
  results.push([
    "exceljs parses + PL images = 2",
    ewb.getWorksheet("Packing List - Pallets")!.getImages().length === 2,
  ]);

  let fail = 0;
  for (const [name, ok] of results) {
    if (!ok) fail++;
    console.log(`  ${ok ? "OK " : "FAIL"} ${name}`);
  }
  return fail;
}

(async () => {
  const f1 = await check(1); // same shape as the user's reference file
  const f2 = await check(5); // template-identical row count
  const f3 = await check(12); // positive delta
  const total = f1 + f2 + f3;
  console.log(total === 0 ? "\nIN-CELL TEST PASS" : `\n${total} FAILED`);
  process.exit(total ? 1 : 0);
})();
