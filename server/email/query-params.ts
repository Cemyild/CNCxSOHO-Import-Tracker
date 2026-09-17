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

export const MAX_ACTION_ITEMS = 100;
export const MAX_ACTION_TEXT = 500;
export const MAX_CLOSE_REASON = 300;

export interface SanitizedActionItem {
  id: string;
  text: string;
  done: boolean;
  autoClosed?: boolean;
  closedReason?: string;
  closedByEmailId?: number;
  closedAt?: string;
}

/**
 * İstemciden gelen yapılacaklar listesini yazmadan önce temizler.
 *
 * Otomatik kapatma kaydı (autoClosed / gerekçe / kaynak mail) KORUNUR: istemci
 * her tikte listenin tamamını geri gönderiyor, bu alanlar düşerse yanlış kapanan
 * bir iş kullanıcının kendi kapattığından ayırt edilemez hale gelir.
 */
export function sanitizeActionItems(items: unknown[]): SanitizedActionItem[] {
  return items.slice(0, MAX_ACTION_ITEMS).map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const mapped: SanitizedActionItem = {
      id: String(item.id ?? "").slice(0, 100),
      text: String(item.text ?? "").slice(0, MAX_ACTION_TEXT),
      done: Boolean(item.done),
    };

    // Tik kaldırıldıysa iş yeniden açılmış demektir; otomatik kapatma kaydı da
    // düşer, yoksa hem açık hem "otomatik kapatıldı" görünen çelişkili bir
    // satır kalır.
    if (item.autoClosed === true && mapped.done) {
      mapped.autoClosed = true;
      mapped.closedReason = String(item.closedReason ?? "").slice(0, MAX_CLOSE_REASON);
      if (Number.isInteger(item.closedByEmailId)) {
        mapped.closedByEmailId = item.closedByEmailId as number;
      }
      if (typeof item.closedAt === "string") {
        mapped.closedAt = item.closedAt.slice(0, 40);
      }
    }

    return mapped;
  });
}
