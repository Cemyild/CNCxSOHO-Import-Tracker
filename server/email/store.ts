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
    .where(and(eq(emails.aiStatus, "pending"), sql`${emails.aiAttempts} < 3`))
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
  if (filter.matched === "no") conditions.push(sql`${emails.procedureId} IS NULL`);
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

export async function updateMessage(
  id: number,
  patch: {
    status?: string;
    procedureId?: number | null;
    actionItems?: Array<{ id: string; text: string; done: boolean }>;
  },
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status) set.status = patch.status;
  if (patch.actionItems) set.actionItems = patch.actionItems;
  if (patch.procedureId !== undefined) {
    set.procedureId = patch.procedureId;
    set.matchConfidence = patch.procedureId === null ? "none" : "manual";
    set.matchReason = patch.procedureId === null ? null : "Elle eşleştirildi";
  }
  await db.update(emails).set(set).where(eq(emails.id, id));
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
