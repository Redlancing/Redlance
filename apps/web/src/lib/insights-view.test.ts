import type {
  BudgetGroup,
  InsightsListRow,
  SubredditInsightsResponse,
} from "@redlance/core";
import { describe, expect, it } from "vitest";
import {
  accessFromCode,
  budgetGroupLabel,
  budgetMiddle,
  budgetRange,
  budgetShort,
  filterRows,
  hiringFacts,
  hourLabel,
  hourSpan,
  hoursSentence,
  inStretch,
  listBuilding,
  listRowView,
  listState,
  nothingYet,
  parseSubredditParam,
  parseTab,
  quietText,
  riskFacts,
  subredditHref,
  tabHref,
  trendOf,
  updatedText,
  weekSentence,
  zoneName,
} from "./insights-view";

const notEnough = { status: "not_enough", have: 12, need: 20 } as const;

const usdHour: BudgetGroup = {
  currency: "USD",
  unit: "hour",
  n: 40,
  p25: 15,
  median: 22.4,
  p75: 35,
};

function detail(
  over: Partial<SubredditInsightsResponse> = {},
): SubredditInsightsResponse {
  return {
    subreddit: "forhire",
    displayName: "ForHire",
    computedAt: "2026-10-21T10:00:00.000Z",
    postsPerWeek: { status: "ok", perWeek: 35, prevPerWeek: 28 },
    fit: { status: "ok", best: 12, hiring: 60, text: "1 in 5 fit your skills" },
    budgets: { status: "ok", groups: [usdHour] },
    hours: {
      status: "ok",
      timeZone: "Asia/Kolkata",
      hours: new Array<number>(24).fill(1),
      busiestStartHour: 18,
      pattern: "weekdays",
    },
    skills: { status: "ok", skills: [] },
    paid: { status: "ok", paid: 92, revShare: 5, unpaid: 3, other: 0 },
    redFlags: {
      status: "ok",
      percent: 12,
      text: "1 in 8 has a red flag, mostly vague pay",
      top: [],
    },
    crowded: { status: "ok", perHiringPost: "3" },
    budgetStated: { status: "ok", percent: 40 },
    remote: { status: "ok", percent: 95 },
    repeatClients: { status: "building", days: 9 },
    latestMatches: [],
    ...over,
  };
}

describe("tabs and links", () => {
  it("reads the tab from the URL, defaulting to yours", () => {
    expect(parseTab(undefined)).toBe("yours");
    expect(parseTab("all")).toBe("all");
    expect(parseTab(["all"])).toBe("yours");
    expect(parseTab("nope")).toBe("yours");
    expect(tabHref("all")).toBe("/insights?tab=all");
    expect(tabHref("yours")).toBe("/insights");
    expect(subredditHref("forhire")).toBe("/insights/forhire");
  });

  it("accepts only Reddit-style names, lowercased", () => {
    expect(parseSubredditParam("ForHire")).toBe("forhire");
    expect(parseSubredditParam("a")).toBeNull();
    expect(parseSubredditParam("has-dash")).toBeNull();
    expect(parseSubredditParam("%E0%A4%A")).toBeNull();
    expect(parseSubredditParam("x".repeat(22))).toBeNull();
  });
});

describe("quietText", () => {
  it("says how far a number is from the threshold, or how long history is", () => {
    expect(quietText(notEnough)).toBe("Not enough data yet (12 of 20)");
    expect(quietText({ status: "building", days: 1 })).toBe(
      "Building history (1 day)",
    );
    expect(quietText({ status: "building", days: 9 })).toBe(
      "Building history (9 days)",
    );
    expect(quietText({ status: "ok" })).toBeNull();
  });
});

