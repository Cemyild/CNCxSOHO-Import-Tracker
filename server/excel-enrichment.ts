
import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db } from "./db";
import { procedures } from "@shared/schema";
import { eq, or, isNull, sql } from "drizzle-orm";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// --- Smart Column Mapping Configuration ---
// Maps potential Excel headers (lowercase, trimmed) to database columns
const COLUMN_MAPPING: Record<string, string> = {
  "faturano": "invoice_no",
  "faturanumara": "invoice_no",
  "invno": "invoice_no",
  "invoiceno": "invoice_no",
  "faturano0100": "invoice_no", // Found in debug
  
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
  "gumrukidaresi": "customs", // User specified
  "customs": "customs",
  
  "beyannamenumarasi": "import_dec_number",
  "beyannameno": "import_dec_number",
  "declarationno": "import_dec_number",
  "tcgbno": "import_dec_number",
  "beyanno": "import_dec_number", // Found in debug
  
  "beyannametarihi": "import_dec_date",
  "dectarih": "import_dec_date",
  "declarationdate": "import_dec_date",
  "tcgbtarihi": "import_dec_date",
  "beyantarihi": "import_dec_date", // Found in debug
  
  "gonderici": "shipper",
  "firma": "shipper",
  "shipper": "shipper",
  "sender": "shipper",
  "gonderen": "shipper", 

  "kap": "package",
  "paket": "package",
  "package": "package",
  "koli": "package", 

  "kilo": "kg",
  "kg": "kg",
  "grossweight": "kg",
  "brutkg": "kg", 
  
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
  "tasimasenedino": "awb_number", 
  
  "tasiyici": "carrier",
  "nakliyeci": "carrier",
  "carrier": "carrier"
};

// --- Helper Functions ---

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

// Excel Date Serial to JS Date Helper
const excelDateToJSDate = (serial: number | string): string | null => {
   if (!serial) return null;
   // If it's already a string with dots or dashes, return as is (maybe normalize to YYYY-MM-DD if needed)
   if (typeof serial === 'string' && (serial.includes('.') || serial.includes('-') || serial.includes('/'))) {
       return serial;
   }
   
   const num = Number(serial);
   if (isNaN(num)) return String(serial);

   // Excel serial date to JS Date
   // 25569 is the offset between Excel epoch (1900-01-01) and JS epoch (1970-01-01)
   // 86400 * 1000 is milliseconds in a day
   const utc_days  = Math.floor(num - 25569);
   const utc_value = utc_days * 86400;                                      
   const date_info = new Date(utc_value * 1000);

   // Format as YYYY-MM-DD (or ISO)
   try {
     return date_info.toISOString().split('T')[0];
   } catch (e) {
     return String(serial);
   }
}

const mapExcelRowToDbFields = (row: any, headers: string[]) => {
  const mappedData: Record<string, any> = {};
  
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    const dbField = COLUMN_MAPPING[normalized];
    
    let value = row[header];

    // Priority 1: Index-based mapping (User override)
    // User specified: 10 -> Customs, 11 -> Dec No, 12 -> Dec Date
    // Note: User likely means 0-based indices matching our debug output (10, 11, 12)
    // Debug output confirmed: [10] "Gümrük İdaresi", [11] "Beyanname No", [12] "Beyanname Tarihi"
    if (index === 10) {
        mappedData.customs = value;
    } 
    else if (index === 11) {
        mappedData.import_dec_number = value;
    }
    else if (index === 12) {
        mappedData.import_dec_date = excelDateToJSDate(value);
    }
    
    // Priority 2: Name-based mapping (if not already set by index)
    if (dbField && (!mappedData[dbField] || mappedData[dbField] === "")) {
        // Handle Date Fields
        if (dbField === 'invoice_date' || dbField === 'import_dec_date' || dbField === 'arrival_date') {
            value = excelDateToJSDate(value);
        }
        mappedData[dbField] = value;
    }

    // Special handling for 'BeyannameFatura' if invoice_no is missing
    if (normalized === 'beyannamefatura' && !mappedData.invoice_no) {
       const raw = String(row[header]);
       // Attempt to extract first part "20886490 07.01.2026" -> "20886490"
       const parts = raw.split(' ');
       if (parts.length > 0 && parts[0].length > 5) {
           mappedData.invoice_no = parts[0].trim();
       }
    }
  });

  return mappedData;
};

// --- Routes ---

