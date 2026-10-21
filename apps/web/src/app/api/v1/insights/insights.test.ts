import { profiles, subredditInsights, subreddits } from "@redlance/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { matchInsightLine, subredditSummary } from "@/server/insights";
import {
  closeAll,
  cookieFor,
  req,
  resetState,
} from "../../../../../test/helpers";
import { seedDraftUser, userIdOf } from "../../../../../test/draft-fixtures";
import {
  clearPosts,
  seedMatch,
  seedPost,
} from "../../../../../test/feed-fixtures";
import { GET as getList } from "./route";
import { GET as getOne } from "./[subreddit]/route";

beforeEach(async () => {
  await resetState();
  await clearPosts();
  await getDb().execute(sql`truncate table subreddit_insights`);
});
afterAll(closeAll);

const DAY = 86_400_000;

type RowOver = Partial<typeof subredditInsights.$inferInsert>;

/** A row with 40 hiring posts and 60 days of history unless overridden. */
async function seedRow(subreddit: string, over: RowOver = {}) {
  const now = Date.now();
  const hiring = over.hiringPosts ?? 40;
  const known = over.knownAuthorPosts ?? Math.min(30, hiring);
  const slots = new Array<number>(336).fill(0);
  slots[36] = 40; // Monday 18:00-18:29 UTC
  await getDb()
    .insert(subredditInsights)
    .values({
      subreddit,
      computedAt: new Date(now),
      windowStart: new Date(now - 28 * DAY),
      hiringPosts: 40,
      hiringPostsPrev: 28,
      forHirePosts: 60,
      budgetStated: Math.min(20, hiring),
      payCounts: { paid: 30, revshare: 4, unpaid: 4, unknown: 2 },
      remoteCounts: { remote: 38, onsite: 2 },
      redFlagPosts: Math.min(5, hiring),
      redFlagCounts: { vague_pay: 4, upfront_fee: 1 },
      skillCounts: [
        { skillId: "nextjs", n: 12 },
        { skillId: "react", n: 2 },
      ],
      budgets: [
        { currency: "USD", unit: "hour", n: 25, p25: 15, median: 22, p75: 35 },
        {
          currency: "GBP",
          unit: "fixed",
          n: 19,
          p25: 100,
          median: 200,
          p75: 400,
        },
      ],
      hourSlots: slots,
      knownAuthorPosts: known,
      repeatAuthorPosts: Math.min(9, known),
      historyStart: new Date(now - 90 * DAY),
      ...over,
    });
}

async function catalogue(name: string, status: "active" | "dead" = "active") {
  await getDb()
    .insert(subreddits)
    .values({
      name,
      displayName: name.toUpperCase(),
      categories: ["development"],
      tier: "core",
      status,
    })
    .onConflictDoUpdate({
      target: subreddits.name,
      set: { status, displayName: name.toUpperCase() },
    });
}

async function user(
  opts: Parameters<typeof seedDraftUser>[1] = {},
  email = "dev@example.com",
) {
  const cookie = await cookieFor(email);
  const userId = await userIdOf(email);
  await seedDraftUser(userId, { grant: false, ...opts });
  return { cookie, userId };
}

const list = (cookie: string, qs = "") =>
  getList(req(`/api/v1/insights${qs}`, { headers: { cookie } }));
const one = (cookie: string, name: string) =>
  getOne(req(`/api/v1/insights/${name}`, { headers: { cookie } }), {
    params: Promise.resolve({ subreddit: name }),
  });

describe("access", () => {
  it("401 signed out", async () => {
    expect((await getList(req("/api/v1/insights"))).status).toBe(401);
  });

  it("404 before onboarding", async () => {
    const cookie = await cookieFor("new@example.com");
    const res = await list(cookie);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect((await one(cookie, "forhire")).status).toBe(404);
  });

  it("403 INSIGHTS_LOCKED after the trial ends", async () => {
    await seedRow("forhire");
    const { cookie } = await user({ trialEndsAt: new Date(Date.now() - 1000) });
    for (const res of [await list(cookie), await one(cookie, "forhire")]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("INSIGHTS_LOCKED");
    }
  });

  it("a paid plan stays allowed after trial_ends_at", async () => {
    await seedRow("forhire");
    const { cookie } = await user({
      plan: "standard",
      trialEndsAt: new Date(Date.now() - DAY),
    });
    expect((await one(cookie, "forhire")).status).toBe(200);
  });

  it("a running trial is allowed", async () => {
    await seedRow("forhire");
    const { cookie } = await user();
    expect((await one(cookie, "forhire")).status).toBe(200);
  });
});

