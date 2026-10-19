import * as core from "@redlance/core";
import { eq, inArray, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ANALYSIS_STATUSES,
  BUDGET_UNITS,
  EMPLOYMENT_TYPES,
  FETCHED_VIA,
  JOB_POSTS_CHANNEL,
  MAX_ANALYSIS_ATTEMPTS,
  PAY_TYPES,
  POST_KINDS,
  POST_SOURCES,
  PRE_KINDS,
  REMOTE_TYPES,
  SUBREDDIT_STATUSES,
  SUBREDDIT_TIERS,
  activeFeeds,
  applyFeedPlan,
  markSubredditUnreachable,
  recentFeedPolls,
  requeueOutdatedAnalyses,
  requeueRetryableFailures,
  splitFeed,
  subredditsLastPolledAt,
  claimPostsForAnalysis,
  completePostAnalysis,
  createDb,
  failPostAnalysis,
  feedPolls,
  feeds,
  jobPostAnalyses,
  jobPosts,
  llmCostSince,
  nextFeed,
  pruneFeedPolls,
  recordFeedPoll,
  recordLlmUsage,
  refreshSubredditStats,
  requeuePostsForAnalysis,
  requeueStalePostAnalyses,
  saveJobPosts,
  duplicateCommunities,
  markDuplicates,
  subreddits,
  syncReferenceData,
  uncataloguedCommunities,
  type NewJobPost,
  type NewPostAnalysis,
} from "./index";
import { runMigrations } from "./migrate";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 5 });

const reset = () =>
  db.execute(
    sql`truncate table job_post_analyses, job_posts, feed_polls, feeds, llm_usage`,
  );

beforeAll(async () => {
  await runMigrations(url);
  await syncReferenceData(db);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await syncReferenceData(db);
  await pool.end();
});

let seq = 0;
function post(over: Partial<NewJobPost> = {}): NewJobPost {
  seq++;
  return {
    source: "reddit",
    externalId: `t3_test${seq}`,
    fetchedVia: "rss",
    community: "forhire",
    url: `https://www.reddit.com/r/forhire/comments/test${seq}/x/`,
    title: `[Hiring] Job ${seq}`,
    body: "Need a React developer, $500 budget.",
    author: "someone",
    postedAt: new Date(Date.now() - seq * 1000),
    sourceUpdatedAt: null,
    preKind: "hiring",
    analyse: true,
    ...over,
  };
}

const analysis: NewPostAnalysis = {
  pipelineVersion: "post@1",
  kind: "hiring",
  employmentType: "freelance",
  payType: "paid",
  categories: ["development"],
  skillIds: ["react"],
  budgetMin: 500,
  budgetMax: 500,
  currency: "USD",
  budgetUnit: "fixed",
  remote: "remote",
  location: null,
  deadline: null,
  redFlags: [],
  summary: "React developer for a small project",
  model: "gemini-3.5-flash-lite",
};

describe("literal lists", () => {
  it("mirror @redlance/core", () => {
    expect(POST_SOURCES).toEqual(core.POST_SOURCES);
    expect(FETCHED_VIA).toEqual(core.FETCHED_VIA);
    expect(PRE_KINDS).toEqual(core.PRE_KINDS);
    expect(POST_KINDS).toEqual(core.POST_KINDS);
    expect(EMPLOYMENT_TYPES).toEqual(core.EMPLOYMENT_TYPES);
    expect(PAY_TYPES).toEqual(core.PAY_TYPES);
    expect(REMOTE_TYPES).toEqual(core.REMOTE_TYPES);
    expect(BUDGET_UNITS).toEqual(core.BUDGET_UNITS);
    expect(SUBREDDIT_TIERS).toEqual(core.SUBREDDIT_TIERS);
    expect(SUBREDDIT_STATUSES).toEqual(core.SUBREDDIT_STATUSES);
    expect(ANALYSIS_STATUSES).toContain("pending");
  });
});

