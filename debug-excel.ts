
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

// --- Smart Column Mapping Configuration (Copied from excel-enrichment.ts) ---
const COLUMN_MAPPING: Record<string, string> = {
  "faturano": "invoice_no",
  "faturanumara": "invoice_no",
  "invno": "invoice_no",
  "invoiceno": "invoice_no",
  
  "faturatarihi": "invoice_date",
  "tarih": "invoice_date",
  "date": "invoice_date",
  "invoicedate": "invoice_date",
  
  "faturatutari": "amount",
  "tutar": "amount",
  "amount": "amount",
  "total": "amount",
  
  "doviz": "currency",
  "parabirimi": "currency",
  "currency": "currency",
  
  "gumruk": "customs",
  "gumrukidaire": "customs",
  "customs": "customs",
  
  "beyannamenumarasi": "import_dec_number",
  "beyannameno": "import_dec_number",
  "declarationno": "import_dec_number",
  
  "beyannametarihi": "import_dec_date",
  "dectarih": "import_dec_date",
  "declarationdate": "import_dec_date",
  
  "gonderici": "shipper",
  "firma": "shipper",
  "shipper": "shipper",
  "sender": "shipper",

  "kap": "package",
  "paket": "package",
  "package": "package",

  "kilo": "kg",
  "kg": "kg",
  "grossweight": "kg",
  
  "adet": "piece",
  "miktar": "piece",
  "quantity": "piece",
  "piece": "piece",
  
  "konimento": "awb_number",
  "konismento": "awb_number",
  "awb": "awb_number",
  "awbnumber": "awb_number",
  
  "tasiyici": "carrier",
  "nakliyeci": "carrier",
  "carrier": "carrier"
};

const normalizeHeader = (header: string): string => {
  return header.toString().toLowerCase().replace(/[^a-z0-9]/g, "");
};

async function debugExcel() {
  const filePath = path.join(process.cwd(), "TOPLAM RAPOR.xlsx");
  console.log(`Checking file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error("ERROR: File not found!");
    return;
  }

  const buf = fs.readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer" });
  
  console.log("Sheet Names:", workbook.SheetNames);
  
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet) as any[]; // Default header mapping

  if (rawData.length === 0) {
    console.log("Sheet is empty!");
    return;
  }

  // Inspect headers properly
  // XLSX.utils.sheet_to_json uses the first row as keys.
  const firstRow = rawData[0];
  const headers = Object.keys(firstRow);
  
  console.log("\n--- Detected Headers ---");
  headers.forEach(h => {
    const normalized = normalizeHeader(h);
    const mapped = COLUMN_MAPPING[normalized];
    console.log(`Original: "${h}" -> Normalized: "${normalized}" -> Mapped To: ${mapped || "NONE"}`);
  });

  console.log("\n--- First 3 Rows of Data ---");
  rawData.slice(0, 3).forEach((row, i) => {
    console.log(`\nRow ${i+1}:`);
    console.log(JSON.stringify(row, null, 2));
    
    // Check mapping match
    const mappedValues: any = {};
    headers.forEach(h => {
        const normalized = normalizeHeader(h);
        const field = COLUMN_MAPPING[normalized];
        if (field) mappedValues[field] = row[h];
    });
    console.log("Mapped fields found:", mappedValues);
  });
}

debugExcel();
