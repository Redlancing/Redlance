import { describe, expect, it } from "vitest";
import type { MatchingStats, UserMatchReport } from "@redlance/db";
import {
  formatMatchingSection,
  formatUserMatches,
  formatUserReport,
  refusalFor,
} from "./match-report";

const stats: MatchingStats = {
  posts: { pending: 2, running: 1, done: 3, skipped: 1 },
  matchesCreated: 6,
  matchesBroad: 1,
  ai: { done: 4, capped: 5, failed: 6, pending: 7 },
  rescoreSpendMicros: 12_300,
  usersAtCap: 2,
};

describe("formatMatchingSection", () => {
  // Case 2: every label and number is there; spend is shown as dollars.
  it("prints each label, number and the spend as $0.0123", () => {
    const text = formatMatchingSection(stats);
    expect(text).toContain("Matching");
    expect(text).toContain("2 pending, 1 running, 3 done, 1 skipped");
    expect(text).toContain("6 created, 1 broad");
    expect(text).toContain("4 done, 5 capped, 6 failed");
    expect(text).toContain("7 pending now");
    expect(text).toContain("$0.0123");
    expect(text).toContain("2 users at cap");
  });

  it("shows zero spend as $0.0000", () => {
    const text = formatMatchingSection({ ...stats, rescoreSpendMicros: 0 });
    expect(text).toContain("$0.0000");
  });
});

const match = (i: number, score: number, title: string) => ({
  title,
  score,
  reason: `reason ${i}`,
});

describe("formatUserMatches", () => {
  // Case 3: 7 matches give the top 5 by score, titles at most 60 characters.
  it("keeps the top 5 by score and cuts titles to 60 characters", () => {
    const long =
      "[Hiring] " + "A very long project title that keeps going ".repeat(3);
    const rows = [
      match(1, 40, "Low one"),
      match(2, 91, long),
      match(3, 70, "Third"),
      match(4, 85, "Fourth"),
      match(5, 60, "Fifth"),
      match(6, 95, "Top"),
      match(7, 30, "Lowest"),
    ];
    const lines = formatUserMatches(rows);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("Top");
    expect(lines[0]).toContain("95");
    expect(lines.join("\n")).not.toContain("Lowest");
    expect(lines.join("\n")).not.toContain("Low one");
    const titleLine = lines.find((l) => l.includes("[Hiring] A very long"))!;
    const shown = titleLine.match(/\[Hiring\] A very long[^·]*/)![0].trimEnd();
    expect(shown.length).toBeLessThanOrEqual(60);
    expect(shown.endsWith("…")).toBe(true);
  });
});

const report: UserMatchReport = {
  plan: "standard",
  trialEndsAt: new Date("2026-10-20T00:00:00Z"),
  aiAllowed: true,
  usedToday: 3,
  cap: 15,
  byAiStatus: {
    not_needed: 1,
    pending: 0,
    running: 0,
    done: 1,
    failed: 0,
    capped: 0,
  },
  byStatus: { new: 2, seen: 0, saved: 0, dismissed: 0, replied: 0 },
  top: [match(1, 85, "Gig one")],
};

describe("formatUserReport", () => {
  it("shows the plan, usage against the cap, and the status counts", () => {
    const text = formatUserReport(report);
    expect(text).toContain("standard");
    expect(text).toContain("3 / 15");
    expect(text).toContain("done 1");
    expect(text).toContain("new 2");
    expect(text).toContain("Gig one");
  });
});

describe("refusalFor", () => {
  // Case 4: the guard refuses outside local and test.
  it("refuses production, staging and unset, and allows local and test", () => {
    expect(refusalFor("production")).toMatch(/APP_ENV/);
    expect(refusalFor("staging")).toMatch(/APP_ENV/);
    expect(refusalFor(undefined)).toMatch(/APP_ENV/);
    expect(refusalFor("local")).toBeNull();
    expect(refusalFor("test")).toBeNull();
  });
});
