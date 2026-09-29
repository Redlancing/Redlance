import { describe, expect, it } from "vitest";
import { trialDaysLeft } from "./trial";

describe("trialDaysLeft", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("rounds up partial days and never goes below 0", () => {
    expect(trialDaysLeft(new Date("2026-10-06T12:00:00Z"), now)).toBe(5);
    expect(trialDaysLeft(new Date("2026-10-01T13:00:00Z"), now)).toBe(1);
    expect(trialDaysLeft(new Date("2026-09-30T12:00:00Z"), now)).toBe(0);
  });
});
