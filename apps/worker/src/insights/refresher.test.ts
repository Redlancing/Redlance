import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInsightsRefresher } from "./refresher";

const HOUR = 60 * 60_000;
const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("insights refresher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs at start, then every hour, and logs counts and duration", async () => {
    const l = log();
    const refresh = vi.fn().mockResolvedValue({ upserted: 5, deleted: 1 });
    const r = createInsightsRefresher({ log: l as never, refresh });
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(l.info).toHaveBeenCalledWith(
      expect.objectContaining({
        upserted: 5,
        deleted: 1,
        ms: expect.any(Number),
      }),
      expect.any(String),
    );
    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(refresh).toHaveBeenCalledTimes(3);
    await r.stop();
  });

  it("does nothing until started (the lock gate) and start twice is one loop", async () => {
    const refresh = vi.fn().mockResolvedValue({ upserted: 0, deleted: 0 });
    const r = createInsightsRefresher({ log: log() as never, refresh });
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(refresh).not.toHaveBeenCalled();
    r.start();
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await r.stop();
  });

  it("keeps the loop alive after an error", async () => {
    const l = log();
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue({ upserted: 2, deleted: 0 });
    const r = createInsightsRefresher({ log: l as never, refresh });
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: "db down" }),
      expect.any(String),
    );
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(l.info).toHaveBeenCalledTimes(1);
    await r.stop();
  });

  it("stop cancels the timer, and a later start runs again", async () => {
    const refresh = vi.fn().mockResolvedValue({ upserted: 0, deleted: 0 });
    const r = createInsightsRefresher({ log: log() as never, refresh });
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    await r.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(refresh).toHaveBeenCalledTimes(1);
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    await r.stop();
  });

  it("stop waits for a refresh in flight and does not reschedule", async () => {
    let finish!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<{ upserted: number; deleted: number }>((res) => {
          finish = () => res({ upserted: 0, deleted: 0 });
        }),
    );
    const r = createInsightsRefresher({ log: log() as never, refresh });
    r.start();
    let stopped = false;
    const p = r.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    finish();
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a restart soon after a run waits out the rest of the interval", async () => {
    const refresh = vi.fn().mockResolvedValue({ upserted: 0, deleted: 0 });
    const r = createInsightsRefresher({ log: log() as never, refresh });
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    await r.stop();
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    r.start(); // lock picked up again 20 minutes later
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(40 * 60_000 - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(refresh).toHaveBeenCalledTimes(3);
    await r.stop();
  });

  it("logs a skipped refresh as skipped", async () => {
    const l = log();
    const refresh = vi
      .fn()
      .mockResolvedValue({ upserted: 0, deleted: 0, skipped: true });
    const r = createInsightsRefresher({ log: l as never, refresh });
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.info).toHaveBeenCalledWith(
      expect.objectContaining({ skipped: true }),
      expect.stringContaining("skipped"),
    );
    await r.stop();
  });
});
