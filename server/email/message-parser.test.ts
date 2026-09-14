import { describe, it, expect } from "vitest";
import { parseGmailMessage, parseFromHeader, htmlToText, MAX_BODY_CHARS } from "./message-parser";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function message(parts: any, headers: Array<[string, string]> = []) {
  return {
    id: "m1",
    threadId: "t1",
    snippet: "önizleme",
    internalDate: "1757836800000",
    payload: {
      headers: [
        ["From", "ISS Global <ops@issglobal.com>"],
        ["To", "cem@sirket.com"],
        ["Subject", "CNCALO-112 evrak"],
        ...headers,
      ].map(([name, value]) => ({ name, value })),
      ...parts,
    },
  };
}

describe("parseGmailMessage", () => {
  it("düz metin gövdeli maili ayrıştırır", () => {
    const parsed = parseGmailMessage(
      message({ mimeType: "text/plain", body: { data: b64("Merhaba Cem, evrak lazım.") } }),
    );
    expect(parsed.gmailMessageId).toBe("m1");
    expect(parsed.gmailThreadId).toBe("t1");
    expect(parsed.fromName).toBe("ISS Global");
    expect(parsed.fromAddress).toBe("ops@issglobal.com");
    expect(parsed.subject).toBe("CNCALO-112 evrak");
    expect(parsed.bodyText).toBe("Merhaba Cem, evrak lazım.");
    expect(parsed.sentAt.getTime()).toBe(1757836800000);
    expect(parsed.attachments).toEqual([]);
  });

  it("çok parçalı mailde text/plain parçasını tercih eder", () => {
    const parsed = parseGmailMessage(
      message({
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64("düz metin") } },
          { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
        ],
      }),
    );
    expect(parsed.bodyText).toBe("düz metin");
  });

  it("yalnızca HTML varsa metne çevirir", () => {
    const parsed = parseGmailMessage(
      message({
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/html", body: { data: b64("<p>Merhaba<br>Cem</p><div>CNCALO-112</div>") } }],
      }),
    );
    expect(parsed.bodyText).toContain("Merhaba");
    expect(parsed.bodyText).toContain("CNCALO-112");
    expect(parsed.bodyText).not.toContain("<p>");
  });

  it("Türkçe karakterleri bozmaz", () => {
    const parsed = parseGmailMessage(
      message({ mimeType: "text/plain", body: { data: b64("Gümrük işlemi tamamlandı, ödeme şart.") } }),
    );
    expect(parsed.bodyText).toBe("Gümrük işlemi tamamlandı, ödeme şart.");
  });

  it("ekleri üst verisiyle listeler, iç içe parçalarda da bulur", () => {
    const parsed = parseGmailMessage(
      message({
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [{ mimeType: "text/plain", body: { data: b64("ekte fatura") } }],
          },
          {
            mimeType: "application/pdf",
            filename: "fatura.pdf",
            body: { attachmentId: "att-1", size: 1234 },
          },
        ],
      }),
    );
    expect(parsed.bodyText).toBe("ekte fatura");
    expect(parsed.attachments).toEqual([
      { gmailAttachmentId: "att-1", filename: "fatura.pdf", mimeType: "application/pdf", sizeBytes: 1234 },
    ]);
  });

  it("gövdeyi üst sınırda kırpar", () => {
    const parsed = parseGmailMessage(
      message({ mimeType: "text/plain", body: { data: b64("x".repeat(MAX_BODY_CHARS + 500)) } }),
    );
    expect(parsed.bodyText.length).toBe(MAX_BODY_CHARS);
  });

  it("eksik başlıklarda çökmez", () => {
    const parsed = parseGmailMessage({ id: "m2", threadId: "t2", payload: {} });
    expect(parsed.subject).toBe("");
    expect(parsed.fromAddress).toBe("");
    expect(parsed.bodyText).toBe("");
  });
});

describe("parseFromHeader", () => {
  it("ad ve adresi ayırır", () => {
    expect(parseFromHeader('"Ops, ISS" <ops@issglobal.com>')).toEqual({
      name: "Ops, ISS", address: "ops@issglobal.com",
    });
  });
  it("yalnızca adres varsa adı boş bırakır", () => {
    expect(parseFromHeader("ops@issglobal.com")).toEqual({ name: "", address: "ops@issglobal.com" });
  });
});

describe("htmlToText", () => {
  it("script ve style içeriğini atar", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Merhaba</p><script>alert(1)</script>")).toBe("Merhaba");
  });
  it("HTML varlıklarını çözer", () => {
    expect(htmlToText("<p>A&nbsp;&amp;&nbsp;B</p>")).toBe("A & B");
  });
});
