import { PROFILE_SECTIONS as DB_SECTIONS } from "@redlance/db";
import { describe, expect, it } from "vitest";
import {
  PROFILE_SECTIONS,
  allowanceText,
  computeAllowance,
  sameSection,
  sectionKey,
  stableJson,
} from "./profile-edit";

const now = new Date("2026-10-20T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("PROFILE_SECTIONS", () => {
  it("matches the database's list", () => {
    expect([...PROFILE_SECTIONS]).toEqual([...DB_SECTIONS]);
  });
});

describe("computeAllowance", () => {
  it("starts with all 5 and no next time", () => {
    expect(computeAllowance([], now)).toEqual({
      limit: 5,
      used: 0,
      remaining: 5,
      nextFreeAt: null,
    });
  });

  it("counts only the last 7 days, and the oldest counted change frees up first", () => {
    const a = computeAllowance([daysAgo(8), daysAgo(3), daysAgo(1)], now);
    expect(a).toMatchObject({ used: 2, remaining: 3 });
    expect(a.nextFreeAt).toBe(daysAgo(3 - 7).toISOString());
  });

  it("drops a change exactly 7 days old (the window rolls)", () => {
    expect(computeAllowance([daysAgo(7)], now).used).toBe(0);
    expect(computeAllowance([daysAgo(6.99)], now).used).toBe(1);
  });

  it("is 0 left at 5, never negative above it", () => {
    const five = [5, 4, 3, 2, 1].map(daysAgo);
    expect(computeAllowance(five, now)).toMatchObject({
      used: 5,
      remaining: 0,
      nextFreeAt: daysAgo(5 - 7).toISOString(),
    });
    // Six (never normal): two must expire, so the second oldest decides.
    const six = [6, ...[5, 4, 3, 2, 1]].map(daysAgo);
    expect(computeAllowance(six, now)).toMatchObject({
      remaining: 0,
      nextFreeAt: daysAgo(5 - 7).toISOString(),
    });
  });
});

describe("allowanceText", () => {
  it("reads naturally for each state", () => {
    expect(allowanceText(computeAllowance([], now), "UTC")).toEqual({
      summary: "5 of 5 changes left this week",
      next: null,
    });
    const two = computeAllowance([daysAgo(2), daysAgo(1)], now);
    expect(allowanceText(two, "UTC")).toEqual({
      summary: "3 of 5 changes left this week",
      next: "One more frees up Sun, Oct 25, 12:00 PM",
    });
    const none = computeAllowance([5, 4, 3, 2, 1].map(daysAgo), now);
    expect(allowanceText(none, "UTC")).toEqual({
      summary: "No changes left this week",
      next: "Next one frees up Thu, Oct 22, 12:00 PM",
    });
  });

  it("uses the profile's time zone, and survives a bad one", () => {
    const one = computeAllowance([daysAgo(1)], now);
    expect(allowanceText(one, "Asia/Kolkata").next).toBe(
      "One more frees up Mon, Oct 26, 5:30 PM",
    );
    expect(allowanceText(one, "Not/AZone").next).toMatch(/^One more frees up/);
  });
});

describe("stableJson and sectionKey", () => {
  it("ignores key order", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("treats skills as a set", () => {
    const a = {
      skills: [
        { id: "react", level: "core", source: "manual" },
        { id: "css", level: "secondary", source: "manual" },
      ],
    };
    const b = { skills: [...a.skills].reverse() };
    expect(sameSection("skills", a, b)).toBe(true);
    expect(
      sameSection("skills", a, {
        ...a,
        skills: [{ ...a.skills[0]!, level: "secondary" }, a.skills[1]!],
      }),
    ).toBe(false);
  });

  it("keeps project order but ignores namesRemoved", () => {
    const p1 = { title: "A", namesRemoved: true };
    const p2 = { title: "B", namesRemoved: false };
    const work = (projects: object[]) => ({
      projects,
      experience: [],
      mentionEmployers: false,
    });
    expect(
      sameSection(
        "work",
        work([p1, p2]),
        work([
          { ...p1, namesRemoved: false },
          { ...p2, namesRemoved: true },
        ]),
      ),
    ).toBe(true);
    expect(sameSection("work", work([p1, p2]), work([p2, p1]))).toBe(false);
  });

  it("compares other sections field by field", () => {
    const rates = {
      minRate: 25,
      currency: "USD",
      rateType: "hourly",
      remoteOnly: true,
    };
    expect(sectionKey("rates", rates)).toBe(sectionKey("rates", { ...rates }));
    expect(sameSection("rates", rates, { ...rates, minRate: 30 })).toBe(false);
  });
});
