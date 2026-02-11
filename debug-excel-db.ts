
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import { db } from "./server/db";
import { procedures } from "@shared/schema";
import { eq } from "drizzle-orm";

// --- Smart Column Mapping Configuration (Match server/excel-enrichment.ts) ---
const COLUMN_MAPPING: Record<string, string> = {
  "faturano": "invoice_no",
  "faturanumara": "invoice_no",
  "invno": "invoice_no",
  "invoiceno": "invoice_no",
  
  "faturatarihi": "invoice_date",
  "tarih": "invoice_date",
  "date": "invoice_date",
  "invoicedate": "invoice_date",
  "faturatarih": "invoice_date",
  
  "faturatutari": "amount",
  "tutar": "amount",
  "amount": "amount",
  "total": "amount",
  "dovizkiymeti": "amount",
  "malbedeli": "amount",
  
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
  "konismentoozetbeyan": "awb_number",
  "ozetbeyan": "awb_number",
  
  "tasiyici": "carrier",
  "nakliyeci": "carrier",
  "carrier": "carrier"
};

const normalizeHeader = (header: string): string => {
  if (!header) return "";
  let text = header.toString().toLowerCase();
  // Turkish char replacement
  const trMap: Record<string, string> = {
      'ç': 'c', 'ğ': 'g', 'ı': 'i', 'i': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
      'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u'
  };
  text = text.replace(/[çğıöşüÇĞİÖŞÜ]/g, (char) => trMap[char] || char);
  return text.replace(/[^a-z0-9]/g, "");
};

const excelDateToJSDate = (serial: number | string): string | null => {
   if (!serial) return null;
   if (typeof serial === 'string' && (serial.includes('.') || serial.includes('-') || serial.includes('/'))) {
       return serial;
   }
   const num = Number(serial);
   if (isNaN(num)) return String(serial);
   const utc_days  = Math.floor(num - 25569);
   const utc_value = utc_days * 86400;                                      
   const date_info = new Date(utc_value * 1000);
   try {
     return date_info.toISOString().split('T')[0];
   } catch (e) {
     return String(serial);
   }
}

async function debugExcel() {
  const filePath = path.join(process.cwd(), "TOPLAM RAPOR.xlsx");
  console.log(`Checking file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error("ERROR: File not found!");
    return;
  }

  const buf = fs.readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet) as any[];

  if (rawData.length === 0) { console.log("Sheet is empty!"); return; }

  const headers = Object.keys(rawData[0]);
  
  console.log("\n--- DB Connection ---");
  const allProcedures = await db.select().from(procedures);
  console.log(`Fetched ${allProcedures.length} existing procedures from DB.`);
  
  // Debug one procedure to see format
  if (allProcedures.length > 0) {
      console.log("Sample DB Procedure:", {
          id: allProcedures[0].id,
          invoice_no: allProcedures[0].invoice_no,
          amount: allProcedures[0].amount,
          reference: allProcedures[0].reference
      });
  }

  console.log("\n--- Matching Analysis (First 5 Rows) ---");

  console.log("\n--- Header Analysis (Index: Name -> Normalized) ---");
  headers.forEach((h, idx) => {
      const normalized = normalizeHeader(h);
      const field = COLUMN_MAPPING[normalized];
      console.log(`[${idx}] "${h}" -> "${normalized}" => ${field || '---'}`);
  });

  // Check first row values for specific indices to debug shift
  // User said 10, 11, 12 (indices 9, 10, 11)
  console.log("\n--- Checking Indices 9, 10, 11, 12 ---");
  const r = rawData[0];
  const h = headers;
  [9, 10, 11, 12].forEach(i => {
      console.log(`Index ${i} Header: "${h[i]}" Value: "${r[h[i]]}"`);
  });

  process.exit(0);
}

debugExcel().catch(console.error);