describe("GET /api/v1/insights/:subreddit", () => {
  it("invalid names and unknown subreddits are 404", async () => {
    await seedRow("forhire");
    const { cookie } = await user();
    for (const bad of ["a", "has-dash", "x".repeat(22), "nope"]) {
      const res = await one(cookie, bad);
      expect(res.status).toBe(404);
    }
  });

  it("the name is lowercased", async () => {
    await seedRow("forhire");
    const { cookie } = await user();
    const res = await one(cookie, "ForHire");
    expect(res.status).toBe(200);
    expect((await res.json()).subreddit).toBe("forhire");
  });

  it("shapes every insight", async () => {
    await seedRow("forhire");
    await catalogue("forhire");
    const { cookie } = await user();
    const body = await (await one(cookie, "forhire")).json();
    expect(body.displayName).toBe("FORHIRE");
    expect(body.postsPerWeek).toEqual({
      status: "ok",
      perWeek: 10,
      prevPerWeek: 7,
    });
    expect(body.budgets).toEqual({
      status: "ok",
      groups: [
        { currency: "USD", unit: "hour", n: 25, p25: 15, median: 22, p75: 35 },
      ], // the GBP group has 19 points
    });
    expect(body.skills).toEqual({
      status: "ok",
      skills: [
        {
          skillId: "nextjs",
          name: expect.any(String),
          mentions: 12,
          percent: 30,
        },
      ], // react has 2 mentions
    });
    expect(body.paid).toEqual({
      status: "ok",
      paid: 75,
      revShare: 10,
      commission: 0,
      unpaid: 10,
      other: 5,
    });
    expect(body.redFlags).toMatchObject({
      status: "ok",
      percent: 13,
      text: "1 in 8 has a red flag, mostly vague pay",
    });
    expect(body.crowded).toEqual({ status: "ok", perHiringPost: "1.5" });
    expect(body.budgetStated).toEqual({ status: "ok", percent: 50 });
    expect(body.remote).toEqual({ status: "ok", percent: 95, unknown: 0 });
    expect(body.repeatClients).toEqual({ status: "ok", percent: 30 });
    expect(body.latestMatches).toEqual([]);
  });
});

