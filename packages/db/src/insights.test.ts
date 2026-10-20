import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import {
  insightRows,
  latestMatchesIn,
  refreshSubredditInsights,
  userFitCounts,
  userInsightSubreddits,
} from "./insights";
import { runMigrations } from "./migrate";
import {
  jobPostAnalyses,
  jobPosts,
  matches,
  profiles,
  subredditInsights,
  users,
} from "./schema";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 5 });

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(
    sql`truncate table match_events, matches, job_post_analyses, job_posts, subreddit_insights cascade`,
  );
};

beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

const DAY = 86_400_000;
const NOW = new Date("2026-10-21T12:00:00Z"); // a Wednesday
const W0 = new Date(NOW.getTime() - 28 * DAY);
const P0 = new Date(NOW.getTime() - 56 * DAY);
const ago = (days: number, extraMs = 0) =>
  new Date(NOW.getTime() - days * DAY + extraMs);

type PostOver = {
  community?: string;
  at?: Date;
  author?: string | null;
  preKind?: "hiring" | "for_hire" | "unknown";
  duplicateOf?: string;
  /** Pass null for a post that has no analysis row. */
  analysis?: null | {
    kind?: "hiring" | "for_hire" | "other";
    payType?: "paid" | "commission_only" | "revshare" | "unpaid" | "unknown";
    remote?: "remote" | "onsite" | "hybrid" | "unknown";
    skillIds?: string[];
    redFlags?: string[];
    min?: number | null;
    max?: number | null;
    currency?: string | null;
    unit?: "fixed" | "hour" | "day" | "week" | "month" | "per_item" | null;
  };
};

let seq = 0;
async function seedPost(over: PostOver = {}) {
  seq++;
  const community = over.community ?? "forhire";
  const [row] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_ins${seq}`,
      fetchedVia: "rss",
      community,
      url: `https://www.reddit.com/r/${community}/comments/ins${seq}/x/`,
      title: `[Hiring] Insight gig ${seq}`,
      body: "Need help.",
      author: over.author === undefined ? `author${seq}` : over.author,
      postedAt: over.at ?? ago(1),
      preKind: over.preKind ?? "hiring",
      analysisStatus: "done",
      duplicateOf: over.duplicateOf ?? null,
    })
    .returning({ id: jobPosts.id });
  const id = row!.id;
  // Analyses exist only for originals.
  if (over.analysis !== null && !over.duplicateOf) {
    const a = over.analysis ?? {};
    await db.insert(jobPostAnalyses).values({
      jobPostId: id,
      pipelineVersion: "post@1",
      kind: a.kind ?? "hiring",
      employmentType: "freelance",
      payType: a.payType ?? "paid",
      categories: ["development"],
      skillIds: a.skillIds ?? [],
      budgetMin: a.min === undefined ? null : a.min,
      budgetMax: a.max === undefined ? null : a.max,
      currency: a.currency === undefined ? null : a.currency,
      budgetUnit: a.unit === undefined ? null : a.unit,
      remote: a.remote ?? "remote",
      redFlags: a.redFlags ?? [],
      summary: "A gig",
      model: "test",
    });
  }
  return id;
}

const rowOf = async (sub: string) => {
  const [r] = await db
    .select()
    .from(subredditInsights)
    .where(eq(subredditInsights.subreddit, sub));
  return r;
};

