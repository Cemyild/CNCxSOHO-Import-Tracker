import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {}, rawDb: {} }));

import {
  saveAttachmentToProcedure,
  AttachmentTooLargeError,
  AttachmentNotFoundError,
  MAX_ATTACHMENT_BYTES,
} from "./attachment-service";

function makeDeps(overrides: any = {}) {
  const gmail = {
    listMessageIds: vi.fn(),
    getMessage: vi.fn(),
    getAttachment: vi.fn().mockResolvedValue(Buffer.from("PDF içeriği")),
    ...overrides.gmail,
  };

  const store = {
    getAttachmentContext: vi.fn().mockResolvedValue({
      attachment: {
        id: 11, emailId: 3, gmailAttachmentId: "att-1",
        filename: "fatura.pdf", mimeType: "application/pdf",
        sizeBytes: 1024, status: "pending",
      },
      gmailMessageId: "m1",
    }),
    getAccount: vi.fn().mockResolvedValue({
      id: 1, userId: 1, emailAddress: "cem@sirket.com",
      refreshToken: "rt", lastSyncedAt: null, status: "connected",
    }),
    markAttachmentSaved: vi.fn().mockResolvedValue(undefined),
    ...overrides.store,
  };

  const uploadFile = overrides.uploadFile ?? vi.fn().mockResolvedValue("SOHO/CNCALO-112/1-fatura.pdf");
  const createProcedureDocument = overrides.createProcedureDocument ?? vi.fn().mockResolvedValue(77);

  return {
    deps: { store, createGmailClient: () => gmail, uploadFile, createProcedureDocument } as any,
    store, gmail, uploadFile, createProcedureDocument,
  };
}

const input = { attachmentId: 11, procedureId: 5, documentType: "Fatura", userId: 1 };

describe("saveAttachmentToProcedure", () => {
  it("eki indirir, yükler ve prosedür belgesi oluşturur", async () => {
    const { deps, gmail, uploadFile, createProcedureDocument, store } = makeDeps();
    const result = await saveAttachmentToProcedure(input, deps);

    expect(gmail.getAttachment).toHaveBeenCalledWith("m1", "att-1");
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(createProcedureDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "fatura.pdf", type: "Fatura", procedureId: 5, uploadedBy: 1 }),
    );
    expect(store.markAttachmentSaved).toHaveBeenCalledWith(11, {
      storagePath: "SOHO/CNCALO-112/1-fatura.pdf",
      procedureDocumentId: 77,
    });
    expect(result).toEqual({ procedureDocumentId: 77, storagePath: "SOHO/CNCALO-112/1-fatura.pdf" });
  });

  it("ek bulunamazsa hata verir", async () => {
    const { deps } = makeDeps({ store: { getAttachmentContext: vi.fn().mockResolvedValue(null) } });
    await expect(saveAttachmentToProcedure(input, deps)).rejects.toThrow(AttachmentNotFoundError);
  });

  it("çok büyük eki indirmeye kalkışmaz", async () => {
    const { deps, gmail } = makeDeps({
      store: {
        getAttachmentContext: vi.fn().mockResolvedValue({
          attachment: {
            id: 11, emailId: 3, gmailAttachmentId: "att-1", filename: "büyük.zip",
            mimeType: "application/zip", sizeBytes: MAX_ATTACHMENT_BYTES + 1, status: "pending",
          },
          gmailMessageId: "m1",
        }),
      },
    });
    await expect(saveAttachmentToProcedure(input, deps)).rejects.toThrow(AttachmentTooLargeError);
    expect(gmail.getAttachment).not.toHaveBeenCalled();
  });

  it("yükleme başarısız olursa veritabanına hiçbir şey yazmaz", async () => {
    const { deps, store, createProcedureDocument } = makeDeps({
      uploadFile: vi.fn().mockRejectedValue(new Error("S3 down")),
    });
    await expect(saveAttachmentToProcedure(input, deps)).rejects.toThrow("S3 down");
    expect(createProcedureDocument).not.toHaveBeenCalled();
    expect(store.markAttachmentSaved).not.toHaveBeenCalled();
  });

  it("mail hesabı bağlı değilse hata verir", async () => {
    const { deps } = makeDeps({ store: { getAccount: vi.fn().mockResolvedValue(null) } });
    await expect(saveAttachmentToProcedure(input, deps)).rejects.toThrow(/bağlı/i);
  });
});
