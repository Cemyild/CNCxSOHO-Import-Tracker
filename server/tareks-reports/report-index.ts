import { db } from "../db";
import { tareksReportStyles } from "@shared/schema";
import { normalizeStyle } from "./style-matcher";
import { groupReportIdsByStyle } from "./style-lookup";

/**
 * Report ids per style, for the styles asked about. Empty map when none match.
 *
 * The stored style column is not normalized, so the comparison happens in JS
 * rather than SQL; the table holds one row per (report, style) pair and stays
 * small — one report per product, not per shipment.
 */
export async function findReportIdsForStyles(styles: string[]): Promise<Map<string, number[]>> {
  const wanted = new Set(styles.map(normalizeStyle).filter(Boolean));
  if (wanted.size === 0) return new Map();

  const rows = await db.select().from(tareksReportStyles);
  const relevant = rows
    .map((r) => ({ reportId: r.reportId, style: r.style }))
    .filter((r) => wanted.has(normalizeStyle(r.style)));

  return groupReportIdsByStyle(relevant);
}