describe("rule 8: the 20-point gate", () => {
  it("19 hides every number, 20 shows it", async () => {
    await seedRow("low", { hiringPosts: 19, knownAuthorPosts: 19 });
    await seedRow("edge", { hiringPosts: 20, knownAuthorPosts: 20 });
    const { cookie } = await user();
    const low = await (await one(cookie, "low")).json();
    for (const k of [
      "postsPerWeek",
      "hours",
      "skills",
      "paid",
      "redFlags",
      "crowded",
      "budgetStated",
      "remote",
      "repeatClients",
    ])
      expect(low[k], k).toEqual({ status: "not_enough", have: 19, need: 20 });
    const text = JSON.stringify(low);
    expect(text).not.toContain('"perWeek"');
    expect(text).not.toContain("percent");
    const edge = await (await one(cookie, "edge")).json();
    expect(edge.postsPerWeek.status).toBe("ok");
    expect(edge.hours.status).toBe("ok");
    expect(edge.repeatClients.status).toBe("ok");
  });

  it("budgets: no group with 20 points is not_enough with the best count", async () => {
    await seedRow("bb", {
      budgets: [
        { currency: "USD", unit: "hour", n: 19, p25: 1, median: 2, p75: 3 },
      ],
    });
    const { cookie } = await user();
    expect((await (await one(cookie, "bb")).json()).budgets).toEqual({
      status: "not_enough",
      have: 19,
      need: 20,
    });
  });

  it("budgets: up to 3 groups, largest first", async () => {
    const g = (currency: string, n: number) => ({
      currency,
      unit: "fixed",
      n,
      p25: 1,
      median: 2,
      p75: 3,
    });
    await seedRow("bb", {
      budgets: [g("EUR", 21), g("USD", 40), g("GBP", 30), g("INR", 25)],
    });
    const { cookie } = await user();
    const b = (await (await one(cookie, "bb")).json()).budgets;
    expect(b.groups.map((x: { currency: string }) => x.currency)).toEqual([
      "USD",
      "GBP",
      "INR",
    ]);
  });

  it("fit: counted since max(window start, onboarded_at), gated at 20 hiring posts", async () => {
    await seedRow("fit");
    const { cookie, userId } = await user();
    // Onboarded 3 days ago: only posts since then count; 19 hiring posts is under the gate.
    await getDb()
      .update(profiles)
      .set({ onboardedAt: new Date(Date.now() - 3 * DAY) })
      .where(eq(profiles.userId, userId));
    for (let i = 0; i < 19; i++)
      await seedPost({
        community: "fit",
        postedAt: new Date(Date.now() - 3600_000 * (i + 1)),
      });
    await seedPost({
      community: "fit",
      postedAt: new Date(Date.now() - 10 * DAY),
    });
    let body = await (await one(cookie, "fit")).json();
    expect(body.fit).toEqual({ status: "not_enough", have: 19, need: 20 });

    await seedPost({
      community: "fit",
      postedAt: new Date(Date.now() - 600_000),
    });
    const best = await seedPost({
      community: "fit",
      postedAt: new Date(Date.now() - 300_000),
    });
    await seedMatch(userId, best, { ruleScore: 90 });
    body = await (await one(cookie, "fit")).json();
    expect(body.fit).toEqual({
      status: "ok",
      best: 1,
      hiring: 21,
      text: "1 in 21 is a strong fit",
    });
    expect(body.latestMatches).toHaveLength(1);
    expect(Object.keys(body.latestMatches[0]).sort()).toEqual([
      "matchId",
      "postedAt",
      "score",
      "title",
    ]);
  });
});

describe("trend", () => {
  it("shown when both windows have 20+ and history covers 56 days", async () => {
    await seedRow("tt");
    const { cookie } = await user();
    expect(
      (await (await one(cookie, "tt")).json()).postsPerWeek.prevPerWeek,
    ).toBe(7);
  });

  it("no trend when the previous window has 19", async () => {
    await seedRow("tt", { hiringPostsPrev: 19 });
    const { cookie } = await user();
    const w = (await (await one(cookie, "tt")).json()).postsPerWeek;
    expect(w).toMatchObject({ status: "ok", prevPerWeek: null });
  });

  it("no trend when stored history is under 56 days", async () => {
    await seedRow("tt", { historyStart: new Date(Date.now() - 40 * DAY) });
    const { cookie } = await user();
    const w = (await (await one(cookie, "tt")).json()).postsPerWeek;
    expect(w).toMatchObject({ status: "ok", prevPerWeek: null });
  });
});

describe("paid and remote: unknowns", () => {
  it("counts commission-only apart from unknown pay, and reports unknown remote", async () => {
    await seedRow("pp", {
      payCounts: { paid: 24, commission_only: 2, unpaid: 6, unknown: 8 },
      remoteCounts: { remote: 24, onsite: 8, unknown: 8 },
    });
    const { cookie } = await user();
    const body = await (await one(cookie, "pp")).json();
    expect(body.paid).toEqual({
      status: "ok",
      paid: 60,
      revShare: 0,
      commission: 5,
      unpaid: 15,
      other: 20,
    });
    expect(body.remote).toEqual({ status: "ok", percent: 60, unknown: 20 });
  });
});

