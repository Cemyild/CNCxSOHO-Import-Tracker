import { describe, it, expect } from "vitest";
import { htmlToText, stripQuotedHistory, MAX_BODY_CHARS } from "./message-parser";

describe("htmlToText", () => {
  it("script ve style içeriğini atar", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Merhaba</p><script>alert(1)</script>")).toBe(
      "Merhaba",
    );
  });

  it("HTML varlıklarını çözer", () => {
    expect(htmlToText("<p>A&nbsp;&amp;&nbsp;B</p>")).toBe("A & B");
  });

  it("satır sonu etiketlerini satır sonuna çevirir", () => {
    expect(htmlToText("<p>Merhaba<br>Cem</p>")).toBe("Merhaba\nCem");
  });

  it("Türkçe karakterleri bozmaz", () => {
    expect(htmlToText("<p>Gümrük işlemi tamamlandı</p>")).toBe("Gümrük işlemi tamamlandı");
  });

  it("etiketsiz metni olduğu gibi bırakır", () => {
    expect(htmlToText("düz metin")).toBe("düz metin");
  });
});

describe("MAX_BODY_CHARS", () => {
  it("gövde üst sınırı 20000 karakterdir", () => {
    expect(MAX_BODY_CHARS).toBe(20000);
  });
});

describe("stripQuotedHistory", () => {
  it("Outlook alıntı bloğundan öncesini bırakır", () => {
    // Gerçek veriden: yeni içerik ~350 karakter, altındaki eski yazışma ~19.600.
    const body = [
      "+++Adding Combined PL for both",
      "",
      "Thank you & Best Regards",
      "Burak Bülbül",
      "",
      "From: Burak Bulbul",
      "Sent: 14 September 2026 09:15",
      "To: Cem YILDIRIM",
      "",
      "Burada eski yazışmanın tamamı var, buradan iş çıkarılmamalı.",
    ].join("\r\n");

    const result = stripQuotedHistory(body);
    expect(result).toContain("Adding Combined PL");
    expect(result).not.toContain("eski yazışmanın tamamı");
  });

  it("Türkçe Outlook alıntısını da keser", () => {
    const body = [
      "Merhaba, evrakları gönderdim.",
      "",
      "Kimden: Ali Veli",
      "Gönderilen: 14 Eylül 2026 09:15",
      "Kime: Cem",
      "",
      "Eski mail metni burada.",
    ].join("\r\n");

    const result = stripQuotedHistory(body);
    expect(result).toContain("evrakları gönderdim");
    expect(result).not.toContain("Eski mail metni");
  });

  it("-----Original Message----- ayıracını keser", () => {
    const body = [
      "Yeni mesaj burada yeterince uzun.",
      "",
      "-----Original Message-----",
      "From: x",
      "Eski içerik.",
    ].join("\n");

    expect(stripQuotedHistory(body)).not.toContain("Eski içerik");
  });

  it("'On ... wrote:' kalıbını keser", () => {
    const body = [
      "Cevabım bu, yeterince uzun bir cümle olsun.",
      "",
      "On Mon, 14 Sep 2026 at 09:15, Ali <a@b.com> wrote:",
      "> eski satır",
    ].join("\n");

    const result = stripQuotedHistory(body);
    expect(result).toContain("Cevabım bu");
    expect(result).not.toContain("eski satır");
  });

  it("alıntı yoksa metni olduğu gibi bırakır", () => {
    const body = "Sadece tek bir mesaj var, alıntı yok.";
    expect(stripQuotedHistory(body)).toBe(body);
  });

  it("kesince geriye çok az kalıyorsa tam metni korur", () => {
    // Yanlış eşleşmede mailin tamamını kaybetmektense fazlasını göndermek iyidir.
    const body = ["From: x", "Sent: y", "Asıl içerik aslında burada, üstte hiçbir şey yok."].join(
      "\n",
    );

    expect(stripQuotedHistory(body)).toBe(body);
  });

  it("boş metinde çökmez", () => {
    expect(stripQuotedHistory("")).toBe("");
  });

  it("en erken alıntı işaretinden keser", () => {
    const body = [
      "Yeni mesaj yeterince uzun olsun diye biraz metin.",
      "",
      "-----Original Message-----",
      "x",
      "",
      "From: a",
      "Sent: b",
    ].join("\n");

    expect(stripQuotedHistory(body).trim()).toBe(
      "Yeni mesaj yeterince uzun olsun diye biraz metin.",
    );
  });
});
