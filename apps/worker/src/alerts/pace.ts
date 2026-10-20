// Pacing for Telegram's limits: about 30 messages a second per bot and 1 a second per chat.

export type Clock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))),
};

/**
 * Evenly spaced sends, at most `perSecond`. `pauseFor` (after a 429) holds every taker,
 * including ones already waiting.
 */
export function createRateLimiter(opts: { perSecond: number; clock?: Clock }) {
  const clock = opts.clock ?? realClock;
  const gap = 1000 / opts.perSecond;
  let next = 0;
  let pausedUntil = 0;
  return {
    async take(): Promise<void> {
      for (;;) {
        const t = clock.now();
        if (t < pausedUntil) {
          await clock.sleep(pausedUntil - t);
          continue;
        }
        const at = Math.max(t, next);
        next = at + gap;
        if (at > t) await clock.sleep(at - t);
        if (clock.now() >= pausedUntil) return;
        // Paused while we waited: queue again after the pause.
      }
    },
    pauseFor(ms: number): void {
      pausedUntil = Math.max(pausedUntil, clock.now() + ms);
    },
  };
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** At most one send per `minGapMs` for each key (a chat id). Old entries are dropped. */
export function createPerKeySpacing(
  minGapMs: number,
  clock: Clock = realClock,
) {
  const last = new Map<string, number>();
  return {
    async wait(key: string): Promise<void> {
      const t = clock.now();
      if (last.size > 1000) {
        for (const [k, at] of last) if (t - at > 60_000) last.delete(k);
      }
      const at = Math.max(t, (last.get(key) ?? -Infinity) + minGapMs);
      last.set(key, at);
      if (at > t) await clock.sleep(at - t);
    },
    size: () => last.size,
  };
}
