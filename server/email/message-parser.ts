/** Gmail users.messages.get(format="full") çıktısını düz bir yapıya çevirir. */

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

function header(payload: any, name: string): string {
  const found = (payload?.headers ?? []).find(
    (h: any) => h?.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

export function parseFromHeader(value: string): { name: string; address: string } {
  const withBrackets = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (withBrackets) {
    return {
      name: withBrackets[1].replace(/^"|"$/g, "").trim(),
      address: withBrackets[2].trim().toLowerCase(),
    };
  }
  return { name: "", address: value.trim().toLowerCase() };
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

function decode(data?: string): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

/** Parça ağacını gezip düz metin, HTML ve ekleri toplar. */
function walk(
  part: any,
  acc: { plain: string[]; html: string[]; attachments: ParsedAttachment[] },
): void {
  if (!part) return;

  const attachmentId = part.body?.attachmentId;
  if (attachmentId) {
    acc.attachments.push({
      gmailAttachmentId: attachmentId,
      filename: part.filename ?? "",
      mimeType: part.mimeType ?? "application/octet-stream",
      sizeBytes: part.body?.size ?? 0,
    });
  } else if (part.mimeType === "text/plain") {
    acc.plain.push(decode(part.body?.data));
  } else if (part.mimeType === "text/html") {
    acc.html.push(decode(part.body?.data));
  }

  for (const child of part.parts ?? []) walk(child, acc);
}

export function parseGmailMessage(raw: any): ParsedMessage {
  const payload = raw?.payload ?? {};
  const acc = { plain: [] as string[], html: [] as string[], attachments: [] as ParsedAttachment[] };
  walk(payload, acc);

  const plain = acc.plain.join("\n").trim();
  const body = plain !== "" ? plain : htmlToText(acc.html.join("\n"));
  const from = parseFromHeader(header(payload, "From"));

  return {
    gmailMessageId: raw?.id ?? "",
    gmailThreadId: raw?.threadId ?? "",
    fromAddress: from.address,
    fromName: from.name,
    toAddress: parseFromHeader(header(payload, "To")).address,
    subject: header(payload, "Subject"),
    sentAt: new Date(Number(raw?.internalDate ?? Date.now())),
    snippet: raw?.snippet ?? "",
    bodyText: body.slice(0, MAX_BODY_CHARS),
    attachments: acc.attachments,
  };
}
