import { describe, expect, it } from "vitest";
import {
  createPerKeySpacing,
  createRateLimiter,
  realClock,
  type Clock,
} from "./pace";

/** Resolves with how long `p` took, in real ms. */
async function timed(p: Promise<unknown>): Promise<number> {
  const t = Date.now();
  await p;
  return Date.now() - t;
}

/** A fake clock: sleeps advance time instantly, in order. */
function fakeClock(): Clock & { t: number } {
  const c = {
    t: 0,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += Math.max(0, ms);
      await Promise.resolve();
    },
  };
  return c;
}

describe("createRateLimiter", () => {
  it("spaces 25 a second evenly", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ perSecond: 25, clock });
    const times: number[] = [];
    for (let i = 0; i < 26; i++) {
      await limiter.take();
      times.push(clock.t);
    }
    expect(times[0]).toBe(0);
    expect(times[1]).toBe(40);
    expect(times[25]).toBe(1000);
  });

  it("pauseFor holds the next taker until the pause ends", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ perSecond: 25, clock });
    await limiter.take();
    limiter.pauseFor(5000);
    await limiter.take();
    expect(clock.t).toBeGreaterThanOrEqual(5000);
  });
});

describe("aborting a wait", () => {
  it("take() returns as soon as the signal aborts, even mid-pause", async () => {
    const limiter = createRateLimiter({ perSecond: 25, clock: realClock });
    await limiter.take();
    limiter.pauseFor(60_000);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    expect(await timed(limiter.take(ac.signal))).toBeLessThan(1000);
  });

  it("take() with an aborted signal doesn't wait for its slot", async () => {
    const limiter = createRateLimiter({ perSecond: 0.01, clock: realClock });
    await limiter.take();
    expect(await timed(limiter.take(AbortSignal.abort()))).toBeLessThan(100);
  });

  it("wait() returns as soon as the signal aborts", async () => {
    const spacing = createPerKeySpacing(60_000, realClock);
    await spacing.wait("a");
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    expect(await timed(spacing.wait("a", ac.signal))).toBeLessThan(1000);
  });
});

describe("createPerKeySpacing", () => {
  it("one send per chat per gap; other chats aren't held", async () => {
    const clock = fakeClock();
    const spacing = createPerKeySpacing(1100, clock);
    await spacing.wait("a");
    expect(clock.t).toBe(0);
    await spacing.wait("b");
    expect(clock.t).toBe(0);
    await spacing.wait("a");
    expect(clock.t).toBe(1100);
  });

  it("drops entries older than a minute once the map grows", async () => {
    const clock = fakeClock();
    const spacing = createPerKeySpacing(1100, clock);
    for (let i = 0; i < 1001; i++) await spacing.wait(`chat${i}`);
    clock.t += 61_000;
    await spacing.wait("new");
    expect(spacing.size()).toBe(1);
  });
});
