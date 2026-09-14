/** Mail takibinin ortak tipleri ve HTML→düz metin yardımcısı. */

export const MAX_BODY_CHARS = 20000;

export interface ParsedAttachment {
  gmailAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ParsedMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  fromAddress: string;
  fromName: string;
  toAddress: string;
  subject: string;
  sentAt: Date;
  snippet: string;
  bodyText: string;
  attachments: ParsedAttachment[];
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
