import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {}, rawDb: {} }));

import { runSync, FIRST_RUN_LOOKBACK_MS, SENT_BACKFILL_MS } from "./sync-service";

/** IMAP istemcisi artık ham veri değil, hazır ParsedMessage döndürüyor. */
function mailMessage(uid: string, subject: string, body: string) {
  return {
    gmailMessageId: uid,
    gmailThreadId: uid,
    fromAddress: "ops@issglobal.com",
    fromName: "ISS Global",
    toAddress: "cem@sirket.com",
    subject,
    sentAt: new Date(1757836800000),
    snippet: subject,
    bodyText: body,
    attachments: [],
  };
}

function makeDeps(overrides: any = {}) {
  const inserted: any[] = [];
  const aiSaved: any[] = [];
  const aiFailed: any[] = [];

  const store = {
    getAccount: vi.fn().mockResolvedValue({
      id: 1, userId: 1, emailAddress: "cem@sirket.com",
      appPassword: "uygulama-sifresi", lastSyncedAt: null, status: "connected",
    }),
    listActiveSenderPatterns: vi.fn().mockResolvedValue(["ops@issglobal.com"]),
    filterNewMessageIds: vi.fn().mockImplementation(async (ids: string[]) => ids),
    insertParsedMessage: vi.fn().mockImplementation(async (_a: number, parsed: any) => {
      inserted.push(parsed);
      return inserted.length;
    }),
    insertAttachments: vi.fn().mockResolvedValue(undefined),
    listPendingForAi: vi.fn().mockResolvedValue([
      {
        id: 1, fromName: "ISS Global", fromAddress: "ops@issglobal.com",
        subject: "CNCALO-112 evrak", sentAt: new Date("2026-09-14T10:00:00Z"),
        bodyText: "Orijinal konşimento lazım. CNCALO-112", attachmentNames: [],
      },
    ]),
    saveAiResult: vi.fn().mockImplementation(async (id: number, patch: any) => {
      aiSaved.push({ id, patch });
    }),
    markAiFailed: vi.fn().mockImplementation(async (id: number, msg: string) => {
      aiFailed.push({ id, msg });
    }),
    markAccountSynced: vi.fn().mockResolvedValue(undefined),
    markAccountError: vi.fn().mockResolvedValue(undefined),
    listMessagesNeedingThreadId: vi.fn().mockResolvedValue([]),
    setThreadId: vi.fn().mockResolvedValue(undefined),
    markThreadRepairAttempt: vi.fn().mockResolvedValue(undefined),
    hasOutgoingMail: vi.fn().mockResolvedValue(true),
    listOpenTodosInThread: vi.fn().mockResolvedValue([]),
    closeActionItems: vi.fn().mockResolvedValue(0),
    ...overrides.store,
  };

  const mail = {
    listMessageIds: vi.fn().mockResolvedValue(["m1"]),
    listSentMessageIds: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue(mailMessage("m1", "CNCALO-112 evrak", "Konşimento lazım")),
    getAttachment: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides.mail,
  };

  const summarize = overrides.summarize ??
    vi.fn().mockResolvedValue({
      summary: "Evrak isteniyor.",
      category: "document",
      urgency: "high",
      actionItems: ["Konşimentoyu gönder"],
      references: { procedureRefs: ["CNCALO-112"], awbNumbers: [], invoiceNumbers: [], customsFileNumbers: [] },
    });

  const matcherDeps = overrides.matcherDeps ?? {
    findByReferences: vi.fn().mockResolvedValue([{ id: 5, reference: "CNCALO-112", shipper: null, invoiceNo: null, awbNumber: null, customsFileNo: null, arrivalDate: null }]),
    findShortlist: vi.fn().mockResolvedValue([]),
    analyzeText: vi.fn(),
  };

  const decideClosures = overrides.decideClosures ?? vi.fn().mockResolvedValue([]);

  return {
    deps: { store, createMailClient: () => mail, summarize, matcherDeps, decideClosures } as any,
    decideClosures,
    store, mail, summarize, matcherDeps, inserted, aiSaved, aiFailed,
  };
}