describe("refreshSubredditInsights: counts and windows", () => {
  it("counts hiring posts in the window and the 28 days before, with exact edges", async () => {
    await seedPost({ at: W0 }); // first instant of this window
    await seedPost({ at: ago(1) });
    await seedPost({ at: new Date(W0.getTime() - 1) }); // last instant of the previous window
    await seedPost({ at: P0 }); // first instant of the previous window
    await seedPost({ at: new Date(P0.getTime() - 1) }); // too old: no row from it
    await seedPost({ at: NOW }); // not yet: the window is [w0, now)
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.hiringPosts).toBe(2);
    expect(r?.hiringPostsPrev).toBe(2);
    expect(r?.windowStart.toISOString()).toBe(W0.toISOString());
    expect(r?.computedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("counts a cross-post copy in its own subreddit with its original's analysis", async () => {
    const orig = await seedPost({
      community: "forhire",
      analysis: { skillIds: ["react"], payType: "revshare" },
    });
    await seedPost({ community: "slavelabour", duplicateOf: orig });
    await refreshSubredditInsights(db, NOW);
    const a = await rowOf("forhire");
    const b = await rowOf("slavelabour");
    expect(a?.hiringPosts).toBe(1);
    expect(b?.hiringPosts).toBe(1);
    expect(b?.payCounts).toEqual({ revshare: 1 });
    expect(b?.skillCounts).toEqual([{ skillId: "react", n: 1 }]);
  });

  it("counts for-hire posts via pre_kind when they were never analysed, and `other` nowhere", async () => {
    await seedPost({ preKind: "for_hire", analysis: null }); // skipped before analysis
    await seedPost({ preKind: "hiring", analysis: { kind: "for_hire" } });
    await seedPost({ preKind: "for_hire", analysis: { kind: "other" } }); // analysis wins
    await seedPost({ preKind: "hiring", analysis: { kind: "other" } });
    await seedPost({ preKind: "hiring", analysis: null }); // not analysed yet: not hiring
    await seedPost({ analysis: { kind: "hiring" } });
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.forHirePosts).toBe(2);
    expect(r?.hiringPosts).toBe(1);
  });

  it("tallies pay types, remote, red flags and skills over hiring posts only", async () => {
    await seedPost({
      analysis: {
        payType: "paid",
        remote: "remote",
        skillIds: ["react", "node"],
        redFlags: ["vague_pay", "asks_for_free_work"],
      },
    });
    await seedPost({
      analysis: {
        payType: "unpaid",
        remote: "onsite",
        skillIds: ["react", "react"],
        redFlags: ["vague_pay"],
      },
    });
    await seedPost({
      analysis: { kind: "for_hire", skillIds: ["python"], redFlags: ["x"] },
    });
    await seedPost({ at: ago(40), analysis: { skillIds: ["python"] } }); // previous window
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.payCounts).toEqual({ paid: 1, unpaid: 1 });
    expect(r?.remoteCounts).toEqual({ remote: 1, onsite: 1 });
    expect(r?.redFlagPosts).toBe(2);
    expect(r?.redFlagCounts).toEqual({
      vague_pay: 2,
      asks_for_free_work: 1,
    });
    expect(r?.skillCounts).toEqual([
      { skillId: "react", n: 2 }, // a repeated id in one post counts once per post
      { skillId: "node", n: 1 },
    ]);
  });

  it("keeps the top 20 skills", async () => {
    const skillIds = Array.from(
      { length: 25 },
      (_, i) => `s${String(i).padStart(2, "0")}`,
    );
    await seedPost({ analysis: { skillIds } });
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.skillCounts).toHaveLength(20);
    expect(r?.skillCounts[0]).toEqual({ skillId: "s00", n: 1 });
  });
});

describe("refreshSubredditInsights: budgets", () => {
  const b = (
    min: number | null,
    max: number | null,
    currency: string | null = "USD",
    unit: "fixed" | "hour" | null = "hour",
  ) => seedPost({ analysis: { min, max, currency, unit } });

  it("uses the midpoint, or the one value given, and ignores zero", async () => {
    await b(10, 30); // 20
    await b(40, null); // 40
    await b(null, 60); // 60
    await b(0, 50); // 50: zero is no value
    await b(0, 0); // nothing
    await b(null, null); // nothing
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.budgetStated).toBe(4);
    expect(r?.budgets).toEqual([
      { currency: "USD", unit: "hour", n: 4, p25: 35, median: 45, p75: 52.5 },
    ]);
  });

  it("computes percentiles on a known set", async () => {
    for (const v of [10, 20, 30, 40, 50]) await b(v, v);
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.budgets).toEqual([
      { currency: "USD", unit: "hour", n: 5, p25: 20, median: 30, p75: 40 },
    ]);
  });

  it("groups by currency and unit without converting, biggest group first", async () => {
    await b(10, 10, "USD", "hour");
    await b(500, 500, "USD", "fixed");
    await b(600, 600, "USD", "fixed");
    await b(20, 20, "GBP", "hour");
    await b(5, 5, null, "hour"); // no currency: cannot be grouped
    await b(5, 5, "USD", null); // no unit: cannot be grouped
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.budgets.map((g) => [g.currency, g.unit, g.n])).toEqual([
      ["USD", "fixed", 2],
      ["GBP", "hour", 1],
      ["USD", "hour", 1],
    ]);
    // Posts with a budget but no group still count as "budget stated".
    expect(r?.budgetStated).toBe(6);
  });

  it("only uses the current window and hiring posts", async () => {
    await seedPost({
      at: ago(40),
      analysis: { min: 99, max: 99, currency: "USD", unit: "hour" },
    });
    await seedPost({
      analysis: {
        kind: "for_hire",
        min: 99,
        max: 99,
        currency: "USD",
        unit: "hour",
      },
    });
    await refreshSubredditInsights(db, NOW);
    expect((await rowOf("forhire"))?.budgets).toEqual([]);
  });
});

