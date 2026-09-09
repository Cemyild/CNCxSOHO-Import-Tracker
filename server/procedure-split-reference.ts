/**
 * Reference numbering for split procedures.
 *
 * When products are removed from a tax calculation into a new one, both the
 * source and the new procedure get a " / N" suffix so the two parts of the same
 * shipment are recognisable: CNCALO-108 becomes CNCALO-108 / 1 and the new one
 * becomes CNCALO-108 / 2.
 *
 * Everything above loadSplitPlan is pure; loadSplitPlan is the single
 * database-backed entry point routes call.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { procedures } from "@shared/schema";

export interface ParsedReference {
  /** The reference without its " / N" suffix. */
  root: string;
  /** The suffix number, or null when the reference carries none. */
  part: number | null;
}

export interface SplitPlan {
  root: string;
  /** Set only when the source has no number yet and must become " / 1". */
  sourceRename: { from: string; to: string } | null;
  newReference: string;
}

const PART_PATTERN = /^(.+?)\s*\/\s*(\d+)$/;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Escape the wildcards a SQL LIKE pattern would otherwise interpret. */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Read a reference into root + part, tolerating every legacy spacing variant
 * present in live data ("CNCALO-4/1", "CNCALO-83 /1", "CNCALO-49 / 1").
 */
export function parseReference(ref: string): ParsedReference {
  const trimmed = String(ref ?? '').trim();
  const match = trimmed.match(PART_PATTERN);
  if (!match) return { root: trimmed, part: null };
  return { root: match[1].trim(), part: Number(match[2]) };
}

/** Write the canonical spaced form. New references always go through here. */
export function formatSplitReference(root: string, part: number): string {
  return `${root.trim()} / ${part}`;
}

/**
 * Is `candidate` the same shipment as `root`?
 *
 * Guards against prefix collisions: the root "CNCALO-108" must not swallow
 * "CNCALO-1080".
 */
export function isSiblingOf(root: string, candidate: string): boolean {
  const trimmedRoot = root.trim();
  const trimmedCandidate = String(candidate ?? '').trim();
  if (trimmedCandidate === trimmedRoot) return true;
  return new RegExp(`^${escapeRegex(trimmedRoot)}\\s*/\\s*\\d+$`).test(trimmedCandidate);
}

/**
 * Decide the two references a split produces.
 *
 * `siblings` is every candidate reference sharing the root; non-siblings are
 * filtered out here, so callers may over-fetch.
 */
export function planSplit(sourceRef: string, siblings: string[]): SplitPlan {
  const source = String(sourceRef ?? '').trim();
  const { root, part } = parseReference(source);

  // An unnumbered sibling counts as part 1 — that is the number it is about to
  // be given.
  const usedParts = siblings
    .filter((sibling) => isSiblingOf(root, sibling))
    .map((sibling) => parseReference(sibling).part ?? 1);

  const highest = usedParts.length > 0 ? Math.max(...usedParts) : (part ?? 1);

  return {
    root,
    sourceRename: part === null ? { from: source, to: formatSplitReference(root, 1) } : null,
    newReference: formatSplitReference(root, highest + 1),
  };
}

/**
 * Load a procedure and work out what a split from it would be numbered.
 *
 * The LIKE only narrows candidates; planSplit does the real sibling filtering,
 * so a prefix collision such as CNCALO-1080 cannot leak in.
 */
export async function loadSplitPlan(
  procedureId: number,
): Promise<{ source: typeof procedures.$inferSelect; plan: SplitPlan }> {
  const [source] = await db.select().from(procedures).where(eq(procedures.id, procedureId));
  if (!source) throw new Error(`Procedure not found: ${procedureId}`);
  if (!source.reference) throw new Error(`Procedure ${procedureId} has no reference`);

  const { root } = parseReference(source.reference);
  const candidates = await db
    .select({ reference: procedures.reference })
    .from(procedures)
    .where(sql`${procedures.reference} LIKE ${`${likeEscape(root)}%`} ESCAPE '\\'`);

  const siblings = candidates
    .map((row) => row.reference)
    .filter((reference): reference is string => Boolean(reference));

  return { source, plan: planSplit(source.reference, siblings) };
}
