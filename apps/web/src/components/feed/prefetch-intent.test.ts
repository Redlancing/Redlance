import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTENT_DWELL_MS,
  PREFETCH_HOLD_MS,
  REPEAT_AFTER_MS,
  canPrefetch,
  createPrefetchScheduler,
} from "./prefetch-intent";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

/** A scheduler whose prefetches are recorded, with each run's onInvalidate kept. */
function setup(options?: Parameters<typeof createPrefetchScheduler>[0]) {
  const s = createPrefetchScheduler(options);
  const runs: string[] = [];
  const invalidate = new Map<string, () => void>();
  const intend = (key: string) =>
    s.intend(key, (onInvalidate) => {
      runs.push(key);
      invalidate.set(key, onInvalidate);
    });
  return { s, runs, invalidate, intend };
}

describe("intent", () => {
  it("prefetches only after the pointer or selection rests for the dwell time", () => {
    const { runs, intend } = setup();
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS - 1);
    expect(runs).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(runs).toEqual(["a"]);
  });

  it("leaving before the dwell time cancels it", () => {
    const { s, runs, intend } = setup();
    intend("a");
    vi.advanceTimersByTime(100);
    s.cancel("a");
    vi.advanceTimersByTime(1_000);
    expect(runs).toEqual([]);
  });

  it("a second intent on the same row doesn't restart or double the timer", () => {
    const { runs, intend } = setup();
    intend("a");
    vi.advanceTimersByTime(100);
    intend("a");
    vi.advanceTimersByTime(50);
    expect(runs).toEqual(["a"]);
    vi.advanceTimersByTime(1_000);
    expect(runs).toEqual(["a"]);
  });

  it("cancel after the prefetch started is harmless", () => {
    const { s, runs, intend } = setup();
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    s.cancel("a");
    expect(runs).toEqual(["a"]);
  });
});

describe("dedupe", () => {
  it("the same match isn't prefetched again while Next still holds it", () => {
    const { runs, intend } = setup();
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS + PREFETCH_HOLD_MS);
    intend("a");
    vi.advanceTimersByTime(4 * 60_000);
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    expect(runs).toEqual(["a"]);
  });

  it("after Next's cache time it may be prefetched again", () => {
    const { runs, intend } = setup({ ttlMs: 5 * 60_000 });
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    vi.advanceTimersByTime(5 * 60_000);
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    expect(runs).toEqual(["a", "a"]);
  });

  it("an invalidated prefetch may repeat, but never within the repeat window", () => {
    const { runs, invalidate, intend } = setup();
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    invalidate.get("a")!();
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    expect(runs).toEqual(["a"]);
    vi.advanceTimersByTime(REPEAT_AFTER_MS);
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    expect(runs).toEqual(["a", "a"]);
  });

  it("an invalidation of an older prefetch doesn't clear a newer one", () => {
    const { s, runs, intend } = setup({ ttlMs: 60_000 });
    let first: (() => void) | undefined;
    s.intend("a", (onInvalidate) => {
      runs.push("a");
      first = onInvalidate;
    });
    vi.advanceTimersByTime(INTENT_DWELL_MS + 60_000);
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    expect(runs).toEqual(["a", "a"]);
    first!();
    vi.advanceTimersByTime(REPEAT_AFTER_MS);
    intend("a");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    expect(runs).toEqual(["a", "a"]);
  });
});

describe("load", () => {
  it("at most two at a time; the newest waiting intent runs when a slot frees", () => {
    const { runs, intend } = setup();
    for (const k of ["a", "b", "c", "d"]) intend(k);
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    expect(runs).toEqual(["a", "b"]);
    vi.advanceTimersByTime(PREFETCH_HOLD_MS);
    // "c" was replaced by the newer "d" while both waited.
    expect(runs).toEqual(["a", "b", "d"]);
    vi.advanceTimersByTime(10 * PREFETCH_HOLD_MS);
    expect(runs).toEqual(["a", "b", "d"]);
  });

  it("a row that goes away (its cleanup cancels) never prefetches, waiting or not", () => {
    const { s, runs, intend } = setup();
    for (const k of ["a", "b", "c"]) intend(k);
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    // "c" waits for a slot; "d" is still in its dwell time. Both rows unmount.
    intend("d");
    s.cancel("c");
    s.cancel("d");
    vi.advanceTimersByTime(10 * PREFETCH_HOLD_MS);
    expect(runs).toEqual(["a", "b"]);
  });

  it("at most ten a minute (sliding window); intents over the limit are dropped", () => {
    const { runs, intend } = setup();
    for (let i = 0; i < 12; i++) {
      intend(`m${i}`);
      vi.advanceTimersByTime(INTENT_DWELL_MS + PREFETCH_HOLD_MS);
    }
    expect(runs).toHaveLength(10);
    // The window slides: a minute after the first one, there is room again.
    vi.setSystemTime(Date.now() + 60_000);
    intend("late");
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    expect(runs.at(-1)).toBe("late");
  });

  it("a run that throws still frees its slot", () => {
    const s = createPrefetchScheduler({ maxConcurrent: 1 });
    const runs: string[] = [];
    s.intend("a", () => {
      throw new Error("bad href");
    });
    vi.advanceTimersByTime(INTENT_DWELL_MS + PREFETCH_HOLD_MS);
    s.intend("b", () => void runs.push("b"));
    vi.advanceTimersByTime(INTENT_DWELL_MS);
    expect(runs).toEqual(["b"]);
  });
});

describe("canPrefetch", () => {
  it("only with a mouse-like pointer and without data saver", () => {
    expect(canPrefetch({ hoverFine: true })).toBe(true);
    expect(canPrefetch({ hoverFine: true, saveData: false })).toBe(true);
    expect(canPrefetch({ hoverFine: false })).toBe(false);
    expect(canPrefetch({ hoverFine: true, saveData: true })).toBe(false);
  });
});
