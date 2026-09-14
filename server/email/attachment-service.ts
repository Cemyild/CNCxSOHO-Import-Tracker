import { db } from "../db";
import { procedureDocuments } from "@shared/schema";
import { uploadFile as defaultUploadFile } from "../object-storage";
import { createGmailClient as defaultCreateGmailClient } from "./gmail-client";
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

export interface SaveAttachmentInput {
  attachmentId: number;
  procedureId: number;
  documentType: string;
  userId: number;
}

export interface SaveAttachmentDeps {
  store: Pick<typeof defaultStore, "getAttachmentContext" | "getAccount" | "markAttachmentSaved"> & {
    // Opsiyonel: gerçek store bunu her zaman sağlar, ancak testteki sahte
    // store nesnesi sağlamıyor — eksikse referans yerine yedek isim kullanılır.
    getProcedureReference?: typeof defaultStore.getProcedureReference;
  };
  createGmailClient: typeof defaultCreateGmailClient;
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

export function createAttachmentDeps(): SaveAttachmentDeps {
  return {
    store: defaultStore,
    createGmailClient: defaultCreateGmailClient,
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
  if ((attachment.sizeBytes ?? 0) > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError();

  const account = await deps.store.getAccount();
  if (!account) throw new Error("Mail hesabı bağlı değil");

  const gmail = deps.createGmailClient({ refreshToken: account.refreshToken });
  const buffer = await gmail.getAttachment(gmailMessageId, attachment.gmailAttachmentId);
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError();

  const reference =
    (await deps.store.getProcedureReference?.(input.procedureId)) ?? `procedure-${input.procedureId}`;

  const storagePath = await deps.uploadFile(
    buffer,
    attachment.filename || "ek",
    attachment.mimeType || "application/octet-stream",
    reference,
  );

  const procedureDocumentId = await deps.createProcedureDocument({
    name: attachment.filename || "ek",
    type: input.documentType,
    path: storagePath,
    procedureId: input.procedureId,
    uploadedBy: input.userId,
  });

  await deps.store.markAttachmentSaved(input.attachmentId, { storagePath, procedureDocumentId });
  return { procedureDocumentId, storagePath };
}
