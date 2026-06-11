import fs from "fs";
import crypto from "crypto";
import JSZip from "jszip";
import ExcelJS from "exceljs";

const md5 = (b: Buffer) => crypto.createHash("md5").update(b).digest("hex");

(async () => {
  const buf = fs.readFileSync("test-output/signed-export.xlsx");
  const zip = await JSZip.loadAsync(buf);

  const sigDisk = fs.readFileSync("server/templates/signatures/alo-llc-signature.png");
  const stampDisk = fs.readFileSync("server/templates/signatures/alo-llc-stamp.png");
  const sigZip = await zip.file("xl/media/image1.png")!.async("nodebuffer");
  const stampZip = await zip.file("xl/media/image2.png")!.async("nodebuffer");

  console.log("signature bytes match:", md5(sigDisk) === md5(sigZip));
  console.log("stamp bytes match:", md5(stampDisk) === md5(stampZip));

  const d1 = await zip.file("xl/drawings/drawing1.xml")!.async("string");
  const exts = [...d1.matchAll(/<xdr:ext cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => ({
    cx: Number(m[1]),
    cy: Number(m[2]),
  }));
  console.log("anchor sizes (EMU):", exts);
  // signature: 414x174 → 5.5cm wide → cy = 1980000 * 174/414 ≈ 832174
  // stamp: 208x216 → 3.2cm wide → cy = 1152000 * 216/208 ≈ 1196308
  const sigOk = Math.abs(exts[0].cy / exts[0].cx - 174 / 414) < 0.01;
  const stampOk = Math.abs(exts[1].cy / exts[1].cx - 216 / 208) < 0.01;
  console.log("signature aspect preserved:", sigOk);
  console.log("stamp aspect preserved:", stampOk);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  console.log(
    "exceljs images — Invoice:",
    wb.getWorksheet("Invoice")!.getImages().length,
    "| PL:",
    wb.getWorksheet("Packing List - Pallets")!.getImages().length,
  );
  console.log("DONE");
})();