describe("saveJobPosts", () => {
  it("dedupes on source + external id and returns only new ids", async () => {
    const a = post();
    const b = post();
    const first = await saveJobPosts(db, [a, b], null);
    expect(first.newIds).toEqual(
      expect.arrayContaining([a.externalId, b.externalId]),
    );
    expect(first.duplicateIds).toEqual([]);
    expect(
      (await saveJobPosts(db, [a, post({ externalId: b.externalId })], null))
        .newIds,
    ).toEqual([]);
    expect(await db.$count(jobPosts)).toBe(2);
  });

  it("stores posts it won't analyse as skipped", async () => {
    const p = post({ preKind: "for_hire", analyse: false });
    await saveJobPosts(db, [p], null);
    const [row] = await db
      .select()
      .from(jobPosts)
      .where(eq(jobPosts.externalId, p.externalId));
    expect(row!.analysisStatus).toBe("skipped");
    expect(row!.preKind).toBe("for_hire");
  });

  it("wakes the analyser only when something needs analysis", async () => {
    const listener = new pg.Client({ connectionString: url });
    await listener.connect();
    const got: string[] = [];
    listener.on("notification", (n) => got.push(n.channel));
    await listener.query(`LISTEN ${JOB_POSTS_CHANNEL}`);
    await saveJobPosts(db, [post({ analyse: false })], null);
    await saveJobPosts(db, [post()], null);
    await new Promise((r) => setTimeout(r, 200));
    await listener.end();
    expect(got).toEqual([JOB_POSTS_CHANNEL]);
  });
});

const DEDUPE = { windowHours: 72, similarity: 0.8 };
const HOUR = 3_600_000;
const T0 = Date.now() - 200 * HOUR;
const GIG = "Need a Next.js dev for my bakery site, $400";
const GIG_BODY =
  "I run a small bakery in Leeds and need a simple website with an online ordering page built in Next.js. Budget is $400, deadline in three weeks.";

function gig(over: Partial<NewJobPost> = {}): NewJobPost {
  return post({
    author: "u1",
    title: GIG,
    body: GIG_BODY,
    postedAt: new Date(T0),
    ...over,
  });
}
const rowOf = async (p: NewJobPost) =>
  (
    await db
      .select()
      .from(jobPosts)
      .where(eq(jobPosts.externalId, p.externalId))
  )[0]!;

async function notifications(run: () => Promise<unknown>): Promise<number> {
  const listener = new pg.Client({ connectionString: url });
  await listener.connect();
  let n = 0;
  listener.on("notification", () => n++);
  await listener.query(`LISTEN ${JOB_POSTS_CHANNEL}`);
  await run();
  await new Promise((r) => setTimeout(r, 200));
  await listener.end();
  return n;
}