describe("refreshSubredditInsights: hour slots", () => {
  it("puts Monday 00:10 UTC in slot 0 and Sunday 23:50 in slot 335", async () => {
    // 2026-10-19 is a Monday, 2026-10-18 a Sunday.
    await seedPost({ at: new Date("2026-10-19T00:10:00Z") });
    await seedPost({ at: new Date("2026-10-18T23:50:00Z") });
    await seedPost({ at: new Date("2026-10-19T00:29:59Z") }); // still slot 0
    await seedPost({ at: new Date("2026-10-19T00:30:00Z") }); // slot 1
    await seedPost({ at: ago(2) });
    await refreshSubredditInsights(db, NOW);
    const s = (await rowOf("forhire"))!.hourSlots;
    expect(s).toHaveLength(336);
    expect(s[0]).toBe(2);
    expect(s[1]).toBe(1);
    expect(s[335]).toBe(1);
    // ago(2) = Monday 2026-10-19 12:00 UTC = slot 24
    expect(s[24]).toBe(1);
    expect(s.reduce((a, c) => a + c, 0)).toBe(5);
  });

  it("counts only hiring posts of the window", async () => {
    await seedPost({ at: ago(40) });
    await seedPost({ analysis: { kind: "for_hire" } });
    await refreshSubredditInsights(db, NOW);
    expect((await rowOf("forhire"))!.hourSlots.every((n) => n === 0)).toBe(
      true,
    );
  });
});

describe("refreshSubredditInsights: repeat clients", () => {
  it("counts an author with an earlier hiring post in any subreddit within 180 days", async () => {
    await seedPost({ community: "hireawriter", author: "alice", at: ago(100) });
    await seedPost({ community: "forhire", author: "alice", at: ago(2) }); // repeat
    await seedPost({ community: "forhire", author: "bob", at: ago(2) }); // new
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.knownAuthorPosts).toBe(2);
    expect(r?.repeatAuthorPosts).toBe(1);
  });

  it("counts a same-day second post, but not the earlier one of the pair", async () => {
    await seedPost({ author: "carol", at: ago(3, -3_600_000) });
    await seedPost({ author: "carol", at: ago(3) });
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.knownAuthorPosts).toBe(2);
    expect(r?.repeatAuthorPosts).toBe(1);
  });

  it("ignores history older than 180 days and non-hiring history", async () => {
    await seedPost({ author: "dave", at: ago(200), community: "hireawriter" });
    await seedPost({
      author: "erin",
      at: ago(100),
      community: "hireawriter",
      analysis: { kind: "for_hire" },
    });
    await seedPost({ author: "dave", at: ago(2) });
    await seedPost({ author: "erin", at: ago(2) });
    await refreshSubredditInsights(db, NOW);
    expect((await rowOf("forhire"))?.repeatAuthorPosts).toBe(0);
  });

  it("does not count the author's own cross-post of the same gig", async () => {
    const orig = await seedPost({
      community: "hireawriter",
      author: "fay",
      at: ago(2, -60_000),
    });
    await seedPost({
      community: "forhire",
      author: "fay",
      at: ago(2),
      duplicateOf: orig,
    });
    await refreshSubredditInsights(db, NOW);
    expect((await rowOf("forhire"))?.repeatAuthorPosts).toBe(0);
    expect((await rowOf("forhire"))?.knownAuthorPosts).toBe(1);
  });

  it("leaves out null and [deleted] authors", async () => {
    await seedPost({ author: null });
    await seedPost({ author: "[deleted]" });
    await seedPost({ author: "[deleted]", at: ago(3) });
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.hiringPosts).toBe(3);
    expect(r?.knownAuthorPosts).toBe(0);
    expect(r?.repeatAuthorPosts).toBe(0);
  });

  it("records the oldest stored post as history_start", async () => {
    await seedPost({ at: ago(300), community: "other_sub" });
    await seedPost({ at: ago(2) });
    await refreshSubredditInsights(db, NOW);
    expect((await rowOf("forhire"))?.historyStart?.toISOString()).toBe(
      ago(300).toISOString(),
    );
  });
});