describe("posts a week: collection start", () => {
  it("is building under 7 days of collection", async () => {
    await seedRow("ww", { historyStart: new Date(Date.now() - 3 * DAY) });
    const { cookie } = await user();
    expect((await (await one(cookie, "ww")).json()).postsPerWeek).toEqual({
      status: "building",
      days: 3,
    });
  });

  it("divides by the weeks actually covered, not four", async () => {
    // 40 posts over 14 days = 2 weeks -> 20 a week
    await seedRow("ww", { historyStart: new Date(Date.now() - 14 * DAY) });
    const { cookie } = await user();
    expect((await (await one(cookie, "ww")).json()).postsPerWeek).toEqual({
      status: "ok",
      perWeek: 20,
      prevPerWeek: null,
    });
  });

  it("uses the full 28 days once collection is older", async () => {
    await seedRow("ww", { historyStart: new Date(Date.now() - 45 * DAY) });
    const { cookie } = await user();
    expect((await (await one(cookie, "ww")).json()).postsPerWeek).toMatchObject(
      { status: "ok", perWeek: 10, prevPerWeek: null },
    );
  });
});

describe("repeat clients: building history", () => {
  it("building until history reaches 28 days before the window", async () => {
    await seedRow("rr", { historyStart: new Date(Date.now() - 40 * DAY) });
    const { cookie } = await user();
    expect((await (await one(cookie, "rr")).json()).repeatClients).toEqual({
      status: "building",
      days: 40,
    });
  });

  it("no history date at all is building too", async () => {
    await seedRow("rr", { historyStart: null });
    const { cookie } = await user();
    expect((await (await one(cookie, "rr")).json()).repeatClients).toEqual({
      status: "building",
      days: 0,
    });
  });

  it("ok once history is 56 days old", async () => {
    await seedRow("rr", { historyStart: new Date(Date.now() - 57 * DAY) });
    const { cookie } = await user();
    expect((await (await one(cookie, "rr")).json()).repeatClients.status).toBe(
      "ok",
    );
  });

  it("history ok but under 20 known authors is not_enough", async () => {
    await seedRow("rr", { knownAuthorPosts: 12 });
    const { cookie } = await user();
    expect((await (await one(cookie, "rr")).json()).repeatClients).toEqual({
      status: "not_enough",
      have: 12,
      need: 20,
    });
  });
});

describe("hours in the profile time zone", () => {
  it("moves a Monday 18:00 UTC post to 23:00 in Asia/Kolkata", async () => {
    await seedRow("hh");
    const { cookie } = await user(); // seedDraftUser uses Asia/Kolkata
    const h = (await (await one(cookie, "hh")).json()).hours;
    expect(h.timeZone).toBe("Asia/Kolkata");
    expect(h.hours).toHaveLength(24);
    expect(h.hours[23]).toBe(40);
    expect(h.hours[18]).toBe(0);
    expect(h.busiestStartHour).toBe(20); // 20-23 holds the 40 (earliest tie)
  });

  it("uses UTC hours for a UTC profile", async () => {
    await seedRow("hh");
    const { cookie, userId } = await user();
    await getDb()
      .update(profiles)
      .set({ timeZone: "UTC" })
      .where(eq(profiles.userId, userId));
    const h = (await (await one(cookie, "hh")).json()).hours;
    expect(h.hours[18]).toBe(40);
  });
});

