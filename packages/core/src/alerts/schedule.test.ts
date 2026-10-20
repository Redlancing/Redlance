import { describe, expect, it } from "vitest";
import { deliveryBackoffMs, startOfLocalDay } from "./schedule";

describe("startOfLocalDay", () => {
  it("is midnight UTC for UTC", () => {
    const now = new Date("2026-10-20T15:30:00Z");
    expect(startOfLocalDay("UTC", now).toISOString()).toBe(
      "2026-10-20T00:00:00.000Z",
    );
  });

  it("handles a half-hour offset (Asia/Kolkata, UTC+5:30)", () => {
    // 20:00 UTC is 01:30 on the 21st in India.
    const now = new Date("2026-10-20T20:00:00Z");
    expect(startOfLocalDay("Asia/Kolkata", now).toISOString()).toBe(
      "2026-10-20T18:30:00.000Z",
    );
    // 10:00 UTC is 15:30 on the 20th.
    expect(
      startOfLocalDay(
        "Asia/Kolkata",
        new Date("2026-10-20T10:00:00Z"),
      ).toISOString(),
    ).toBe("2026-10-19T18:30:00.000Z");
  });

  it("handles America/New_York on both sides of the DST change", () => {
    // 2026-11-01: clocks go back at 02:00 EDT (UTC-4) to 01:00 EST (UTC-5).
    // Midnight that day is still EDT.
    expect(
      startOfLocalDay(
        "America/New_York",
        new Date("2026-11-01T20:00:00Z"),
      ).toISOString(),
    ).toBe("2026-11-01T04:00:00.000Z");
    expect(
      startOfLocalDay(
        "America/New_York",
        new Date("2026-11-02T20:00:00Z"),
      ).toISOString(),
    ).toBe("2026-11-02T05:00:00.000Z");
    // 2026-03-08: clocks go forward at 02:00 EST to 03:00 EDT; midnight is EST.
    expect(
      startOfLocalDay(
        "America/New_York",
        new Date("2026-03-08T20:00:00Z"),
      ).toISOString(),
    ).toBe("2026-03-08T05:00:00.000Z");
  });

  it("falls back to UTC for an unknown zone", () => {
    const now = new Date("2026-10-20T15:30:00Z");
    expect(startOfLocalDay("Not/AZone", now).toISOString()).toBe(
      "2026-10-20T00:00:00.000Z",
    );
  });
});

describe("deliveryBackoffMs", () => {
  it("doubles from 30 s and caps at 30 min", () => {
    expect(deliveryBackoffMs(1)).toBe(30_000);
    expect(deliveryBackoffMs(2)).toBe(60_000);
    expect(deliveryBackoffMs(3)).toBe(120_000);
    expect(deliveryBackoffMs(10)).toBe(30 * 60_000);
    expect(deliveryBackoffMs(0)).toBe(30_000);
  });
});
