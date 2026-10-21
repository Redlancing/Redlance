import { describe, expect, it, vi } from "vitest";
import { createPoller } from "./poll";

// A manual clock: timers fire only when the test advances time.
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  return {
    now: () => now,
    setTimeout(cb: () => void, ms: number) {
      const id = nextId++;
      timers.set(id, { at: now + ms, cb });
      return id;
    },
    clearTimeout(h: unknown) {
      timers.delete(h as number);
    },
    pending: () => timers.size,
    /** Moves time forward, firing due timers in order and letting promises settle between. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].cb();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      now = end;
    },
  };
}

describe("createPoller", () => {
  it("waits firstDelayMs, then intervalMs between calls", async () => {
    const clock = fakeClock();
    const fn = vi.fn(async () => 0);
    createPoller({
      fn,
      intervalMs: 1000,
      firstDelayMs: 1500,
      timeoutMs: 60_000,
      isDone: () => false,
      clock,
    });
    await clock.advance(1499);
    expect(fn).toHaveBeenCalledTimes(0);
    await clock.advance(1);
    expect(fn).toHaveBeenCalledTimes(1);
    await clock.advance(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops when isDone returns true", async () => {
    const clock = fakeClock();
    let n = 0;
    const onResult = vi.fn();
    const p = createPoller({
      fn: async () => ++n,
      intervalMs: 100,
      timeoutMs: 10_000,
      isDone: (v) => v === 3,
      onResult,
      clock,
    });
    await clock.advance(5000);
    expect(n).toBe(3);
    expect(onResult).toHaveBeenCalledTimes(3);
    expect(p.finished).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it("gives up at the timeout and calls onTimeout once", async () => {
    const clock = fakeClock();
    const fn = vi.fn(async () => 0);
    const onTimeout = vi.fn();
    const p = createPoller({
      fn,
      intervalMs: 1000,
      timeoutMs: 3500,
      isDone: () => false,
      onTimeout,
      clock,
    });
    await clock.advance(20_000);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(p.finished).toBe(true);
  });

  it("never overlaps calls", async () => {
    const clock = fakeClock();
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    createPoller({
      fn: () => {
        active++;
        maxActive = Math.max(maxActive, active);
        return new Promise<number>((resolve) =>
          releases.push(() => {
            active--;
            resolve(0);
          }),
        );
      },
      intervalMs: 100,
      timeoutMs: 100_000,
      isDone: () => false,
      clock,
    });
    await clock.advance(5000); // the first call never settles, so no second one starts
    expect(releases).toHaveLength(1);
    releases[0]();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await clock.advance(100);
    expect(releases).toHaveLength(2);
    expect(maxActive).toBe(1);
  });

  it("keeps polling after a failed call", async () => {
    const clock = fakeClock();
    const fn = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue(1);
    createPoller({
      fn,
      intervalMs: 100,
      timeoutMs: 10_000,
      isDone: (v) => v === 1,
      clock,
    });
    await clock.advance(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("pauses and resumes", async () => {
    const clock = fakeClock();
    const fn = vi.fn(async () => 0);
    const p = createPoller({
      fn,
      intervalMs: 100,
      timeoutMs: 100_000,
      isDone: () => false,
      clock,
    });
    await clock.advance(250);
    expect(fn).toHaveBeenCalledTimes(2);
    p.pause();
    await clock.advance(5000);
    expect(fn).toHaveBeenCalledTimes(2);
    p.resume();
    await clock.advance(100);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("drops the result of a call that was paused mid-flight", async () => {
    const clock = fakeClock();
    let release!: () => void;
    const onResult = vi.fn();
    const p = createPoller({
      fn: () => new Promise<number>((r) => (release = () => r(9))),
      intervalMs: 100,
      timeoutMs: 100_000,
      isDone: () => true,
      onResult,
      clock,
    });
    await clock.advance(100);
    p.pause();
    release();
    await clock.advance(0);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(onResult).not.toHaveBeenCalled();
    expect(p.finished).toBe(false);
  });

  it("stop() ends it for good", async () => {
    const clock = fakeClock();
    const fn = vi.fn(async () => 0);
    const p = createPoller({
      fn,
      intervalMs: 100,
      timeoutMs: 100_000,
      isDone: () => false,
      clock,
    });
    p.stop();
    p.resume();
    await clock.advance(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
