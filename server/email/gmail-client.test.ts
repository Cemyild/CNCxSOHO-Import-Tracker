import { describe, it, expect } from "vitest";
import { buildGmailQuery, MAX_SENDERS_PER_QUERY } from "./gmail-client";

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
});
