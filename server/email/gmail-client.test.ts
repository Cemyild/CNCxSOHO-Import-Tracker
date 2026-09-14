import { describe, it, expect } from "vitest";
import {
  buildGmailQuery,
  MAX_SENDERS_PER_QUERY,
  collectMessageIds,
  MAX_PAGES_PER_QUERY,
} from "./gmail-client";

describe("buildGmailQuery", () => {
  it("gönderenleri OR ile birleştirip tarih sınırı ekler", () => {
    expect(buildGmailQuery(["ops@iss.com", "@dhl.com"], 1757836800)).toEqual([
      "(from:ops@iss.com OR from:dhl.com) after:1757836800",
    ]);
  });

  it("alan adı kalıbındaki baştaki @ işaretini atar", () => {
    expect(buildGmailQuery(["@dhl.com"], 1)[0]).toContain("from:dhl.com");
  });

  it("gönderen listesini üst sınıra göre parçalara böler", () => {
    const many = Array.from({ length: MAX_SENDERS_PER_QUERY + 3 }, (_, i) => `a${i}@x.com`);
    const queries = buildGmailQuery(many, 1757836800);
    expect(queries).toHaveLength(2);
    expect(queries[0].split(" OR ")).toHaveLength(MAX_SENDERS_PER_QUERY);
    expect(queries[1].split(" OR ")).toHaveLength(3);
    expect(queries.every((q) => q.endsWith("after:1757836800"))).toBe(true);
  });

  it("gönderen yoksa hiç sorgu üretmez", () => {
    expect(buildGmailQuery([], 1757836800)).toEqual([]);
  });

  it("boşlukları kırpar ve küçük harfe çevirir", () => {
    expect(buildGmailQuery(["  OPS@ISSGlobal.com  "], 1)[0]).toContain("from:ops@issglobal.com");
  });

  it("tam sınır sayıda göndereni tek sorguda tutar", () => {
    const exact = Array.from({ length: MAX_SENDERS_PER_QUERY }, (_, i) => `a${i}@x.com`);
    const queries = buildGmailQuery(exact, 1757836800);
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain("()");
  });
});

describe("collectMessageIds", () => {
  it("tek sayfayı toplar", async () => {
    const ids = await collectMessageIds(async () => ({ ids: ["a", "b"] }));
    expect(ids).toEqual(["a", "b"]);
  });

  it("sayfalar arasında birleştirir", async () => {
    const pages: Record<string, { ids: string[]; nextPageToken?: string }> = {
      "": { ids: ["a"], nextPageToken: "p2" },
      p2: { ids: ["b"], nextPageToken: "p3" },
      p3: { ids: ["c"] },
    };
    const ids = await collectMessageIds(async (token) => pages[token ?? ""]);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("ilerlemeyen sayfa belirtecinde durur", async () => {
    let calls = 0;
    const ids = await collectMessageIds(async () => {
      calls++;
      return { ids: ["x"], nextPageToken: "same" };
    });
    expect(calls).toBe(2);
    expect(ids).toEqual(["x", "x"]);
  });

  it("sayfa üst sınırını aşmaz", async () => {
    let calls = 0;
    await collectMessageIds(async () => {
      calls++;
      return { ids: ["x"], nextPageToken: `p${calls}` };
    });
    expect(calls).toBe(MAX_PAGES_PER_QUERY);
  });
});
