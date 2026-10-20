// Prefetching a match page on intent: the pointer resting on a row, or a j/k selection staying on
// one. Pure (timers and the clock only), so the rules are tested with fake timers; the hook in
// use-prefetch-intent.ts connects it to the router.

/** How long the pointer or selection must rest on a row before it counts as intent. */
export const INTENT_DWELL_MS = 150;
/** Never prefetch the same match twice within this window, even if Next dropped it. */
export const REPEAT_AFTER_MS = 30_000;
/** How long Next keeps a full prefetch (`staleTimes.static`, 5 min by default; not changed here). */
export const PREFETCH_TTL_MS = 5 * 60_000;
/** At most this many prefetches per sliding minute, per tab. */
export const PREFETCHES_PER_MINUTE = 10;
/** At most this many prefetches in flight at once. */
export const MAX_CONCURRENT = 2;
/**
 * `router.prefetch` doesn't say when its request finishes, so a prefetch holds its slot for
 * about as long as a match page takes to render.
 */
export const PREFETCH_HOLD_MS = 1_500;

/** Starts one prefetch; `onInvalidate` is Next's signal that the cached copy went stale. */
export type PrefetchRun = (onInvalidate: () => void) => void;

export type PrefetchScheduler = {
  /** The pointer or selection arrived on a row: prefetch it if it rests there long enough. */
  intend(key: string, run: PrefetchRun): void;
  /** It left before the dwell time (or the row was opened): forget the intent. */
  cancel(key: string): void;
};

/**
 * Whether this device should prefetch at all: a mouse-like pointer (phones never hover, and a tap
 * is the click) and no data saver.
 */
export function canPrefetch(env: {
  hoverFine: boolean;
  saveData?: boolean;
}): boolean {
  return env.hoverFine && env.saveData !== true;
}

export function createPrefetchScheduler(
  options: {
    dwellMs?: number;
    repeatMs?: number;
    ttlMs?: number;
    perMinute?: number;
    maxConcurrent?: number;
    holdMs?: number;
  } = {},
): PrefetchScheduler {
  const {
    dwellMs = INTENT_DWELL_MS,
    repeatMs = REPEAT_AFTER_MS,
    ttlMs = PREFETCH_TTL_MS,
    perMinute = PREFETCHES_PER_MINUTE,
    maxConcurrent = MAX_CONCURRENT,
    holdMs = PREFETCH_HOLD_MS,
  } = options;

  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  // The last prefetch per match: when it started and whether Next has called it stale since.
  const done = new Map<string, { at: number; invalidated: boolean }>();
  const started: number[] = [];
  let inFlight = 0;
  // Only the newest intent waits for a free slot; older ones are dropped.
  let waiting: { key: string; run: PrefetchRun } | null = null;

  function recentlyFetched(key: string, now: number): boolean {
    const last = done.get(key);
    if (!last) return false;
    const age = now - last.at;
    return age < repeatMs || (age < ttlMs && !last.invalidated);
  }

  function overRate(now: number): boolean {
    while (started.length > 0 && started[0]! <= now - 60_000) started.shift();
    return started.length >= perMinute;
  }

  function request(key: string, run: PrefetchRun) {
    const now = Date.now();
    if (recentlyFetched(key, now) || overRate(now)) return;
    if (inFlight >= maxConcurrent) {
      waiting = { key, run };
      return;
    }
    const entry = { at: now, invalidated: false };
    done.set(key, entry);
    for (const [k, v] of done) if (now - v.at >= ttlMs) done.delete(k);
    started.push(now);
    inFlight++;
    try {
      // Only this prefetch's own invalidation counts, not one from an older copy.
      run(() => {
        entry.invalidated = true;
      });
    } catch {
      // A bad href: nothing was fetched, but the slot and the rate budget stay counted.
    }
    setTimeout(() => {
      inFlight--;
      const next = waiting;
      waiting = null;
      if (next) request(next.key, next.run);
    }, holdMs);
  }

  return {
    intend(key, run) {
      if (pending.has(key) || recentlyFetched(key, Date.now())) return;
      pending.set(
        key,
        setTimeout(() => {
          pending.delete(key);
          request(key, run);
        }, dwellMs),
      );
    },
    cancel(key) {
      const timer = pending.get(key);
      if (timer !== undefined) clearTimeout(timer);
      pending.delete(key);
      if (waiting?.key === key) waiting = null;
    },
  };
}
