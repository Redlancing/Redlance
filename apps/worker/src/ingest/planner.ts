import type { FeedPlanItem } from "@redlance/db";
import { PAGE_SIZE } from "../sources/reddit-rss/feed-url";

// Packs active subreddits into combined feeds (docs/ingestion/plan.md, Phase 2). Pure and
// deterministic: the same input gives the same feeds, so a nightly re-plan keeps feeds (and
// their poll state) when nothing changed.

export type PlannerSubreddit = {
  name: string;
  /** Measured volume; null = unknown (treated as DEFAULT_POSTS_PER_DAY). */
  postsPerDay: number | null;
  dormant: boolean;
  /** Reddit refuses it on its own: polled alone, once a day, so it can't break a group. */
  unreachable?: boolean;
};

export type PlannerOptions = {
  /** Subreddits per combined URL (check 0.2 in the plan sets the real limit). */
  maxGroupSize: number;
  /** How often each active group is polled. */
  groupIntervalSeconds: number;
  /** Dormant subreddits (no posts in 30 days) are still polled, rarely. */
  dormantIntervalSeconds: number;
  /** Site-wide search feeds that catch hiring posts in subreddits we don't list. */
  searchQueries: readonly string[];
  searchIntervalSeconds: number;
  /** Expected new posts per poll stays under this share of a page, so nothing falls off. */
  maxPostsPerPoll: number;
  unreachableIntervalSeconds: number;
  /** The request spacing: if the plan needs more requests than it allows, intervals stretch. */
  slotSeconds: number;
  /** Today's subreddit groups: kept as they are while they still fit (stable feed state). */
  current?: string[][];
};

export const DEFAULT_POSTS_PER_DAY = 5;

export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = {
  // Check 0.2 (2026-10-01): 120 subreddits in one URL worked, and Reddit skips a banned one.
  maxGroupSize: 80,
  groupIntervalSeconds: 5 * 60,
  dormantIntervalSeconds: 6 * 60 * 60,
  searchQueries: ["title:hiring", "title:task", "title:paid"],
  searchIntervalSeconds: 20 * 60,
  maxPostsPerPoll: Math.floor(PAGE_SIZE * 0.4),
  unreachableIntervalSeconds: 24 * 60 * 60,
  slotSeconds: 65,
};

const rate = (s: PlannerSubreddit) => s.postsPerDay ?? DEFAULT_POSTS_PER_DAY;

/** Longest-processing-time packing: busiest first into the least-loaded group. */
function pack(
  subs: PlannerSubreddit[],
  groups: number,
  maxSize: number,
): string[][] {
  const bins = Array.from({ length: groups }, () => ({
    load: 0,
    names: [] as string[],
  }));
  const sorted = [...subs].sort(
    (a, b) => rate(b) - rate(a) || a.name.localeCompare(b.name),
  );
  for (const s of sorted) {
    let best = -1;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i]!.names.length >= maxSize) continue;
      if (best < 0 || bins[i]!.load < bins[best]!.load) best = i;
    }
    if (best < 0) {
      bins.push({ load: 0, names: [] });
      best = bins.length - 1;
    }
    bins[best]!.load += rate(s);
    bins[best]!.names.push(s.name);
  }
  return bins.filter((b) => b.names.length > 0).map((b) => [...b.names].sort());
}

/** Requests a day a plan needs. */
export function requestsPerDay(plan: readonly FeedPlanItem[]): number {
  return plan.reduce((n, f) => n + 86_400 / f.intervalSeconds, 0);
}

/** Reuse today's groups if they still hold exactly these subreddits and each still fits. */
function keepCurrent(
  live: PlannerSubreddit[],
  current: string[][] | undefined,
  o: PlannerOptions,
): string[][] | null {
  if (!current?.length) return null;
  const byName = new Map(live.map((s) => [s.name, s]));
  const seen = new Set<string>();
  const perPollDays = o.groupIntervalSeconds / 86_400;
  for (const group of current) {
    if (group.length > o.maxGroupSize) return null;
    let load = 0;
    for (const n of group) {
      const s = byName.get(n);
      if (!s || seen.has(n)) return null;
      seen.add(n);
      load += rate(s);
    }
    if (load * perPollDays > o.maxPostsPerPoll) return null;
  }
  return seen.size === byName.size ? current.map((g) => [...g].sort()) : null;
}

export function planFeeds(
  subs: readonly PlannerSubreddit[],
  options: Partial<PlannerOptions> = {},
): FeedPlanItem[] {
  const o = { ...DEFAULT_PLANNER_OPTIONS, ...options };
  if (o.maxGroupSize < 1) throw new Error("maxGroupSize must be at least 1");
  const unique = [...new Map(subs.map((s) => [s.name, s])).values()];
  const alone = unique.filter((s) => s.unreachable);
  const live = unique.filter((s) => !s.unreachable && !s.dormant);
  const dormant = unique.filter((s) => !s.unreachable && s.dormant);
  const plan: FeedPlanItem[] = [];

  if (live.length) {
    const perPollDays = o.groupIntervalSeconds / 86_400;
    const total = live.reduce((n, s) => n + rate(s), 0);
    const groups = Math.max(
      Math.ceil(live.length / o.maxGroupSize),
      Math.ceil((total * perPollDays) / o.maxPostsPerPoll),
      1,
    );
    for (const names of keepCurrent(live, o.current, o) ??
      pack(live, groups, o.maxGroupSize))
      plan.push({
        kind: "subreddits",
        subreddits: names,
        intervalSeconds: o.groupIntervalSeconds,
      });
  }
  if (dormant.length) {
    for (const names of pack(
      dormant,
      Math.ceil(dormant.length / o.maxGroupSize),
      o.maxGroupSize,
    ))
      plan.push({
        kind: "subreddits",
        subreddits: names,
        intervalSeconds: o.dormantIntervalSeconds,
      });
  }
  for (const s of [...alone].sort((a, b) => a.name.localeCompare(b.name)))
    plan.push({
      kind: "subreddits",
      subreddits: [s.name],
      intervalSeconds: o.unreachableIntervalSeconds,
    });
  for (const query of o.searchQueries)
    plan.push({
      kind: "search",
      query,
      intervalSeconds: o.searchIntervalSeconds,
    });

  // More requests than the spacing allows: stretch every interval evenly (with 5% headroom),
  // rather than let the most overdue feeds fall further and further behind.
  const capacity = (86_400 / o.slotSeconds) * 0.95;
  const need = requestsPerDay(plan);
  if (need > capacity) {
    const k = need / capacity;
    for (const f of plan) f.intervalSeconds = Math.ceil(f.intervalSeconds * k);
  }
  return plan;
}
