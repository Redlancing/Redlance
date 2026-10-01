import { readFileSync } from "node:fs";
import {
  activeFeeds,
  applyFeedPlan,
  createDb,
  feedPolls,
  feeds,
  jobPosts,
  recordFeedPoll,
  saveJobPosts,
  subreddits,
  subredditsLastPolledAt,
  syncReferenceData,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RATE_HEADERS, atomFeed, fakeFetch, fakePosts } from "../../test/atom";
import { pollFeed, selectPosts, type Catalogue } from "./poll-feed";
import { createPoller, type SessionLock } from "./poller";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 5 });
const log = pino({ level: "silent" });
const UA = "web:app.redlance.ingest:test";
const FIXTURE = readFileSync(
  new URL("../../test/fixtures/reddit-combined.atom.xml", import.meta.url),
  "utf8",
);
const FIXTURE_SUBS = [
  "artcommissions",
  "designjobs",
  "forhire",
  "hungryartists",
  "photoshoprequest",
];
const HOUR = 3_600_000;

const catalogue: Catalogue = new Map([
  ["forhire", "active"],
  ["hiring", "active"],
  ["jobboardsearch", "excluded"],
]);
const deps = (f: typeof fetch, over: Record<string, unknown> = {}) => ({
  db,
  userAgent: UA,
  catalogue: async () => catalogue,
  lastPolledAt: (names: string[]) => subredditsLastPolledAt(db, names),
  fetch: f,
  ...over,
});
const ok = (body: string) => new Response(body, { headers: RATE_HEADERS });

async function oneFeed(subs: string[] | null, query?: string) {
  await applyFeedPlan(db, [
    subs
      ? { kind: "subreddits", subreddits: subs, intervalSeconds: 480 }
      : { kind: "search", query: query!, intervalSeconds: 1200 },
  ]);
  return (await activeFeeds(db))[0]!;
}
const lastPolled = (names: string[], at: Date | null) =>
  db
    .update(subreddits)
    .set({ lastPolledAt: at })
    .where(inArray(subreddits.name, names));

