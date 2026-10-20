import { HOUR_SLOTS } from "./constants";

export type Gate = { ok: true } | { ok: false; have: number; need: number };

/** Rule 8: is there enough data to show a number? */
export function gate(n: number, min: number): Gate {
  return n >= min ? { ok: true } : { ok: false, have: n, need: min };
}

/** Whole-number percent; a real share never rounds to 0% or 100%. */
export function percentText(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  let n = Math.round((part / whole) * 100);
  if (n === 0 && part > 0) n = 1;
  if (n === 100 && part < whole) n = 99;
  return `${n}%`;
}

/** "1 in 5" for a share up to a half, a percent above that. */
export function ratioText(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "None";
  if (part >= whole) return "All";
  if (part / whole > 0.5) return percentText(part, whole);
  return `1 in ${Math.max(2, Math.round(whole / part))}`;
}

/** A per-post ratio: "3", "0.4", "15" (the caller adds "per hiring post"). */
export function perPostText(part: number, whole: number): string {
  if (whole <= 0) return "0";
  const r = part / whole;
  return String(r >= 10 ? Math.round(r) : Math.round(r * 10) / 10);
}

/** The zone's offset from UTC at `now`, in half-hour slots (45-minute zones round to the nearest). */
export function zoneOffsetSlots(timeZone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offsetMs = asUtc - Math.floor(now.getTime() / 1000) * 1000;
  return Math.round(offsetMs / 1_800_000);
}

/** UTC week slots moved into the zone: index = local half-hour of the week, Monday 00:00 = 0. */
export function slotsToLocalSlots(
  slots: readonly number[],
  timeZone: string,
  now: Date,
): number[] {
  if (slots.length !== HOUR_SLOTS) {
    throw new Error(`expected ${HOUR_SLOTS} slots, got ${slots.length}`);
  }
  const shift = zoneOffsetSlots(timeZone, now);
  const out = new Array<number>(HOUR_SLOTS).fill(0);
  for (let i = 0; i < HOUR_SLOTS; i++) {
    out[(((i + shift) % HOUR_SLOTS) + HOUR_SLOTS) % HOUR_SLOTS] = slots[i]!;
  }
  return out;
}

/** 24 local-hour counts (0–23) from the UTC week slots. */
export function slotsToLocalHours(
  slots: readonly number[],
  timeZone: string,
  now: Date,
): number[] {
  const local = slotsToLocalSlots(slots, timeZone, now);
  const hours = new Array<number>(24).fill(0);
  for (let i = 0; i < HOUR_SLOTS; i++) {
    hours[Math.floor((i % 48) / 2)]! += local[i]!;
  }
  return hours;
}

/** The busiest 4-hour stretch (wraps past midnight). Ties go to the earliest start. */
export function busiestStretch(hours: readonly number[]): {
  startHour: number;
  total: number;
} {
  let best = { startHour: 0, total: -1 };
  for (let s = 0; s < 24; s++) {
    let total = 0;
    for (let k = 0; k < 4; k++) total += hours[(s + k) % 24]!;
    if (total > best.total) best = { startHour: s, total };
  }
  return best;
}

/**
 * Do posts arrive mostly on weekdays or weekends (local time)? Compares the rate per day
 * (5 weekdays vs 2 weekend days), so an even week reads "all week".
 */
export function weekPattern(
  slots: readonly number[],
  timeZone: string,
  now: Date,
): { weekendShare: number; pattern: "weekdays" | "weekends" | "all week" } {
  const local = slotsToLocalSlots(slots, timeZone, now);
  let weekend = 0;
  let total = 0;
  for (let i = 0; i < HOUR_SLOTS; i++) {
    total += local[i]!;
    if (Math.floor(i / 48) >= 5) weekend += local[i]!;
  }
  if (total === 0) return { weekendShare: 0, pattern: "all week" };
  const weekdayRate = (total - weekend) / 5;
  const weekendRate = weekend / 2;
  const pattern =
    weekdayRate > weekendRate * 1.5
      ? "weekdays"
      : weekendRate > weekdayRate * 1.5
        ? "weekends"
        : "all week";
  return { weekendShare: weekend / total, pattern };
}
