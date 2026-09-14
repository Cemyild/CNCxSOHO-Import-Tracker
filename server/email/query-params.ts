export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

const STATUSES = ["new", "read", "done"];
const CATEGORIES = ["payment", "document", "customs", "shipment", "other"];
const URGENCIES = ["high", "normal", "low"];

export interface MessageFilter {
  status?: string;
  category?: string;
  urgency?: string;
  matched?: "yes" | "no";
  sender?: string;
  q?: string;
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
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0,
  };

  const status = oneOf(query.status, STATUSES);
  if (status) filter.status = status;
  const category = oneOf(query.category, CATEGORIES);
  if (category) filter.category = category;
  const urgency = oneOf(query.urgency, URGENCIES);
  if (urgency) filter.urgency = urgency;
  const matched = oneOf(query.matched, ["yes", "no"]);
  if (matched) filter.matched = matched as "yes" | "no";
  const sender = text(query.sender);
  if (sender) filter.sender = sender;
  const q = text(query.q);
  if (q) filter.q = q;

  return filter;
}
