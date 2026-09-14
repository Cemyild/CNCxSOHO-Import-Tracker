import { describe, it, expect } from "vitest";
import { extractReferences, normalizeProcedureRef, mergeRefs } from "./reference-extractor";

describe("extractReferences", () => {
  it("prosedür referanslarını yakalar", () => {
    const r = extractReferences("Merhaba, CNCALO-112 sevkiyatı için evrak lazım.");
    expect(r.procedureRefs).toEqual(["CNCALO-112"]);
  });

  it("bölünmüş referansı kanonik biçime getirir", () => {
    const r = extractReferences("konu: cncalo-104 / 2 gümrük");
    expect(r.procedureRefs).toEqual(["CNCALO-104 / 2"]);
  });

  it("AWB numarasını yakalar", () => {
    const r = extractReferences("AWB 235-51135254 bugün indi");
    expect(r.awbNumbers).toEqual(["235-51135254"]);
  });

  it("gümrük dosya numarasını yakalar", () => {
    const r = extractReferences("Dosya no: 26-13117");
    expect(r.customsFileNumbers).toEqual(["26-13117"]);
  });

  it("tarihleri gümrük dosya no sanmaz", () => {
    const r = extractReferences("Teslim 14-09-2026 tarihinde, saat 10-30 gibi.");
    expect(r.customsFileNumbers).toEqual([]);
  });

  it("telefon numarasını AWB sanmaz", () => {
    const r = extractReferences("Tel: +90 212 555-12345678 değil, 0212 555 44 33");
    expect(r.awbNumbers).toEqual([]);
  });

  it("aynı numarayı iki kez döndürmez", () => {
    const r = extractReferences("CNCALO-112 ... tekrar CNCALO-112");
    expect(r.procedureRefs).toEqual(["CNCALO-112"]);
  });

  it("boş metinde boş sonuç döner", () => {
    expect(extractReferences("")).toEqual({
      procedureRefs: [], awbNumbers: [], customsFileNumbers: [], invoiceNumbers: [],
    });
  });
});

describe("mergeRefs", () => {
  it("iki kaynağı tekrarsız birleştirir", () => {
    const merged = mergeRefs(
      { procedureRefs: ["CNCALO-112"], awbNumbers: [], customsFileNumbers: [], invoiceNumbers: [] },
      { procedureRefs: ["CNCALO-112", "CNCALO-113"], invoiceNumbers: ["SHP0001LBNTR"] },
    );
    expect(merged.procedureRefs).toEqual(["CNCALO-112", "CNCALO-113"]);
    expect(merged.invoiceNumbers).toEqual(["SHP0001LBNTR"]);
  });
});

describe("normalizeProcedureRef", () => {
  it("büyük harfe çevirip boşlukları düzenler", () => {
    expect(normalizeProcedureRef("cncalo - 104 /2")).toBe("CNCALO-104 / 2");
    expect(normalizeProcedureRef("CNCALO-112")).toBe("CNCALO-112");
  });
});
