import { randomUUID } from "crypto";
import * as defaultStore from "./store";
import { buildGmailQuery, createGmailClient as defaultCreateGmailClient } from "./gmail-client";
import { parseGmailMessage } from "./message-parser";
import { extractReferences, mergeRefs } from "./reference-extractor";
import { summarizeEmail as defaultSummarize } from "./summarizer";
import {
  createDbMatcherDeps,
  matchEmailToProcedure,
  type MatcherDeps,
} from "./procedure-matcher";

export const OVERLAP_MS = 10 * 60 * 1000;
export const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_AI_PER_RUN = 30;

export interface SyncResult {
  fetched: number;
  inserted: number;
  processed: number;
  failed: number;
  skipped?: "no-account" | "no-senders" | "already-running" | "error";
  error?: string;
}

export interface SyncDeps {
  store: typeof defaultStore;
  createGmailClient: typeof defaultCreateGmailClient;
  summarize: typeof defaultSummarize;
  matcherDeps: MatcherDeps;
  now?: () => Date;
}

let running = false;

export function isSyncRunning(): boolean {
  return running;
}

export async function runSync(overrides: Partial<SyncDeps> = {}): Promise<SyncResult> {
  if (running) {
    return { fetched: 0, inserted: 0, processed: 0, failed: 0, skipped: "already-running" };
  }
  running = true;

  const store = overrides.store ?? defaultStore;
  const createClient = overrides.createGmailClient ?? defaultCreateGmailClient;
  const summarize = overrides.summarize ?? defaultSummarize;
  const matcherDeps = overrides.matcherDeps ?? createDbMatcherDeps();
  const now = overrides.now ?? (() => new Date());

  const result: SyncResult = { fetched: 0, inserted: 0, processed: 0, failed: 0 };

  try {
    const account = await store.getAccount();
    if (!account || account.status === "disconnected") {
      return { ...result, skipped: "no-account" };
    }

    const patterns = await store.listActiveSenderPatterns();
    if (patterns.length === 0) {
      return { ...result, skipped: "no-senders" };
    }

    const startedAt = now();
    const afterMs = account.lastSyncedAt
      ? account.lastSyncedAt.getTime() - OVERLAP_MS
      : startedAt.getTime() - FIRST_RUN_LOOKBACK_MS;
    const queries = buildGmailQuery(patterns, Math.floor(afterMs / 1000));

    const gmail = createClient({ refreshToken: account.refreshToken });

    // 1) Listele + yeni olanları kaydet
    const ids: string[] = [];
    for (const query of queries) {
      ids.push(...(await gmail.listMessageIds(query)));
    }
    result.fetched = ids.length;

    const newIds = await store.filterNewMessageIds(Array.from(new Set(ids)));
    for (const id of newIds) {
      const parsed = parseGmailMessage(await gmail.getMessage(id));
      const emailId = await store.insertParsedMessage(account.id, parsed);
      if (emailId !== null) {
        await store.insertAttachments(emailId, parsed.attachments);
        result.inserted++;
      }
    }

    // Liste adımı sorunsuz bittiyse zaman damgasını ilerlet.
    // Bilerek AI adımından ÖNCE: Claude kesintisi saati durdurmasın, aynı mailler
    // sonsuza dek yeniden listelenmesin.
    await store.markAccountSynced(account.id, startedAt);

    // 2) Bekleyenleri özetle + eşleştir (buradaki hatalar turu bozmaz)
    const pending = await store.listPendingForAi(MAX_AI_PER_RUN);
    for (const row of pending) {
      try {
        const summary = await summarize({
          fromName: row.fromName ?? "",
          fromAddress: row.fromAddress ?? "",
          subject: row.subject ?? "",
          sentAt: row.sentAt ?? new Date(),
          bodyText: row.bodyText ?? "",
          attachmentNames: row.attachmentNames ?? [],
        });

        const refs = mergeRefs(
          extractReferences(`${row.subject ?? ""}\n${row.bodyText ?? ""}`),
          summary.references,
        );

        const match = await matchEmailToProcedure(
          {
            refs,
            fromAddress: row.fromAddress ?? "",
            subject: row.subject ?? "",
            summary: summary.summary,
          },
          matcherDeps,
        );

        await store.saveAiResult(row.id, {
          summary: summary.summary,
          category: summary.category,
          urgency: summary.urgency,
          actionItems: summary.actionItems.map((text) => ({
            id: randomUUID(),
            text,
            done: false,
          })),
          extractedRefs: refs,
          procedureId: match.procedureId,
          matchConfidence: match.confidence,
          matchReason: match.reason,
        });
        result.processed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[email-inbox] mail ${row.id} işlenemedi:`, message);
        await store.markAiFailed(row.id, message);
        result.failed++;
      }
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[email-inbox] senkron hatası:", message);
    try {
      const account = await store.getAccount();
      if (account) await store.markAccountError(account.id, message);
    } catch {
      // hesap okunamıyorsa yapacak bir şey yok
    }
    return { ...result, skipped: "error", error: message };
  } finally {
    running = false;
  }
}
