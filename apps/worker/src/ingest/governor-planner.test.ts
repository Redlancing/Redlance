import { describe, expect, it } from "vitest";
import { MIN_SPACING_MS, RequestGovernor } from "./governor";
import { planFeeds, requestsPerDay, type PlannerSubreddit } from "./planner";

describe("RequestGovernor", () => {
  const rl = (remaining: number | null, resetSeconds: number | null) => ({
    remaining,
    resetSeconds,
  });
  const make = () => {
    let t = 1_000_000;
    const g = new RequestGovernor(MIN_SPACING_MS, () => t);
    return { g, at: (ms: number) => (t = ms), now: () => t };
  };

  it("keeps at least 65 s between requests, even when the window resets sooner", () => {
    const { g, now } = make();
    g.onResult({ ok: true, rateLimit: rl(0, 2) });
    expect(g.nextAllowedAt() - now()).toBe(65_000);
  });

  it("waits for the reset when it is further away", () => {
    const { g, now } = make();
    g.onResult({ ok: true, rateLimit: rl(0, 90) });
    expect(g.nextAllowedAt() - now()).toBe(92_000);
    g.onResult({ ok: true, rateLimit: rl(5, 90) });
    expect(g.nextAllowedAt() - now()).toBe(65_000);
  });

  it("backs off on repeated 429s, capped at 10 minutes, and recovers on success", () => {
    const { g, now } = make();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      g.onResult({
        ok: false,
        errorCode: "RATE_LIMITED",
        rateLimit: rl(0, 30),
      });
      waits.push(g.nextAllowedAt() - now());
    }
    expect(waits).toEqual([
      65_000, 120_000, 240_000, 480_000, 600_000, 600_000,
    ]);
    g.onResult({ ok: true, rateLimit: rl(0, 10) });
    expect(g.state().rateLimitedStreak).toBe(0);
    expect(g.nextAllowedAt() - now()).toBe(65_000);
  });

  it("treats one feed's 403 as that feed's problem, and two feeds' as an IP block", () => {
    const { g, now } = make();
    const blocked = {
      ok: false,
      errorCode: "BLOCKED",
      rateLimit: rl(null, null),
    };
    g.onResult(blocked, "feed-a");
    expect(g.nextAllowedAt() - now()).toBe(65_000);
    g.onResult(blocked, "feed-a"); // same feed again: still its own problem
    expect(g.nextAllowedAt() - now()).toBe(65_000);
    g.onResult({ ...blocked, errorCode: "NOT_A_FEED" }, "feed-b");
    expect(g.nextAllowedAt() - now()).toBe(30 * 60_000);
    expect(g.state().blockedStreak).toBe(1);
    g.onResult({ ok: true, rateLimit: rl(0, 5) }, "feed-c");
    expect(g.state().blockedStreak).toBe(0);
  });

  it("backs off a little on network trouble", () => {
    const { g, now } = make();
    g.onResult({ ok: false, errorCode: "TIMEOUT", rateLimit: rl(null, null) });
    expect(g.nextAllowedAt() - now()).toBe(130_000);
  });

  it("holds the slot from the moment a request is sent", () => {
    const { g, at, now } = make();
    g.reserve();
    at(now() + 1_000); // the request "crashes" after a second: no onResult
    expect(g.nextAllowedAt() - now()).toBe(64_000);
  });

  it("rebuilds spacing and backoff from the poll log after a restart", () => {
    const { g, now } = make();
    const poll = (agoMs: number, errorCode: string | null, feedId = "f") => ({
      feedId,
      startedAt: new Date(now() - agoMs),
      durationMs: 0,
      errorCode,
      rateLimitRemaining: 0,
      rateLimitReset: 10,
    });
    g.seed([poll(10_000, null)]);
    expect(g.nextAllowedAt() - now()).toBe(55_000);
    const h = new RequestGovernor(MIN_SPACING_MS, now);
    h.seed([
      poll(5_000, "RATE_LIMITED"),
      poll(80_000, "RATE_LIMITED"),
      poll(200_000, null),
    ]);
    expect(h.state().rateLimitedStreak).toBe(2);
    expect(h.nextAllowedAt() - now()).toBe(115_000);
  });
});

