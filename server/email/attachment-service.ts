import { db } from "../db";
import { procedureDocuments } from "@shared/schema";
import { uploadFile as defaultUploadFile } from "../object-storage";
import { createImapClient as defaultCreateMailClient } from "./imap-client";
import * as defaultStore from "./store";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class AttachmentTooLargeError extends Error {
  constructor() {
    super("Ek 25 MB'tan büyük; lütfen Gmail'den elle indirip yükleyin");
    this.name = "AttachmentTooLargeError";
  }
}

export class AttachmentNotFoundError extends Error {
  constructor() {
    super("Ek bulunamadı");
    this.name = "AttachmentNotFoundError";
  }
}

export class AttachmentAlreadyHandledError extends Error {
  constructor() {
    super("Bu ek zaten işlendi");
    this.name = "AttachmentAlreadyHandledError";
  }
}

export interface SaveAttachmentInput {
  attachmentId: number;
  procedureId: number;
  documentType: string;
  userId: number;
}

export interface SaveAttachmentDeps {
  store: Pick<
    typeof defaultStore,
    "getAttachmentContext" | "getAccount" | "markAttachmentSaved" | "getProcedureReference"
  >;
  createMailClient: typeof defaultCreateMailClient;
  uploadFile: typeof defaultUploadFile;
  createProcedureDocument(input: {
    name: string;
    type: string;
    path: string;
    procedureId: number;
    uploadedBy: number;
  }): Promise<number>;
}

async function insertProcedureDocument(input: {
  name: string;
  type: string;
  path: string;
  procedureId: number;
  uploadedBy: number;
}): Promise<number> {
  const [row] = await db.insert(procedureDocuments).values(input).returning({ id: procedureDocuments.id });
  return row.id;
}

/** Gönderenin verdiği dosya adını güvenli hale getirir: yol ayırıcıları,
 *  kontrol karakterleri ve aşırı uzunluk temizlenir. */
export function safeFilename(raw: string | null | undefined): string {
  const cleaned = (raw ?? "")
    .replace(/[\/\\]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return cleaned === "" ? "ek" : cleaned.slice(0, 120);
}

export function createAttachmentDeps(): SaveAttachmentDeps {
  return {
    store: defaultStore,
    createMailClient: defaultCreateMailClient,
    uploadFile: defaultUploadFile,
    createProcedureDocument: insertProcedureDocument,
  };
}

/**
 * Eki Gmail'den indirir, S3'e yükler ve prosedür belgesi olarak kaydeder.
 * Sıralama bilinçli: yükleme başarısız olursa veritabanına hiçbir satır yazılmaz.
 */
export async function saveAttachmentToProcedure(
  input: SaveAttachmentInput,
  deps: SaveAttachmentDeps,
): Promise<{ procedureDocumentId: number; storagePath: string }> {
  const context = await deps.store.getAttachmentContext(input.attachmentId);
  if (!context) throw new AttachmentNotFoundError();

  const { attachment, gmailMessageId } = context;
  if (attachment.status !== "pending") throw new AttachmentAlreadyHandledError();
  if ((attachment.sizeBytes ?? 0) > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError();

  const account = await deps.store.getAccount();
  if (!account) throw new Error("Mail hesabı bağlı değil");

  const mail = deps.createMailClient({
    emailAddress: account.emailAddress,
    appPassword: account.appPassword,
  });
  let buffer: Buffer;
  try {
    buffer = await mail.getAttachment(gmailMessageId, attachment.gmailAttachmentId);
  } finally {
    await mail.close().catch(() => {
      // kapanış hatası kaydı engellemez
    });
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError();

  const reference =
    (await deps.store.getProcedureReference(input.procedureId)) ?? `procedure-${input.procedureId}`;
  const filename = safeFilename(attachment.filename);

  const storagePath = await deps.uploadFile(
    buffer,
    filename,
    attachment.mimeType || "application/octet-stream",
    reference,
  );

  const procedureDocumentId = await deps.createProcedureDocument({
    name: filename,
    type: input.documentType,
    path: storagePath,
    procedureId: input.procedureId,
    uploadedBy: input.userId,
  });

  await deps.store.markAttachmentSaved(input.attachmentId, { storagePath, procedureDocumentId });
  return { procedureDocumentId, storagePath };
}
