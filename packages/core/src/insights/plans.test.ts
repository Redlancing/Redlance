import { describe, expect, it } from "vitest";
import { insightsAllowed } from "./plans";

const now = new Date("2026-10-21T12:00:00Z");
const future = new Date("2026-10-23T00:00:00Z");
const past = new Date("2026-10-10T00:00:00Z");

describe("insightsAllowed", () => {
  it("allows a trial before it ends and not at or after", () => {
    expect(insightsAllowed("trial", future, now)).toBe(true);
    expect(insightsAllowed("trial", now, now)).toBe(false);
    expect(insightsAllowed("trial", past, now)).toBe(false);
  });
  it("allows paid plans even after the trial date", () => {
    expect(insightsAllowed("standard", past, now)).toBe(true);
    expect(insightsAllowed("max", past, now)).toBe(true);
  });
});
