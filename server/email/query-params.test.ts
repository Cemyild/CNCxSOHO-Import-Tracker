import { describe, it, expect } from "vitest";
import { readMessageFilter, DEFAULT_LIMIT, MAX_LIMIT, parseId, escapeLikePattern } from "./query-params";

describe("readMessageFilter", () => {
  it("boş sorguda varsayılanları verir", () => {
    expect(readMessageFilter({})).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  it("tanınan filtreleri aktarır", () => {
    expect(readMessageFilter({ status: "new", category: "payment", urgency: "high" })).toMatchObject({
      status: "new", category: "payment", urgency: "high",
    });
  });

  it("tanınmayan durum değerini yok sayar", () => {
    expect(readMessageFilter({ status: "uydurma" }).status).toBeUndefined();
  });

  it("matched değerini yes/no/other'a sınırlar", () => {
    expect(readMessageFilter({ matched: "yes" }).matched).toBe("yes");
    expect(readMessageFilter({ matched: "no" }).matched).toBe("no");
    // "other": işleme ait olmadığı ELLE işaretlenmiş mailler; hiç bakılmamış
    // olanlardan ("no") ayrı bir durum.
    expect(readMessageFilter({ matched: "other" }).matched).toBe("other");
    expect(readMessageFilter({ matched: "belki" }).matched).toBeUndefined();
  });

  it("limiti üst sınıra kırpar", () => {
    expect(readMessageFilter({ limit: "5000" }).limit).toBe(MAX_LIMIT);
    expect(readMessageFilter({ limit: "0" }).limit).toBe(DEFAULT_LIMIT);
    expect(readMessageFilter({ limit: "abc" }).limit).toBe(DEFAULT_LIMIT);
  });

  it("negatif offset'i sıfırlar", () => {
    expect(readMessageFilter({ offset: "-10" }).offset).toBe(0);
  });

  it("arama metnini kırpar ve boşsa yok sayar", () => {
    expect(readMessageFilter({ q: "  konşimento  " }).q).toBe("konşimento");
    expect(readMessageFilter({ q: "   " }).q).toBeUndefined();
  });

  it("işlem numarasını okur", () => {
    expect(readMessageFilter({ procedureId: "42" }).procedureId).toBe(42);
  });

  it("geçersiz işlem numarasını yok sayar", () => {
    expect(readMessageFilter({ procedureId: "abc" }).procedureId).toBeUndefined();
    expect(readMessageFilter({ procedureId: "0" }).procedureId).toBeUndefined();
  });

  it("ondalıklı limiti aşağı yuvarlar", () => {
    expect(readMessageFilter({ limit: "50.7" }).limit).toBe(50);
  });
});

describe("parseId", () => {
  it("pozitif tam sayıyı okur", () => expect(parseId("12")).toBe(12));
  it("sayı olmayanı reddeder", () => expect(parseId("abc")).toBeNull());
  it("sıfır ve negatifi reddeder", () => {
    expect(parseId("0")).toBeNull();
    expect(parseId("-3")).toBeNull();
  });
  it("ondalıklıyı reddeder", () => expect(parseId("1.5")).toBeNull());
  it("boş değeri reddeder", () => expect(parseId(undefined)).toBeNull());
});

describe("escapeLikePattern", () => {
  it("joker karakterleri kaçırır", () => {
    expect(escapeLikePattern("%_x")).toBe("\\%\\_x");
  });
  it("ters bölü işaretini kaçırır", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });
  it("sıradan metni değiştirmez", () => {
    expect(escapeLikePattern("CNCALO-112")).toBe("CNCALO-112");
  });
});
