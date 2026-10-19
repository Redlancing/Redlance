import { describe, expect, it } from "vitest";
import { aiAllowed, RESCORE_DAILY_CAP } from "./plans";

const now = new Date("2026-10-17T12:00:00Z");
const before = new Date("2026-10-20T00:00:00Z");
const after = new Date("2026-10-10T00:00:00Z");

describe("aiAllowed", () => {
  it("allows a trial before it ends and not after", () => {
    expect(aiAllowed("trial", before, now)).toBe(true);
    expect(aiAllowed("trial", after, now)).toBe(false);
  });
  it("allows paid plans even after the trial date", () => {
    expect(aiAllowed("standard", after, now)).toBe(true);
    expect(aiAllowed("max", after, now)).toBe(true);
  });
});

describe("RESCORE_DAILY_CAP", () => {
  it("is 15 / 15 / 50", () => {
    expect(RESCORE_DAILY_CAP).toEqual({ trial: 15, standard: 15, max: 50 });
  });
});
