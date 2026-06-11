import { parseDraftTaxFile } from "../client/src/lib/draft-tax-parse";
import fs from "fs";

const files = [
  "attached_assets/TR00025 Draft Tax File Footwear USA.xlsx",
  "TR00023 Draft Tax File.xlsx",
];

for (const f of files) {
  console.log("====", f);
  const buf = fs.readFileSync(f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const r = parseDraftTaxFile(ab);
  console.log("SKU rows:", r.skuRowCount, "| line items:", r.lineItems.length);
  console.log("PO numbers:", JSON.stringify(r.poNumbers));
  let totalQty = 0;
  let totalAmt = 0;
  r.lineItems.forEach((li) => {
    totalQty += Number(li.qty);
    totalAmt += Number(li.qty) * Number(li.unitPrice);
  });
  r.lineItems.slice(0, 8).forEach((li) => {
    const amt = Number(li.qty) * Number(li.unitPrice);
    console.log(
      `  ${li.styleNo} | ${li.styleDescription} | hts='${li.htsCode}' | madeIn=${JSON.stringify(li.madeIn)} | qty=${li.qty} | $${li.unitPrice} => ${amt.toFixed(2)}`,
    );
  });
  if (r.lineItems.length > 8)
    console.log("  ... +" + (r.lineItems.length - 8) + " more");
  console.log("TOTALS: qty=" + totalQty + ", amount=" + totalAmt.toFixed(2));
}
