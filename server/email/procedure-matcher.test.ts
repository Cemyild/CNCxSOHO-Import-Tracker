import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {}, rawDb: {} }));

import {
  matchByReferences,
  parseAiMatch,
  matchEmailToProcedure,
  buildShipperHint,
  type ProcedureCandidate,
} from "./procedure-matcher";

const emptyRefs = {
  procedureRefs: [] as string[],
  awbNumbers: [] as string[],
  customsFileNumbers: [] as string[],
  invoiceNumbers: [] as string[],
};

const p = (over: Partial<ProcedureCandidate> & { id: number }): ProcedureCandidate => ({
  reference: null, shipper: null, invoiceNo: null, awbNumber: null,
  customsFileNo: null, arrivalDate: null, ...over,
});

describe("matchByReferences", () => {
  it("tek referans eşleşmesinde exact döner", () => {
    const result = matchByReferences(
      { ...emptyRefs, procedureRefs: ["CNCALO-112"] },
      [p({ id: 5, reference: "CNCALO-112" })],
    );
    expect(result).toEqual({
      procedureId: 5, confidence: "exact", reason: "Referans eşleşmesi: CNCALO-112",
    });
  });

  it("referans karşılaştırmasında boşluk farkını yok sayar", () => {
    const result = matchByReferences(
      { ...emptyRefs, procedureRefs: ["CNCALO-104 / 2"] },
      [p({ id: 9, reference: "CNCALO-104 /2" })],
    );
    expect(result.procedureId).toBe(9);
  });

  it("AWB ile eşleşir", () => {
    const result = matchByReferences(
      { ...emptyRefs, awbNumbers: ["235-51135254"] },
      [p({ id: 3, awbNumber: "235-51135254" })],
    );
    expect(result.confidence).toBe("exact");
    expect(result.procedureId).toBe(3);
  });

  it("gümrük dosya numarası ile eşleşir", () => {
    const result = matchByReferences(
      { ...emptyRefs, customsFileNumbers: ["26-13117"] },
      [p({ id: 4, customsFileNo: "26-13117" })],
    );
    expect(result.procedureId).toBe(4);
  });

  it("birden fazla farklı prosedür eşleşirse kesin sonuç vermez", () => {
    const result = matchByReferences(
      { ...emptyRefs, awbNumbers: ["235-51135254"] },
      [p({ id: 3, awbNumber: "235-51135254" }), p({ id: 7, awbNumber: "235-51135254" })],
    );
    expect(result.confidence).toBe("none");
    expect(result.procedureId).toBeNull();
  });

  it("aynı prosedür iki alandan eşleşirse yine exact döner", () => {
    const result = matchByReferences(
      { ...emptyRefs, procedureRefs: ["CNCALO-112"], awbNumbers: ["235-51135254"] },
      [p({ id: 5, reference: "CNCALO-112", awbNumber: "235-51135254" })],
    );
    expect(result.procedureId).toBe(5);
  });

  it("aday yoksa none döner", () => {
    expect(matchByReferences(emptyRefs, [])).toEqual({
      procedureId: null, confidence: "none", reason: null,
    });
  });

  it("iki ayrı prosedür farklı alanlardan eşleşirse kesin sonuç vermez", () => {
    const result = matchByReferences(
      { ...emptyRefs, procedureRefs: ["CNCALO-112"], awbNumbers: ["235-51135254"] },
      [p({ id: 5, reference: "CNCALO-112" }), p({ id: 7, awbNumber: "235-51135254" })],
    );
    expect(result.confidence).toBe("none");
    expect(result.procedureId).toBeNull();
  });
});

describe("parseAiMatch", () => {
  const candidates = [p({ id: 5, reference: "CNCALO-112" })];

  it("seçilen id'yi döner", () => {
    const r = parseAiMatch('{"procedureId": 5, "reason": "Konuda CNCALO-112 geçiyor"}', candidates);
    expect(r).toEqual({ procedureId: 5, confidence: "ai", reason: "Konuda CNCALO-112 geçiyor" });
  });

  it("null seçimini none olarak döner", () => {
    expect(parseAiMatch('{"procedureId": null, "reason": "belirsiz"}', candidates).confidence).toBe("none");
  });

  it("kısa listede olmayan id'yi reddeder", () => {
    expect(parseAiMatch('{"procedureId": 999}', candidates).procedureId).toBeNull();
  });

  it("bozuk cevabı none olarak döner", () => {
    expect(parseAiMatch("bozuk", candidates).confidence).toBe("none");
  });

  it("sayı yerine metin gelen id'yi reddeder", () => {
    expect(parseAiMatch('{"procedureId": "5"}', [p({ id: 5 })]).procedureId).toBeNull();
  });
});

describe("buildShipperHint", () => {
  it("alan adının ilk parçasını büyük harfle verir", () => {
    expect(buildShipperHint("ops@issglobal.com")).toBe("ISSGLOBAL");
  });
  it("joker karakterleri kaçırır", () => {
    expect(buildShipperHint("a@te%st_x.com")).toBe("TE\\%ST\\_X");
  });
  it("çok kısa ipucunda null döner", () => {
    expect(buildShipperHint("a@ab.com")).toBeNull();
  });
  it("adres bozuksa null döner", () => {
    expect(buildShipperHint("düzgün-olmayan-adres")).toBeNull();
  });
});

describe("matchEmailToProcedure", () => {
  const input = {
    refs: { ...emptyRefs, procedureRefs: ["CNCALO-112"] },
    fromAddress: "ops@issglobal.com",
    subject: "CNCALO-112 evrak",
    summary: "Evrak isteniyor",
  };

  it("kesin eşleşme varken Claude'u hiç çağırmaz", async () => {
    const analyzeText = vi.fn();
    const result = await matchEmailToProcedure(input, {
      findByReferences: async () => [p({ id: 5, reference: "CNCALO-112" })],
      findShortlist: async () => [],
      analyzeText,
    });
    expect(result.confidence).toBe("exact");
    expect(analyzeText).not.toHaveBeenCalled();
  });

  it("kısa liste boşsa Claude'u hiç çağırmaz", async () => {
    const analyzeText = vi.fn();
    const result = await matchEmailToProcedure(
      { ...input, refs: emptyRefs },
      { findByReferences: async () => [], findShortlist: async () => [], analyzeText },
    );
    expect(result.confidence).toBe("none");
    expect(analyzeText).not.toHaveBeenCalled();
  });

  it("kesin eşleşme yoksa kısa listeyle Claude'a sorar", async () => {
    const analyzeText = vi.fn().mockResolvedValue('{"procedureId": 8, "reason": "Aynı gönderen ve tarih"}');
    const result = await matchEmailToProcedure(
      { ...input, refs: emptyRefs },
      {
        findByReferences: async () => [],
        findShortlist: async () => [p({ id: 8, reference: "CNCALO-113", shipper: "ISS GLOBAL" })],
        analyzeText,
      },
    );
    expect(result).toEqual({ procedureId: 8, confidence: "ai", reason: "Aynı gönderen ve tarih" });
    expect(analyzeText).toHaveBeenCalledTimes(1);
  });

  it("Claude hata verirse eşleşmesiz devam eder", async () => {
    const analyzeText = vi.fn().mockRejectedValue(new Error("529 overloaded"));
    const result = await matchEmailToProcedure(
      { ...input, refs: emptyRefs },
      {
        findByReferences: async () => [],
        findShortlist: async () => [p({ id: 8 })],
        analyzeText,
      },
    );
    expect(result.confidence).toBe("none");
  });
});
