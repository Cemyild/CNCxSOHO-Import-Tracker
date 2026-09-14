import { describe, it, expect } from "vitest";
import {
  analyzeBodyStructure,
  decodeTextPart,
  buildParsedMessage,
  type ImapStructureNode,
} from "./imap-parser";

const textPlain = (part: string, charset = "utf-8"): ImapStructureNode => ({
  part,
  type: "text/plain",
  parameters: { charset },
});

const textHtml = (part: string): ImapStructureNode => ({
  part,
  type: "text/html",
  parameters: { charset: "utf-8" },
});

describe("analyzeBodyStructure", () => {
  it("tek parçalı düz metin mailinde gövde parçasını bulur", () => {
    const result = analyzeBodyStructure({ type: "text/plain", parameters: { charset: "utf-8" } });
    expect(result.textPart).toBe("1");
    expect(result.textType).toBe("text/plain");
    expect(result.attachments).toEqual([]);
  });

  it("çok parçalı mailde düz metni HTML'e tercih eder", () => {
    const result = analyzeBodyStructure({
      type: "multipart/alternative",
      childNodes: [textPlain("1"), textHtml("2")],
    });
    expect(result.textPart).toBe("1");
    expect(result.textType).toBe("text/plain");
  });

  it("yalnızca HTML varsa onu gövde olarak seçer", () => {
    const result = analyzeBodyStructure({
      type: "multipart/alternative",
      childNodes: [textHtml("2")],
    });
    expect(result.textPart).toBe("2");
    expect(result.textType).toBe("text/html");
  });

  it("gövde karakter kümesini okur", () => {
    const result = analyzeBodyStructure({
      type: "multipart/alternative",
      childNodes: [textPlain("1", "iso-8859-9")],
    });
    expect(result.textCharset).toBe("iso-8859-9");
  });

  it("karakter kümesi belirtilmemişse utf-8 varsayar", () => {
    const result = analyzeBodyStructure({ part: "1", type: "text/plain" });
    expect(result.textCharset).toBe("utf-8");
  });

  it("iç içe parçalarda gövdeyi ve eki birlikte bulur", () => {
    const result = analyzeBodyStructure({
      type: "multipart/mixed",
      childNodes: [
        { type: "multipart/alternative", childNodes: [textPlain("1.1"), textHtml("1.2")] },
        {
          part: "2",
          type: "application/pdf",
          size: 1234,
          disposition: "attachment",
          dispositionParameters: { filename: "fatura.pdf" },
        },
      ],
    });
    expect(result.textPart).toBe("1.1");
    expect(result.attachments).toEqual([
      {
        gmailAttachmentId: "2",
        filename: "fatura.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1234,
      },
    ]);
  });

  it("dosya adı yalnızca Content-Type parametresindeyse de ek sayar", () => {
    const result = analyzeBodyStructure({
      type: "multipart/mixed",
      childNodes: [
        textPlain("1"),
        { part: "2", type: "image/png", size: 10, parameters: { name: "logo.png" } },
      ],
    });
    expect(result.attachments[0].filename).toBe("logo.png");
  });

  it("dosya adı olan bir metin parçasını gövde sanmaz", () => {
    const result = analyzeBodyStructure({
      type: "multipart/mixed",
      childNodes: [
        textPlain("1"),
        {
          part: "2",
          type: "text/plain",
          size: 20,
          disposition: "attachment",
          dispositionParameters: { filename: "not.txt" },
        },
      ],
    });
    expect(result.textPart).toBe("1");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("not.txt");
  });

  it("parça numarası olmayan eki listelemez", () => {
    const result = analyzeBodyStructure({
      type: "multipart/mixed",
      childNodes: [
        textPlain("1"),
        { type: "application/pdf", size: 5, dispositionParameters: { filename: "kayip.pdf" } },
      ],
    });
    expect(result.attachments).toEqual([]);
  });

  it("hiç metin parçası yoksa null döner", () => {
    const result = analyzeBodyStructure({
      type: "multipart/mixed",
      childNodes: [
        {
          part: "1",
          type: "application/pdf",
          size: 5,
          dispositionParameters: { filename: "a.pdf" },
        },
      ],
    });
    expect(result.textPart).toBeNull();
    expect(result.textType).toBeNull();
  });
});

