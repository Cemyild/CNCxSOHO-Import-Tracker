/**
 * The DB-free, HTTP-free core of the Excel-enrichment feature.
 *
 * Everything below is pure: parse the workbook, map its columns, clean the
 * values, and (for the full pipeline) match rows against candidates. Neither
 * function touches Express, the database, or auth — `server/excel-enrichment.ts`
 * calls into this module for both `/analyze` and `/preview`, and
 * `pipeline.test.ts` exercises it directly against a fixture with no server
 * environment required at all.
 */
import { parseWorkbook, type ParseOverrides } from "./parse-workbook";
import { applyProfile, buildColumnProfile } from "./column-profile";
import { matchRows, type MatchCandidate } from "./match";
import type { EnrichField, MatchedGroup, UnmatchedRow, UnusedColumn } from "./types";

export interface DetectionSummary {
  sheetName: string;
  availableSheets: string[];
  headerRowIndex: number;
  dataRowCount: number;
  skippedRowCount: number;
  mapped: Array<{ field: EnrichField; colIndex: number; header: string }>;
  unusedCandidates: UnusedColumn[];
  unmappedHeaders: string[];
}

export interface PipelineResult {
  detection: DetectionSummary;
  matched: MatchedGroup[];
  unmatched: UnmatchedRow[];
}

/** Parse + column-map a workbook. Shared by `detectStructure` (no matching)
 *  and `runEnrichmentPipeline` (parse + map + match). */
function parseAndProfile(buffer: Buffer, overrides: ParseOverrides) {
  const parsed = parseWorkbook(buffer, overrides);
  const profile = buildColumnProfile(parsed.headers);
  const detection: DetectionSummary = {
    sheetName: parsed.sheetName,
    availableSheets: parsed.availableSheets,
    headerRowIndex: parsed.headerRowIndex,
    dataRowCount: parsed.dataRows.length,
    skippedRowCount: parsed.skippedRows.length,
    mapped: profile.mapped,
    unusedCandidates: profile.unusedCandidates,
    unmappedHeaders: profile.unmappedHeaders,
  };
  return { parsed, profile, detection };
}

/** Structure only — what `/analyze` shows the user before any matching. */
export function detectStructure(
  buffer: Buffer,
  overrides: ParseOverrides = {},
): DetectionSummary {
  return parseAndProfile(buffer, overrides).detection;
}

/**
 * The whole read-only side of the feature, with no database or HTTP in it:
 * parse -> map columns -> clean values -> match -> merge. `/preview` runs
 * this against real candidates; the pipeline test runs it against a fixture.
 */
export function runEnrichmentPipeline(
  buffer: Buffer,
  candidates: MatchCandidate[],
  overrides: ParseOverrides = {},
): PipelineResult {
  const { parsed, profile, detection } = parseAndProfile(buffer, overrides);
  const rows = applyProfile(parsed.dataRows, profile);
  const { matched, unmatched } = matchRows(rows, candidates);
  return { detection, matched, unmatched };
}
