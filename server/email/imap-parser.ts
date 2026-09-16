/**
 * IMAP tarafındaki saf çözümleme. Gmail API'si bize hazır JSON veriyordu;
 * IMAP'te ise önce mesajın yapısını (BODYSTRUCTURE) alıp hangi parçanın gövde,
 * hangilerinin ek olduğunu kendimiz kararlaştırıyoruz. Ekler bu aşamada
 * İNDİRİLMEZ — yalnızca parça numarası ve üst verisi tutulur; indirme, admin
 * "prosedüre kaydet" dediğinde olur.
 */

import { htmlToText, MAX_BODY_CHARS, type ParsedAttachment, type ParsedMessage } from "./message-parser";

export const DEFAULT_CHARSET = "utf-8";
export const SNIPPET_CHARS = 200;

export interface ImapStructureNode {
  /** IMAP parça numarası ("1", "1.2", ...). Yoksa parça ayrıca çekilemez. */
  part?: string;
  type: string;
  parameters?: Record<string, string>;
  /** Content-ID. Doluysa parça mailin gövdesinde gösteriliyor demektir. */
  id?: string;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  size?: number;
  childNodes?: ImapStructureNode[];
}

export interface ImapStructureResult {
  textPart: string | null;
  textType: "text/plain" | "text/html" | null;
  textCharset: string;
  attachments: ParsedAttachment[];
}

export interface ImapEnvelope {
  from?: Array<{ name?: string; address?: string }>;
  to?: Array<{ name?: string; address?: string }>;
  subject?: string;
  date?: Date;
}

/** Dosya adı taşıyan her parça ektir; adı iki yerden gelebilir. */
function filenameOf(node: ImapStructureNode): string {
  return node.dispositionParameters?.filename ?? node.parameters?.name ?? "";
}

/**
 * Gömülü olmasına rağmen imza sayılmayacak büyüklük. Gönderici gövdeye gerçek
 * bir fotoğraf (hasar tutanağı, damga) yapıştırmış olabilir; imza logoları
 * pratikte bu boyutun çok altında kalıyor.
 */
export const SIGNATURE_IMAGE_MAX_BYTES = 100_000;

/** Outlook ve Gmail imza resimlerini image001.png ya da image.png diye adlandırır. */
const AUTO_IMAGE_NAME = /^image\d*\.(png|jpe?g|gif|bmp)$/i;

/**
 * Mail imzasındaki logo/resim mi? Bu parçalar gövdenin içinde gösterilmek
 * üzere taşınıyor, kullanıcının "eki" değiller — listede gürültü yapıyorlar.
 * Yalnızca RESİM parçaları imza sayılabilir: gövdede gösterilen bir PDF bile
 * gerçek belgedir.
 */
export function isSignatureImage(node: ImapStructureNode): boolean {
  const filename = filenameOf(node);
  if (filename === "") return false;
  if (!(node.type ?? "").toLowerCase().startsWith("image/")) return false;

  // Otomatik ad kesin işarettir, boyuta bakmadan eleriz.
  if (AUTO_IMAGE_NAME.test(filename)) return true;

  // Gövdeye gömülü ama adı anlamlı olan resimler: yalnızca küçükse imza sayılır.
  const embedded = (node.disposition ?? "").toLowerCase() === "inline" || Boolean(node.id);
  return embedded && (node.size ?? 0) < SIGNATURE_IMAGE_MAX_BYTES;
}

export function analyzeBodyStructure(root: ImapStructureNode): ImapStructureResult {
  const attachments: ParsedAttachment[] = [];
  let plain: ImapStructureNode | null = null;
  let html: ImapStructureNode | null = null;

  const walk = (node: ImapStructureNode | undefined): void => {
    if (!node) return;

    const filename = filenameOf(node);
    if (filename !== "") {
      // Dosya adı olan parça asla gövde sayılmaz. Parça numarası yoksa sonradan
      // indirilemeyeceği için listelenmez de; imza resimleri de listelenmez.
      if (node.part && !isSignatureImage(node)) {
        attachments.push({
          gmailAttachmentId: node.part,
          filename,
          mimeType: node.type ?? "application/octet-stream",
          sizeBytes: node.size ?? 0,
        });
      }
    } else if (node.type === "text/plain") {
      plain ??= node;
    } else if (node.type === "text/html") {
      html ??= node;
    }

    for (const child of node.childNodes ?? []) walk(child);
  };

  walk(root);

  const chosen = plain ?? html;
  if (!chosen) {
    return { textPart: null, textType: null, textCharset: DEFAULT_CHARSET, attachments };
  }

  return {
    // Çok parçalı olmayan mailde kök düğümün parça numarası olmaz; gövde "1"dir.
    textPart: chosen.part ?? "1",
    textType: chosen.type as "text/plain" | "text/html",
    textCharset: (chosen.parameters?.charset ?? DEFAULT_CHARSET).toLowerCase(),
    attachments,
  };
}

/** Gövde baytlarını maildeki karakter kümesine göre metne çevirir. */
export function decodeTextPart(buffer: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

export function buildParsedMessage(input: {
  uid: string;
  /** Gmail'in X-GM-THRID değeri; aynı konuşmadaki mailler bunu paylaşır. */
  threadId?: string | null;
  envelope: ImapEnvelope;
  structure: ImapStructureNode;
  textContent: string;
  textType?: "text/plain" | "text/html" | null;
}): ParsedMessage {
  const analysis = analyzeBodyStructure(input.structure);
  const type = input.textType ?? analysis.textType;
  const decoded = type === "text/html" ? htmlToText(input.textContent) : input.textContent;
  const bodyText = decoded.slice(0, MAX_BODY_CHARS);

  const from = input.envelope.from?.[0];
  const to = input.envelope.to?.[0];

  return {
    gmailMessageId: input.uid,
    // Gmail konu kimliği verirse aynı konuşmadaki mailler gruplanabilir;
    // vermezse her mail kendi başına bir konuşma sayılır.
    gmailThreadId: input.threadId || input.uid,
    fromAddress: (from?.address ?? "").toLowerCase(),
    fromName: from?.name ?? "",
    toAddress: (to?.address ?? "").toLowerCase(),
    subject: input.envelope.subject ?? "",
    sentAt: input.envelope.date ?? new Date(),
    snippet: bodyText.slice(0, SNIPPET_CHARS),
    bodyText,
    attachments: analysis.attachments,
  };
}