const reset = async () => {
  await db.execute(
    sql`truncate table job_post_analyses, job_posts, feed_polls, feeds, llm_usage`,
  );
  await db.update(subreddits).set({
    lastPolledAt: null,
    unreachableSince: null,
    unreachableReason: null,
    dormantSince: null,
  });
};
beforeAll(async () => {
  await runMigrations(url);
  await syncReferenceData(db);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

describe("pollFeed", () => {
  it("saves new posts once, tags them, and schedules the next poll", async () => {
    const feed = await oneFeed(FIXTURE_SUBS);
    const calls: string[] = [];
    const before = Date.now();
    const out = await pollFeed(
      feed,
      { catchUp: false },
      deps(fakeFetch(() => ok(FIXTURE), calls)),
    );
    expect(calls).toEqual([
      "https://www.reddit.com/r/artcommissions+designjobs+forhire+hungryartists+photoshoprequest/new/.rss?limit=100",
    ]);
    expect(out).toMatchObject({
      page: 0,
      entries: 6,
      newPosts: 5,
      malformed: 1,
      consecutiveErrors: 0,
    });

    const rows = await db.select().from(jobPosts);
    const by = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    expect(by.t3_1aaa001).toMatchObject({
      preKind: "hiring",
      analysisStatus: "pending",
      firstSeenFeedId: feed.id,
    });
    expect(by.t3_1aaa002).toMatchObject({
      preKind: "for_hire",
      analysisStatus: "skipped",
    });
    // Flair-only boards have no title tag: still analysed.
    expect(by.t3_1aaa004).toMatchObject({
      preKind: "unknown",
      analysisStatus: "pending",
    });

    const again = await pollFeed(
      (await activeFeeds(db))[0]!,
      { catchUp: false },
      deps(fakeFetch(() => ok(FIXTURE))),
    );
    expect(again.newPosts).toBe(0);
    const [after] = await activeFeeds(db);
    expect(after!.lastPolledAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(after!.nextPollAt.getTime() - after!.lastPolledAt!.getTime()).toBe(
      480_000,
    );
    expect(await db.$count(feedPolls)).toBe(2);
    // The subreddits' own last poll moved too (gap detection survives re-plans).
    expect(await subredditsLastPolledAt(db, ["forhire"])).toEqual(
      after!.lastPolledAt,
    );
  });

  it("ignores posts from subreddits outside the feed", async () => {
    const feed = await oneFeed(["forhire"]);
    const out = await pollFeed(
      feed,
      { catchUp: false },
      deps(fakeFetch(() => ok(FIXTURE))),
    );
    expect(out.newPosts).toBe(1);
  });

  it("pages back after a gap until it reaches the last poll, even if a search feed saved some posts", async () => {
    const now = Date.now();
    await lastPolled(["forhire"], new Date(now - 3 * HOUR));
    const feed = await oneFeed(["forhire"]);
    // 150 posts since the last poll (one a minute), then older ones we already have.
    const fresh = fakePosts(150, {
      prefix: "new",
      sub: "forhire",
      newest: new Date(now),
    });
    const older = fakePosts(60, {
      prefix: "old",
      sub: "forhire",
      newest: new Date(now - 200 * 60_000),
    });
    // A search feed had already saved a few of the fresh hiring posts.
    await saveJobPosts(
      db,
      fresh.slice(10, 15).map((p) => ({
        source: "reddit" as const,
        externalId: `t3_${p.id}`,
        fetchedVia: "rss" as const,
        community: "forhire",
        url: `https://www.reddit.com/r/forhire/comments/${p.id}/post/`,
        title: p.title,
        body: "",
        author: null,
        postedAt: p.publishedAt,
        sourceUpdatedAt: null,
        preKind: "hiring" as const,
        analyse: true,
      })),
      null,
    );
    const pages = [
      fresh.slice(0, 100),
      [...fresh.slice(100), ...older.slice(0, 50)],
    ];
    const calls: string[] = [];
    const f = fakeFetch(
      (u) => ok(atomFeed(u.includes("after=") ? pages[1]! : pages[0]!)),
      calls,
    );

    const first = await pollFeed(feed, { catchUp: false }, deps(f));
    expect(first).toMatchObject({ newPosts: 95, catchUpPagesLeft: 5 });
    const [gap] = await activeFeeds(db);
    expect(gap!.catchUpAfter).toBe("t3_new99");
    expect(gap!.catchUpUntil!.getTime()).toBe(now - 3 * HOUR);

    const second = await pollFeed(gap!, { catchUp: true }, deps(f));
    expect(calls[1]).toContain("after=t3_new99");
    // This page reaches back past the last poll: the gap is closed.
    expect(second).toMatchObject({
      page: 1,
      newPosts: 100,
      catchUpPagesLeft: 0,
    });
    const [done] = await activeFeeds(db);
    expect(done!.catchUpAfter).toBeNull();
    expect(done!.nextPollAt.getTime()).toBe(gap!.nextPollAt.getTime());
    expect(await db.$count(jobPosts)).toBe(200);
  });

  it("doesn't see a gap when the page reaches back to the last poll, or the subreddits were never polled", async () => {
    const posts = fakePosts(100, { prefix: "a", sub: "forhire" }); // spans 100 minutes
    const feed = await oneFeed(["forhire"]);
    const first = await pollFeed(
      feed,
      { catchUp: false },
      deps(fakeFetch(() => ok(atomFeed(posts)))),
    );
    expect(first.catchUpPagesLeft).toBe(0); // never polled before
    await lastPolled(["forhire"], new Date(Date.now() - 30 * 60_000));
    const second = await pollFeed(
      (await activeFeeds(db))[0]!,
      { catchUp: false },
      deps(
        fakeFetch(() =>
          ok(atomFeed(fakePosts(100, { prefix: "b", sub: "forhire" }))),
        ),
      ),
    );
    expect(second.catchUpPagesLeft).toBe(0); // the page goes back further than 30 min
  });

  it("keeps a rate-limited feed due, and backs off a failing one", async () => {
    const feed = await oneFeed(["forhire"]);
    const limited = await pollFeed(
      feed,
      { catchUp: false },
      deps(
        fakeFetch(
          () => new Response("", { status: 429, headers: RATE_HEADERS }),
        ),
      ),
    );
    expect(limited.fetch.errorCode).toBe("RATE_LIMITED");
    let [f] = await activeFeeds(db);
    expect(f!.consecutiveErrors).toBe(0);
    expect(f!.lastPolledAt).toBeNull();
    expect(f!.nextPollAt.getTime()).toBeLessThanOrEqual(Date.now());

    const start = Date.now();
    await pollFeed(
      f!,
      { catchUp: false },
      deps(fakeFetch(() => new Response("", { status: 500 }))),
    );
    [f] = await activeFeeds(db);
    expect(f!.consecutiveErrors).toBe(1);
    expect(f!.nextPollAt.getTime() - start).toBeGreaterThanOrEqual(
      960_000 - 50,
    );
    const [poll] = await db
      .select()
      .from(feedPolls)
      .where(eq(feedPolls.errorCode, "HTTP_ERROR"));
    expect(poll!.httpStatus).toBe(500);
  });

  it("records parse errors, unreadable pages and save failures, and still reschedules", async () => {
    const feed = await oneFeed(["forhire"]);
    const broken = await pollFeed(
      feed,
      { catchUp: false },
      deps(
        fakeFetch(() =>
          ok('<?xml version="1.0"?><feed><entry><id>t3_a</id></entry'),
        ),
      ),
    );
    expect(broken.fetch.errorCode).toBe("PARSE");

    const junk = await pollFeed(
      (await activeFeeds(db))[0]!,
      { catchUp: false },
      deps(
        fakeFetch(() =>
          ok(
            atomFeed([
              { id: "x", sub: "forhire", title: "", publishedAt: new Date() },
            ]),
          ),
        ),
      ),
    );
    expect(junk.fetch.errorCode).toBe("ALL_MALFORMED");

    const errors: unknown[] = [];
    const failed = await pollFeed(
      (await activeFeeds(db))[0]!,
      { catchUp: false },
      deps(
        fakeFetch(() => ok(FIXTURE)),
        {
          catalogue: async () => {
            throw new Error("db down");
          },
          onError: (e: unknown) => errors.push(e),
        },
      ),
    );
    expect(failed).toMatchObject({
      consecutiveErrors: 3,
      fetch: { ok: true, errorCode: "SAVE_FAILED" },
    });
    expect(errors).toHaveLength(1);
    const [f] = await activeFeeds(db);
    expect(f!.nextPollAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000); // backed off
    expect(await db.$count(feedPolls)).toBe(3);
  });
});

describe("search feeds", () => {
  it("skips posts on user profiles without counting them as malformed", async () => {
    const feed = await oneFeed(null, "title:hiring");
    const page = [
      {
        id: "p1",
        sub: "u/some_company",
        title: "We are Hiring!",
        publishedAt: new Date(),
      },
      {
        id: "p2",
        sub: "forhire",
        title: "[Hiring] Logo",
        publishedAt: new Date(),
      },
    ];
    const out = await pollFeed(
      feed,
      { catchUp: false },
      deps(fakeFetch(() => ok(atomFeed(page)))),
    );
    expect(out).toMatchObject({
      entries: 2,
      newPosts: 1,
      malformed: 0,
      profilePosts: 1,
    });
    const onlyProfiles = await pollFeed(
      (await activeFeeds(db))[0]!,
      { catchUp: false },
      deps(fakeFetch(() => ok(atomFeed([page[0]!])))),
    );
    expect(onlyProfiles.fetch.errorCode).toBeNull();
  });
});

describe("selectPosts (search feeds)", () => {
  it("keeps active and unknown subreddits, drops excluded ones, analyses unknown ones only when hiring", async () => {
    const feed = await oneFeed(null, "title:hiring");
    const p = (sub: string, title: string) => ({
      source: "reddit" as const,
      externalId: `t3_${sub}${title.length}`,
      fetchedVia: "rss" as const,
      community: sub,
      url: `https://www.reddit.com/r/${sub}/comments/x/y/`,
      title,
      body: "",
      author: null,
      postedAt: new Date(),
      sourceUpdatedAt: null,
    });
    const out = selectPosts(
      feed,
      [
        p("forhire", "Looking for an editor"),
        p("jobboardsearch", "[HIRING] Staff engineer"),
        p("somenewboard", "[Hiring] Logo designer"),
        p("starbucks", "Is anyone hiring at my store?"),
      ],
      catalogue,
    );
    expect(out.map((o) => [o.community, o.analyse])).toEqual([
      ["forhire", true],
      ["somenewboard", true],
      ["starbucks", false],
    ]);
  });
});

describe("poller", () => {
  function virtualClock(start = Date.now()) {
    let t = start;
    return {
      now: () => t,
      sleep: async (ms: number, signal: AbortSignal) => {
        if (!signal.aborted) t += Math.max(ms, 1);
      },
    };
  }
  const heldLock = (): SessionLock => ({
    lost: new Promise(() => {}),
    release: async () => {},
  });
  const until = (cond: () => boolean) =>
    new Promise<void>((r) => {
      const check = () => (cond() ? r() : setTimeout(check, 10));
      check();
    });

  it("spaces requests at least 65 s apart, even right after a restart, and polls every feed", async () => {
    await applyFeedPlan(db, [
      { kind: "subreddits", subreddits: ["forhire"], intervalSeconds: 480 },
      { kind: "subreddits", subreddits: ["hiring"], intervalSeconds: 480 },
      { kind: "search", query: "title:task", intervalSeconds: 1200 },
    ]);
    const clock = virtualClock();
    // A request went out 10 s ago (before a restart): the next one must wait.
    await recordFeedPoll(
      db,
      null,
      {
        startedAt: new Date(clock.now() - 10_000),
        durationMs: 500,
        httpStatus: 200,
        entries: 0,
        newPosts: 0,
        page: 0,
        rateLimitRemaining: 0,
        rateLimitReset: 5,
        errorCode: null,
      },
      null,
    );
    const start = clock.now();
    const times: number[] = [];
    const urls: string[] = [];
    let poller!: ReturnType<typeof createPoller>;
    poller = createPoller({
      db,
      log,
      userAgent: UA,
      acquireLock: async () => heldLock(),
      fetch: fakeFetch((u) => {
        times.push(clock.now());
        urls.push(u);
        return ok(atomFeed([]));
      }),
      now: clock.now,
      sleep: clock.sleep,
      onPoll: () => {
        if (times.length >= 6) void poller.stop();
      },
    });
    poller.start();
    await until(() => times.length >= 6);
    await poller.stop();
    expect(times[0]! - start).toBeGreaterThanOrEqual(55_000 - 500); // 65 s after the last request
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(65_000);
    expect(new Set(urls.slice(0, 3)).size).toBe(3);
  });

  it("splits a group Reddit keeps refusing, then sets the bad subreddit aside", async () => {
    await applyFeedPlan(db, [
      {
        kind: "subreddits",
        subreddits: ["forhire", "hiring"],
        intervalSeconds: 480,
      },
    ]);
    const clock = virtualClock();
    let polls = 0;
    let poller!: ReturnType<typeof createPoller>;
    poller = createPoller({
      db,
      log,
      userAgent: UA,
      acquireLock: async () => heldLock(),
      // Reddit refuses any URL that includes r/hiring.
      fetch: fakeFetch((u) =>
        u.includes("hiring")
          ? new Response("", { status: 403, headers: RATE_HEADERS })
          : ok(atomFeed([])),
      ),
      now: clock.now,
      sleep: clock.sleep,
      onPoll: () => {
        if (++polls >= 8) void poller.stop();
      },
    });
    poller.start();
    await until(() => polls >= 8);
    await poller.stop();
    const [hiring] = await db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, "hiring"));
    expect(hiring!.unreachableReason).toBe("BLOCKED");
    const [forhire] = await db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, "forhire"));
    expect(forhire!.unreachableSince).toBeNull();
    expect(forhire!.lastPolledAt).not.toBeNull();
  });

  it("runs upkeep on taking the lock, and plans feeds when there are none", async () => {
    const clock = virtualClock();
    let upkeeps = 0;
    const poller = createPoller({
      db,
      log,
      userAgent: UA,
      acquireLock: async () => heldLock(),
      fetch: fakeFetch(() => ok(atomFeed([]))),
      now: clock.now,
      sleep: clock.sleep,
      upkeep: async () => {
        upkeeps++;
        if (upkeeps === 1) throw new Error("stats failed");
        if (upkeeps >= 2) void poller.stop();
      },
    });
    poller.start();
    await until(() => upkeeps >= 2);
    await poller.stop();
    expect(upkeeps).toBe(2); // the failed first run was retried within minutes, not a day
  });

  it("stands by while another worker holds the lock", async () => {
    let tries = 0;
    const clock = virtualClock();
    const poller = createPoller({
      db,
      log,
      userAgent: UA,
      acquireLock: async () => {
        tries++;
        if (tries >= 3) void poller.stop();
        return null;
      },
      fetch: fakeFetch(() => {
        throw new Error("must not fetch");
      }),
      now: clock.now,
      sleep: clock.sleep,
    });
    poller.start();
    await until(() => tries >= 3);
    await poller.stop();
    expect(tries).toBeGreaterThanOrEqual(3);
  });
});
