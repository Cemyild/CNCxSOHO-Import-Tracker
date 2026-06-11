import XLSX from "xlsx";
import fs from "fs";

const wb = XLSX.read(fs.readFileSync("test-output/endpoint-test.xlsx"), {
  type: "buffer",
  cellFormula: true,
});
const inv = wb.Sheets["Invoice"];
const pl = wb.Sheets["Packing List - Pallets"];

// 2 items (delta=-3), 1 pallet (delta=-1)
const checks: [string, unknown, unknown][] = [
  ["E4 invoice no", inv["E4"]?.v, 99999999],
  ["H4 date serial", inv["H4"]?.v, 46184], // 2026-06-11 (= 25569 + days since epoch)
  ["B18 goods", inv["B18"]?.v, "FOOTWEAR, ACCESSORY"],
  ["E16 wh ref", inv["E16"]?.v, "W/H Invoice REF NO: 555, 666"],
  ["item B20", inv["B20"]?.v, "T1"],
  ["item K20 formula", inv["K20"]?.f, "G20*J20"],
  ["item K21 formula", inv["K21"]?.f, "G21*J21"],
  ["GT label B22", inv["B22"]?.v, "Grand Total"],
  ["GT G22 formula", inv["G22"]?.f, "SUM(G20:G21)"],
  ["GT G22 value", inv["G22"]?.v, 13],
  ["GT K22 value", inv["K22"]?.v, 91],
  ["J27 gross wt", inv["J27"]?.v, 150.5],
  ["J28 cbm", inv["J28"]?.v, 2.64], // 1.2*1.0*1.1*2 = 2.64
  ["J29 cartons", inv["J29"]?.v, 7],
  ["J30 pallets", inv["J30"]?.v, 2],
  ["cert B24", String(inv["B24"]?.v ?? "").slice(0, 20), "I/We hereby certify "],
  ["signature B35", inv["B35"]?.v, "Signed by …………………….(Affix Company Stamp here)"],
  ["Invoice !ref", inv["!ref"], "B1:K36"],
  ["PL pallet B19", pl["B19"]?.v, "120x100x110"],
  ["PL GT B20", pl["B20"]?.v, "GRAND TOTAL"],
  ["PL GT C20 formula", pl["C20"]?.f, "SUM(C19:C19)"],
  ["PL GT D20 value", pl["D20"]?.v, 150.5],
  ["PL H28 formula", pl["H28"]?.f, "Invoice!J27"],
  ["PL H29 formula", pl["H29"]?.f, "Invoice!J28"],
  ["PL !ref", pl["!ref"], "B1:J34"],
];

let fail = 0;
for (const [name, got, want] of checks) {
  const ok =
    typeof got === "number" && typeof want === "number"
      ? Math.abs(got - want) < 1e-9
      : String(got) === String(want);
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "FAIL"} ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}
console.log(fail === 0 ? "\nENDPOINT TEST PASS" : `\n${fail} CHECKS FAILED`);
process.exit(fail === 0 ? 0 : 1);
