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

/**
 * Kesildikten sonra bu kadarından azı kalıyorsa kesme yanlış yapılmış sayılır.
 * Düşük tutuluyor: "Merhaba, evrakları gönderdim." gibi kısa ama gerçek cevaplar
 * da kesilebilmeli; eşik yalnızca işaretin mailin en başında çıktığı durumu
 * (yani aslında alıntı olmayan metni) elemek için var.
 */
export const MIN_KEPT_CHARS = 10;

/**
 * Cevap zincirinde altta taşınan eski yazışmayı atar.
 *
 * Gerçek veride bir mailin yeni içeriği ~350 karakterken gövdenin tamamı 20.000
 * karakteri buluyordu; geri kalanı önceki maillerin kopyasıydı. Modele hepsini
 * vermek, çoktan halledilmiş konulardan yeni "yapılacak" üretmesine yol açıyordu.
 *
 * Yalnızca yapay zekâya gönderilen metni kısaltır — saklanan gövde tam kalır,
 * "orijinali göster" ve arama tam metin üzerinde çalışmaya devam eder.
 */
const QUOTE_MARKERS: RegExp[] = [
  // Outlook: "From: ... Sent: ..." (satır başında, İngilizce ve Türkçe)
  /^[ \t]*From:.*(?:\r?\n.*){0,3}?\r?\n[ \t]*Sent:/im,
  /^[ \t]*Kimden:.*(?:\r?\n.*){0,3}?\r?\n[ \t]*Gönderilen:/im,
  /^[ \t]*-{2,}\s*Original Message\s*-{2,}/im,
  /^[ \t]*-{2,}\s*Özgün İleti\s*-{2,}/im,
  // Gmail: "On <tarih> ... wrote:" / "<tarih> tarihinde ... yazdı:"
  /^[ \t]*On .{0,120}?\bwrote:/im,
  /^[ \t]*\d.{0,120}?\btarihinde .{0,120}?\byazdı:/im,
];

export function stripQuotedHistory(body: string): string {
  if (body === "") return body;

  let cut = -1;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(body);
    if (match && match.index >= 0 && (cut === -1 || match.index < cut)) {
      cut = match.index;
    }
  }

  if (cut === -1) return body;

  const kept = body.slice(0, cut).trimEnd();
  // Kalan neredeyse boşsa işaret büyük ihtimalle mailin kendi içeriğindeydi;
  // metni kaybetmektense fazlasını göndermek yeğdir.
  return kept.trim().length >= MIN_KEPT_CHARS ? kept : body;
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
