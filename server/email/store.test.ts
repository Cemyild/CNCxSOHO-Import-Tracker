import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {}, rawDb: {} }));

import { normalizeSenderPattern, isValidSenderPattern, buildMessagePatch, OTHER_BUCKET } from "./store";

describe("normalizeSenderPattern", () => {
  it("küçük harfe çevirir ve kırpar", () => {
    expect(normalizeSenderPattern("  Ops@ISSGlobal.com ")).toBe("ops@issglobal.com");
  });
});

describe("isValidSenderPattern", () => {
  it("tam mail adresini kabul eder", () => {
    expect(isValidSenderPattern("ops@issglobal.com")).toBe(true);
  });
  it("@ ile başlayan alan adını kabul eder", () => {
    expect(isValidSenderPattern("@dhl.com")).toBe(true);
  });
  it("çıplak kelimeyi reddeder", () => {
    expect(isValidSenderPattern("dhl")).toBe(false);
  });
  it("boş değeri reddeder", () => {
    expect(isValidSenderPattern("   ")).toBe(false);
  });
  it("boşluk içeren değeri reddeder", () => {
    expect(isValidSenderPattern("ops@iss global.com")).toBe(false);
  });
  it("yalnızca @ işaretini reddeder", () => {
    expect(isValidSenderPattern("@")).toBe(false);
  });
});

describe("buildMessagePatch", () => {
  it("işlem seçilince elle eşleştirilmiş sayar", () => {
    const patch = buildMessagePatch({ procedureId: 42 });
    expect(patch.procedureId).toBe(42);
    expect(patch.matchConfidence).toBe("manual");
    expect(patch.matchReason).toBeTruthy();
  });

  it("eşleşme kaldırılınca 'none' olur", () => {
    const patch = buildMessagePatch({ procedureId: null });
    expect(patch.procedureId).toBeNull();
    expect(patch.matchConfidence).toBe("none");
    expect(patch.matchReason).toBeNull();
  });

  it("\"Diğer\" işaretlenince işlemden çözülür", () => {
    const patch = buildMessagePatch({ markOther: true });
    expect(patch.procedureId).toBeNull();
    expect(patch.matchConfidence).toBe(OTHER_BUCKET);
  });

  it("\"Diğer\" ile işlem aynı anda gönderilirse 'Diğer' kazanır", () => {
    // İki durum bir arada olamaz; aksi halde mail hem işlemde hem Diğer'de çıkardı.
    const patch = buildMessagePatch({ markOther: true, procedureId: 42 });
    expect(patch.procedureId).toBeNull();
    expect(patch.matchConfidence).toBe(OTHER_BUCKET);
  });

  it("yalnızca durum güncellenince eşleşmeye dokunmaz", () => {
    const patch = buildMessagePatch({ status: "done" });
    expect(patch.status).toBe("done");
    expect("procedureId" in patch).toBe(false);
    expect("matchConfidence" in patch).toBe(false);
  });

  it("yapılacaklar listesini aktarır", () => {
    const items = [{ id: "a", text: "iş", done: true }];
    expect(buildMessagePatch({ actionItems: items }).actionItems).toEqual(items);
  });
});
