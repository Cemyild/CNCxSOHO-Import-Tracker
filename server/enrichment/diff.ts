import {
  FIELD_KIND,
  NUMERIC_FIELDS,
  type EnrichField,
  type FieldChange,
  type MatchedGroup,
} from "./types";
import { isJunk } from "./normalize";

const ENRICH_FIELDS = new Set(Object.keys(FIELD_KIND) as EnrichField[]);

/**
 * A field may be filled when the database holds nothing meaningful.
 *
 * "Nothing meaningful" covers NULL, empty/whitespace strings and the "-" / "."
 * placeholders that earlier imports wrote — plus a literal zero on numeric
 * columns, where 0 is a default rather than a measurement.
 */
export function isFillable(field: EnrichField, currentValue: unknown): boolean {
  if (isJunk(currentValue)) return true;
  if (NUMERIC_FIELDS.includes(field)) {
    const parsed = Number(currentValue);
    if (Number.isFinite(parsed) && parsed === 0) return true;
  }
  return false;
}

export function computeChanges(
  group: MatchedGroup,
  procedure: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [rawField, newValue] of Object.entries(group.values)) {
    const field = rawField as EnrichField;
    if (!ENRICH_FIELDS.has(field)) continue;
    if (newValue === undefined || newValue === null || newValue === "") continue;

    const currentValue = procedure[field];
    if (!isFillable(field, currentValue)) continue;

    changes.push({
      field,
      oldValue: (currentValue ?? null) as FieldChange["oldValue"],
      newValue: String(newValue),
    });
  }

  return changes;
}
