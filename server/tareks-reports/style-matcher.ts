/**
 * Detects product style numbers inside a Tareks test-report filename.
 *
 * Real filenames from the archive look like:
 *   "A0059U Test raporu.pdf"
 *   "M3245R - BURGUNDY.pdf"
 *   "AWFOSR1085-001.pdf"
 *   "M3732R -  M5251R - 2856984 - Ticaret Bakanlığı (Softline) - A26857186 - ...pdf"
 *   "M3193R - 260059838_-_TAREKS_NO_A26638221_-_MODEL_NO_.pdf"
 *
 * Two hazards drive the design:
 *   1. Style formats vary wildly (W3956R, A0690U, AWSNSN1056, W31084R) so a
 *      single regex is unreliable — the product catalogue is matched first.
 *   2. Filenames also carry TAREKS ids (A26638221) and order numbers
 *      (2600003016) that look style-ish. The fallback pattern caps the digit
 *      run at 6 so those never qualify.
 *
 * Detection is a *suggestion*: the upload screen lets the user fix it.
 */

/** Uppercase, trim, and strip punctuation that clings to a style token. */
export function normalizeStyle(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/^[^A-Z0-9]+/, "")
    .replace(/[^A-Z0-9]+$/, "");
}

/** Styles not in the catalogue: 1-6 letters + 3-6 digits + optional letter. */
const FALLBACK_STYLE = /\b[A-Z]{1,6}\d{3,6}[A-Z]?\b/g;

function stripExtension(filename: string): string {
  return filename.replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

/** True when the match is not glued to further letters/digits on either side. */
function isStandalone(haystack: string, start: number, end: number): boolean {
  const before = start > 0 ? haystack[start - 1] : "";
  const after = end < haystack.length ? haystack[end] : "";
  return !/[A-Z0-9]/.test(before) && !/[A-Z0-9]/.test(after);
}

/**
 * Returns the styles found in `filename`, in the order they appear, without
 * duplicates. `knownStyles` is the product catalogue (products.style).
 */
export function detectStyles(filename: string, knownStyles: string[]): string[] {
  const haystack = stripExtension(filename).toUpperCase();

  // Position → style, so results can be sorted back into filename order.
  const hits = new Map<number, string>();
  const claimed: Array<[number, number]> = [];

  const overlapsClaimed = (start: number, end: number) =>
    claimed.some(([s, e]) => start < e && end > s);

  // Pass 1: catalogue matches, longest first so "AMFOSR1095" wins over a
  // shorter catalogue entry that happens to be a substring of it.
  const sorted = [...new Set(knownStyles.map(normalizeStyle))]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const style of sorted) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(style, from);
      if (at === -1) break;
      const end = at + style.length;
      if (isStandalone(haystack, at, end) && !overlapsClaimed(at, end)) {
        hits.set(at, style);
        claimed.push([at, end]);
      }
      from = at + 1;
    }
  }

  // Pass 2: fallback pattern for styles missing from the catalogue.
  FALLBACK_STYLE.lastIndex = 0;
  for (const m of haystack.matchAll(FALLBACK_STYLE)) {
    const at = m.index ?? -1;
    if (at < 0) continue;
    const end = at + m[0].length;
    if (overlapsClaimed(at, end)) continue;
    hits.set(at, m[0]);
    claimed.push([at, end]);
  }

  const ordered = [...hits.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  return [...new Set(ordered)];
}

/** Replace characters that are illegal inside a ZIP path. */
export function sanitizeZipSegment(s: string): string {
  return s.replace(/[\/\:\*\?"<>|]/g, "_").replace(/_+/g, "_").trim();
}

export type ZipCandidate = {
  id: number;
  originalFilename: string;
  styles: string[];
};

export type ZipPath = { id: number; pathInZip: string };

/**
 * Lays out the selected reports inside the ZIP: one folder per style, so the
 * downloaded archive says which product each report belongs to. A report that
 * covers several styles is copied into each of their folders. Reports with no
 * style land in `_NO_STYLE`.
 */
export function buildZipPaths(reports: ZipCandidate[]): ZipPath[] {
  const usedPerFolder = new Map<string, Set<string>>();
  const out: ZipPath[] = [];

  for (const report of reports) {
    const folders = report.styles.length > 0
      ? report.styles.map((s) => sanitizeZipSegment(normalizeStyle(s)) || "_NO_STYLE")
      : ["_NO_STYLE"];

    for (const folder of folders) {
      if (!usedPerFolder.has(folder)) usedPerFolder.set(folder, new Set());
      const used = usedPerFolder.get(folder)!;

      const clean = sanitizeZipSegment(report.originalFilename) || "rapor.pdf";
      let name = clean;
      if (used.has(name)) {
        const dot = clean.lastIndexOf(".");
        const base = dot > 0 ? clean.slice(0, dot) : clean;
        const ext = dot > 0 ? clean.slice(dot) : "";
        let n = 2;
        while (used.has(`${base} (${n})${ext}`)) n++;
        name = `${base} (${n})${ext}`;
      }
      used.add(name);
      out.push({ id: report.id, pathInZip: `${folder}/${name}` });
    }
  }

  return out;
}