describe("posted budgets", () => {
  it("shows the middle half as a range, per currency and unit", () => {
    expect(budgetRange(usdHour)).toBe("$15–35");
    expect(budgetMiddle(usdHour)).toBe("$22");
    expect(budgetGroupLabel(usdHour)).toBe("USD per hour");
    expect(budgetShort(usdHour)).toBe("$15–35/hour");
  });

  it("collapses an equal range and handles fixed prices and unknown currencies", () => {
    const fixed: BudgetGroup = {
      currency: "GBP",
      unit: "fixed",
      n: 20,
      p25: 1200,
      median: 1500,
      p75: 2500,
    };
    expect(budgetShort(fixed)).toBe("£1,200–2,500 fixed");
    expect(budgetRange({ ...usdHour, p25: 20.2, p75: 19.8 })).toBe("$20");
    const cad: BudgetGroup = { ...usdHour, currency: "CAD" };
    expect(budgetRange(cad)).toBe("15–35 CAD");
    expect(budgetMiddle(cad)).toBe("22 CAD");
  });
});

describe("hours", () => {
  it("labels hours on a 12-hour clock", () => {
    expect(hourLabel(0)).toBe("12 am");
    expect(hourLabel(6)).toBe("6 am");
    expect(hourLabel(12)).toBe("12 pm");
    expect(hourLabel(18)).toBe("6 pm");
  });

  it("names a 4-hour stretch, across noon and midnight", () => {
    expect(hourSpan(18, 4)).toBe("6–10 pm");
    expect(hourSpan(10, 4)).toBe("10 am–2 pm");
    expect(hourSpan(22, 4)).toBe("10 pm–2 am");
    expect(hourSpan(20, 4)).toBe("8 pm–12 am");
    expect(hourSpan(0, 4)).toBe("12–4 am");
  });

  it("knows which bars sit in the busiest stretch, wrapping midnight", () => {
    expect([21, 22, 23, 0, 1, 2].map((h) => inStretch(h, 22))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("writes the hours sentence", () => {
    expect(hoursSentence(18, "weekdays")).toBe(
      "Most posts arrive 6–10 pm your time, mostly on weekdays.",
    );
    expect(hoursSentence(9, "all week")).toBe(
      "Most posts arrive 9 am–1 pm your time, spread across the week.",
    );
    expect(zoneName("America/New_York")).toBe("New York");
    expect(zoneName("UTC")).toBe("UTC");
  });
});

describe("facts", () => {
  it("puts the number first and one sentence after it", () => {
    const facts = hiringFacts(detail());
    expect(facts.map((f) => f.key)).toEqual([
      "perWeek",
      "fit",
      "paid",
      "budgetStated",
      "remote",
    ]);
    expect(facts[0]).toMatchObject({
      value: "~35",
      sentence: "hiring posts a week, up from 28",
    });
    expect(facts[1]).toMatchObject({
      value: "20%",
      sentence: "12 of 60 hiring posts fit your skills",
    });
    expect(facts[2]).toMatchObject({
      value: "92%",
      sentence: "are paid; 5% offer a revenue share, 3% are unpaid",
    });
  });

  it("shows the quiet line for not_enough and building", () => {
    const r = detail({ remote: notEnough });
    expect(hiringFacts(r).find((f) => f.key === "remote")).toEqual({
      key: "remote",
      label: "Remote",
      quiet: "Not enough data yet (12 of 20)",
    });
    expect(riskFacts(r).find((f) => f.key === "repeat")).toEqual({
      key: "repeat",
      label: "Repeat clients",
      quiet: "Building history (9 days)",
    });
  });

  it("marks a high red-flag share in the danger tone only", () => {
    const low = riskFacts(detail())[0]!;
    expect("tone" in low && low.tone).toBeFalsy();
    const high = riskFacts(
      detail({
        redFlags: { status: "ok", percent: 25, text: "1 in 4", top: [] },
      }),
    )[0]!;
    expect(high).toMatchObject({ tone: "danger", value: "25%" });
  });

  it("words the week trend", () => {
    expect(weekSentence(30, null)).toBe("hiring posts a week");
    expect(weekSentence(20, 28)).toBe("hiring posts a week, down from 28");
    expect(weekSentence(28, 28)).toBe(
      "hiring posts a week, same as the month before",
    );
    expect(trendOf(30, 28)).toBe("up");
    expect(trendOf(28, 28)).toBeNull();
    expect(trendOf(20, null)).toBeNull();
  });

  it("knows when nothing has a number yet", () => {
    expect(nothingYet(detail())).toBe(false);
    const r = detail({
      postsPerWeek: notEnough,
      fit: notEnough,
      budgets: notEnough,
      hours: notEnough,
      skills: notEnough,
      paid: notEnough,
      redFlags: notEnough,
      crowded: notEnough,
      budgetStated: notEnough,
      remote: notEnough,
    });
    expect(nothingYet(r)).toBe(true);
  });
});

describe("list rows", () => {
  const row: InsightsListRow = {
    subreddit: "forhire",
    displayName: "ForHire",
    perWeek: { status: "ok", perWeek: 35, prevPerWeek: 28 },
    fit: { status: "ok", text: "1 in 5 fit your skills" },
    mainBudget: { status: "ok", group: usdHour },
    redFlagPercent: { status: "ok", percent: 30 },
    matches: 4,
  };

  it("shapes a row for Yours", () => {
    expect(listRowView(row)).toEqual({
      name: "forhire",
      displayName: "ForHire",
      href: "/insights/forhire",
      perWeek: { ok: true, value: { text: "~35", trend: "up", prev: 28 } },
      fit: { ok: true, value: "1 in 5 fit your skills" },
      budget: { ok: true, value: "$15–35/hour" },
      redFlags: { ok: true, value: { text: "30%", danger: true } },
      matches: 4,
    });
  });

  it("shapes a Browse all row with quiet cells", () => {
    const v = listRowView({
      ...row,
      fit: null,
      matches: undefined,
      perWeek: notEnough,
      mainBudget: notEnough,
    });
    expect(v.fit).toBeNull();
    expect(v.matches).toBeNull();
    expect(v.perWeek).toEqual({
      ok: false,
      quiet: "Not enough data yet (12 of 20)",
    });
    expect(v.budget.ok).toBe(false);
  });

  it("detects the first days, when no row has a weekly number", () => {
    expect(listBuilding([])).toBe(false);
    expect(listBuilding([row])).toBe(false);
    expect(listBuilding([{ ...row, perWeek: notEnough }])).toBe(true);
  });

  it("filters by name, r/ prefix or display name", () => {
    const rows = [
      { subreddit: "forhire", displayName: "ForHire" },
      { subreddit: "slavelabour", displayName: "Slave Labour" },
      { subreddit: "hireawriter", displayName: "Hire a Writer" },
    ];
    expect(filterRows(rows, "")).toHaveLength(3);
    expect(filterRows(rows, " r/HIRE").map((r) => r.subreddit)).toEqual([
      "forhire",
      "hireawriter",
    ]);
    expect(filterRows(rows, "slave labour")).toHaveLength(1);
    expect(filterRows(rows, "zzz")).toEqual([]);
  });
});

describe("page states", () => {
  it("picks the empty message per tab", () => {
    expect(listState("yours", [])).toBe("empty-yours");
    expect(listState("all", [])).toBe("empty-all");
    expect(listState("all", [1])).toBe("rows");
  });

  it("maps the viewer check's codes to locked and not onboarded", () => {
    expect(accessFromCode("INSIGHTS_LOCKED")).toBe("locked");
    expect(accessFromCode("NOT_FOUND")).toBe("not_onboarded");
    expect(accessFromCode("INTERNAL")).toBeNull();
    expect(accessFromCode(undefined)).toBeNull();
  });
});

describe("updatedText", () => {
  const now = new Date("2026-10-21T12:00:00.000Z");
  it("says when the numbers were worked out", () => {
    expect(updatedText("2026-10-21T11:59:30.000Z", now)).toBe(
      "Updated just now",
    );
    expect(updatedText("2026-10-21T11:48:00.000Z", now)).toBe(
      "Updated 12m ago",
    );
    expect(updatedText("2026-10-01T11:48:00.000Z", now)).toBe("Updated Oct 1");
    expect(updatedText("not a date", now)).toBe("");
  });
});