describe("refreshSubredditInsights: rows", () => {
  it("is idempotent", async () => {
    await seedPost({
      analysis: {
        min: 10,
        max: 20,
        currency: "USD",
        unit: "hour",
        skillIds: ["react"],
      },
    });
    await seedPost({ community: "hireawriter", author: "x", at: ago(90) });
    await seedPost({ community: "hireawriter", author: "x", at: ago(5) });
    const first = await refreshSubredditInsights(db, NOW);
    const rows1 = await insightRows(db);
    const second = await refreshSubredditInsights(db, NOW);
    const rows2 = await insightRows(db);
    expect(second).toEqual(first);
    expect(rows2).toEqual(rows1);
    expect(rows1.map((r) => r.subreddit)).toEqual(["forhire", "hireawriter"]);
  });

  it("deletes rows for subreddits with no post in 56 days and keeps the others", async () => {
    await seedPost({ community: "gone", at: ago(10) });
    await refreshSubredditInsights(db, NOW);
    await seedPost({ community: "kept", at: ago(5) });
    // 50 days later "gone"'s post is 60 days old, "kept"'s 55.
    const res = await refreshSubredditInsights(
      db,
      new Date(NOW.getTime() + 50 * DAY),
    );
    expect(res).toEqual({ upserted: 1, deleted: 1 });
    const rows = await insightRows(db);
    expect(rows.map((r) => r.subreddit)).toEqual(["kept"]);
    expect(rows[0]?.hiringPosts).toBe(0);
    expect(rows[0]?.hiringPostsPrev).toBe(1);
  });

  it("keeps a row for a subreddit that only has for-hire posts", async () => {
    await seedPost({ analysis: { kind: "for_hire" } });
    await refreshSubredditInsights(db, NOW);
    const r = await rowOf("forhire");
    expect(r?.hiringPosts).toBe(0);
    expect(r?.forHirePosts).toBe(1);
  });

  it("skips communities that are not valid subreddit names", async () => {
    await seedPost({ community: "" });
    await seedPost({ community: "x" });
    await refreshSubredditInsights(db, NOW);
    expect(await insightRows(db)).toEqual([]);
  });

  it("insightRows filters by name", async () => {
    await seedPost({ community: "a1" });
    await seedPost({ community: "b2" });
    await refreshSubredditInsights(db, NOW);
    expect((await insightRows(db, ["b2"])).map((r) => r.subreddit)).toEqual([
      "b2",
    ]);
    expect(await insightRows(db, [])).toEqual([]);
  });
});

// ---- Readers that need a user ----