describe("GET /api/v1/insights", () => {
  it("yours: subreddits with a recent match, most matches first, with fit and matches", async () => {
    await seedRow("alpha");
    await seedRow("beta");
    await seedRow("gamma");
    await catalogue("alpha");
    await catalogue("beta");
    const { cookie, userId } = await user();
    await getDb()
      .update(profiles)
      .set({ onboardedAt: new Date(Date.now() - 5 * DAY) })
      .where(eq(profiles.userId, userId));
    await seedMatch(userId, await seedPost({ community: "alpha" }));
    await seedMatch(userId, await seedPost({ community: "beta" }));
    await seedMatch(userId, await seedPost({ community: "beta" }));
    const body = await (await list(cookie)).json();
    expect(body.tab).toBe("yours");
    expect(body.rows.map((r: { subreddit: string }) => r.subreddit)).toEqual([
      "beta",
      "alpha",
    ]);
    expect(body.rows[0]).toMatchObject({
      displayName: "BETA",
      matches: 2,
      perWeek: { status: "ok", perWeek: 10 },
      mainBudget: { status: "ok", group: { currency: "USD" } },
      redFlagPercent: { status: "ok", percent: 13 },
      fit: { status: "not_enough", have: 2, need: 20 },
    });
  });

  it("yours is empty with no matches", async () => {
    await seedRow("alpha");
    const { cookie } = await user();
    expect(await (await list(cookie)).json()).toEqual({
      tab: "yours",
      rows: [],
    });
  });

  it("all: active catalogue subreddits only, by hiring posts, no fit or matches", async () => {
    await seedRow("small", { hiringPosts: 21 });
    await seedRow("big", { hiringPosts: 90 });
    await seedRow("mid", { hiringPosts: 19 });
    await seedRow("dead", { hiringPosts: 500 });
    await seedRow("offlist", { hiringPosts: 600 });
    for (const n of ["small", "big", "mid"]) await catalogue(n);
    await catalogue("dead", "dead");
    const { cookie } = await user();
    const body = await (await list(cookie, "?tab=all")).json();
    expect(body.rows.map((r: { subreddit: string }) => r.subreddit)).toEqual([
      "big",
      "small",
      "mid",
    ]);
    expect(body.rows[0].fit).toBeNull();
    expect(body.rows[0]).not.toHaveProperty("matches");
    expect(body.rows[2].perWeek).toEqual({
      status: "not_enough",
      have: 19,
      need: 20,
    });
  });

  it("rejects an unknown tab", async () => {
    const { cookie } = await user();
    expect((await list(cookie, "?tab=x")).status).toBe(400);
  });
});

describe("no usernames", () => {
  it("responses carry no author data", async () => {
    await seedRow("alpha");
    await catalogue("alpha");
    const { cookie, userId } = await user();
    await seedMatch(userId, await seedPost({ community: "alpha" }));
    const texts = [
      await (await one(cookie, "alpha")).text(),
      await (await list(cookie)).text(),
      await (await list(cookie, "?tab=all")).text(),
    ];
    for (const t of texts) expect(t).not.toMatch(/author/i);
  });
});

describe("subredditSummary", () => {
  it("one line with posts a week and the main posted budget", async () => {
    await seedRow("forhire");
    expect(await subredditSummary("ForHire")).toBe(
      "~10 hiring posts a week · posted budgets USD/hour $15–35",
    );
  });

  it("only the parts past the threshold; null when none", async () => {
    await seedRow("aa", {
      hiringPosts: 19,
      budgets: [
        {
          currency: "EUR",
          unit: "fixed",
          n: 30,
          p25: 100,
          median: 150,
          p75: 300,
        },
      ],
    });
    expect(await subredditSummary("aa")).toBe(
      "posted budgets EUR fixed €100–300",
    );
    await seedRow("bb", { hiringPosts: 5, budgets: [] });
    expect(await subredditSummary("bb")).toBeNull();
    expect(await subredditSummary("missing")).toBeNull();
  });
});

describe("matchInsightLine", () => {
  it("the summary line while insights are allowed", async () => {
    await seedRow("forhire");
    const { userId } = await user();
    expect(await matchInsightLine(userId, "forhire")).toBe(
      "~10 hiring posts a week · posted budgets USD/hour $15–35",
    );
  });

  it("null after the trial ends, before onboarding, and without a row", async () => {
    await seedRow("forhire");
    const { userId } = await user({
      trialEndsAt: new Date(Date.now() - 1000),
    });
    expect(await matchInsightLine(userId, "forhire")).toBeNull();
    await cookieFor("new@example.com");
    expect(
      await matchInsightLine(await userIdOf("new@example.com"), "forhire"),
    ).toBeNull();
    const other = await user({}, "paid@example.com");
    expect(await matchInsightLine(other.userId, "missing")).toBeNull();
  });
});
