import { describe, it, expect } from "vitest";
import { htmlToText, MAX_BODY_CHARS } from "./message-parser";

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
