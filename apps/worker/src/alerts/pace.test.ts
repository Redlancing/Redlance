import { describe, expect, it } from "vitest";
import { createPerKeySpacing, createRateLimiter, type Clock } from "./pace";

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
