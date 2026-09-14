import { runSync as defaultRunSync } from "./sync-service";

export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const STARTUP_DELAY_MS = 30 * 1000;

interface SchedulerDeps {
  runSync?: () => Promise<unknown>;
  setTimeoutFn?: typeof setTimeout;
  setIntervalFn?: typeof setInterval;
}

/**
 * 15 dakikada bir mail senkronu. Hiçbir hata süreci düşürmez.
 * EMAIL_SYNC_ENABLED=false veya NODE_ENV=test iken hiç kurulmaz.
 */
export function startEmailSyncScheduler(deps: SchedulerDeps = {}): { stop(): void } | null {
  if (process.env.EMAIL_SYNC_ENABLED === "false" || process.env.NODE_ENV === "test") {
    console.log("[email-inbox] zamanlayıcı kapalı");
    return null;
  }

  const run = deps.runSync ?? (() => defaultRunSync());
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;

  const tick = () => {
    try {
      run().catch((error) => console.error("[email-inbox] zamanlanmış senkron hatası:", error));
    } catch (error) {
      console.error("[email-inbox] zamanlanmış senkron hatası:", error);
    }
  };

  const startupTimer = setTimeoutFn(tick, STARTUP_DELAY_MS);
  const intervalTimer = setIntervalFn(tick, SYNC_INTERVAL_MS);
  console.log(`[email-inbox] zamanlayıcı kuruldu (${SYNC_INTERVAL_MS / 60000} dakika)`);

  return {
    stop() {
      clearTimeout(startupTimer as any);
      clearInterval(intervalTimer as any);
    },
  };
}
