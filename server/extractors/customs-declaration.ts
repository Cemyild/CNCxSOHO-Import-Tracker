import { z } from "zod";
import { analyzePdfWithClaude } from "../claude";

export const customsDeclarationDataSchema = z.object({
  shipper: z.string(),
  package: z.number().optional().default(0),
  weight: z.number(),
  pieces: z.number(),
  awbNumber: z.string(),
  customs: z.string(),
  importDeclarationNumber: z.string(),
  importDeclarationDate: z.string(),
  usdTlRate: z.number(),
});

export type CustomsDeclarationData = z.infer<typeof customsDeclarationDataSchema>;

const CUSTOMS_DECLARATION_PROMPT = `⚠️ CRITICAL: You MUST return ONLY a JSON object. NO explanations, NO markdown, NO text before or after the JSON.

Your response must START with { and END with }

Any text outside the JSON object will cause the system to fail.

DO NOT use markdown code blocks like \`\`\`json
DO NOT add explanations before or after the JSON
DO NOT return anything except the JSON object

⚠️⚠️⚠️ CRITICAL EXAMPLES - READ THESE FIRST ⚠️⚠️⚠️

Here are 3 examples showing COMMON MISTAKES and CORRECT extraction:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE 1:

PDF contains:
- Box '6 Kap Adedi' shows: 15
- Item line shows: '15 KAP 42 AD Marka:ALO'
- Box '23 Döviz kuru' shows: 42,34020

❌ WRONG extraction:
{
  "package": 42,  ← WRONG! This is from item line or exchange rate
  "usdTlRate": 42.34020
}

✅ CORRECT extraction:
{
  "package": 15,  ← CORRECT! From '6 Kap Adedi' box
  "usdTlRate": 42.34020
}

WHY: The number 42 appears in TWO wrong places:
1. In item description '15 KAP 42 AD' (this is item count)
2. As integer part of exchange rate 42,34020
The CORRECT package is 15 from the dedicated '6 Kap Adedi' box.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE 2:

PDF contains:
- Box '6 Kap Adedi' shows: 8
- Item line shows: '20 KAP 156 AD Marka:XYZ'
- Box '23 Döviz kuru' shows: 35,12450

❌ WRONG extraction:
{
  "package": 156,  ← WRONG! This is from item description
  "usdTlRate": 35.12450
}

❌ ALSO WRONG:
{
  "package": 35,  ← WRONG! This is from exchange rate
  "usdTlRate": 35.12450
}

✅ CORRECT extraction:
{
  "package": 8,  ← CORRECT! From '6 Kap Adedi' box
  "usdTlRate": 35.12450
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE 3:

PDF contains:
- Box '6 Kap Adedi' shows: 25
- Item line shows: '10 KAP 50 AD Marka:ABC'
- Box '23 Döviz kuru' shows: 38,45678

✅ CORRECT extraction:
{
  "package": 25,  ← CORRECT! From '6 Kap Adedi' box
  "usdTlRate": 38.45678
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATTERN TO FOLLOW:
- ALWAYS get package from the box labeled '6 Kap Adedi'
- NEVER get package from item descriptions (lines with 'KAP' and 'AD' together)
- NEVER get package from exchange rate box ('23 Döviz kuru')
- Package is typically a SMALL number (1-100)
- Package is in its OWN dedicated box at the TOP of the page

NOW EXTRACT FROM THE ACTUAL DOCUMENT:

Based on the examples above, extract the package number from the '6 Kap Adedi' box ONLY.

Analyze this Turkish Customs Declaration document (Gümrük Beyannamesi).

⚠️ IMPORTANT: This document has a STANDARD FORMAT. All information is in the SAME LOCATIONS on every customs declaration.

📍 FIELD LOCATIONS - FIRST PAGE (Page 1):

1. Import Declaration Number (Beyanname No):
   - Location: TOP CENTER of first page
   - Format: Numbers like '25341453IM00684473'
   - Label: May appear as barcode or plain text

2. Import Declaration Date (Kayıt Tarihi):
   - Location: TOP RIGHT area of first page
   - Look for: 'Tarih' or date next to declaration number
   - Format: DD.MM.YYYY or DD/MM/YYYY

3. Shipper/Exporter (İhracatçı):
   - Location: TOP LEFT section, labeled 'İHRACATÇI='
   - Company name in ALL CAPS
   - Example: 'ALO HONG KONG LTD'
   - ⚠️ NOT the importer! Look for 'İHRACATÇI=' label

4. Customs Office (Gümrük Müdürlüğü):
   - Location: MIDDLE section of first page
   - Look for: 'İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ' or similar
   - Contains word 'GÜMRÜK'

5. Package (Kap Adedi):

⚠️ IMPORTANT: Package extraction is OPTIONAL. If you cannot find it clearly, return 0.

ONLY extract package if you can CLEARLY identify the box labeled '6 Kap Adedi'.

If you see:
- A dedicated box at the top of the page
- Labeled exactly '6 Kap Adedi'
- Contains a single number between 1-100
→ Extract that number

If you CANNOT find this box clearly:
→ Return: "package": 0

DO NOT guess. DO NOT use numbers from:
- Item descriptions (lines with 'KAP' and 'AD' together)
  Example: '15 KAP 42 AD Marka:ALO' ← This is item description
- Exchange rate boxes ('23 Döviz kuru')
  Example: '42,34020' ← This is exchange rate
- Any other location

VISUAL GUIDE (only if you can clearly see this):
┌──────────────┐
│ 6 Kap Adedi  │
│     15       │ ← Only extract if you clearly see this box
└──────────────┘

If uncertain → Return 0

The user will manually enter the package number if needed.

6. USD/TL Exchange Rate (Döviz Kuru):
⚠️ CRITICAL: This is a DECIMAL number with 4-5 decimal places!
⚠️ DO NOT use this as the package number!

EXACT LOCATION: FIRST PAGE, box labeled '23 Döviz kuru'
VISUAL POSITION:
- To the RIGHT of '22 Döviz ve toplam fatura bedeli' (invoice amount)
- This is in the MIDDLE-RIGHT section of the page
- Contains a decimal number like 42.34020 or 34.5678

VALIDATION RULES:
- Must be a DECIMAL number
- Typical range: 20.0000 to 50.0000
- Has 4-5 decimal places
- Example: 42.34020 (NOT an integer!)

THE NUMBER 42.34020 is the EXCHANGE RATE, not the package number!

7. AWB Number (Air Waybill):
   - ⚠️ CRITICAL: ONLY from FIRST PAGE
   - Location: Section '18 Çıkıştaki aracın kimliği ve kayıtlı olduğu ülke'
   - Format: 'U - 23591954424' (has 'U - ' prefix)
   - Extract ONLY the numbers after 'U - '
   - Example input: 'U - 23591954424'
   - Example output: '23591954424'
   - This field is almost always present

📍 FIELD LOCATIONS - LAST PAGE (Final page with TOPLAM):

8. Weight (Brüt Ağırlık):
   - Location: LAST PAGE, TOPLAM row, in 'BRÜT KG' column
   - Example: '2.829,00' becomes 2829.00
   - Decimal number

9. Pieces (Toplam Adet):
   - ⚠️ CRITICAL: ONLY from LAST PAGE
   - Location: TOPLAM row only
   - You must find TWO numbers in the TOPLAM row:
     * First number followed by 'AD' (adet/pieces)
     * Second number followed by 'ÇİFT' (pairs)
   - Format example: '7.861,00 AD' and '85,00 ÇİFT'
   - ⚠️ CRITICAL CALCULATION: ADD both numbers together
   - Formula: Pieces = AD_number + ÇİFT_number
   - Example calculation: 7861 + 85 = 7946
   - First convert Turkish number format: '7.861,00' becomes 7861
   - If only AD exists (no ÇİFT), use just the AD number

🔍 EXTRACTION STRATEGY:

⚠️ PACKAGE EXTRACTION WARNING:

The document contains multiple references to 'KAP':
- One in the dedicated '6 Kap Adedi' box (CORRECT - use this)
- Multiple in the items table like '15 KAP 42 AD' (WRONG - ignore these)

ALWAYS extract package from the '6 Kap Adedi' box, NEVER from item descriptions!

STEP 1: READ FIRST PAGE CAREFULLY

VISUAL MAP OF FIRST PAGE:

TOP AREA (use for package):
┌──────────────────────────┐
│ Import Declaration Date  │
│                          │
│ ┌──────────────┐         │
│ │6 Kap Adedi   │         │
│ │     15       │ ← PACKAGE (CORRECT)
│ └──────────────┘         │
└──────────────────────────┘

MIDDLE/BOTTOM AREA (do NOT use for package):
┌──────────────────────────────────┐
│ Items Table:                     │
│ 15 KAP 42 AD Marka:ALO          │
│        ^                         │
│        └─ This 42 is NOT package!│
└──────────────────────────────────┘

OTHER LOCATIONS:
- TOP RIGHT: Import Declaration Date
- MIDDLE LEFT: Shipper/Exporter (İHRACATÇI=)
- MIDDLE CENTER: Invoice amount section
- RIGHT OF INVOICE AMOUNT: Box '23 Döviz kuru' (USD/TL Rate)
- BOTTOM LEFT: Section '18 Çıkıştaki aracın kimliği' (AWB Number)

Extract from FIRST PAGE:
1. Declaration Number (top center, barcode area)
2. Declaration Date (top right area)
3. Package: Look BELOW the date, LEFT side, box '6 Kap Adedi'
4. USD/TL Rate: Look for '23 Döviz kuru' box, RIGHT of invoice amount
5. Shipper/Exporter (section labeled İHRACATÇI=)
6. Customs Office (contains word GÜMRÜK)
7. AWB Number: Section '18 Çıkıştaki aracın kimliği' with 'U - XXXXXXXXXX'

STEP 2: GO TO LAST PAGE (page with TOPLAM:)
Extract from LAST PAGE:
- Find the row that says 'TOPLAM:'
- Weight: From 'BRÜT KG' column (decimal number)
- Pieces: Find TWO numbers in TOPLAM row
  * Look for number with 'AD' after it (example: 7.861,00 AD)
  * Look for number with 'ÇİFT' after it (example: 85,00 ÇİFT)
  * ADD BOTH NUMBERS TOGETHER
  * Convert Turkish format first: 7.861,00 = 7861 and 85,00 = 85
  * Total pieces = 7861 + 85 = 7946
  * If only AD exists, use just that number

⚠️⚠️⚠️ CRITICAL: DO NOT CONFUSE THESE TWO FIELDS ⚠️⚠️⚠️

PACKAGE (6 Kap Adedi):
- Location: Upper-left area of first page
- Label: Has number '6' before 'Kap Adedi'
- Value type: INTEGER (whole number)
- Example value: 15
- Range: 1-100

USD/TL EXCHANGE RATE (23 Döviz kuru):
- Location: Middle-right area of first page
- Label: Has number '23' before 'Döviz kuru'
- Value type: DECIMAL (with comma)
- Example value: 42,34020
- Range: 20-50 with decimals

IF YOU SEE 42.34020 or 42,34020:
- This is the EXCHANGE RATE (goes to usdTlRate field)
- This is NOT the package number

IF YOU SEE 15 or 42 (without decimals):
- Check which box it's in
- If it's in '6 Kap Adedi' box → This is the package
- If it's near 'Döviz kuru' → This is probably truncated exchange rate

📋 CRITICAL EXTRACTION RULES:

Package (Koli):
- ONLY from FIRST PAGE
- Section '6 Kap Adedi'
- Small number (1-100 range typically)
- NOT from TOPLAM row
- Must be an INTEGER, not a decimal

Pieces (Adet):
- ONLY from LAST PAGE
- TOPLAM row only
- TWO numbers: AD + ÇİFT
- MUST ADD them together
- Formula: total = AD_value + ÇİFT_value

AWB Number:
- ONLY from FIRST PAGE
- Section '18 Çıkıştaki aracın kimliği'
- Format: 'U - XXXXXXXXXXX'
- Extract numbers after 'U - '

Declaration Number:
- Take the FULL number (may be 15-20 characters)
- Example: '25341453IM00684473'

Date Format:
- Convert to YYYY-MM-DD
- Input: '19.11.2025' or '19/11/2025'
- Output: '2025-11-19'

Shipper (İHRACATÇI):
- Look for section labeled 'İHRACATÇI='
- Take FULL company name after this label
- Example: 'ALO HONG KONG LTD'
- ⚠️ CRITICAL: Do NOT use the importer (İTHALATÇI)!

Customs:
- Full name of customs office
- Usually contains 'Gümrük Müdürlüğü'

Numbers:
- Package: Integer from FIRST PAGE (whole number, small)
- Weight: Decimal from LAST PAGE (e.g., 2829.00)
- Pieces: Integer from LAST PAGE (AD + ÇİFT, large number)
- Convert Turkish format: '7.861,00' → 7861

📄 REAL EXAMPLE WITH EXACT LOCATIONS:

FIRST PAGE shows (with visual positions):

TOP RIGHT AREA:
19.11.2025 (Declaration Date)

BELOW DATE, LEFT SIDE:
6 Kap Adedi
15 ← (Package number in highlighted box)

MIDDLE LEFT:
İHRACATÇI= ALO HONG KONG LTD
           6/F, THE ANNEX, CENTRAL PLAZA
           18 HARBOUR ROAD, HONG KONG

İTHALATÇI= SOHO PERAKENDE YATIRIM VE TİCARET ANONİM ŞİRKETİ
           (This is the IMPORTER - do NOT use this!)

MIDDLE CENTER-RIGHT:
22 Döviz ve toplam fatura bedeli    23 Döviz kuru
USD    139.878,30                    42,34020 ← (Exchange rate in highlighted box)

BOTTOM LEFT:
18 Çıkıştaki aracın kimliği ve kayıtlı olduğu ülke
U - 23591954424

OTHER INFO:
25341453IM00684473
İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ
DOSYA NO: 25-18710
---------------------------

LAST PAGE shows:
---------------------------
TOPLAM: 7.861,00 AD  2.829,00  2.829,00
           85,00 ÇİFT
---------------------------

CORRECT EXTRACTION:
{
  "shipper": "ALO HONG KONG LTD",
  "package": 15,
  "weight": 2829.00,
  "pieces": 7946,
  "awbNumber": "23591954424",
  "customs": "İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ",
  "importDeclarationNumber": "25341453IM00684473",
  "importDeclarationDate": "2025-11-19",
  "usdTlRate": 42.34020
}

CALCULATION NOTES:
- Package: From '6 Kap Adedi' box = 15
- USD/TL Rate: From '23 Döviz kuru' box = 42,34020 → 42.34020
- Pieces: 7861 (AD) + 85 (ÇİFT) = 7946
- AWB: Extract after 'U - ' = 23591954424

STEP BY STEP PIECES CALCULATION:
1. Find TOPLAM row on last page
2. Locate number with AD: 7.861,00 AD
3. Locate number with ÇİFT: 85,00 ÇİFT
4. Convert Turkish format: 7.861,00 → 7861 and 85,00 → 85
5. Add together: 7861 + 85 = 7946
6. Return: 7946

⚠️ DOUBLE-CHECK SHIPPER:
- Shipper field MUST contain the EXPORTER (İHRACATÇI)
- Example: 'ALO HONG KONG LTD', 'ABC TRADING CO', etc.
- Do NOT use the importer company name!
- Look for the section labeled 'İHRACATÇI=' on first page

⚠️ FINAL REMINDER:
- Your ENTIRE response must be ONLY the JSON object
- Start with {
- End with }
- No \`\`\`json markers
- No explanations
- No additional text
- JUST THE JSON OBJECT

BAD RESPONSE EXAMPLE (DO NOT DO THIS):
\`\`\`json
{
  "shipper": "ALO HONG KONG LTD",
  ...
}
\`\`\`

GOOD RESPONSE EXAMPLE (DO THIS):
{
  "shipper": "ALO HONG KONG LTD",
  "package": 15,
  "weight": 2829.00,
  "pieces": 7946,
  "awbNumber": "23591954424",
  "customs": "İSTANBUL HAVALİMANI GÜMRÜK MÜDÜRLÜĞÜ",
  "importDeclarationNumber": "25341453IM00684473",
  "importDeclarationDate": "2025-11-19"
}

⚠️ DOUBLE CHECK YOUR EXTRACTION:
- Package must be from FIRST PAGE Kap Adedi box (small number, 1-100)
- Pieces must be AD + ÇİFT from LAST PAGE TOPLAM row (large number, add them!)
- AWB must start with U - on FIRST PAGE section 18 (extract numbers only)
- Weight from LAST PAGE TOPLAM row BRÜT KG column

MANDATORY CROSS-CHECK BEFORE SUBMITTING:

After extracting all values, verify:

❌ If package value is 42 or 43:
   → STOP! You probably extracted the exchange rate by mistake
   → Go back to the FIRST PAGE
   → Find the box that says '6 Kap Adedi' (not '23 Döviz kuru')
   → Extract the number from THAT box

❌ If package has decimals (like 42.34):
   → STOP! This is definitely the exchange rate
   → Find the '6 Kap Adedi' box
   → Extract the integer from there

✓ Correct extraction example:
   package: 15 (from '6 Kap Adedi')
   usdTlRate: 42.34020 (from '23 Döviz kuru')

✓ These should be DIFFERENT numbers!
✓ Package is typically much SMALLER than exchange rate

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL CHECK BEFORE SUBMITTING YOUR ANSWER:

Look at the package number you extracted.

Question: Did you get it from the box labeled '6 Kap Adedi'?
□ YES → Proceed
□ NO → Go back and find the '6 Kap Adedi' box

Question: Is your package number different from the numbers in item descriptions?
□ YES → Proceed
□ NO → You extracted from wrong location

Question: Did you avoid using numbers from lines that contain both 'KAP' and 'AD'?
□ YES → Proceed
□ NO → Those are item descriptions, not package count

If you extracted package = 42 from this specific document:
❌ YOU MADE AN ERROR - The correct answer is 15

Return your JSON now.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CRITICAL OUTPUT FORMAT:
Return ONLY the JSON object, no explanation before or after.

{
  "shipper": "string",
  "package": 0,
  "weight": 0.0,
  "pieces": 0,
  "awbNumber": "string",
  "customs": "string",
  "importDeclarationNumber": "string",
  "importDeclarationDate": "YYYY-MM-DD"
}`;