describe("decodeTextPart", () => {
  it("utf-8 metni çözer", () => {
    expect(decodeTextPart(Buffer.from("Gümrük işlemi", "utf8"), "utf-8")).toBe("Gümrük işlemi");
  });

  it("iso-8859-9 Türkçe metni çözer", () => {
    expect(decodeTextPart(Buffer.from([0x47, 0xfc, 0x6d, 0x72, 0xfc, 0x6b]), "iso-8859-9")).toBe(
      "Gümrük",
    );
  });

  it("bilinmeyen karakter kümesinde utf-8'e düşer", () => {
    expect(decodeTextPart(Buffer.from("merhaba", "utf8"), "uydurma-charset")).toBe("merhaba");
  });
});

describe("buildParsedMessage", () => {
  const envelope = {
    from: [{ name: "ISS Global", address: "OPS@IssGlobal.com" }],
    to: [{ name: "Cem", address: "cem@sirket.com" }],
    subject: "CNCALO-112 evrak",
    date: new Date("2026-09-14T10:00:00Z"),
  };

  const structure: ImapStructureNode = {
    type: "multipart/mixed",
    childNodes: [
      textPlain("1"),
      {
        part: "2",
        type: "application/pdf",
        size: 1234,
        dispositionParameters: { filename: "fatura.pdf" },
      },
    ],
  };

  it("zarf ve gövdeden ParsedMessage üretir", () => {
    const parsed = buildParsedMessage({
      uid: "4711",
      envelope,
      structure,
      textContent: "Orijinal konşimento lazım.",
    });

    expect(parsed.gmailMessageId).toBe("4711");
    expect(parsed.gmailThreadId).toBe("4711");
    expect(parsed.fromName).toBe("ISS Global");
    expect(parsed.fromAddress).toBe("ops@issglobal.com");
    expect(parsed.toAddress).toBe("cem@sirket.com");
    expect(parsed.subject).toBe("CNCALO-112 evrak");
    expect(parsed.sentAt.toISOString()).toBe("2026-09-14T10:00:00.000Z");
    expect(parsed.bodyText).toBe("Orijinal konşimento lazım.");
    expect(parsed.attachments).toHaveLength(1);
  });

  it("HTML gövdeyi düz metne çevirir", () => {
    const parsed = buildParsedMessage({
      uid: "1",
      envelope,
      structure: { type: "text/html", part: "1", parameters: { charset: "utf-8" } },
      textContent: "<p>Merhaba<br>Cem</p>",
      textType: "text/html",
    });
    expect(parsed.bodyText).toContain("Merhaba");
    expect(parsed.bodyText).not.toContain("<p>");
  });

  it("gövdeyi üst sınırda kırpar", () => {
    const parsed = buildParsedMessage({
      uid: "1",
      envelope,
      structure,
      textContent: "x".repeat(25000),
    });
    expect(parsed.bodyText).toHaveLength(20000);
  });

  it("eksik zarf alanlarında çökmez", () => {
    const parsed = buildParsedMessage({
      uid: "9",
      envelope: {},
      structure: { type: "text/plain", part: "1" },
      textContent: "",
    });
    expect(parsed.fromAddress).toBe("");
    expect(parsed.subject).toBe("");
    expect(parsed.toAddress).toBe("");
    expect(parsed.sentAt).toBeInstanceOf(Date);
  });

  it("önizleme metnini gövdenin başından üretir", () => {
    const parsed = buildParsedMessage({
      uid: "1",
      envelope,
      structure,
      textContent: "Bu mailin ilk cümlesi burada duruyor ve önizlemeye girmeli.",
    });
    expect(parsed.snippet.length).toBeLessThanOrEqual(200);
    expect(parsed.snippet).toContain("Bu mailin ilk cümlesi");
  });
});
