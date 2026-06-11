import fs from "fs";
import JSZip from "jszip";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import {
  buildCommercialInvoiceXlsx,
  type ExportPayload,
} from "../server/invoice-maker-export";

const payload: ExportPayload = {
  shipperId: "alo-llc",
  shipperAddress: "ALO, LLC\r\nTEST",
  importerAddress: "SOHO",
  deliveryAddress: "ULUSTRANS",
  invoiceNo: "12345",
  invoiceDate: "2026-06-11",
  invoiceReference: "r",
  poOrderNo: "p",
  portOfLoading: "LA",
  finalDestination: "IST",
  paymentTerm: "AT 30 DAYS",
  shipmentMode: "AIR",
  shipmentTerm: "EX-WORKS",
  whInvoiceRef: "",
  goodsDescription: "FOOTWEAR",
  totalCartons: 1,
  // 8 items → invDelta = +3; signature line should sit at row 38+3 = 41
  lineItems: Array.from({ length: 8 }, (_, i) => ({
    styleNo: `S${i}`,
    styleDescription: "d",
    htsCode: "1234.56.78.90.00",
    composition: "c",
    madeIn: "CN",
    qty: 1,
    uom: "PCS",
    currency: "USD",
    unitPrice: 2,
  })),
  // 3 pallets → plDelta = +1
  pallets: [
    { dimension: "100x100x100", qty: 1, grossWt: 10 },
    { dimension: "100x100x100", qty: 1, grossWt: 10 },
    { dimension: "100x100x100", qty: 1, grossWt: 10 },
  ],
};

(async () => {
  const buf = await buildCommercialInvoiceXlsx(payload);
  fs.writeFileSync("test-output/signature-test.xlsx", buf);

  const zip = await JSZip.loadAsync(buf);
  const files = Object.keys(zip.files);
  const checks: [string, boolean][] = [
    ["media/image1.png present", files.includes("xl/media/image1.png")],
    ["media/image2.png present", files.includes("xl/media/image2.png")],
    ["drawing1.xml present", files.includes("xl/drawings/drawing1.xml")],
    ["drawing2.xml present", files.includes("xl/drawings/drawing2.xml")],
  ];

  const d1 = await zip.file("xl/drawings/drawing1.xml")!.async("string");
  const d2 = await zip.file("xl/drawings/drawing2.xml")!.async("string");
  // invDelta=3 → signature row 33+3=36, stamp row 32+3=35 (0-based)
  checks.push(["inv signature row 36", d1.includes("<xdr:row>36</xdr:row>")]);
  checks.push(["inv stamp row 35", d1.includes("<xdr:row>35</xdr:row>")]);
  // plDelta=1 → signature row 30+1=31, stamp row 29+1=30
  checks.push(["pl signature row 31", d2.includes("<xdr:row>31</xdr:row>")]);
  checks.push(["pl stamp row 30", d2.includes("<xdr:row>30</xdr:row>")]);

  const s1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const s2 = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  checks.push(["sheet1 <drawing> wired", s1.includes('<drawing r:id="rId99"/>')]);
  checks.push(["sheet2 <drawing> wired", s2.includes('<drawing r:id="rId99"/>')]);

  const ct = await zip.file("[Content_Types].xml")!.async("string");
  checks.push(["png content type", /Extension="png"/.test(ct)]);
  checks.push(["drawing overrides", /drawing2\.xml/.test(ct)]);

  // both parsers still open it
  const wb = XLSX.read(buf, { type: "buffer" });
  checks.push(["xlsx parses", wb.SheetNames.length === 2]);
  const ewb = new ExcelJS.Workbook();
  await ewb.xlsx.load(buf);
  const invImgs = ewb.getWorksheet("Invoice").getImages();
  const plImgs = ewb.getWorksheet("Packing List - Pallets").getImages();
  checks.push(["exceljs sees 2 invoice images", invImgs.length === 2]);
  checks.push(["exceljs sees 2 PL images", plImgs.length === 2]);

  let fail = 0;
  for (const [name, ok] of checks) {
    if (!ok) fail++;
    console.log(`${ok ? "OK " : "FAIL"} ${name}`);
  }
  console.log(fail === 0 ? "\nSIGNATURE TEST PASS" : `\n${fail} FAILED`);
  process.exit(fail ? 1 : 0);
})();
