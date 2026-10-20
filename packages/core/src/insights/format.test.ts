import { describe, expect, it } from "vitest";
import {
  busiestStretch,
  gate,
  percentText,
  perPostText,
  ratioText,
  slotsToLocalHours,
  weekPattern,
  zoneOffsetSlots,
} from "./format";

const now = new Date("2026-10-21T12:00:00Z"); // Europe and the US are both still on summer time
const slots = (set: Record<number, number>) => {
  const a = new Array<number>(336).fill(0);
  for (const [i, n] of Object.entries(set)) a[Number(i)] = n;
  return a;
};

describe("gate", () => {
  it("passes at the minimum and reports have/need below it", () => {
    expect(gate(20, 20)).toEqual({ ok: true });
    expect(gate(19, 20)).toEqual({ ok: false, have: 19, need: 20 });
    expect(gate(0, 20)).toEqual({ ok: false, have: 0, need: 20 });
  });
});

describe("ratioText / percentText / perPostText", () => {
  it("writes 1 in N for shares up to a half", () => {
    expect(ratioText(1, 5)).toBe("1 in 5");
    expect(ratioText(7, 50)).toBe("1 in 7");
    expect(ratioText(1, 2)).toBe("1 in 2");
    expect(ratioText(2, 3)).toBe("67%");
  });
  it("handles none and all", () => {
    expect(ratioText(0, 10)).toBe("None");
    expect(ratioText(10, 10)).toBe("All");
    expect(ratioText(0, 0)).toBe("None");
  });
  it("never rounds a real share to 0% or 100%", () => {
    expect(percentText(1, 1000)).toBe("1%");
    expect(percentText(999, 1000)).toBe("99%");
    expect(percentText(0, 10)).toBe("0%");
    expect(percentText(10, 10)).toBe("100%");
    expect(percentText(9, 20)).toBe("45%");
    expect(percentText(1, 0)).toBe("0%");
  });
  it("writes per-post ratios", () => {
    expect(perPostText(60, 20)).toBe("3");
    expect(perPostText(8, 20)).toBe("0.4");
    expect(perPostText(300, 20)).toBe("15");
    expect(perPostText(5, 0)).toBe("0");
  });
});

describe("zoneOffsetSlots", () => {
  it("returns half-hour offsets, including negative and half-hour zones", () => {
    expect(zoneOffsetSlots("UTC", now)).toBe(0);
    expect(zoneOffsetSlots("Asia/Kolkata", now)).toBe(11);
    expect(zoneOffsetSlots("America/New_York", now)).toBe(-8);
    expect(zoneOffsetSlots("Europe/London", now)).toBe(2);
    expect(zoneOffsetSlots("Europe/Paris", now)).toBe(4);
  });
  it("follows the current offset (DST)", () => {
    expect(
      zoneOffsetSlots("America/New_York", new Date("2026-12-21T12:00:00Z")),
    ).toBe(-10);
  });
});

describe("slotsToLocalHours", () => {
  it("groups half-hours into hours in UTC", () => {
    const h = slotsToLocalHours(slots({ 0: 2, 1: 3, 2: 4 }), "UTC", now);
    expect(h[0]).toBe(5);
    expect(h[1]).toBe(4);
    expect(h.reduce((a, b) => a + b, 0)).toBe(9);
  });
  it("shifts by a half-hour zone (India +5:30)", () => {
    // Monday 10:00 UTC = slot 20 -> 15:30 local -> hour 15
    const h = slotsToLocalHours(slots({ 20: 7 }), "Asia/Kolkata", now);
    expect(h[15]).toBe(7);
    expect(h.reduce((a, b) => a + b, 0)).toBe(7);
  });
  it("wraps across midnight and the week edge", () => {
    // Monday 01:00 UTC (slot 2) in New York (-4) = Sunday 21:00 local
    expect(
      slotsToLocalHours(slots({ 2: 3 }), "America/New_York", now)[21],
    ).toBe(3);
    // Sunday 23:30 UTC (slot 335) in Tokyo (+9) = Monday 08:30 local
    expect(slotsToLocalHours(slots({ 335: 2 }), "Asia/Tokyo", now)[8]).toBe(2);
  });
  it("rejects a wrong-length array", () => {
    expect(() => slotsToLocalHours([1, 2], "UTC", now)).toThrow();
  });
});

describe("busiestStretch", () => {
  it("finds the busiest four hours", () => {
    const hours = new Array<number>(24).fill(0);
    hours[18] = hours[19] = hours[20] = hours[21] = 5;
    expect(busiestStretch(hours)).toEqual({ startHour: 18, total: 20 });
  });
  it("wraps past midnight and breaks ties by the earliest start", () => {
    const hours = new Array<number>(24).fill(0);
    hours[22] = hours[23] = hours[0] = hours[1] = 3;
    expect(busiestStretch(hours).startHour).toBe(22);
    expect(busiestStretch(new Array<number>(24).fill(1)).startHour).toBe(0);
  });
});

describe("weekPattern", () => {
  const day = (d: number, n: number) => ({ [d * 48 + 20]: n });
  it("says weekdays when Monday to Friday dominate", () => {
    const s = slots({
      ...day(0, 10),
      ...day(1, 10),
      ...day(2, 10),
      ...day(5, 1),
    });
    expect(weekPattern(s, "UTC", now).pattern).toBe("weekdays");
  });
  it("says weekends when Saturday and Sunday dominate", () => {
    const s = slots({ ...day(5, 20), ...day(6, 20), ...day(0, 2) });
    expect(weekPattern(s, "UTC", now).pattern).toBe("weekends");
  });
  it("says all week when the rate per day is similar", () => {
    const s = slots(
      Object.assign({}, ...[0, 1, 2, 3, 4, 5, 6].map((d) => day(d, 5))),
    );
    expect(weekPattern(s, "UTC", now)).toEqual({
      weekendShare: 10 / 35,
      pattern: "all week",
    });
  });
  it("uses local days: Sunday night UTC is Monday in Tokyo", () => {
    const s = slots({ 335: 10 });
    expect(weekPattern(s, "UTC", now).pattern).toBe("weekends");
    expect(weekPattern(s, "Asia/Tokyo", now).pattern).toBe("weekdays");
  });
  it("handles no posts", () => {
    expect(weekPattern(slots({}), "UTC", now).pattern).toBe("all week");
  });
});
