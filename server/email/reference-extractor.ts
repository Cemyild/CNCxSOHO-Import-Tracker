/**
 * Mail metninden prosedür referansı, AWB, gümrük dosya numarası çıkarır.
 * Biçimler canlı veriden doğrulandı (2026-09-14, 200 prosedür):
 *   referans  CNCALO-112 / CNCALO-104 / 2
 *   AWB       235-51135254 (3 hane + 8 hane)
 *   dosya no  26-13117 (2 hane + 5 hane)
 * Fatura numaraları serbest biçimli (SHP0001LBNTR, 1000873321) olduğu için
 * regex ile aranmaz; onları yalnızca Claude çıkarır ve DB'de birebir aranır.
 */

export interface ExtractedRefs {
  procedureRefs: string[];
  awbNumbers: string[];
  customsFileNumbers: string[];
  invoiceNumbers: string[];
}

const PROCEDURE_RE = /\bCNC[A-Z]{2,6}\s*-\s*\d{2,5}(?:\s*\/\s*\d+)?/gi;
const AWB_RE = /(?<![\d-])(?<!\d\s)\d{3}-\d{8}(?![\d-])/g;
const CUSTOMS_RE = /(?<![\d\-/.])\d{2}-\d{5}(?![\d\-/.])/g;

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function normalizeProcedureRef(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^(CNC[A-Z]{2,6})\s*-\s*(\d{2,5})(?:\s*\/\s*(\d+))?$/);
  if (!m) return cleaned;
  return m[3] ? `${m[1]}-${m[2]} / ${m[3]}` : `${m[1]}-${m[2]}`;
}

export function extractReferences(text: string): ExtractedRefs {
  const source = text ?? "";
  return {
    procedureRefs: unique((source.match(PROCEDURE_RE) ?? []).map(normalizeProcedureRef)),
    awbNumbers: unique(source.match(AWB_RE) ?? []),
    customsFileNumbers: unique(source.match(CUSTOMS_RE) ?? []),
    invoiceNumbers: [],
  };
}

export function mergeRefs(a: ExtractedRefs, b: Partial<ExtractedRefs>): ExtractedRefs {
  return {
    procedureRefs: unique([...a.procedureRefs, ...(b.procedureRefs ?? []).map(normalizeProcedureRef)]),
    awbNumbers: unique([...a.awbNumbers, ...(b.awbNumbers ?? [])]),
    customsFileNumbers: unique([...a.customsFileNumbers, ...(b.customsFileNumbers ?? [])]),
    invoiceNumbers: unique([...a.invoiceNumbers, ...(b.invoiceNumbers ?? [])]),
  };
}
