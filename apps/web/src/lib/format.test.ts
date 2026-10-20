import { describe, expect, it } from "vitest";
import { budgetText, communityUrl, scoreBand, timeAgo } from "./format";

const now = new Date("2026-10-20T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("timeAgo", () => {
  it("steps through now, minutes, hours and days", () => {
    expect(timeAgo(ago(30_000), now)).toBe("now");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5m");
    expect(timeAgo(ago(2 * 3_600_000), now)).toBe("2h");
    expect(timeAgo(ago(3 * 86_400_000), now)).toBe("3d");
  });
  it("switches to a date after a week", () => {
    expect(timeAgo("2026-10-12T08:00:00Z", now)).toBe("Oct 12");
  });
  it("reads a future or invalid time safely", () => {
    expect(timeAgo(ago(-60_000), now)).toBe("now");
    expect(timeAgo("nope", now)).toBe("");
  });
});

describe("budgetText", () => {
  it("formats a budget and returns null without one", () => {
    expect(
      budgetText({ min: 400, max: 600, currency: "USD", unit: "fixed" }),
    ).toBe("$400–600");
    expect(
      budgetText({ min: null, max: null, currency: null, unit: null }),
    ).toBe(null);
    expect(budgetText(null)).toBe(null);
  });
});

describe("scoreBand", () => {
  it("cuts at 85 and 70", () => {
    expect(scoreBand(100)).toBe("strong");
    expect(scoreBand(85)).toBe("strong");
    expect(scoreBand(84)).toBe("good");
    expect(scoreBand(70)).toBe("good");
    expect(scoreBand(69)).toBe("fair");
  });
});

describe("communityUrl", () => {
  it("links the subreddit with or without the r/ prefix", () => {
    expect(communityUrl("forhire")).toBe("https://www.reddit.com/r/forhire/");
    expect(communityUrl("r/forhire")).toBe("https://www.reddit.com/r/forhire/");
  });
});