describe("dedupe", () => {
  const save = (posts: NewJobPost[]) =>
    saveJobPosts(db, posts, null, { dedupe: DEDUPE });

  it("marks a same-author cross-post as a duplicate of the first", async () => {
    const a = gig({ community: "forhire" });
    const b = gig({ community: "hiring", postedAt: new Date(T0 + 2 * HOUR) });
    await save([a]);
    const res = await save([b]);
    expect(res.duplicateIds).toEqual([b.externalId]);
    const [ra, rb] = [await rowOf(a), await rowOf(b)];
    expect(rb.duplicateOf).toBe(ra.id);
    expect(rb.analysisStatus).toBe("skipped");
    expect(rb.analysisError).toBe("DUPLICATE");
    expect(ra.duplicateOf).toBeNull();
    expect(ra.analysisStatus).toBe("pending");
  });

  it("still matches when the body is lightly edited", async () => {
    const a = gig();
    const b = gig({
      body: GIG_BODY + " Happy to chat, thanks! 🙏",
      postedAt: new Date(T0 + HOUR),
    });
    await save([a, b]);
    expect((await rowOf(b)).duplicateOf).toBe((await rowOf(a)).id);
  });

  it("keeps different gigs by one author apart", async () => {
    const a = gig({
      title: "React dev needed",
      body: "Dashboard for a logistics company, charts and a login, two months, $3000.",
    });
    const b = gig({
      title: "React Native dev needed",
      body: "Mobile app for a gym with class booking and push notifications. Equity possible.",
      postedAt: new Date(T0 + HOUR),
    });
    await save([a, b]);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("needs the same author", async () => {
    const a = gig({ author: "u1" });
    const b = gig({ author: "u2", postedAt: new Date(T0 + HOUR) });
    await save([a, b]);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("ignores copies outside the window", async () => {
    const a = gig();
    const b = gig({ postedAt: new Date(T0 + 80 * HOUR) });
    await save([a]);
    await save([b]);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("never dedupes posts without an author", async () => {
    const a = gig({ author: null });
    const b = gig({ author: null, postedAt: new Date(T0 + HOUR) });
    await save([a]);
    await save([b]);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("points every copy at the original, not at another copy", async () => {
    const a = gig();
    const b = gig({ postedAt: new Date(T0 + HOUR) });
    const c = gig({ postedAt: new Date(T0 + 2 * HOUR) });
    await save([a]);
    await save([b]);
    await save([c]);
    const id = (await rowOf(a)).id;
    expect((await rowOf(b)).duplicateOf).toBe(id);
    expect((await rowOf(c)).duplicateOf).toBe(id);
  });

  it("handles an original and its copy in the same batch", async () => {
    const a = gig();
    const b = gig({ postedAt: new Date(T0 + HOUR) });
    // Listed copy-first: the one stored first is the original, whatever posted_at says.
    await save([b, a]);
    expect((await rowOf(a)).duplicateOf).toBe((await rowOf(b)).id);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("never chains duplicates inside one batch", async () => {
    // Each row is similar only to its neighbour (titles differ by one number-free word).
    const base = "Need a video editor for YouTube channel";
    const body = (extra: string) =>
      `I run a travel channel and need long videos cut with captions and music. ${extra}`;
    const rows = [
      gig({ title: base + " alpha", body: body("Deliver within one week.") }),
      gig({
        title: base + " alpha",
        body: body("Deliver within one week, paid per video."),
        postedAt: new Date(T0 + HOUR),
      }),
      gig({
        title: base + " alpha",
        body: body(
          "Paid per video, long term work with a retainer afterwards.",
        ),
        postedAt: new Date(T0 + 2 * HOUR),
      }),
      gig({
        title: base + " alpha",
        body: body(
          "Long term retainer, bonus for fast turnaround and quality.",
        ),
        postedAt: new Date(T0 + 3 * HOUR),
      }),
    ];
    await save(rows);
    const stored = await Promise.all(rows.map(rowOf));
    const dupIds = new Set(
      stored.filter((r) => r.duplicateOf).map((r) => r.id),
    );
    for (const r of stored)
      if (r.duplicateOf) expect(dupIds.has(r.duplicateOf)).toBe(false);
    // The first row is always an original; its neighbours are the only ones it can absorb.
    expect(stored[0]!.duplicateOf).toBeNull();
  });

  it("does not merge A and C through B when only neighbours are similar", async () => {
    const sims = async (a: string, b: string) =>
      (
        await db.execute<{ s: number }>(
          sql`select similarity(${a}::text, ${b}::text) as s`,
        )
      ).rows[0]!.s;
    // Build bodies where A~B and B~C pass 0.8 but A~C does not.
    const w = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `word${String.fromCharCode(97 + (i % 26))}${i}`,
      );
    const A = w(40).join(" ");
    const B = [...w(40).slice(0, 36), "q1x", "q2x", "q3x", "q4x"].join(" ");
    const C = [
      ...w(40).slice(0, 32),
      "q1x",
      "q2x",
      "q3x",
      "q4x",
      "r1x",
      "r2x",
      "r3x",
      "r4x",
    ].join(" ");
    const [ab, bc, ac] = [await sims(A, B), await sims(B, C), await sims(A, C)];
    // Only meaningful if the fixture really has the shape; assert it so it cannot rot.
    expect(ab).toBeGreaterThanOrEqual(0.8);
    expect(bc).toBeGreaterThanOrEqual(0.8);
    expect(ac).toBeLessThan(0.8);
    const rows = [A, B, C].map((b, i) =>
      gig({ title: "Same title", body: b, postedAt: new Date(T0 + i * HOUR) }),
    );
    await save(rows);
    const [ra, rb, rc] = await Promise.all(rows.map(rowOf));
    expect(ra!.duplicateOf).toBeNull();
    expect(rb!.duplicateOf).toBe(ra!.id);
    // C is similar only to B, which is a copy: it must not point at B, nor merge with A.
    expect(rc!.duplicateOf).toBeNull();
  });

  it("keeps an agency template with different roles apart", async () => {
    const blurb =
      "We are Northwind Studio, a remote-first agency of 40 people helping startups ship products fast. Apply with your portfolio and rates.";
    const a = gig({ title: "Shopify developer wanted", body: blurb });
    const b = gig({
      title: "Video editor wanted",
      body: blurb,
      postedAt: new Date(T0 + HOUR),
    });
    await save([a, b]);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("does not merge titles whose numbers differ", async () => {
    const a = gig({ title: "[Task] Transcribe 10 min audio - $10", body: "" });
    const b = gig({
      title: "[Task] Transcribe 20 min audio - $20",
      body: "",
      postedAt: new Date(T0 + HOUR),
    });
    await save([a, b]);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("does not merge near-identical titles with empty bodies", async () => {
    const a = gig({ title: "React developer needed - $500", body: "" });
    const b = gig({
      title: "React Native developer needed - $500",
      body: "",
      postedAt: new Date(T0 + HOUR),
    });
    await save([a, b]);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("merges identical titles with empty bodies, but not when only one body is empty", async () => {
    const a = gig({ title: "Logo for my bakery $50", body: "" });
    const b = gig({
      title: "Logo for my bakery $50",
      body: "",
      postedAt: new Date(T0 + HOUR),
    });
    const c = gig({
      title: "Logo for my bakery $50",
      body: "Warm colours please, send examples.",
      postedAt: new Date(T0 + 2 * HOUR),
    });
    await save([a, b, c]);
    expect((await rowOf(b)).duplicateOf).toBe((await rowOf(a)).id);
    expect((await rowOf(c)).duplicateOf).toBeNull();
  });

  it("does not merge near-identical titles that differ by a key word", async () => {
    const body = "Simple flat logo, two colours, vector files, by Friday.";
    const a = gig({ title: "Logo for my bakery", body });
    const b = gig({
      title: "Logo for my cafe",
      body,
      postedAt: new Date(T0 + HOUR),
    });
    await save([a, b]);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("normalises case, emoji and spacing in titles", async () => {
    const a = gig({ title: "NEED a Next.js dev for my bakery site, $400" });
    const b = gig({
      title: "Need a  Next.js dev for my bakery site, $400 \u{1F680}",
      postedAt: new Date(T0 + HOUR),
    });
    await save([a, b]);
    expect((await rowOf(b)).duplicateOf).toBe((await rowOf(a)).id);
  });

  it("catches an out-of-order cross-post: the copy stored second is the duplicate", async () => {
    const earlier = gig({ community: "forhire", postedAt: new Date(T0) });
    const later = gig({
      community: "hiring",
      postedAt: new Date(T0 + 30_000),
    });
    await save([later]);
    await save([earlier]);
    const [rl, re] = [await rowOf(later), await rowOf(earlier)];
    expect(rl.duplicateOf).toBeNull();
    expect(re.duplicateOf).toBe(rl.id);
  });

  it("never uses a never-analysed row as the original", async () => {
    const skipped = gig({ community: "unknownsub", analyse: false });
    const real = gig({ community: "forhire", postedAt: new Date(T0 + HOUR) });
    await save([skipped]);
    await save([real]);
    const r = await rowOf(real);
    expect(r.duplicateOf).toBeNull();
    expect(r.analysisStatus).toBe("pending");
    expect((await rowOf(skipped)).duplicateOf).toBeNull();
  });

  it("sends no wake-up when every new row is a duplicate", async () => {
    await save([gig()]);
    const n = await notifications(() =>
      save([gig({ postedAt: new Date(T0 + HOUR) })]),
    );
    expect(n).toBe(0);
  });

  it("sends one wake-up for a batch with an original and a duplicate", async () => {
    await save([gig()]);
    const n = await notifications(() =>
      save([
        gig({ postedAt: new Date(T0 + HOUR) }),
        post({ author: "other", postedAt: new Date(T0 + HOUR) }),
      ]),
    );
    expect(n).toBe(1);
  });

  it("lists the communities of an original's copies, sorted", async () => {
    const a = gig({ community: "forhire" });
    const b = gig({ community: "jobbit", postedAt: new Date(T0 + HOUR) });
    const c = gig({ community: "hiring", postedAt: new Date(T0 + 2 * HOUR) });
    const d = gig({ community: "hiring", postedAt: new Date(T0 + 3 * HOUR) });
    await save([a]);
    await save([b]);
    await save([c]);
    await save([d]);
    const id = (await rowOf(a)).id;
    const map = await duplicateCommunities(db, [id, (await rowOf(b)).id]);
    expect(map.get(id)).toEqual(["hiring", "jobbit"]);
    expect(map.size).toBe(1);
  });

  it("does nothing without dedupe options", async () => {
    const a = gig();
    const b = gig({ postedAt: new Date(T0 + HOUR) });
    const res = await saveJobPosts(db, [a, b], null);
    expect(res.duplicateIds).toEqual([]);
    expect((await rowOf(b)).duplicateOf).toBeNull();
  });

  it("uses the similarity threshold it is given", async () => {
    const a = gig();
    const b = gig({
      body:
        GIG_BODY + " Please send your rates and a few examples of past work.",
      postedAt: new Date(T0 + HOUR),
    });
    const ids = (await saveJobPosts(db, [a, b], null)).newIds;
    expect(ids).toHaveLength(2);
    const bId = (await rowOf(b)).id;
    await db.transaction(async (tx) => {
      expect(
        await markDuplicates(tx, [bId], { windowHours: 72, similarity: 0.95 }),
      ).toEqual([]);
    });
    expect((await rowOf(b)).duplicateOf).toBeNull();
    expect(
      await markDuplicates(db, [bId], { windowHours: 72, similarity: 0.6 }),
    ).toEqual([bId]);
  });

  it("never hands a duplicate to the analyser", async () => {
    await save([gig()]);
    await save([gig({ postedAt: new Date(T0 + HOUR) })]);
    const claimed = await claimPostsForAnalysis(db, 10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.duplicateOf).toBeNull();
  });
});

describe("feeds", () => {
  it("keeps unchanged feeds, adds new ones and retires the rest", async () => {
    await applyFeedPlan(db, [
      {
        kind: "subreddits",
        subreddits: ["hiring", "forhire"],
        intervalSeconds: 480,
      },
      { kind: "search", query: "title:hiring", intervalSeconds: 1200 },
    ]);
    const [first] = await db
      .select()
      .from(feeds)
      .where(eq(feeds.kind, "subreddits"));
    await db
      .update(feeds)
      .set({ catchUpAfter: "t3_abc", catchUpPagesLeft: 2 })
      .where(eq(feeds.id, first!.id));

    const res = await applyFeedPlan(db, [
      {
        kind: "subreddits",
        subreddits: ["forhire", "hiring"],
        intervalSeconds: 300,
      },
      { kind: "subreddits", subreddits: ["designjobs"], intervalSeconds: 480 },
    ]);
    expect(res).toEqual({ kept: 1, added: 1, retired: 1 });
    const active = await activeFeeds(db);
    expect(active).toHaveLength(2);
    const kept = active.find((f) => f.id === first!.id)!;
    expect(kept.intervalSeconds).toBe(300);
    expect(kept.catchUpPagesLeft).toBe(2);
    expect(await db.$count(feeds, eq(feeds.status, "retired"))).toBe(1);
  });

  it("rejects malformed feeds", async () => {
    await expect(
      db.insert(feeds).values({ kind: "search", intervalSeconds: 300 }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(feeds)
        .values({ kind: "subreddits", subreddits: [], intervalSeconds: 300 }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(feeds)
        .values({ kind: "search", query: "x", intervalSeconds: 5 }),
    ).rejects.toThrow();
  });

  it("picks the most overdue feed, or the most overdue catch-up", async () => {
    await applyFeedPlan(db, [
      { kind: "subreddits", subreddits: ["forhire"], intervalSeconds: 300 },
      { kind: "subreddits", subreddits: ["hiring"], intervalSeconds: 300 },
    ]);
    const [a, b] = await activeFeeds(db);
    await db
      .update(feeds)
      .set({ nextPollAt: new Date(Date.now() - 60_000) })
      .where(eq(feeds.id, b!.id));
    expect((await nextFeed(db, { catchUp: false }))!.id).toBe(b!.id);
    expect(await nextFeed(db, { catchUp: true })).toBeNull();
    await db
      .update(feeds)
      .set({ catchUpPagesLeft: 1, catchUpAfter: "t3_x" })
      .where(eq(feeds.id, a!.id));
    expect((await nextFeed(db, { catchUp: true }))!.id).toBe(a!.id);
  });

  it("logs a poll and moves the schedule", async () => {
    await applyFeedPlan(db, [
      { kind: "search", query: "title:task", intervalSeconds: 600 },
    ]);
    const [f] = await activeFeeds(db);
    const startedAt = new Date();
    const next = new Date(Date.now() + 600_000);
    await recordFeedPoll(
      db,
      f!.id,
      {
        startedAt,
        durationMs: 800,
        httpStatus: 200,
        entries: 100,
        newPosts: 100,
        page: 0,
        rateLimitRemaining: 0,
        rateLimitReset: 42,
        errorCode: null,
      },
      {
        polled: true,
        nextPollAt: next,
        consecutiveErrors: 0,
        catchUpAfter: "t3_old",
        catchUpPagesLeft: 5,
        catchUpUntil: null,
        subreddits: null,
      },
    );
    const [after] = await activeFeeds(db);
    expect(after!.lastPolledAt!.getTime()).toBe(startedAt.getTime());
    expect(after!.nextPollAt.getTime()).toBe(next.getTime());
    expect(after!.catchUpPagesLeft).toBe(5);
    expect(await db.$count(feedPolls)).toBe(1);
    expect(await pruneFeedPolls(db, 30)).toBe(0);
  });
});

describe("feed recovery", () => {
  const poll = (startedAt: Date, errorCode: string | null = null) => ({
    startedAt,
    durationMs: 500,
    httpStatus: errorCode ? 403 : 200,
    entries: 0,
    newPosts: 0,
    page: 0,
    rateLimitRemaining: 0,
    rateLimitReset: 30,
    errorCode,
  });

  it("moves the subreddits' last poll on success, so gap detection survives re-plans", async () => {
    await db
      .update(subreddits)
      .set({ lastPolledAt: null, unreachableSince: null });
    await applyFeedPlan(db, [
      {
        kind: "subreddits",
        subreddits: ["forhire", "hiring"],
        intervalSeconds: 480,
      },
    ]);
    const [f] = await activeFeeds(db);
    expect(await subredditsLastPolledAt(db, ["forhire", "hiring"])).toBeNull();
    await markSubredditUnreachable(db, "hiring", "BLOCKED");
    const at = new Date(Date.now() - 1000);
    const update = {
      polled: true,
      nextPollAt: new Date(),
      consecutiveErrors: 0,
      catchUpAfter: null,
      catchUpPagesLeft: 0,
      catchUpUntil: null,
      subreddits: f!.subreddits,
    };
    await recordFeedPoll(db, f!.id, poll(at), update);
    expect(
      (await subredditsLastPolledAt(db, [
        "forhire",
        "hiring",
        "designjobs",
      ]))!.getTime(),
    ).toBe(at.getTime());
    const [hiring] = await db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, "hiring"));
    expect(hiring!.unreachableSince).toBeNull();
    // A failed poll doesn't count as coverage.
    await recordFeedPoll(db, f!.id, poll(new Date(), "BLOCKED"), {
      ...update,
      polled: false,
    });
    expect((await subredditsLastPolledAt(db, ["forhire"]))!.getTime()).toBe(
      at.getTime(),
    );
    expect((await recentFeedPolls(db, 1))[0]!.errorCode).toBe("BLOCKED");
  });

  it("splits a failing feed into halves and marks a lone subreddit unreachable", async () => {
    await applyFeedPlan(db, [
      {
        kind: "subreddits",
        subreddits: ["a_one", "b_two", "c_three"],
        intervalSeconds: 480,
      },
    ]);
    const [f] = await activeFeeds(db);
    expect(await splitFeed(db, f!)).toHaveLength(2);
    const halves = (await activeFeeds(db)).map((x) => x.subreddits);
    expect(halves).toEqual(
      expect.arrayContaining([["a_one", "b_two"], ["c_three"]]),
    );
    expect(await splitFeed(db, f!)).toEqual([]); // already retired
    await markSubredditUnreachable(db, "forhire", "NOT_FOUND");
    const [row] = await db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, "forhire"));
    expect(row!.unreachableReason).toBe("NOT_FOUND");
    await db
      .update(subreddits)
      .set({ unreachableSince: null, unreachableReason: null });
  });
});

describe("analysis queue", () => {
  it("claims newest first, completes and replaces the analysis", async () => {
    const older = post({ postedAt: new Date(Date.now() - 3_600_000) });
    const newer = post({ postedAt: new Date() });
    await saveJobPosts(db, [older, newer, post({ analyse: false })], null);
    const claimed = await claimPostsForAnalysis(db, 5);
    expect(claimed.map((c) => c.externalId)).toEqual([
      newer.externalId,
      older.externalId,
    ]);
    expect(await claimPostsForAnalysis(db, 5)).toHaveLength(0);

    const c = claimed[0]!;
    expect(
      await completePostAnalysis(db, c.id, c.analysisAttempts, analysis),
    ).toBe(true);
    // A stale claim can't write.
    expect(
      await completePostAnalysis(db, c.id, c.analysisAttempts, analysis),
    ).toBe(false);
    const [a] = await db
      .select()
      .from(jobPostAnalyses)
      .where(eq(jobPostAnalyses.jobPostId, c.id));
    expect(a!.budgetMin).toBe(500);
    expect(a!.skillIds).toEqual(["react"]);

    await requeuePostsForAnalysis(db, [c.id]);
    const [again] = await claimPostsForAnalysis(db, 1);
    await completePostAnalysis(db, again!.id, again!.analysisAttempts, {
      ...analysis,
      pipelineVersion: "post@2",
    });
    expect(await db.$count(jobPostAnalyses)).toBe(1);
  });

  it("retries with backoff, then fails for good", async () => {
    await saveJobPosts(db, [post()], null);
    for (let n = 1; n <= MAX_ANALYSIS_ATTEMPTS; n++) {
      const [c] = await claimPostsForAnalysis(db, 1);
      expect(c!.analysisAttempts).toBe(n);
      const out = await failPostAnalysis(db, c!.id, n, {
        errorCode: "TIMEOUT",
        retryable: true,
      });
      expect(out).toBe(n < MAX_ANALYSIS_ATTEMPTS ? "requeued" : "failed");
      await db.update(jobPosts).set({ analysisRunAfter: new Date(0) });
    }
    const [row] = await db.select().from(jobPosts);
    expect(row!.analysisStatus).toBe("failed");
    expect(row!.analysisError).toBe("TIMEOUT");
  });

  it("gives the attempt back for provider outages, and re-queues retryable failures", async () => {
    await saveJobPosts(db, [post()], null);
    for (let i = 0; i < 5; i++) {
      const [c] = await claimPostsForAnalysis(db, 1);
      expect(c!.analysisAttempts).toBe(1);
      expect(
        await failPostAnalysis(db, c!.id, 1, {
          errorCode: "LLM_SERVER",
          retryable: true,
          countAttempt: false,
        }),
      ).toBe("requeued");
      await db.update(jobPosts).set({ analysisRunAfter: new Date(0) });
    }
    await db
      .update(jobPosts)
      .set({ analysisStatus: "failed", analysisError: "LLM_SERVER" });
    expect(await requeueRetryableFailures(db, ["LLM_TIMEOUT"])).toBe(0);
    expect(await requeueRetryableFailures(db, ["LLM_SERVER"])).toBe(1);
    const [row] = await db.select().from(jobPosts);
    expect(row).toMatchObject({
      analysisStatus: "pending",
      analysisAttempts: 0,
    });
  });

  it("re-queues posts analysed by an older pipeline", async () => {
    await saveJobPosts(db, [post()], null);
    const [c] = await claimPostsForAnalysis(db, 1);
    await completePostAnalysis(db, c!.id, 1, analysis);
    expect(await requeueOutdatedAnalyses(db, "post@1")).toBe(0);
    expect(await requeueOutdatedAnalyses(db, "post@2")).toBe(1);
  });

  it("does not retry a non-retryable failure, and rescues stale claims", async () => {
    await saveJobPosts(db, [post(), post()], null);
    const [a, b] = await claimPostsForAnalysis(db, 2);
    expect(
      await failPostAnalysis(db, a!.id, a!.analysisAttempts, {
        errorCode: "INVALID_OUTPUT",
        retryable: false,
      }),
    ).toBe("failed");
    await db
      .update(jobPosts)
      .set({ analysisLockedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(jobPosts.id, b!.id));
    expect(await requeueStalePostAnalyses(db)).toBe(1);
    const [row] = await db
      .select()
      .from(jobPosts)
      .where(eq(jobPosts.id, b!.id));
    expect(row!.analysisStatus).toBe("pending");
  });

  it("sums today's model spend for a task", async () => {
    const since = new Date(Date.now() - 60_000);
    for (const costMicros of [120, 80])
      await recordLlmUsage(db, {
        task: "post_analysis",
        step: "extract",
        promptVersion: "post@1",
        model: "m",
        inputTokens: 1,
        outputTokens: 1,
        costMicros,
        latencyMs: 1,
        attempt: 1,
        outcome: "ok",
      });
    expect(await llmCostSince(db, since, "post_analysis")).toBe(200);
    expect(await llmCostSince(db, since, "resume_import")).toBe(0);
  });
});

describe("upkeep", () => {
  it("keeps the study's volume under 3 days of data, and reports uncatalogued subreddits", async () => {
    await db
      .update(subreddits)
      .set({ postsPerDay: 33 })
      .where(eq(subreddits.name, "forhire"));
    await saveJobPosts(
      db,
      [
        post(),
        post({ community: "somenewboard" }),
        post({ community: "somenewboard", preKind: "unknown" }),
      ],
      null,
    );
    await refreshSubredditStats(db);
    const [forhire] = await db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, "forhire"));
    expect(forhire!.postsPerDay).toBe(33);
    expect(forhire!.lastPostAt).not.toBeNull();
    expect(forhire!.dormantSince).toBeNull();
    expect(await uncataloguedCommunities(db)).toEqual([
      { community: "somenewboard", posts: 2, hiring: 1 },
    ]);
  });

  it("marks a silent subreddit dormant only while we were polling it, and wakes it on a post", async () => {
    const day = 86_400_000;
    await saveJobPosts(db, [post({ community: "hiring" })], null);
    await db
      .update(subreddits)
      .set({
        createdAt: new Date(Date.now() - 60 * day),
        lastPostAt: new Date(Date.now() - 40 * day),
        lastPolledAt: new Date(),
        dormantSince: null,
      })
      .where(eq(subreddits.name, "designjobs"));
    await db
      .update(subreddits)
      .set({
        createdAt: new Date(),
        lastPostAt: null,
        lastPolledAt: new Date(),
      })
      .where(eq(subreddits.name, "remotejs"));
    await refreshSubredditStats(db);
    const get = async (n: string) =>
      (await db.select().from(subreddits).where(eq(subreddits.name, n)))[0]!;
    expect((await get("designjobs")).dormantSince).not.toBeNull();
    expect((await get("remotejs")).dormantSince).toBeNull(); // new to the catalogue
    await saveJobPosts(db, [post({ community: "designjobs" })], null);
    await refreshSubredditStats(db);
    expect((await get("designjobs")).dormantSince).toBeNull();
    await db
      .update(subreddits)
      .set({ dormantSince: null, lastPostAt: null, lastPolledAt: null })
      .where(inArray(subreddits.name, ["designjobs", "remotejs"]));
  });

  it("measures volume once there are 3+ days of data", async () => {
    const day = 86_400_000;
    await saveJobPosts(
      db,
      [0, 1, 2, 3].map((i) =>
        post({ community: "hiring", postedAt: new Date(Date.now() - i * day) }),
      ),
      null,
    );
    await db
      .update(jobPosts)
      .set({ firstSeenAt: new Date(Date.now() - 10 * day) });
    await refreshSubredditStats(db);
    const [hiring] = await db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, "hiring"));
    expect(hiring!.postsPerDay).toBeCloseTo(4 / 7, 1);
    expect(hiring!.hiringShare).toBe(1);
  });
});