describe("planFeeds", () => {
  const subs = (n: number, perDay: number | null = 10): PlannerSubreddit[] =>
    Array.from({ length: n }, (_, i) => ({
      name: `sub_${String(i).padStart(3, "0")}`,
      postsPerDay: perDay,
      dormant: false,
    }));

  it("packs subreddits into groups no bigger than the URL limit", () => {
    const plan = planFeeds(subs(186), { maxGroupSize: 40, searchQueries: [] });
    expect(plan).toHaveLength(5);
    for (const f of plan) {
      expect(f.kind).toBe("subreddits");
      if (f.kind === "subreddits")
        expect(f.subreddits.length).toBeLessThanOrEqual(40);
    }
    const all = plan.flatMap((f) =>
      f.kind === "subreddits" ? f.subreddits : [],
    );
    expect(new Set(all).size).toBe(186);
  });

  it("balances volume so one busy subreddit doesn't crowd its group", () => {
    const list = [
      { name: "busy", postsPerDay: 1_000, dormant: false },
      ...subs(10, 1),
    ];
    const plan = planFeeds(list, {
      maxGroupSize: 40,
      groupIntervalSeconds: 480,
      searchQueries: [],
    });
    // 1,011 posts a day at one poll every 8 min = ~5.6 a poll: one group is enough.
    expect(plan).toHaveLength(1);
    const heavy = planFeeds(
      list.map((s) => ({ ...s, postsPerDay: (s.postsPerDay ?? 0) * 20 })),
      {
        maxGroupSize: 40,
        groupIntervalSeconds: 480,
        searchQueries: [],
      },
    );
    // ~20,000 a day = ~112 a poll: split so each group expects under 40.
    expect(heavy.length).toBeGreaterThanOrEqual(3);
    const withBusy = heavy.find(
      (f) => f.kind === "subreddits" && f.subreddits.includes("busy"),
    );
    expect(
      withBusy && withBusy.kind === "subreddits" && withBusy.subreddits,
    ).toEqual(["busy"]);
  });

  it("polls dormant subreddits rarely and adds the search feeds", () => {
    const plan = planFeeds([
      { name: "alive", postsPerDay: 3, dormant: false },
      { name: "quiet", postsPerDay: 0, dormant: true },
    ]);
    expect(plan).toEqual([
      { kind: "subreddits", subreddits: ["alive"], intervalSeconds: 300 },
      { kind: "subreddits", subreddits: ["quiet"], intervalSeconds: 21_600 },
      { kind: "search", query: "title:hiring", intervalSeconds: 1_200 },
      { kind: "search", query: "title:task", intervalSeconds: 1_200 },
      { kind: "search", query: "title:paid", intervalSeconds: 1_200 },
    ]);
  });

  it("keeps today's groups while they still fit, and re-packs when the set changes", () => {
    const list = subs(80);
    const first = planFeeds(list, { searchQueries: [] });
    const current = first.map((f) =>
      f.kind === "subreddits" ? f.subreddits : [],
    );
    // Volumes drift a little: the same groups stay (their poll state survives).
    const drifted = list.map((s, i) => ({ ...s, postsPerDay: 10 + (i % 3) }));
    expect(planFeeds(drifted, { searchQueries: [], current })).toEqual(first);
    // A new subreddit joins: re-packed.
    const grown = planFeeds(
      [...list, { name: "zz_new", postsPerDay: 1, dormant: false }],
      {
        searchQueries: [],
        current,
      },
    );
    expect(
      grown.flatMap((f) => (f.kind === "subreddits" ? f.subreddits : [])),
    ).toContain("zz_new");
  });

  it("polls unreachable subreddits alone, once a day", () => {
    const plan = planFeeds(
      [
        { name: "ok_one", postsPerDay: 5, dormant: false },
        { name: "gone_one", postsPerDay: 5, dormant: false, unreachable: true },
      ],
      { searchQueries: [] },
    );
    expect(plan).toEqual([
      { kind: "subreddits", subreddits: ["ok_one"], intervalSeconds: 300 },
      { kind: "subreddits", subreddits: ["gone_one"], intervalSeconds: 86_400 },
    ]);
  });

  it("stretches every interval when the plan needs more requests than the spacing allows", () => {
    const plan = planFeeds(subs(186), { maxGroupSize: 10 }); // 19 groups every 8 min + 3 searches
    const capacity = (86_400 / 65) * 0.95;
    expect(requestsPerDay(plan)).toBeLessThanOrEqual(capacity + 1);
    expect(plan[0]!.intervalSeconds).toBeGreaterThan(300);
  });

  it("is deterministic and ignores duplicates", () => {
    const list = [...subs(90, null), ...subs(5, null)].reverse();
    expect(planFeeds(list)).toEqual(planFeeds([...list].reverse()));
    const names = planFeeds(list).flatMap((f) =>
      f.kind === "subreddits" ? f.subreddits : [],
    );
    expect(names).toHaveLength(90);
  });
});
