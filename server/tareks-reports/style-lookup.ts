import { normalizeStyle } from "./style-matcher";

export type StyleReportRow = { reportId: number; style: string };

/**
 * Index report ids by style so a product list can show, per row, whether that
 * style has a Tareks test report.
 *
 * Styles are typed by hand in two unrelated places (tax_calculation_items and
 * tareks_report_styles), so matching is case- and whitespace-insensitive.
 * Keys are the normalized (upper-case, trimmed) style.
 *
 * Pure on purpose — it pulls in no database module, so it stays testable.
 */
export function groupReportIdsByStyle(rows: StyleReportRow[]): Map<string, number[]> {
  const byStyle = new Map<string, Set<number>>();

  for (const row of rows) {
    const style = normalizeStyle(row.style ?? "");
    if (!style) continue;
    if (!byStyle.has(style)) byStyle.set(style, new Set());
    byStyle.get(style)!.add(row.reportId);
  }

  const out = new Map<string, number[]>();
  for (const [style, ids] of byStyle) {
    out.set(style, [...ids].sort((a, b) => a - b));
  }
  return out;
}