describe("runSync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hesap yoksa hiçbir şey yapmaz", async () => {
    const { deps, store, mail } = makeDeps({ store: { getAccount: vi.fn().mockResolvedValue(null) } });
    const result = await runSync(deps);
    expect(result.skipped).toBe("no-account");
    expect(mail.listMessageIds).not.toHaveBeenCalled();
    expect(store.markAccountSynced).not.toHaveBeenCalled();
  });

  it("gönderen listesi boşsa hiçbir şey taramaz", async () => {
    const { deps, mail } = makeDeps({ store: { listActiveSenderPatterns: vi.fn().mockResolvedValue([]) } });
    const result = await runSync(deps);
    expect(result.skipped).toBe("no-senders");
    expect(mail.listMessageIds).not.toHaveBeenCalled();
  });

  it("ilk turda 7 günlük geçmişi tarar", async () => {
    const now = new Date("2026-09-14T12:00:00Z");
    const { deps, mail } = makeDeps();
    await runSync({ ...deps, now: () => now });
    const query = mail.listMessageIds.mock.calls[0][0] as string;
    const expected = Math.floor((now.getTime() - FIRST_RUN_LOOKBACK_MS) / 1000);
    expect(query).toContain(`after:${expected}`);
  });

  it("son senkrondan 10 dakika geriye çakışma payı bırakır", async () => {
    const now = new Date("2026-09-14T12:00:00Z");
    const lastSynced = new Date("2026-09-14T11:00:00Z");
    const { deps, mail } = makeDeps({
      store: {
        getAccount: vi.fn().mockResolvedValue({
          id: 1, userId: 1, emailAddress: "cem@sirket.com",
          refreshToken: "rt", lastSyncedAt: lastSynced, status: "connected",
        }),
      },
    });
    await runSync({ ...deps, now: () => now });
    const query = mail.listMessageIds.mock.calls[0][0] as string;
    expect(query).toContain(`after:${Math.floor((lastSynced.getTime() - 10 * 60 * 1000) / 1000)}`);
  });

  it("zaten kayıtlı mailleri yeniden çekmez", async () => {
    const { deps, mail } = makeDeps({
      store: { filterNewMessageIds: vi.fn().mockResolvedValue([]) },
    });
    const result = await runSync(deps);
    expect(mail.getMessage).not.toHaveBeenCalled();
    expect(result.inserted).toBe(0);
  });

  it("yeni maili kaydeder, özetler ve eşleştirir", async () => {
    const { deps, aiSaved } = makeDeps();
    const result = await runSync(deps);
    expect(result.inserted).toBe(1);
    expect(result.processed).toBe(1);
    expect(aiSaved[0].patch.summary).toBe("Evrak isteniyor.");
    expect(aiSaved[0].patch.procedureId).toBe(5);
    expect(aiSaved[0].patch.matchConfidence).toBe("exact");
    expect(aiSaved[0].patch.actionItems[0]).toMatchObject({ text: "Konşimentoyu gönder", done: false });
  });

  it("regex ile bulunan numaraları Claude'un çıkardıklarıyla birleştirir", async () => {
    const { deps, aiSaved } = makeDeps({
      summarize: vi.fn().mockResolvedValue({
        summary: "özet", category: "other", urgency: "normal", actionItems: [],
        references: { procedureRefs: [], awbNumbers: ["235-51135254"], invoiceNumbers: [], customsFileNumbers: [] },
      }),
      store: {
        listPendingForAi: vi.fn().mockResolvedValue([
          {
            id: 1, fromName: "ISS", fromAddress: "ops@issglobal.com", subject: "konu",
            sentAt: new Date(), bodyText: "CNCALO-112 için evrak", attachmentNames: [],
          },
        ]),
      },
    });
    await runSync(deps);
    const refs = aiSaved[0].patch.extractedRefs;
    expect(refs.procedureRefs).toEqual(["CNCALO-112"]);   // regex'ten
    expect(refs.awbNumbers).toEqual(["235-51135254"]);     // Claude'dan
  });

  it("başarılı turdan sonra son senkron zamanını yazar", async () => {
    const { deps, store } = makeDeps();
    await runSync(deps);
    expect(store.markAccountSynced).toHaveBeenCalledTimes(1);
  });

  it("Gmail listeleme hatasında son senkron zamanını GÜNCELLEMEZ", async () => {
    const { deps, store } = makeDeps({
      mail: { listMessageIds: vi.fn().mockRejectedValue(new Error("401 invalid_grant")) },
    });
    const result = await runSync(deps);
    expect(store.markAccountSynced).not.toHaveBeenCalled();
    expect(store.markAccountError).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe("error");
  });

  it("bir mailin özetlenmesi başarısız olsa da diğerleri işlenir", async () => {
    const summarize = vi.fn()
      .mockRejectedValueOnce(new Error("529 overloaded"))
      .mockResolvedValueOnce({
        summary: "ikinci", category: "other", urgency: "low", actionItems: [],
        references: { procedureRefs: [], awbNumbers: [], invoiceNumbers: [], customsFileNumbers: [] },
      });
    const { deps, store, aiSaved, aiFailed } = makeDeps({
      summarize,
      store: {
        listPendingForAi: vi.fn().mockResolvedValue([
          { id: 1, fromName: "A", fromAddress: "a@x.com", subject: "s1", sentAt: new Date(), bodyText: "b1", attachmentNames: [] },
          { id: 2, fromName: "B", fromAddress: "b@x.com", subject: "s2", sentAt: new Date(), bodyText: "b2", attachmentNames: [] },
        ]),
      },
    });
    const result = await runSync(deps);
    expect(aiFailed).toHaveLength(1);
    expect(aiSaved).toHaveLength(1);
    expect(result.failed).toBe(1);
    expect(store.markAccountSynced).toHaveBeenCalledTimes(1);
  });

  it("ek dosya adlarını özetleyiciye iletir", async () => {
    const summarize = vi.fn().mockResolvedValue({
      summary: "özet", category: "document", urgency: "normal", actionItems: [],
      references: { procedureRefs: [], awbNumbers: [], invoiceNumbers: [], customsFileNumbers: [] },
    });
    const { deps } = makeDeps({
      summarize,
      store: {
        listPendingForAi: vi.fn().mockResolvedValue([
          {
            id: 1, fromName: "ISS", fromAddress: "ops@issglobal.com", subject: "konu",
            sentAt: new Date(), bodyText: "gövde", attachmentNames: ["fatura.pdf", "pl.xlsx"],
          },
        ]),
      },
    });
    await runSync(deps);
    expect(summarize.mock.calls[0][0].attachmentNames).toEqual(["fatura.pdf", "pl.xlsx"]);
  });

  it("tek bir mail alınamazsa diğerlerini işlemeye devam eder", async () => {
    const { deps, store } = makeDeps({
      mail: {
        listMessageIds: vi.fn().mockResolvedValue(["m1", "m2"]),
        getMessage: vi.fn()
          .mockRejectedValueOnce(new Error("404 not found"))
          .mockResolvedValueOnce(mailMessage("m2", "ikinci", "gövde")),
      },
    });
    const result = await runSync(deps);
    expect(result.inserted).toBe(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(store.markAccountSynced).toHaveBeenCalledTimes(1);
  });

  it("hata durumu yazılamasa da tur tamamlanır", async () => {
    const summarize = vi.fn().mockRejectedValue(new Error("529 overloaded"));
    const { deps, store } = makeDeps({
      summarize,
      store: { markAiFailed: vi.fn().mockRejectedValue(new Error("DB down")) },
    });
    const result = await runSync(deps);
    expect(result.skipped).toBeUndefined();
    expect(store.markAccountSynced).toHaveBeenCalledTimes(1);
  });

  it("aynı mail iki sorgu parçasında çıksa da bir kez sayılır", async () => {
    const { deps } = makeDeps({
      mail: { listMessageIds: vi.fn().mockResolvedValue(["m1", "m1"]) },
    });
    const result = await runSync(deps);
    expect(result.fetched).toBe(1);
  });

  it("son senkron zamanı gelecekteyse pencereyi şimdiye sabitler", async () => {
    const now = new Date("2026-09-14T12:00:00Z");
    const future = new Date("2026-09-20T12:00:00Z");
    const { deps, mail } = makeDeps({
      store: {
        getAccount: vi.fn().mockResolvedValue({
          id: 1, userId: 1, emailAddress: "cem@sirket.com",
          refreshToken: "rt", lastSyncedAt: future, status: "connected",
        }),
      },
    });
    await runSync({ ...deps, now: () => now });
    const query = mail.listMessageIds.mock.calls[0][0] as string;
    expect(query).toContain(`after:${Math.floor((now.getTime() - 10 * 60 * 1000) / 1000)}`);
  });

  it("konu kimliği eksik maillerin kimliğini tamamlar", async () => {
    const { deps, store, mail } = makeDeps({
      store: {
        listMessagesNeedingThreadId: vi.fn().mockResolvedValue([
          { id: 7, gmailMessageId: "m7" },
          { id: 8, gmailMessageId: "m8" },
        ]),
      },
      mail: {
        listMessageIds: vi.fn().mockResolvedValue([]),
        listSentMessageIds: vi.fn().mockResolvedValue([]),
        getMessage: vi
          .fn()
          .mockResolvedValueOnce({ ...mailMessage("m7", "konu", "g"), gmailThreadId: "T1" })
          .mockResolvedValueOnce({ ...mailMessage("m8", "konu", "g"), gmailThreadId: "T1" }),
      },
    });

    await runSync(deps);

    expect(store.setThreadId).toHaveBeenCalledWith(7, "T1");
    expect(store.setThreadId).toHaveBeenCalledWith(8, "T1");
    expect(store.markAccountSynced).toHaveBeenCalledTimes(1);
  });

  it("onarım denemesini sayar, böylece silinmiş mail sonsuza kadar denenmez", async () => {
    const { deps, store } = makeDeps({
      store: {
        listMessagesNeedingThreadId: vi.fn().mockResolvedValue([{ id: 7, gmailMessageId: "m7" }]),
      },
      mail: {
        listMessageIds: vi.fn().mockResolvedValue([]),
        listSentMessageIds: vi.fn().mockResolvedValue([]),
        getMessage: vi.fn().mockRejectedValue(new Error("mail arşivlenmiş")),
      },
    });

    await runSync(deps);

    expect(store.markThreadRepairAttempt).toHaveBeenCalledWith(7);
  });

  it("konu kimliği tamamlanamazsa tur yine biter", async () => {
    const { deps, store } = makeDeps({
      store: {
        listMessagesNeedingThreadId: vi.fn().mockResolvedValue([{ id: 7, gmailMessageId: "m7" }]),
      },
      mail: {
        listMessageIds: vi.fn().mockResolvedValue([]),
        listSentMessageIds: vi.fn().mockResolvedValue([]),
        getMessage: vi.fn().mockRejectedValue(new Error("mail silinmiş")),
      },
    });

    const result = await runSync(deps);

    expect(result.skipped).toBeUndefined();
    expect(store.setThreadId).not.toHaveBeenCalled();
    expect(store.markAccountSynced).toHaveBeenCalledTimes(1);
  });

  it("kendi gönderdiğim maili 'giden' olarak kaydeder", async () => {
    const { deps, store } = makeDeps({
      mail: {
        listMessageIds: vi.fn().mockResolvedValue([]),
        listSentMessageIds: vi.fn().mockResolvedValue(["sent:9"]),
        getMessage: vi.fn().mockResolvedValue(mailMessage("sent:9", "RE: evrak", "ekte gönderiyorum")),
      },
    });

    await runSync(deps);

    expect(store.insertParsedMessage).toHaveBeenCalledWith(1, expect.anything(), "outgoing");
  });

  it("giden mail aynı konuşmadaki işi kapatır", async () => {
    const decideClosures = vi
      .fn()
      .mockResolvedValue([{ emailId: 3, itemId: "a", reason: "ekte gönderildi" }]);
    const { deps, store } = makeDeps({
      decideClosures,
      store: {
        listOpenTodosInThread: vi
          .fn()
          .mockResolvedValue([{ emailId: 3, itemId: "a", text: "Konşimentoyu gönder" }]),
      },
      mail: {
        listMessageIds: vi.fn().mockResolvedValue([]),
        listSentMessageIds: vi.fn().mockResolvedValue(["sent:9"]),
        getMessage: vi.fn().mockResolvedValue(mailMessage("sent:9", "RE: evrak", "ekte gönderiyorum")),
      },
    });

    await runSync(deps);

    expect(decideClosures).toHaveBeenCalledTimes(1);
    expect(store.closeActionItems).toHaveBeenCalledWith(
      [{ emailId: 3, itemId: "a", reason: "ekte gönderildi" }],
      expect.any(Number),
    );
  });

  it("gelen mail için kapatma kararı hiç sorulmaz", async () => {
    const { deps, decideClosures } = makeDeps();
    await runSync(deps);
    expect(decideClosures).not.toHaveBeenCalled();
  });

  it("kapatma kararı alınamazsa tur yine tamamlanır", async () => {
    const { deps, store } = makeDeps({
      decideClosures: vi.fn().mockRejectedValue(new Error("529")),
      store: {
        listOpenTodosInThread: vi
          .fn()
          .mockResolvedValue([{ emailId: 3, itemId: "a", text: "bir iş" }]),
      },
      mail: {
        listMessageIds: vi.fn().mockResolvedValue([]),
        listSentMessageIds: vi.fn().mockResolvedValue(["sent:9"]),
        getMessage: vi.fn().mockResolvedValue(mailMessage("sent:9", "RE", "gövde")),
      },
    });

    const result = await runSync(deps);

    expect(result.skipped).toBeUndefined();
    expect(store.markAccountSynced).toHaveBeenCalledTimes(1);
  });

  it("giden mail hiç yokken pencereyi 3 güne genişletir", async () => {
    // Özellik açıldığında geçmişte gönderilmiş mailler de taranmalı ki mevcut
    // açık işler kapanabilsin.
    const now = new Date("2026-09-17T12:00:00Z");
    const lastSynced = new Date("2026-09-17T11:50:00Z");
    const { deps, gmail, mail } = makeDeps({
      store: {
        hasOutgoingMail: vi.fn().mockResolvedValue(false),
        getAccount: vi.fn().mockResolvedValue({
          id: 1, userId: 1, emailAddress: "cem@sirket.com",
          appPassword: "uygulama-sifresi", lastSyncedAt: lastSynced, status: "connected",
        }),
      },
    });

    await runSync({ ...deps, now: () => now });

    const query = (mail ?? gmail).listMessageIds.mock.calls[0][0] as string;
    expect(query).toContain(`after:${Math.floor((now.getTime() - SENT_BACKFILL_MS) / 1000)}`);
  });

  it("aynı anda ikinci kez çağrılırsa ikincisi atlanır", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps } = makeDeps({
      mail: {
        listMessageIds: vi.fn().mockImplementation(async () => { await gate; return []; }),
      },
    });

    const first = runSync(deps);
    const second = await runSync(deps);
    expect(second.skipped).toBe("already-running");
    release();
    await first;
  });
});
