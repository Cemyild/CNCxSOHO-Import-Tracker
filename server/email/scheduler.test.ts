import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {}, rawDb: {} }));

import { startEmailSyncScheduler, SYNC_INTERVAL_MS, STARTUP_DELAY_MS } from "./scheduler";

describe("startEmailSyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.EMAIL_SYNC_ENABLED;
    process.env.NODE_ENV = "development";
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.NODE_ENV = "test";
  });

  it("açılıştan sonra bir kez, sonra periyodik çalışır", () => {
    const runSync = vi.fn().mockResolvedValue({});
    const handle = startEmailSyncScheduler({ runSync });

    expect(runSync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(STARTUP_DELAY_MS);
    expect(runSync).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SYNC_INTERVAL_MS);
    expect(runSync).toHaveBeenCalledTimes(2);

    handle?.stop();
    vi.advanceTimersByTime(SYNC_INTERVAL_MS * 3);
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it("EMAIL_SYNC_ENABLED=false iken hiç kurulmaz", () => {
    process.env.EMAIL_SYNC_ENABLED = "false";
    const runSync = vi.fn();
    expect(startEmailSyncScheduler({ runSync })).toBeNull();
    vi.advanceTimersByTime(SYNC_INTERVAL_MS * 2);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("test ortamında hiç kurulmaz", () => {
    process.env.NODE_ENV = "test";
    const runSync = vi.fn();
    expect(startEmailSyncScheduler({ runSync })).toBeNull();
  });

  it("senkron hata fırlatsa bile zamanlayıcı ayakta kalır", async () => {
    const runSync = vi.fn().mockRejectedValue(new Error("patladı"));
    startEmailSyncScheduler({ runSync });

    vi.advanceTimersByTime(STARTUP_DELAY_MS);
    await Promise.resolve();
    vi.advanceTimersByTime(SYNC_INTERVAL_MS);
    expect(runSync).toHaveBeenCalledTimes(2);
  });
});
