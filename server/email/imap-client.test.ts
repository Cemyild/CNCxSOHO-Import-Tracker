import { describe, it, expect } from "vitest";
import {
  buildSearchQuery,
  capUids,
  describeImapError,
  imapOptions,
  MAX_SENDERS_PER_QUERY,
  MAX_UIDS_PER_RUN,
} from "./imap-client";

describe("buildSearchQuery", () => {
  it("gönderenleri OR ile birleştirip tarih sınırı ekler", () => {
    expect(buildSearchQuery(["ops@iss.com", "@dhl.com"], 1757836800)).toEqual([
      "(from:ops@iss.com OR from:dhl.com) after:1757836800",
    ]);
  });

  it("alan adı kalıbındaki baştaki @ işaretini atar", () => {
    expect(buildSearchQuery(["@dhl.com"], 1)[0]).toContain("from:dhl.com");
  });

  it("boşlukları kırpar ve küçük harfe çevirir", () => {
    expect(buildSearchQuery(["  OPS@ISSGlobal.com  "], 1)[0]).toContain("from:ops@issglobal.com");
  });

  it("gönderen listesini üst sınıra göre parçalara böler", () => {
    const many = Array.from({ length: MAX_SENDERS_PER_QUERY + 3 }, (_, i) => `a${i}@x.com`);
    const queries = buildSearchQuery(many, 1757836800);
    expect(queries).toHaveLength(2);
    expect(queries[0].split(" OR ")).toHaveLength(MAX_SENDERS_PER_QUERY);
    expect(queries[1].split(" OR ")).toHaveLength(3);
  });

  it("tam sınır sayıda göndereni tek sorguda tutar", () => {
    const exact = Array.from({ length: MAX_SENDERS_PER_QUERY }, (_, i) => `a${i}@x.com`);
    const queries = buildSearchQuery(exact, 1757836800);
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain("()");
  });

  it("gönderen yoksa hiç sorgu üretmez", () => {
    expect(buildSearchQuery([], 1757836800)).toEqual([]);
  });
});

describe("capUids", () => {
  it("sınırın altındaki listeyi olduğu gibi bırakır", () => {
    expect(capUids([1, 2, 3])).toEqual(["1", "2", "3"]);
  });

  it("sınırı aşınca en yeni maillerden üst sınır kadarını tutar", () => {
    const many = Array.from({ length: MAX_UIDS_PER_RUN + 5 }, (_, i) => i + 1);
    const capped = capUids(many);
    expect(capped).toHaveLength(MAX_UIDS_PER_RUN);
    expect(capped[capped.length - 1]).toBe(String(MAX_UIDS_PER_RUN + 5));
  });

  it("boş listede boş döner", () => {
    expect(capUids([])).toEqual([]);
  });
});

describe("imapOptions", () => {
  it("zaman aşımı sınırları tanımlar", () => {
    const options = imapOptions({ emailAddress: "a@b.com", appPassword: "x" });
    // Sınır yokken bağlantı denemesi sonsuza kadar asılı kalıyor; bu da
    // "Bağlan" isteğini ve senkron turunu kilitler.
    expect(options.connectionTimeout).toBeGreaterThan(0);
    expect(options.greetingTimeout).toBeGreaterThan(0);
    expect(options.socketTimeout).toBeGreaterThan(0);
  });

  it("kimlik bilgilerini ve sunucuyu doğru yerleştirir", () => {
    const options = imapOptions({ emailAddress: "a@b.com", appPassword: "gizli" });
    expect(options.host).toBe("imap.gmail.com");
    expect(options.port).toBe(993);
    expect(options.secure).toBe(true);
    expect(options.auth).toEqual({ user: "a@b.com", pass: "gizli" });
  });

  it("protokol günlüğünü kapalı tutar", () => {
    // Açık olsa mail konuları ve kimlik bilgileri sunucu günlüğüne düşer.
    expect(imapOptions({ emailAddress: "a@b.com", appPassword: "x" }).logger).toBe(false);
  });
});

describe("describeImapError", () => {
  it("kimlik doğrulama hatasını anlaşılır mesaja çevirir", () => {
    const message = describeImapError(new Error("Invalid credentials (Failure)"));
    expect(message).toMatch(/uygulama şifresi/i);
  });

  it("Gmail'in anlamsız 'Command failed' kimlik hatasını da çevirir", () => {
    // imapflow yanlış şifrede mesaj olarak yalnızca "Command failed" veriyor;
    // hangi hata olduğu nesnedeki authenticationFailed alanında.
    const error = Object.assign(new Error("Command failed"), { authenticationFailed: true });
    expect(describeImapError(error)).toMatch(/uygulama şifresi/i);
  });

  it("IMAP kapalıysa bunu söyler", () => {
    const message = describeImapError(new Error("[ALERT] IMAP access is disabled for your domain"));
    expect(message).toMatch(/IMAP/);
    expect(message).toMatch(/açık/i);
  });

  it("bağlantı hatasını anlaşılır mesaja çevirir", () => {
    expect(describeImapError(new Error("getaddrinfo ENOTFOUND imap.gmail.com"))).toMatch(
      /bağlan/i,
    );
  });

  it("tanımadığı hatayı olduğu gibi taşır", () => {
    expect(describeImapError(new Error("beklenmedik bir şey"))).toContain("beklenmedik bir şey");
  });

  it("hata nesnesi olmayan değeri de karşılar", () => {
    expect(typeof describeImapError("düz metin")).toBe("string");
  });
});
