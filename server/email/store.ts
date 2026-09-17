import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  emailAccounts,
  emailAttachments,
  emailWatchedSenders,
  emails,
  procedures,
  type EmailAccount,
  type EmailRow,
  type WatchedSender,
} from "@shared/schema";
import { encryptToken, decryptToken } from "./token-crypto";
import type { ParsedAttachment, ParsedMessage } from "./message-parser";
import type { ExtractedRefs } from "./reference-extractor";
import type { ClosureDecision, OpenTodo } from "./todo-closer";
import { escapeLikePattern, type MessageFilter } from "./query-params";

// ---------------------------------------------------------------------------
// Sender pattern doğrulama (saf fonksiyonlar — DB'siz test edilir)
// ---------------------------------------------------------------------------

export function normalizeSenderPattern(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Ya tam mail adresi (a@b.com) ya da alan adı kalıbı (@b.com). */
export function isValidSenderPattern(value: string): boolean {
  const v = normalizeSenderPattern(value);
  if (v === "" || /\s/.test(v)) return false;
  if (v.startsWith("@")) return /^@[a-z0-9.-]+\.[a-z]{2,}$/.test(v);
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v);
}

// ---------------------------------------------------------------------------
// email_accounts — tek admin hesabı (OAuth token'ları şifreli saklanır)
// ---------------------------------------------------------------------------

export interface DecryptedAccount {
  id: number;
  userId: number;
  emailAddress: string;
  appPassword: string;
  lastSyncedAt: Date | null;
  status: string;
}

export async function getAccountRow(): Promise<EmailAccount | null> {
  const [row] = await db.select().from(emailAccounts).orderBy(desc(emailAccounts.id)).limit(1);
  return row ?? null;
}

export async function getAccount(): Promise<DecryptedAccount | null> {
  const row = await getAccountRow();
  if (!row || !row.appPassword) return null;
  return {
    id: row.id,
    userId: row.userId,
    emailAddress: row.emailAddress,
    appPassword: decryptToken(row.appPassword),
    lastSyncedAt: row.lastSyncedAt ?? null,
    status: row.status,
  };
}

export interface SaveAccountInput {
  userId: number;
  emailAddress: string;
  appPassword: string;
}

/** Aynı kullanıcı+adres varsa günceller, yoksa ekler. */
export async function saveAccount(input: SaveAccountInput): Promise<void> {
  const values = {
    userId: input.userId,
    emailAddress: input.emailAddress,
    appPassword: encryptToken(input.appPassword),
    status: "connected",
    lastError: null as string | null,
    updatedAt: new Date(),
  };

  await db
    .insert(emailAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: [emailAccounts.userId, emailAccounts.emailAddress],
      set: values,
    });
}

export async function markAccountError(id: number, message: string): Promise<void> {
  await db
    .update(emailAccounts)
    .set({ status: "error", lastError: message.slice(0, 1000), updatedAt: new Date() })
    .where(eq(emailAccounts.id, id));
}

export async function markAccountSynced(id: number, at: Date): Promise<void> {
  await db
    .update(emailAccounts)
    .set({ lastSyncedAt: at, status: "connected", lastError: null, updatedAt: new Date() })
    .where(eq(emailAccounts.id, id));
}

export async function disconnectAccount(id: number): Promise<void> {
  await db
    .update(emailAccounts)
    .set({ status: "disconnected", appPassword: null, updatedAt: new Date() })
    .where(eq(emailAccounts.id, id));
}

// ---------------------------------------------------------------------------
// email_watched_senders — izlenen gönderici kalıpları
// ---------------------------------------------------------------------------

export async function listSenders(): Promise<WatchedSender[]> {
  return db.select().from(emailWatchedSenders).orderBy(emailWatchedSenders.pattern);
}

export async function listActiveSenderPatterns(): Promise<string[]> {
  const rows = await db
    .select({ pattern: emailWatchedSenders.pattern })
    .from(emailWatchedSenders)
    .where(eq(emailWatchedSenders.active, true));
  return rows.map((r) => r.pattern);
}

