// Pacing for Telegram's limits: about 30 messages a second per bot and 1 a second per chat.
// Every wait takes an optional AbortSignal: on abort it returns at once (without a slot), so a
// stopping sender can give its claimed rows back instead of waiting out a long pause.

export type Clock = {
  now: () => number;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      signal?.addEventListener("abort", done);
    }),
};

/**
 * Evenly spaced sends, at most `perSecond`. `pauseFor` (after a 429) holds every taker,
 * including ones already waiting. An aborted `take` returns early; the caller must check
 * the signal and not send.
 */
export function createRateLimiter(opts: { perSecond: number; clock?: Clock }) {
  const clock = opts.clock ?? realClock;
  const gap = 1000 / opts.perSecond;
  let next = 0;
  let pausedUntil = 0;
  return {
    async take(signal?: AbortSignal): Promise<void> {
      for (;;) {
        if (signal?.aborted) return;
        const t = clock.now();
        if (t < pausedUntil) {
          await clock.sleep(pausedUntil - t, signal);
          continue;
        }
        const at = Math.max(t, next);
        next = at + gap;
        if (at > t) await clock.sleep(at - t, signal);
        if (signal?.aborted) return;
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
    async wait(key: string, signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) return;
      const t = clock.now();
      if (last.size > 1000) {
        for (const [k, at] of last) if (t - at > 60_000) last.delete(k);
      }
      const at = Math.max(t, (last.get(key) ?? -Infinity) + minGapMs);
      last.set(key, at);
      if (at > t) await clock.sleep(at - t, signal);
    },
    size: () => last.size,
  };
}
