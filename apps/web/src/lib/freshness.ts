/**
 * How old server data may be before the page shows it and checks it again in the background.
 * Next's client cache keeps a prefetched or visited page for minutes (`staleTimes`), so a match
 * page's drafts, sent state and status can be much older than the moment it appears.
 */
export const STALE_AFTER_MS = 10_000;

/** Clock differences up to this much between server and browser still count as "now". */
export const CLOCK_SKEW_MS = 5_000;

/**
 * True when data the server loaded at `loadedAt` (epoch ms) should be revalidated. A timestamp
 * further in the future than the allowed skew (a browser clock that is behind) also counts as
 * stale: checking again is cheap, trusting old data is not.
 */
export function isStale(
  loadedAt: number,
  now: number,
  afterMs: number = STALE_AFTER_MS,
): boolean {
  const age = now - loadedAt;
  return age > afterMs || age < -CLOCK_SKEW_MS;
}

/** The current time in epoch ms; server components stamp loaded data with it (`loadedAt`). */
export function stampNow(): number {
  return Date.now();
}