let useq = 0;
async function seedUser() {
  useq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|i${useq}`,
      email: `i${useq}@example.com`,
      emailNormalized: `i${useq}@example.com`,
    })
    .returning({ id: users.id });
  await db.insert(profiles).values({
    userId: u!.id,
    displayName: `Insights ${useq}`,
    categories: ["development"],
    experienceLevel: "experienced",
    country: "GB",
    timeZone: "Europe/London",
    minRateMinor: 3000,
    currency: "USD",
    rateType: "either",
    remoteOnly: false,
    onboardedAt: ago(60),
    trialEndsAt: new Date(NOW.getTime() + 5 * DAY),
  });
  return u!.id;
}

async function seedMatch(
  userId: string,
  postId: string,
  over: {
    score?: number;
    at?: Date;
    withdrawn?: boolean;
    status?: "new" | "dismissed";
  } = {},
) {
  await db.insert(matches).values({
    userId,
    jobPostId: postId,
    postedAt: over.at ?? ago(1),
    ruleScore: over.score ?? 70,
    broad: false,
    features: [],
    ruleReason: "2 of your core skills",
    aiStatus: "not_needed",
    score: over.score ?? 70,
    status: over.status ?? "new",
    profileVersion: 1,
    analysedAt: ago(1),
    withdrawnAt: over.withdrawn ? ago(0.5) : null,
  });
}

describe("userInsightSubreddits", () => {
  it("lists subreddits with a match in the last 30 days, most first, counting copies", async () => {
    const u = await seedUser();
    const other = await seedUser();
    const p1 = await seedPost({ community: "forhire", at: ago(1) });
    const p2 = await seedPost({ community: "forhire", at: ago(2) });
    const p3 = await seedPost({ community: "hireawriter", at: ago(3) });
    await seedPost({ community: "hireawriter", duplicateOf: p1, at: ago(1) }); // copy of p1
    await seedPost({ community: "forhire", duplicateOf: p1, at: ago(1) }); // same community again
    await seedMatch(u, p1, { score: 80, at: ago(1) });
    await seedMatch(u, p2, { score: 40, at: ago(2) });
    await seedMatch(u, p3, { score: 60, at: ago(3) });
    await seedMatch(other, p2); // someone else's
    expect(await userInsightSubreddits(db, u, NOW)).toEqual([
      { subreddit: "forhire", matches: 2, bestMatches: 1 },
      { subreddit: "hireawriter", matches: 2, bestMatches: 2 },
    ]);
  });

  it("leaves out withdrawn matches and ones older than 30 days, keeps dismissed", async () => {
    const u = await seedUser();
    await seedMatch(u, await seedPost({ community: "a1" }), {
      withdrawn: true,
    });
    await seedMatch(u, await seedPost({ community: "b2", at: ago(31) }), {
      at: ago(31),
    });
    await seedMatch(u, await seedPost({ community: "c3", at: ago(29) }), {
      at: ago(29),
    });
    await seedMatch(u, await seedPost({ community: "d4" }), {
      status: "dismissed",
    });
    expect(
      (await userInsightSubreddits(db, u, NOW)).map((r) => r.subreddit),
    ).toEqual(["c3", "d4"]);
  });
});

describe("userFitCounts", () => {
  it("counts Best matches and hiring posts in a subreddit since a date", async () => {
    const u = await seedUser();
    const p1 = await seedPost({ at: ago(2) });
    const p2 = await seedPost({ at: ago(3) });
    await seedPost({ at: ago(4) }); // hiring, no match
    await seedPost({ at: ago(5), analysis: { kind: "for_hire" } }); // not hiring
    await seedPost({ at: ago(60) }); // before `since`
    await seedPost({ community: "elsewhere", at: ago(2) });
    await seedMatch(u, p1, { score: 60 }); // exactly the Best threshold
    await seedMatch(u, p2, { score: 59 });
    expect(await userFitCounts(db, u, "forhire", ago(28))).toEqual({
      bestMatches: 1,
      hiringPosts: 3,
    });
    expect(await userFitCounts(db, u, "forhire", ago(2, -1))).toEqual({
      bestMatches: 1,
      hiringPosts: 1,
    });
  });

  it("counts a copy in its own subreddit through its original's match, never above the posts", async () => {
    const u = await seedUser();
    const orig = await seedPost({ community: "hireawriter", at: ago(2) });
    await seedPost({ community: "forhire", duplicateOf: orig, at: ago(2) });
    await seedMatch(u, orig, { score: 90 });
    expect(await userFitCounts(db, u, "forhire", ago(28))).toEqual({
      bestMatches: 1,
      hiringPosts: 1,
    });
    expect(await userFitCounts(db, u, "hireawriter", ago(28))).toEqual({
      bestMatches: 1,
      hiringPosts: 1,
    });
  });

  it("ignores withdrawn matches and other users' matches", async () => {
    const u = await seedUser();
    const other = await seedUser();
    const p = await seedPost();
    await seedMatch(u, p, { withdrawn: true });
    await seedMatch(other, p);
    expect(await userFitCounts(db, u, "forhire", ago(28))).toEqual({
      bestMatches: 0,
      hiringPosts: 1,
    });
  });
});

describe("latestMatchesIn", () => {
  it("returns the newest matches from a subreddit, including gigs cross-posted into it", async () => {
    const u = await seedUser();
    const a = await seedPost({ community: "forhire", at: ago(3) });
    const b = await seedPost({ community: "forhire", at: ago(2) });
    const c = await seedPost({ community: "hireawriter", at: ago(1) });
    await seedPost({ community: "forhire", duplicateOf: c, at: ago(1) });
    const d = await seedPost({ community: "hireawriter", at: ago(1, -1000) });
    for (const p of [a, b, c, d]) await seedMatch(u, p, { at: undefined });
    await db.execute(
      sql`update matches set posted_at = p.posted_at from job_posts p where p.id = matches.job_post_id`,
    );
    const items = await latestMatchesIn(db, u, "forhire", 2);
    expect(items.map((i) => i.post.id)).toEqual([c, b]);
    expect(
      (await latestMatchesIn(db, u, "forhire", 10)).map((i) => i.post.id),
    ).toEqual([c, b, a]);
    expect(await latestMatchesIn(db, u, "nowhere", 5)).toEqual([]);
  });
});
