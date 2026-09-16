/**
 * Gmail'e IMAP üzerinden bağlanır. Google Cloud projesi gerekmez; kullanıcı
 * kendi hesabından bir "uygulama şifresi" üretir.
 *
 * Gmail'in IMAP'i X-GM-RAW eklentisini destekliyor, yani Gmail arama kutusundaki
 * sözdiziminin aynısını kullanabiliyoruz — gönderen bazlı sorgumuz olduğu gibi
 * çalışmaya devam ediyor.
 */

import { ImapFlow, type MailboxLockObject } from "imapflow";
import {
  analyzeBodyStructure,
  buildParsedMessage,
  decodeTextPart,
  type ImapStructureNode,
} from "./imap-parser";
import type { ParsedMessage } from "./message-parser";

export const IMAP_HOST = "imap.gmail.com";
export const IMAP_PORT = 993;
export const MAX_SENDERS_PER_QUERY = 25;
/** Tek turda işlenecek en fazla mail; ilk dolumda gelen kuyruğu sınırlar. */
export const MAX_UIDS_PER_RUN = 500;
export const CONNECTION_TIMEOUT_MS = 15000;
export const GREETING_TIMEOUT_MS = 10000;
/** Tek bir IMAP komutunun sessiz kalabileceği süre. */
export const SOCKET_TIMEOUT_MS = 60000;

export interface ImapCredentials {
  emailAddress: string;
  appPassword: string;
}

export interface MailClient {
  listMessageIds(query: string): Promise<string[]>;
  getMessage(uid: string): Promise<ParsedMessage>;
  getAttachment(uid: string, partId: string): Promise<Buffer>;
  close(): Promise<void>;
}

/** Gmail sorgu uzunluğu sınırlı olduğu için gönderen listesi parçalara bölünür. */
export function buildSearchQuery(patterns: string[], afterEpochSeconds: number): string[] {
  const cleaned = patterns
    .map((p) => p.trim().toLowerCase().replace(/^@/, ""))
    .filter((p) => p.length > 0);

  const queries: string[] = [];
  for (let i = 0; i < cleaned.length; i += MAX_SENDERS_PER_QUERY) {
    const chunk = cleaned.slice(i, i + MAX_SENDERS_PER_QUERY);
    queries.push(`(${chunk.map((p) => `from:${p}`).join(" OR ")}) after:${afterEpochSeconds}`);
  }
  return queries;
}

/** IMAP araması UID'leri artan sırada verir; sınırı aşınca en yenileri tutulur. */
export function capUids(uids: number[]): string[] {
  const kept = uids.length > MAX_UIDS_PER_RUN ? uids.slice(-MAX_UIDS_PER_RUN) : uids;
  return kept.map((uid) => String(uid));
}

/** IMAP hatalarını kullanıcının anlayacağı Türkçe mesaja çevirir. */
export function describeImapError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // imapflow yanlış şifrede yalnızca "Command failed" diyor; gerçek sebep
  // hata nesnesindeki bayrakta.
  const authFlag = (error as { authenticationFailed?: boolean } | null)?.authenticationFailed === true;

  if (authFlag || /invalid credentials|authenticationfailed|application-specific password|auth/i.test(raw)) {
    return (
      "Giriş başarısız. Mail adresini ve uygulama şifresini kontrol edin — " +
      "buraya normal Google şifreniz değil, uygulama şifresi girilmeli."
    );
  }
  if (/imap access is disabled|imap is disabled|imap disabled/i.test(raw)) {
    return "Gmail'de IMAP kapalı görünüyor. Gmail → Ayarlar → POP/IMAP bölümünde IMAP erişimi açık olmalı.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|timed out/i.test(raw)) {
    return "Mail sunucusuna bağlanılamadı. İnternet bağlantısını kontrol edip tekrar deneyin.";
  }
  return raw;
}

/**
 * Bağlantı ayarları. Zaman aşımı sınırları şart: sınırsız bırakıldığında
 * bağlantı denemesi hiç cevap dönmeden asılı kalabiliyor ve hem "Bağlan"
 * isteğini hem de senkron turunu kilitliyor.
 */
export function imapOptions(creds: ImapCredentials) {
  return {
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: creds.emailAddress, pass: creds.appPassword },
    // imapflow varsayılan olarak her IMAP komutunu loglar; mail konuları ve
    // kimlik bilgileri sunucu günlüğüne düşmesin diye kapalı.
    logger: false as const,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  };
}

function newConnection(creds: ImapCredentials): ImapFlow {
  return new ImapFlow(imapOptions(creds));
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Bağlantı ilk kullanımda kurulur ve `close()` çağrılana kadar açık kalır —
 * her mail için yeniden bağlanmak Gmail'in eşzamanlı bağlantı sınırını zorlar.
 */
export function createImapClient(creds: ImapCredentials): MailClient {
  let client: ImapFlow | null = null;
  let lock: MailboxLockObject | null = null;

  async function connected(): Promise<ImapFlow> {
    if (client) return client;
    const fresh = newConnection(creds);
    try {
      await fresh.connect();
      lock = await fresh.getMailboxLock("INBOX");
    } catch (error) {
      try {
        await fresh.logout();
      } catch {
        // bağlantı zaten kopmuş olabilir
      }
      throw new Error(describeImapError(error));
    }
    client = fresh;
    return client;
  }

  return {
    async listMessageIds(query: string) {
      const imap = await connected();
      const uids = await imap.search({ gmailRaw: query }, { uid: true });
      return capUids(uids || []);
    },

    async getMessage(uid: string) {
      const imap = await connected();
      const message = await imap.fetchOne(
        uid,
        { envelope: true, bodyStructure: true, threadId: true },
        { uid: true },
      );
      if (!message) throw new Error(`Mail bulunamadı: ${uid}`);

      const structure = message.bodyStructure as unknown as ImapStructureNode;
      const analysis = analyzeBodyStructure(structure);

      let textContent = "";
      if (analysis.textPart) {
        const part = await imap.download(uid, analysis.textPart, { uid: true });
        textContent = decodeTextPart(await readStream(part.content), analysis.textCharset);
      }

      return buildParsedMessage({
        uid,
        threadId: message.threadId ?? null,
        envelope: (message.envelope ?? {}) as any,
        structure,
        textContent,
        textType: analysis.textType,
      });
    },

    async getAttachment(uid: string, partId: string) {
      const imap = await connected();
      const part = await imap.download(uid, partId, { uid: true });
      return readStream(part.content);
    },

    async close() {
      if (lock) {
        lock.release();
        lock = null;
      }
      if (client) {
        try {
          await client.logout();
        } catch {
          // kapanışta hata önemli değil
        }
        client = null;
      }
    },
  };
}

/** Kimlik bilgilerini kaydetmeden önce dener; başarısızsa anlaşılır hata fırlatır. */
export async function testImapConnection(creds: ImapCredentials): Promise<void> {
  const client = createImapClient(creds);
  try {
    // Bağlantı ve INBOX kilidi ilk aramada kurulur; sonuç önemli değil.
    await client.listMessageIds("after:2147483647");
  } finally {
    await client.close();
  }
}