export async function addSender(input: {
  pattern: string;
  label?: string;
  createdBy: number;
}): Promise<WatchedSender> {
  const [row] = await db
    .insert(emailWatchedSenders)
    .values({
      pattern: normalizeSenderPattern(input.pattern),
      label: input.label ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

export async function updateSender(
  id: number,
  patch: { label?: string; active?: boolean },
): Promise<void> {
  await db.update(emailWatchedSenders).set(patch).where(eq(emailWatchedSenders.id, id));
}

export async function removeSender(id: number): Promise<void> {
  await db.delete(emailWatchedSenders).where(eq(emailWatchedSenders.id, id));
}

// ---------------------------------------------------------------------------
// emails — senkronizasyon (yeni mesaj ekleme, kopya eleme)
// ---------------------------------------------------------------------------

/** Veritabanında zaten olan id'leri eler. */
export async function filterNewMessageIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const known = await db
    .select({ gmailMessageId: emails.gmailMessageId })
    .from(emails)
    .where(inArray(emails.gmailMessageId, ids));
  const seen = new Set(known.map((r) => r.gmailMessageId));
  return ids.filter((id) => !seen.has(id));
}

/** Çakışmada hiçbir şey yapmaz; yarış durumunda çift kayıt oluşmaz. */
export async function insertParsedMessage(
  accountId: number,
  parsed: ParsedMessage,
  direction: string = DIRECTION_INCOMING,
): Promise<number | null> {
  const [row] = await db
    .insert(emails)
    .values({
      accountId,
      gmailMessageId: parsed.gmailMessageId,
      gmailThreadId: parsed.gmailThreadId,
      fromAddress: parsed.fromAddress,
      fromName: parsed.fromName,
      toAddress: parsed.toAddress,
      subject: parsed.subject,
      sentAt: parsed.sentAt,
      snippet: parsed.snippet,
      bodyText: parsed.bodyText,
      hasAttachments: parsed.attachments.length > 0,
      direction,
      // Giden mailden yeni iş çıkarılmaz; özetleme kuyruğuna hiç girmesin.
      aiStatus: direction === DIRECTION_OUTGOING ? "skipped" : "pending",
    })
    .onConflictDoNothing({ target: emails.gmailMessageId })
    .returning({ id: emails.id });
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// email_attachments — ekler
// ---------------------------------------------------------------------------

export async function insertAttachments(
  emailId: number,
  items: ParsedAttachment[],
): Promise<void> {
  if (items.length === 0) return;
  await db.insert(emailAttachments).values(
    items.map((a) => ({
      emailId,
      gmailAttachmentId: a.gmailAttachmentId,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    })),
  );
}

// ---------------------------------------------------------------------------
// AI değerlendirme kuyruğu (özetleme, sınıflandırma, prosedür eşleştirme)
// ---------------------------------------------------------------------------

/**
 * `EmailRow` alanları + o mailin ek dosya adları (boş dizi, ek yoksa).
 * Özetleyici için "bir fatura ekli" bilgisi özeti değiştiren bir sinyal
 * olduğundan dosya adları da döndürülür.
 */
export type PendingEmail = EmailRow & { attachmentNames: string[] };

export const MAX_THREAD_REPAIR_ATTEMPTS = 3;

/**
 * "Bir işleme ait değil ama yapılacak işi var" durumu. Hiç bakılmamış maillerden
 * (match_confidence 'none' veya boş) ayırmak için match_confidence alanında
 * saklanıyor; ayrı bir kolon gerekmiyor.
 */
export const OTHER_BUCKET = "other";

/**
 * Konu kimliği kendi mail kimliğine eşit olan kayıtlar: bunlar Gmail konu
 * kimliği çekilmeden önce kaydedilmişti, senkron turu bunları onarıyor.
 */
export async function listMessagesNeedingThreadId(
  limit: number,
): Promise<Array<{ id: number; gmailMessageId: string }>> {
  return db
    .select({ id: emails.id, gmailMessageId: emails.gmailMessageId })
    .from(emails)
    .where(
      and(
        sql`${emails.gmailThreadId} = ${emails.gmailMessageId}`,
        sql`${emails.threadRepairAttempts} < ${MAX_THREAD_REPAIR_ATTEMPTS}`,
      ),
    )
    .orderBy(desc(emails.id))
    .limit(limit);
}

/** Onarım denemesini sayar; arşivlenmiş/silinmiş mail kuyruğu tıkamasın. */
export async function markThreadRepairAttempt(id: number): Promise<void> {
  await db
    .update(emails)
    .set({ threadRepairAttempts: sql`${emails.threadRepairAttempts} + 1` })
    .where(eq(emails.id, id));
}

export async function setThreadId(id: number, threadId: string): Promise<void> {
  await db
    .update(emails)
    .set({ gmailThreadId: threadId, updatedAt: new Date() })
    .where(eq(emails.id, id));
}

export async function listPendingForAi(limit: number): Promise<PendingEmail[]> {
  const rows = await db
    .select({
      email: emails,
      attachmentNames: sql<string[]>`COALESCE(
        (SELECT array_agg(${emailAttachments.filename})
         FROM ${emailAttachments}
         WHERE ${emailAttachments.emailId} = ${emails.id}
           AND ${emailAttachments.filename} IS NOT NULL),
        ARRAY[]::text[]
      )`,
    })
    .from(emails)
    .where(
      and(
        eq(emails.aiStatus, "pending"),
        eq(emails.direction, DIRECTION_INCOMING),
        sql`${emails.aiAttempts} < 3`,
      ),
    )
    .orderBy(desc(emails.sentAt))
    .limit(limit);

  return rows.map((r) => ({ ...r.email, attachmentNames: r.attachmentNames ?? [] }));
}

export interface AiResultPatch {
  summary: string;
  category: string;
  urgency: string;
  actionItems: Array<{ id: string; text: string; done: boolean }>;
  extractedRefs: ExtractedRefs;
  procedureId: number | null;
  matchConfidence: string;
  matchReason: string | null;
}

export async function saveAiResult(id: number, result: AiResultPatch): Promise<void> {
  await db
    .update(emails)
    .set({
      summary: result.summary,
      category: result.category,
      urgency: result.urgency,
      actionItems: result.actionItems,
      extractedRefs: result.extractedRefs,
      procedureId: result.procedureId,
      matchConfidence: result.matchConfidence,
      matchReason: result.matchReason,
      aiStatus: "ok",
      aiError: null,
      updatedAt: new Date(),
    })
    .where(eq(emails.id, id));
}

export async function markAiFailed(id: number, message: string): Promise<void> {
  await db
    .update(emails)
    .set({
      aiStatus: sql`CASE WHEN ${emails.aiAttempts} + 1 >= 3 THEN 'failed' ELSE 'pending' END`,
      aiAttempts: sql`${emails.aiAttempts} + 1`,
      aiError: message.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(emails.id, id));
}

// ---------------------------------------------------------------------------
// emails — liste, detay, güncelleme (yönetim API'si)
// ---------------------------------------------------------------------------

export interface MessageListItem {
  id: number;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  sentAt: Date | null;
  summary: string | null;
  category: string | null;
  urgency: string | null;
  status: string;
  aiStatus: string;
  hasAttachments: boolean;
  procedureId: number | null;
  procedureReference: string | null;
}

function filterConditions(filter: MessageFilter) {
  const conditions = [];
  if (filter.status) conditions.push(eq(emails.status, filter.status));
  if (filter.category) conditions.push(eq(emails.category, filter.category));
  if (filter.urgency) conditions.push(eq(emails.urgency, filter.urgency));
  if (filter.matched === "yes") conditions.push(sql`${emails.procedureId} IS NOT NULL`);
  if (filter.matched === "no") {
    // Hiç bakılmamış: işleme bağlı değil ve "diğer" olarak da işaretlenmemiş.
    conditions.push(
      sql`${emails.procedureId} IS NULL AND COALESCE(${emails.matchConfidence}, '') <> ${OTHER_BUCKET}`,
    );
  }
  if (filter.matched === "other") {
    conditions.push(
      sql`${emails.procedureId} IS NULL AND ${emails.matchConfidence} = ${OTHER_BUCKET}`,
    );
  }
  if (filter.procedureId !== undefined) conditions.push(eq(emails.procedureId, filter.procedureId));
  if (filter.sender) {
    conditions.push(
      sql`${emails.fromAddress} ILIKE ${`%${escapeLikePattern(filter.sender)}%`} ESCAPE '\\'`,
    );
  }
  if (filter.q) {
    const pattern = `%${escapeLikePattern(filter.q)}%`;
    conditions.push(
      sql`(${emails.subject} ILIKE ${pattern} ESCAPE '\\' OR ${emails.summary} ILIKE ${pattern} ESCAPE '\\' OR ${emails.bodyText} ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  return conditions;
}

export async function listMessages(
  filter: MessageFilter,
): Promise<{ items: MessageListItem[]; total: number }> {
  const conditions = filterConditions(filter);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db
    .select({
      id: emails.id,
      fromName: emails.fromName,
      fromAddress: emails.fromAddress,
      subject: emails.subject,
      sentAt: emails.sentAt,
      summary: emails.summary,
      category: emails.category,
      urgency: emails.urgency,
      status: emails.status,
      aiStatus: emails.aiStatus,
      hasAttachments: emails.hasAttachments,
      procedureId: emails.procedureId,
      procedureReference: procedures.reference,
    })
    .from(emails)
    .leftJoin(procedures, eq(emails.procedureId, procedures.id))
    .where(where)
    .orderBy(desc(emails.sentAt))
    .limit(filter.limit)
    .offset(filter.offset);

  const [{ value }] = await db
    .select({ value: count() })
    .from(emails)
    .where(where);

  return { items, total: Number(value) };
}

export async function procedureExists(id: number): Promise<boolean> {
  const [row] = await db
    .select({ id: procedures.id })
    .from(procedures)
    .where(eq(procedures.id, id))
    .limit(1);
  return !!row;
}

export async function getMessage(id: number) {
  const [row] = await db
    .select({
      email: emails,
      procedureReference: procedures.reference,
      procedureShipper: procedures.shipper,
    })
    .from(emails)
    .leftJoin(procedures, eq(emails.procedureId, procedures.id))
    .where(eq(emails.id, id))
    .limit(1);
  if (!row) return null;

  const attachments = await db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.emailId, id))
    .orderBy(emailAttachments.id);

  return { ...row.email, procedureReference: row.procedureReference, procedureShipper: row.procedureShipper, attachments };
}

export interface MessagePatchInput {
  status?: string;
  procedureId?: number | null;
  /** true: işleme ait değil ama takip edilecek ("Diğer / Yapılacak"). */
  markOther?: boolean;
  actionItems?: Array<{ id: string; text: string; done: boolean }>;
}

/**
 * Gelen isteği yazılacak kolonlara çevirir. Eşleşme alanlarına yalnızca
 * gerçekten eşleşme değiştiğinde dokunulur; "Diğer" ile işlem aynı anda
 * gönderilirse "Diğer" kazanır, çünkü mail aynı anda iki yerde olamaz.
 */
export function buildMessagePatch(patch: MessagePatchInput): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status) set.status = patch.status;
  if (patch.actionItems) set.actionItems = patch.actionItems;

  if (patch.markOther) {
    set.procedureId = null;
    set.matchConfidence = OTHER_BUCKET;
    set.matchReason = "Diğer / yapılacak olarak işaretlendi";
  } else if (patch.procedureId !== undefined) {
    set.procedureId = patch.procedureId;
    set.matchConfidence = patch.procedureId === null ? "none" : "manual";
    set.matchReason = patch.procedureId === null ? null : "Elle eşleştirildi";
  }

  return set;
}

export async function updateMessage(id: number, patch: MessagePatchInput): Promise<void> {
  await db.update(emails).set(buildMessagePatch(patch)).where(eq(emails.id, id));
}

export async function resetForReprocess(id: number): Promise<void> {
  await db
    .update(emails)
    .set({ aiStatus: "pending", aiAttempts: 0, aiError: null, updatedAt: new Date() })
    .where(eq(emails.id, id));
}

// ---------------------------------------------------------------------------
// Ekler — prosedüre kaydetme (Task 13)
// ---------------------------------------------------------------------------

export async function getAttachmentContext(attachmentId: number) {
  const [row] = await db
    .select({ attachment: emailAttachments, gmailMessageId: emails.gmailMessageId })
    .from(emailAttachments)
    .innerJoin(emails, eq(emailAttachments.emailId, emails.id))
    .where(eq(emailAttachments.id, attachmentId))
    .limit(1);
  return row ?? null;
}

export async function markAttachmentSaved(
  attachmentId: number,
  data: { storagePath: string; procedureDocumentId: number },
): Promise<void> {
  await db
    .update(emailAttachments)
    .set({
      storagePath: data.storagePath,
      procedureDocumentId: data.procedureDocumentId,
      status: "saved",
    })
    .where(eq(emailAttachments.id, attachmentId));
}

export async function dismissAttachment(attachmentId: number): Promise<void> {
  await db
    .update(emailAttachments)
    .set({ status: "dismissed" })
    .where(eq(emailAttachments.id, attachmentId));
}

export async function getProcedureReference(procedureId: number): Promise<string | null> {
  const [row] = await db
    .select({ reference: procedures.reference })
    .from(procedures)
    .where(eq(procedures.id, procedureId))
    .limit(1);
  return row?.reference ?? null;
}

// ---------------------------------------------------------------------------
// Konuşma (thread) bazlı liste ve prosedür özetleri
// ---------------------------------------------------------------------------

export interface ThreadListItem {
  threadId: string;
  latestEmailId: number;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  lastSentAt: Date | null;
  summary: string | null;
  category: string | null;
  urgency: string | null;
  status: string;
  aiStatus: string;
  messageCount: number;
  unreadCount: number;
  openActionCount: number;
  hasAttachments: boolean;
  procedureId: number | null;
  procedureReference: string | null;
}

/**
 * Aynı konuşmadaki mailleri tek satırda toplar. Filtre bir konuşmanın
 * HERHANGİ bir mailine uyuyorsa konuşma listeye girer; gösterilen bilgiler
 * konuşmanın en son mailinden gelir.
 */
export async function listThreads(
  filter: MessageFilter,
): Promise<{ items: ThreadListItem[]; total: number }> {
  const conditions = filterConditions(filter);
  const where = conditions.length > 0 ? and(...conditions) : sql`TRUE`;

  // Filtre tek tek maillere uyar; liste ise konuşma gösterir. Bir konuşma,
  // filtreye UYAN maillerinden oluşuyormuş gibi özetlenir: sayaçlar ve
  // gösterilen mail hep filtrenin içinden gelir, aksi halde "okunmamış" filtresi
  // okunmuş bir maili başlık yapardı.
  const matching = sql`
    SELECT * FROM ${emails}
    WHERE ${where} AND ${emails.gmailThreadId} IS NOT NULL
  `;

  const rows = await db.execute<{
    thread_id: string;
    latest_email_id: number;
    subject: string | null;
    from_name: string | null;
    from_address: string | null;
    last_sent_at: Date | null;
    summary: string | null;
    category: string | null;
    urgency: string | null;
    status: string;
    ai_status: string;
    message_count: number;
    unread_count: number;
    open_action_count: number;
    has_attachments: boolean;
    procedure_id: number | null;
    procedure_reference: string | null;
  }>(sql`
    WITH matching AS (${matching}),
    agg AS (
      SELECT m.gmail_thread_id,
             COUNT(*)::int AS message_count,
             COUNT(*) FILTER (WHERE m.status = 'new')::int AS unread_count,
             BOOL_OR(m.has_attachments) AS has_attachments,
             MAX(m.sent_at) AS last_sent_at,
             COALESCE(SUM(
               CASE WHEN jsonb_typeof(m.action_items) = 'array' THEN (
                 SELECT COUNT(*) FROM jsonb_array_elements(m.action_items) ai
                 WHERE COALESCE((ai->>'done')::boolean, false) = false
               ) ELSE 0 END
             ), 0)::int AS open_action_count
      FROM matching m
      GROUP BY m.gmail_thread_id
      -- Yalnızca bizim gönderdiğimiz maillerden oluşan konuşmalar listeyi
      -- kalabalıklaştırmasın; cevap gelince zaten görünürler.
      HAVING BOOL_OR(m.direction = ${DIRECTION_INCOMING})
    )
    SELECT agg.gmail_thread_id AS thread_id,
           agg.message_count, agg.unread_count, agg.has_attachments,
           agg.last_sent_at, agg.open_action_count,
           latest.id AS latest_email_id, latest.subject, latest.from_name,
           latest.from_address, latest.summary, latest.category, latest.urgency,
           latest.status, latest.ai_status, latest.procedure_id,
           p.reference AS procedure_reference
    FROM agg
    JOIN LATERAL (
      SELECT * FROM matching m2
      WHERE m2.gmail_thread_id = agg.gmail_thread_id
      ORDER BY m2.sent_at DESC NULLS LAST, m2.id DESC
      LIMIT 1
    ) latest ON TRUE
    LEFT JOIN procedures p ON p.id = latest.procedure_id
    ORDER BY agg.last_sent_at DESC NULLS LAST, agg.gmail_thread_id
    LIMIT ${filter.limit} OFFSET ${filter.offset}
  `);

  // Sayım da listeyle aynı kuralı uygulamalı: yalnızca gelen maili olan
  // konuşmalar listeleniyor, sayı da onları saymalı.
  const totals = await db.execute<{ value: number }>(sql`
    SELECT COUNT(*)::int AS value FROM (
      SELECT m.gmail_thread_id
      FROM (${matching}) AS m
      GROUP BY m.gmail_thread_id
      HAVING BOOL_OR(m.direction = ${DIRECTION_INCOMING})
    ) AS t
  `);
  const value = totals.rows?.[0]?.value ?? 0;

  return {
    items: (rows.rows ?? []).map((r) => ({
      threadId: r.thread_id,
      latestEmailId: r.latest_email_id,
      subject: r.subject,
      fromName: r.from_name,
      fromAddress: r.from_address,
      lastSentAt: r.last_sent_at,
      summary: r.summary,
      category: r.category,
      urgency: r.urgency,
      status: r.status,
      aiStatus: r.ai_status,
      messageCount: Number(r.message_count),
      unreadCount: Number(r.unread_count),
      openActionCount: Number(r.open_action_count),
      hasAttachments: r.has_attachments,
      procedureId: r.procedure_id,
      procedureReference: r.procedure_reference,
    })),
    total: Number(value),
  };
}

/** Bir konuşmadaki mailler, eskiden yeniye. */
export async function listThreadMessages(threadId: string): Promise<MessageListItem[]> {
  return db
    .select({
      id: emails.id,
      fromName: emails.fromName,
      fromAddress: emails.fromAddress,
      subject: emails.subject,
      sentAt: emails.sentAt,
      summary: emails.summary,
      category: emails.category,
      urgency: emails.urgency,
      status: emails.status,
      aiStatus: emails.aiStatus,
      hasAttachments: emails.hasAttachments,
      direction: emails.direction,
      procedureId: emails.procedureId,
      procedureReference: procedures.reference,
    })
    .from(emails)
    .leftJoin(procedures, eq(emails.procedureId, procedures.id))
    .where(eq(emails.gmailThreadId, threadId))
    .orderBy(emails.sentAt, emails.id);
}

/** "Diğer" olarak işaretlenmiş maillerin yapılacakları. */
export async function listOtherActionItems(): Promise<ProcedureActionItem[]> {
  const rows = await db.execute<any>(sql`
    SELECT e.id AS email_id, e.subject AS email_subject, e.sent_at,
           ai->>'id' AS item_id, ai->>'text' AS text,
           COALESCE((ai->>'done')::boolean, false) AS done,
           COALESCE((ai->>'autoClosed')::boolean, false) AS auto_closed,
           ai->>'closedReason' AS closed_reason
    FROM emails e,
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(e.action_items) = 'array' THEN e.action_items ELSE '[]'::jsonb END
         ) ai
    WHERE e.procedure_id IS NULL AND e.match_confidence = ${OTHER_BUCKET}
    ORDER BY COALESCE((ai->>'done')::boolean, false), e.sent_at DESC NULLS LAST
  `);

  return (rows.rows ?? []).map((r: any) => ({
    emailId: Number(r.email_id),
    emailSubject: r.email_subject,
    sentAt: r.sent_at,
    itemId: r.item_id ?? "",
    text: r.text ?? "",
    done: r.done === true,
    autoClosed: r.auto_closed === true,
    closedReason: r.closed_reason ?? "",
  }));
}

export interface ProcedureMailSummary {
  procedureId: number;
  reference: string | null;
  shipper: string | null;
  messageCount: number;
  threadCount: number;
  openActionCount: number;
  unreadCount: number;
  pendingAttachmentCount: number;
  lastMailAt: Date | null;
}

/** Maili olan işlemler, en son mail alanı üstte. */
export async function listProceduresWithMail(): Promise<ProcedureMailSummary[]> {
  const rows = await db.execute<{
    procedure_id: number;
    reference: string | null;
    shipper: string | null;
    message_count: number;
    thread_count: number;
    open_action_count: number;
    unread_count: number;
    pending_attachment_count: number;
    last_mail_at: Date | null;
  }>(sql`
    SELECT e.procedure_id,
           p.reference,
           p.shipper,
           COUNT(*)::int AS message_count,
           COUNT(DISTINCT e.gmail_thread_id)::int AS thread_count,
           COUNT(*) FILTER (WHERE e.status = 'new')::int AS unread_count,
           MAX(e.sent_at) AS last_mail_at,
           COALESCE(SUM(
             CASE WHEN jsonb_typeof(e.action_items) = 'array' THEN (
               SELECT COUNT(*) FROM jsonb_array_elements(e.action_items) ai
               WHERE COALESCE((ai->>'done')::boolean, false) = false
             ) ELSE 0 END
           ), 0)::int AS open_action_count,
           COALESCE(SUM((
             SELECT COUNT(*) FROM email_attachments a
             WHERE a.email_id = e.id AND a.status = 'pending'
           )), 0)::int AS pending_attachment_count
    FROM emails e
    JOIN procedures p ON p.id = e.procedure_id
    WHERE e.procedure_id IS NOT NULL
    GROUP BY e.procedure_id, p.reference, p.shipper
    ORDER BY MAX(e.sent_at) DESC NULLS LAST
  `);

  return (rows.rows ?? []).map((r) => ({
    procedureId: r.procedure_id,
    reference: r.reference,
    shipper: r.shipper,
    messageCount: Number(r.message_count),
    threadCount: Number(r.thread_count),
    openActionCount: Number(r.open_action_count),
    unreadCount: Number(r.unread_count),
    pendingAttachmentCount: Number(r.pending_attachment_count),
    lastMailAt: r.last_mail_at,
  }));
}

export interface ProcedureMailDocument {
  source: "procedure" | "email";
  /** procedure_documents.id ya da email_attachments.id */
  id: number;
  name: string | null;
  type: string | null;
  createdAt: Date | null;
  /** Yalnızca mailden gelenlerde dolu */
  emailId: number | null;
  emailSubject: string | null;
  status: string | null;
  sizeBytes: number | null;
}

/** İşlemin kendi belgeleri ve maillerinden gelen ekler tek listede. */
export async function listProcedureDocuments(
  procedureId: number,
): Promise<ProcedureMailDocument[]> {
  const own = await db.execute<any>(sql`
    SELECT 'procedure' AS source, d.id, d.name, d.type, d.created_at,
           NULL::int AS email_id, NULL::text AS email_subject,
           NULL::text AS status, NULL::int AS size_bytes
    FROM procedure_documents d
    WHERE d.procedure_id = ${procedureId}
    ORDER BY d.created_at DESC NULLS LAST
  `);

  const fromMail = await db.execute<any>(sql`
    SELECT 'email' AS source, a.id, a.filename AS name, a.mime_type AS type,
           a.created_at, a.email_id, e.subject AS email_subject,
           a.status, a.size_bytes
    FROM email_attachments a
    JOIN emails e ON e.id = a.email_id
    WHERE e.procedure_id = ${procedureId}
      -- Kaydedilen ek zaten procedure_documents'ta listeleniyor; iki kez çıkmasın.
      AND a.procedure_document_id IS NULL
    ORDER BY a.created_at DESC NULLS LAST
  `);

  const map = (r: any): ProcedureMailDocument => ({
    source: r.source,
    id: Number(r.id),
    name: r.name,
    type: r.type,
    createdAt: r.created_at,
    emailId: r.email_id === null ? null : Number(r.email_id),
    emailSubject: r.email_subject,
    status: r.status,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  });

  return [...(own.rows ?? []).map(map), ...(fromMail.rows ?? []).map(map)];
}

export interface ProcedureActionItem {
  emailId: number;
  autoClosed?: boolean;
  closedReason?: string;
  emailSubject: string | null;
  sentAt: Date | null;
  itemId: string;
  text: string;
  done: boolean;
}

/** İşlemin bütün maillerinden çıkan yapılacaklar, tek listede. */
export async function listProcedureActionItems(
  procedureId: number,
): Promise<ProcedureActionItem[]> {
  const rows = await db.execute<any>(sql`
    SELECT e.id AS email_id, e.subject AS email_subject, e.sent_at,
           ai->>'id' AS item_id, ai->>'text' AS text,
           COALESCE((ai->>'done')::boolean, false) AS done,
           COALESCE((ai->>'autoClosed')::boolean, false) AS auto_closed,
           ai->>'closedReason' AS closed_reason
    FROM emails e,
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(e.action_items) = 'array' THEN e.action_items ELSE '[]'::jsonb END
         ) ai
    WHERE e.procedure_id = ${procedureId}
    ORDER BY COALESCE((ai->>'done')::boolean, false), e.sent_at DESC NULLS LAST
  `);

  return (rows.rows ?? []).map((r: any) => ({
    emailId: Number(r.email_id),
    emailSubject: r.email_subject,
    sentAt: r.sent_at,
    itemId: r.item_id ?? "",
    text: r.text ?? "",
    done: r.done === true,
    autoClosed: r.auto_closed === true,
    closedReason: r.closed_reason ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Giden mailler ve işlerin otomatik kapanması
// ---------------------------------------------------------------------------

export const DIRECTION_OUTGOING = "outgoing";
export const DIRECTION_INCOMING = "incoming";

/** Hiç giden mail kaydedildi mi? Geriye dönük tarama kararı buna bakıyor. */
export async function hasOutgoingMail(): Promise<boolean> {
  const [row] = await db
    .select({ id: emails.id })
    .from(emails)
    .where(eq(emails.direction, DIRECTION_OUTGOING))
    .limit(1);
  return !!row;
}

/** Aynı konuşmadaki açık işler; giden mailin hangilerini kapattığı buradan seçilir. */
export async function listOpenTodosInThread(threadId: string): Promise<OpenTodo[]> {
  const rows = await db.execute<any>(sql`
    SELECT e.id AS email_id, ai->>'id' AS item_id, ai->>'text' AS text
    FROM emails e,
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(e.action_items) = 'array' THEN e.action_items ELSE '[]'::jsonb END
         ) ai
    WHERE e.gmail_thread_id = ${threadId}
      AND e.direction = ${DIRECTION_INCOMING}
      AND COALESCE((ai->>'done')::boolean, false) = false
  `);

  return (rows.rows ?? [])
    .map((r: any) => ({
      emailId: Number(r.email_id),
      itemId: r.item_id ?? "",
      text: r.text ?? "",
    }))
    .filter((t: OpenTodo) => t.itemId !== "" && t.text !== "");
}

/**
 * Kararları uygular. İş silinmez: "done" yapılır ve üzerine neden/kaynak
 * yazılır, böylece kullanıcı yanlış kapanmayı görüp geri açabilir.
 */
export async function closeActionItems(
  decisions: ClosureDecision[],
  closedByEmailId: number,
): Promise<number> {
  const byEmail = new Map<number, ClosureDecision[]>();
  for (const decision of decisions) {
    const list = byEmail.get(decision.emailId) ?? [];
    list.push(decision);
    byEmail.set(decision.emailId, list);
  }

  let closed = 0;
  const closedAt = new Date().toISOString();

  for (const [emailId, items] of byEmail) {
    const [row] = await db
      .select({ actionItems: emails.actionItems })
      .from(emails)
      .where(eq(emails.id, emailId))
      .limit(1);
    if (!row || !Array.isArray(row.actionItems)) continue;

    const reasons = new Map(items.map((i) => [i.itemId, i.reason]));
    let changed = false;
    let changedCount = 0;

    const next = (row.actionItems as any[]).map((item) => {
      if (!reasons.has(item?.id) || item?.done === true) return item;
      changed = true;
      changedCount++;
      return {
        ...item,
        done: true,
        autoClosed: true,
        closedReason: reasons.get(item.id) ?? "",
        closedByEmailId,
        closedAt,
      };
    });

    if (changed) {
      await db
        .update(emails)
        .set({ actionItems: next, updatedAt: new Date() })
        .where(eq(emails.id, emailId));
      // Yalnızca gerçekten yazılanlar sayılır.
      closed += changedCount;
    }
  }

  return closed;
}