router.post("/preview", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // 1. Parse Excel as Array of Arrays (header: 1) to guarantee column order
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // This gives us rows as arrays: [ [H1, H2...], [V1, V2...] ]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    if (!rows || rows.length < 2) {
      return res.status(400).json({ message: "Excel file is empty or missing headers" });
    }

    // Row 0 is Headers
    const headers = rows[0] as string[];
    console.log("[ExcelEnrichment] Detected Headers:", headers);
    
    // Build a map of "NormalizedHeader -> ColumnIndex" for dynamic fields
    const headerIndexMap: Record<string, number> = {};
    headers.forEach((h, idx) => {
        if (h) headerIndexMap[normalizeHeader(h)] = idx;
    });

    // 2. Fetch Potential Matches from DB
    const allProcedures = await db.select().from(procedures);

    const matches = [];

    // 3. Perform Matching Logic (Iterate data rows starting at index 1)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const mappedData: Record<string, any> = {};

      // --- A. Dynamic Header Mapping ---
      // Iterate through our know mappings and pull from found indices
      for (const [normHeader, dbField] of Object.entries(COLUMN_MAPPING)) {
          const colIdx = headerIndexMap[normHeader];
          if (colIdx !== undefined && row[colIdx] !== undefined) {
             let val = row[colIdx];
             if (dbField === 'invoice_date' || dbField === 'import_dec_date' || dbField === 'arrival_date') {
                 val = excelDateToJSDate(val);
             }
             mappedData[dbField] = val;
          }
      }

      // Special 'BeyannameFatura' handling if Invoice No is still missing
      // Using dynamic lookup for 'BeyannameFatura' column
      if (!mappedData.invoice_no) {
          const bfIdx = headerIndexMap['beyannamefatura'];
          if (bfIdx !== undefined && row[bfIdx]) {
              const raw = String(row[bfIdx]);
              const parts = raw.split(' ');
              if (parts.length > 0 && parts[0].length > 5) {
                mappedData.invoice_no = parts[0].trim();
              }
          }
      }

      // --- Matching Logic Only Below ---
      
      // We need at least Invoice No or Amount to match
      if (!mappedData.invoice_no && !mappedData.amount) {
        continue; 
      }

      let matchedProcedure = null;
      let matchMethod = null;

      // Priority 1: Invoice No
      if (mappedData.invoice_no) {
        const cleanInvNo = String(mappedData.invoice_no).trim();
        matchedProcedure = allProcedures.find(p => p.invoice_no && String(p.invoice_no).trim() === cleanInvNo);
        if (matchedProcedure) matchMethod = "invoice_no";
      }

      // Priority 2: Amount
      if (!matchedProcedure && mappedData.amount) {
        const targetAmount = parseFloat(String(mappedData.amount));
        matchedProcedure = allProcedures.find(p => {
          if (!p.amount) return false;
          const dbAmount = parseFloat(String(p.amount));
          return Math.abs(dbAmount - targetAmount) < 0.01;
        });
        if (matchedProcedure) matchMethod = "amount";
      }

      if (matchedProcedure) {
        const changes = [];
        
        for (const [field, newValue] of Object.entries(mappedData)) {
            const currentValue = (matchedProcedure as any)[field];
            const isDbEmpty = currentValue === null || currentValue === undefined || currentValue === "";
            
            // Loose equality check for strings/numbers to avoid "false updates" (e.g. 100 vs "100")
            // But here we only update if DB is empty, so collision isn't main worry.
            
            if (isDbEmpty && newValue !== null && newValue !== "") {
              changes.push({
                field: field,
                oldValue: currentValue,
                newValue: String(newValue)
              });
            }
        }

        if (changes.length > 0) {
          matches.push({
            procedureId: matchedProcedure.id,
            reference: matchedProcedure.reference,
            matchMethod: matchMethod,
            excelRow: i + 1, // Row number 1-based
            changes: changes
          });
        }
      }
    }

    res.json({ matchCount: matches.length, matches });

  } catch (error) {
    console.error("Excel processing error:", error);
    res.status(500).json({ message: "Failed to process Excel file", error: String(error) });
  }
});

router.post("/apply", async (req, res) => {
  try {
    const { updates } = req.body; // Expecting array of { procedureId, changes: { field: value, ... } }

    if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ message: "Invalid updates format" });
    }

    const results = [];

    // Process updates in a transaction-like manner (sequential for now)
    for (const update of updates) {
        const { procedureId, changes } = update;
        
        if (!procedureId || !changes) continue;

        // Verify record still exists
        const [procedure] = await db.select().from(procedures).where(eq(procedures.id, procedureId));
        
        if (procedure) {
            // Apply updates
            // Filter out fields that are NOT in the schema to avoid safety errors
            // (Though mapExcelRowToDbFields should have handled this, safety first)
            
            const sanitizedUpdates: Record<string, any> = {};
            // We can check if field exists in 'procedure' object keys, but TS makes it tricky at runtime.
            // We rely on the Preview endpoint ensuring valid field names from COLUMN_MAPPING.
            
            // We only need to set updated fields
            // Assuming changes is object { field: value }
            
            await db.update(procedures)
                .set({
                    ...changes,
                    updatedAt: new Date()
                })
                .where(eq(procedures.id, procedureId));
                
            results.push({ id: procedureId, status: "success" });
        } else {
            results.push({ id: procedureId, status: "not_found" });
        }
    }

    res.json({ message: "Updates applied", results });

  } catch (error) {
      console.error("Apply updates error:", error);
      res.status(500).json({ message: "Failed to apply updates", error: String(error) });
  }
});

export default router;
