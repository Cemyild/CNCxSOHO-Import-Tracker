export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

const STATUSES = ["new", "read", "done"];
const CATEGORIES = ["payment", "document", "customs", "shipment", "other"];
const URGENCIES = ["high", "normal", "low"];

export interface MessageFilter {
  status?: string;
  category?: string;
  urgency?: string;
  matched?: "yes" | "no" | "other";
  sender?: string;
  q?: string;
  procedureId?: number;
  limit: number;
  offset: number;
}

function oneOf(value: unknown, allowed: string[]): string | undefined {
  return typeof value === "string" && allowed.includes(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function readMessageFilter(query: Record<string, unknown>): MessageFilter {
  const limitRaw = Number(query.limit);
  const offsetRaw = Number(query.offset);

  const filter: MessageFilter = {
    limit:
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.floor(Math.min(limitRaw, MAX_LIMIT))
        : DEFAULT_LIMIT,
    offset: Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0,
  };

  const status = oneOf(query.status, STATUSES);
  if (status) filter.status = status;
  const category = oneOf(query.category, CATEGORIES);
  if (category) filter.category = category;
  const urgency = oneOf(query.urgency, URGENCIES);
  if (urgency) filter.urgency = urgency;
  const matched = oneOf(query.matched, ["yes", "no", "other"]);
  if (matched) filter.matched = matched as "yes" | "no" | "other";
  const sender = text(query.sender);
  if (sender) filter.sender = sender;
  const q = text(query.q);
  if (q) filter.q = q;
  const procedureId = parseId(query.procedureId);
  if (procedureId !== null) filter.procedureId = procedureId;

  return filter;
}

/** Yol parametresinden pozitif tam sayı okur; geçersizse null. */
export function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** ILIKE kalıbındaki joker karakterleri kaçırır. */
export function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}
