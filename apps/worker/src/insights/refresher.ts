import type { Logger } from "../logger";

// Recomputes the subreddit insight rows every hour (docs/insights/design.md). Only the process
// that holds the poller lock runs it: the poller calls start() when it takes the lock and stop()
// when it loses or releases it, so there is no second lock and two workers never refresh together.

export const INSIGHTS_REFRESH_INTERVAL_MS = 60 * 60_000;

export type RefresherDeps = {
  log: Logger;
  refresh: () => Promise<{
    upserted: number;
    deleted: number;
    skipped?: boolean;
  }>;
  intervalMs?: number;
  now?: () => number;
};

export function createInsightsRefresher(deps: RefresherDeps) {
  const interval = deps.intervalMs ?? INSIGHTS_REFRESH_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;
  // Kept across stop/start: the poller lock moves between processes and flaps, and every
  // pickup must not recompute everything again.
  let lastRunAt: number | null = null;

  async function runOnce(): Promise<void> {
    const t0 = now();
    lastRunAt = t0;
    try {
      const res = await deps.refresh();
      deps.log.info(
        { ...res, ms: now() - t0 },
        res.skipped
          ? "subreddit insights refresh skipped; another refresh is running"
          : "subreddit insights refreshed",
      );
    } catch (err) {
      deps.log.warn(
        { err: (err as Error).message, ms: now() - t0 },
        "subreddit insights refresh failed; retrying next hour",
      );
    }
  }

  function tick() {
    timer = null;
    if (!running) return;
    inFlight = runOnce().finally(() => {
      inFlight = null;
      if (running) timer = setTimeout(tick, interval);
    });
  }

  return {
    /**
     * Runs now, then hourly; if the last run (before an earlier stop) was less than an interval
     * ago, waits out the rest of it first. No-op if already running.
     */
    start() {
      if (running) return;
      running = true;
      const wait =
        lastRunAt === null ? 0 : Math.max(0, lastRunAt + interval - now());
      if (wait === 0) tick();
      else timer = setTimeout(tick, wait);
    },
    /** Cancels the timer and waits for a refresh in flight. Can be started again later. */
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      await inFlight;
    },
    isRunning: () => running,
  };
}
