import { describe, it, expect } from "vitest";
import { readMessageFilter, DEFAULT_LIMIT, MAX_LIMIT } from "./query-params";

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

  it("matched değerini yes/no'ya sınırlar", () => {
    expect(readMessageFilter({ matched: "yes" }).matched).toBe("yes");
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
});
