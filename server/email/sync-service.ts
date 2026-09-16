import { randomUUID } from "crypto";
import * as defaultStore from "./store";
import {
  buildSearchQuery,
  createImapClient as defaultCreateMailClient,
  type MailClient,
} from "./imap-client";
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
/** Tur başına onarılacak eksik konu kimliği sayısı. */
export const MAX_THREAD_REPAIR_PER_RUN = 50;

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
  createMailClient: typeof defaultCreateMailClient;
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
  const createClient = overrides.createMailClient ?? defaultCreateMailClient;
  const summarize = overrides.summarize ?? defaultSummarize;
  const matcherDeps = overrides.matcherDeps ?? createDbMatcherDeps();
  const now = overrides.now ?? (() => new Date());

  const result: SyncResult = { fetched: 0, inserted: 0, processed: 0, failed: 0 };
  let mail: MailClient | null = null;

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
    const firstRunFloor = startedAt.getTime() - FIRST_RUN_LOOKBACK_MS;
    const afterMs = account.lastSyncedAt
      ? Math.min(account.lastSyncedAt.getTime() - OVERLAP_MS, startedAt.getTime() - OVERLAP_MS)
      : firstRunFloor;
    const queries = buildSearchQuery(patterns, Math.floor(afterMs / 1000));

    // IMAP bağlantısı durumludur; tur bitince mutlaka kapatılır.
    mail = createClient({
      emailAddress: account.emailAddress,
      appPassword: account.appPassword,
    });

    // 1) Listele + yeni olanları kaydet
    const ids: string[] = [];
    for (const query of queries) {
      ids.push(...(await mail.listMessageIds(query)));
    }
    const uniqueIds = Array.from(new Set(ids));
    result.fetched = uniqueIds.length;

    const newIds = await store.filterNewMessageIds(uniqueIds);
    for (const id of newIds) {
      try {
        const parsed = await mail.getMessage(id);
        const emailId = await store.insertParsedMessage(account.id, parsed);
        if (emailId !== null) {
          await store.insertAttachments(emailId, parsed.attachments);
          result.inserted++;
        }
      } catch (error) {
        // Tek bir mailin alınamaması turu durdurmaz: zaman damgası yine
        // ilerler, aksi halde aynı bozuk mail her turda tekrar denenir ve
        // sorgu penceresi sonsuza kadar büyür. Mail Gmail'de duruyor.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[email-inbox] mail ${id} alınamadı:`, message);
        result.failed++;
      }
    }

    // 1b) Konu kimliği eksik eski kayıtları onar. Gmail konu kimliği sonradan
    // eklendiği için ilk sürümde kaydedilen mailler gruplanamıyor; IMAP
    // bağlantısı zaten açıkken bunları tamamlıyoruz. Buradaki hata turu bozmaz.
    try {
      const needRepair = await store.listMessagesNeedingThreadId(MAX_THREAD_REPAIR_PER_RUN);
      for (const row of needRepair) {
        // Denemeyi ÖNCE sayıyoruz: mail arşivlenmiş ya da silinmişse istek her
        // turda başarısız olur ve sayaç olmadan bu kayıt kuyruğu sonsuza kadar
        // tıkar (her denemesi bir IMAP çağrısı).
        try {
          await store.markThreadRepairAttempt(row.id);
        } catch (error) {
          console.error(`[email-inbox] onarım sayacı yazılamadı (${row.id}):`, error);
        }

        try {
          const parsed = await mail.getMessage(row.gmailMessageId);
          if (parsed.gmailThreadId && parsed.gmailThreadId !== row.gmailMessageId) {
            await store.setThreadId(row.id, parsed.gmailThreadId);
          }
        } catch (error) {
          console.error(`[email-inbox] konu kimliği onarılamadı (${row.gmailMessageId}):`, error);
        }
      }
    } catch (error) {
      console.error("[email-inbox] konu kimliği onarım adımı atlandı:", error);
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
        try {
          await store.markAiFailed(row.id, message);
        } catch (markError) {
          console.error(`[email-inbox] mail ${row.id} hata durumu yazılamadı:`, markError);
        }
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
    if (mail) {
      try {
        await mail.close();
      } catch (closeError) {
        console.error("[email-inbox] IMAP bağlantısı kapatılamadı:", closeError);
      }
    }
    running = false;
  }
}
