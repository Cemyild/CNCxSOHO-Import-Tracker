import { z } from "zod";
import { analyzePdfWithClaude } from "../claude";

export const taxDataSchema = z.object({
  declarationNumber: z.string(),
  declarationDate: z.string(),
  currency: z.string(),
  customsTax: z.number(),
  additionalCustomsTax: z.number(),
  kkdf: z.number(),
  vat: z.number(),
  stampTax: z.number(),
});

export type TaxData = z.infer<typeof taxDataSchema>;

const TAX_PROMPT = `Analyze this Turkish tax document (Gümrük Beyannamesi or Vergi Ödeme Dekontu).

CRITICAL: Extract tax amounts with EXACT Turkish term matching:

1. Gümrük Vergisi (Customs Tax):
   - Look for: 'Gümrük Vergisi' or 'G.Vergisi' or 'Gümrük V.'
   - Map to: customsTax

2. İlave Gümrük Vergisi (Additional Customs Tax):
   - Look for: 'İlave Gümrük Vergisi' or 'İlave G.V.' or 'İlave Gümrük'
   - This is SEPARATE from KDV!
   - Map to: additionalCustomsTax

3. KKDF (Resource Utilization Support Fund):
   - Look for: 'KKDF' (exact match)
   - Map to: kkdf

4. KDV (VAT - Value Added Tax):
   - Look for: 'KDV' or 'Katma Değer Vergisi'
   - This is DIFFERENT from İlave Gümrük Vergisi!
   - Map to: vat

5. Damga Vergisi (Stamp Tax):
   - Look for: 'Damga Vergisi' or 'D.Vergisi'
   - Map to: stampTax

IMPORTANT DISTINCTIONS:
- 'İlave Gümrük Vergisi' (Additional Customs) ≠ 'KDV' (VAT)
- These are TWO DIFFERENT taxes
- İlave Gümrük Vergisi is usually smaller than KDV
- KDV is typically the largest tax amount

EXAMPLE from real document:
Gümrük Vergisi: 5.000,00 → customsTax: 5000
İlave Gümrük Vergisi: 1.200,00 → additionalCustomsTax: 1200
KKDF: 800,00 → kkdf: 800
KDV: 9.500,00 → vat: 9500
Damga Vergisi: 150,00 → stampTax: 150

NUMBER FORMAT:
- Turkish format: '5.000,00' means 5000.00 (dot is thousands separator, comma is decimal)
- Convert to decimal number

VISUAL CLUES:
- Document usually has a table with tax names on left, amounts on right
- Tax names may be in BOLD
- Look in both table rows and summary sections

If a field is not found in the document, return 0.

Return ONLY valid JSON:
{
  "declarationNumber": "string or empty",
  "declarationDate": "YYYY-MM-DD or empty",
  "currency": "TRY/USD/EUR or empty",
  "customsTax": 0,
  "additionalCustomsTax": 0,
  "kkdf": 0,
  "vat": 0,
  "stampTax": 0
}

⚠️ CRITICAL OUTPUT FORMAT:
Your response MUST be ONLY the JSON object, nothing else.
Do NOT include:
- Explanations before the JSON
- Comments about the document
- Step-by-step reasoning
- Any text outside the JSON object

ONLY output the raw JSON object starting with { and ending with }.`;

export async function extractTaxes(buffer: Buffer): Promise<TaxData> {
  const base64Data = buffer.toString("base64");
  const result = await analyzePdfWithClaude({
    base64Data,
    prompt: TAX_PROMPT,
    maxTokens: 2000,
    temperature: 0,
  });

  let cleanJson = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const m = cleanJson.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON object found in Claude response");
  const parsed = JSON.parse(m[0]);

  const validation = taxDataSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(`Tax data validation failed: ${JSON.stringify(validation.error.issues)}`);
  }
  return validation.data;
}
