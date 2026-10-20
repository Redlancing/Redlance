import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, isStale } from "./freshness";

describe("isStale", () => {
  const now = 1_000_000;
  it("fresh data is not stale, up to the threshold", () => {
    expect(isStale(now, now)).toBe(false);
    expect(isStale(now - STALE_AFTER_MS, now)).toBe(false);
  });
  it("older than the threshold is stale", () => {
    expect(isStale(now - STALE_AFTER_MS - 1, now)).toBe(true);
    expect(isStale(now - 5 * 60_000, now)).toBe(true);
  });
  it("a small clock skew is tolerated, a large one is stale", () => {
    expect(isStale(now + 3_000, now)).toBe(false);
    expect(isStale(now + 60_000, now)).toBe(true);
  });
  it("takes a custom threshold", () => {
    expect(isStale(now - 2_000, now, 1_000)).toBe(true);
  });
});