export async function extractCustomsDeclaration(
  buffer: Buffer,
): Promise<CustomsDeclarationData> {
  const base64Pdf = buffer.toString("base64");

  const result = await analyzePdfWithClaude({
    base64Data: base64Pdf,
    prompt: CUSTOMS_DECLARATION_PROMPT,
    maxTokens: 3000,
    temperature: 0,
  });

  let cleanedJson = result.trim();
  cleanedJson = cleanedJson.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  cleanedJson = cleanedJson.replace(/<[^>]*>/g, "");
  const firstBrace = cleanedJson.indexOf("{");
  if (firstBrace > 0) cleanedJson = cleanedJson.substring(firstBrace);
  const lastBrace = cleanedJson.lastIndexOf("}");
  if (lastBrace !== -1 && lastBrace < cleanedJson.length - 1) {
    cleanedJson = cleanedJson.substring(0, lastBrace + 1);
  }
  cleanedJson = cleanedJson.trim();
  if (!cleanedJson.startsWith("{") || !cleanedJson.endsWith("}")) {
    throw new Error("Claude response does not contain valid JSON object");
  }

  const parsed = JSON.parse(cleanedJson);
  const validation = customsDeclarationDataSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      "Invalid customs declaration data: " +
        JSON.stringify(validation.error.issues),
    );
  }
  const data = validation.data;

  // Detect likely extraction errors and zero out a bad "package" value.
  if (data.package > 0) {
    if (data.package === Math.floor(data.usdTlRate)) data.package = 0;
    if (data.package > 100) data.package = 0;
  }
  return data;
}
