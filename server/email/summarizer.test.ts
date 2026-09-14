import { describe, it, expect, vi } from "vitest";
import { parseSummaryJson, summarizeEmail, SummaryParseError } from "./summarizer";

const validJson = JSON.stringify({
  summary: "ISS Global, CNCALO-112 sevkiyatı için orijinal konşimento istiyor.",
  category: "document",
  urgency: "high",
  actionItems: ["Orijinal konşimentoyu ISS Global'e gönder"],
  references: {
    procedureRefs: ["CNCALO-112"],
    awbNumbers: [],
    invoiceNumbers: [],
    customsFileNumbers: [],
  },
});

describe("parseSummaryJson", () => {
  it("düz JSON'u ayrıştırır", () => {
    const r = parseSummaryJson(validJson);
    expect(r.category).toBe("document");
    expect(r.urgency).toBe("high");
    expect(r.actionItems).toEqual(["Orijinal konşimentoyu ISS Global'e gönder"]);
    expect(r.references.procedureRefs).toEqual(["CNCALO-112"]);
  });

  it("kod bloğu içindeki JSON'u ayrıştırır", () => {
    const wrapped = "İşte sonuç:\n```json\n" + validJson + "\n```";
    expect(parseSummaryJson(wrapped).category).toBe("document");
  });

  it("bilinmeyen kategoriyi 'other'a düşürür", () => {
    const r = parseSummaryJson(JSON.stringify({ ...JSON.parse(validJson), category: "uydurma" }));
    expect(r.category).toBe("other");
  });

  it("bilinmeyen aciliyeti 'normal'a düşürür", () => {
    const r = parseSummaryJson(JSON.stringify({ ...JSON.parse(validJson), urgency: "çok acil" }));
    expect(r.urgency).toBe("normal");
  });

  it("eksik alanları güvenli varsayılanlarla doldurur", () => {
    const r = parseSummaryJson(JSON.stringify({ summary: "kısa özet" }));
    expect(r.actionItems).toEqual([]);
    expect(r.references.procedureRefs).toEqual([]);
  });

  it("JSON olmayan cevabı reddeder", () => {
    expect(() => parseSummaryJson("Bu bir cevap değil")).toThrow(SummaryParseError);
  });

  it("özet metni yoksa reddeder", () => {
    expect(() => parseSummaryJson(JSON.stringify({ category: "other" }))).toThrow(SummaryParseError);
  });
});

describe("summarizeEmail", () => {
  const input = {
    fromName: "ISS Global",
    fromAddress: "ops@issglobal.com",
    subject: "CNCALO-112 evrak",
    sentAt: new Date("2026-09-14T10:00:00Z"),
    bodyText: "Orijinal konşimento lazım.",
    attachmentNames: ["fatura.pdf"],
  };

  it("Claude'un cevabını ayrıştırıp döner", async () => {
    const analyzeText = vi.fn().mockResolvedValue(validJson);
    const result = await summarizeEmail(input, { analyzeText });
    expect(result.summary).toContain("CNCALO-112");
    expect(analyzeText).toHaveBeenCalledTimes(1);
  });

  it("istemde mail içeriğini veri olarak işaretler", async () => {
    const analyzeText = vi.fn().mockResolvedValue(validJson);
    await summarizeEmail(input, { analyzeText });
    const prompt = analyzeText.mock.calls[0][0] as string;
    expect(prompt).toContain("Orijinal konşimento lazım.");
    expect(prompt).toContain("<mail_icerigi>");
    const system = analyzeText.mock.calls[0][1] as string;
    expect(system.toLowerCase()).toContain("talimat");
  });

  it("ilk cevap bozuksa bir kez daha dener", async () => {
    const analyzeText = vi
      .fn()
      .mockResolvedValueOnce("bozuk cevap")
      .mockResolvedValueOnce(validJson);
    const result = await summarizeEmail(input, { analyzeText });
    expect(result.category).toBe("document");
    expect(analyzeText).toHaveBeenCalledTimes(2);
  });

  it("ikinci deneme de bozuksa hata fırlatır", async () => {
    const analyzeText = vi.fn().mockResolvedValue("bozuk");
    await expect(summarizeEmail(input, { analyzeText })).rejects.toThrow(SummaryParseError);
    expect(analyzeText).toHaveBeenCalledTimes(2);
  });
});
