import {
  BEST_MIN_SCORE,
  INSIGHT_SUBREDDITS_DAYS,
  INSIGHT_WINDOW_DAYS,
  REPEAT_LOOKBACK_DAYS,
} from "@redlance/core";
import { asc, inArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { feedPage, type FeedItem } from "./matches";
import { subredditInsights } from "./schema";

// Storage for subreddit insights (docs/insights/design.md): the hourly refresh that fills
// subreddit_insights, and the readers the web API uses. Raw counts only; the 20-data-point
// rule (rule 8) and the wording are applied by the reader, so they can change without a
// recompute.

type Executor = Pick<Database, "execute">;

/** Arbitrary key for the refresh's advisory lock ("insights" in ASCII hex-ish); no other code uses it. */
export const INSIGHTS_REFRESH_LOCK_KEY = 0x1a51_6875;

export type SubredditInsightsRow = typeof subredditInsights.$inferSelect;

/**
 * Recomputes every subreddit's insights in one statement and replaces the table's rows;
 * rows for subreddits with no post in the last 2 windows are deleted. `now` is a parameter so
 * tests can pin the windows: this window is [now - 28 d, now), the previous one the 28 days before.
 *
 * Counting rules (pinned by tests):
 * - a hiring post is a post whose analysis says `kind = 'hiring'`; a cross-post copy counts in
 *   its own subreddit and uses its original's analysis (analyses exist only for originals);
 * - "for hire" posts count by `coalesce(analysis kind, pre_kind)`, so ones skipped before
 *   analysis still count; `other` posts count nowhere;
 * - a post's budget is the midpoint of min and max, or the one value given; zero is no value;
 *   percentiles are per (currency, unit), never converted;
 * - history_start is when collection started (earliest first_seen_at, not the oldest posted_at:
 *   first-page polls store old posts), so trends and repeat clients wait for real history;
 * - repeat client: the same author has an earlier hiring post (not another copy of this gig)
 *   in any subreddit in the 180 days before; known authors exclude null and `[deleted]`.
 */
export async function refreshSubredditInsights(
  db: Pick<Database, "transaction">,
  now: Date = new Date(),
): Promise<{ upserted: number; deleted: number; skipped: boolean }> {
  // The hourly worker refresh and the `insights:refresh` CLI could otherwise run together
  // (and upsert/delete over each other). The lock lives until the transaction ends.
  return db.transaction(async (tx) => {
    const got = await tx.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(${INSIGHTS_REFRESH_LOCK_KEY}) as ok`,
    );
    if (!got.rows[0]?.ok) return { upserted: 0, deleted: 0, skipped: true };
    return { ...(await recompute(tx, now)), skipped: false };
  });
}

async function recompute(
  db: Executor,
  now: Date,
): Promise<{ upserted: number; deleted: number }> {
  const win = INSIGHT_WINDOW_DAYS;
  const res = await db.execute<{ upserted: number; deleted: number }>(sql`
    with bounds as (
      select ${now.toISOString()}::timestamptz as at,
             ${now.toISOString()}::timestamptz - make_interval(days => ${win}) as w0,
             ${now.toISOString()}::timestamptz - make_interval(days => ${win * 2}) as p0),
    posts as (
      select p.id, coalesce(p.duplicate_of, p.id) as root, p.community, p.posted_at, p.author,
             p.pre_kind, a.kind, a.pay_type, a.remote, a.skill_ids, a.red_flags,
             a.currency, a.budget_unit,
             case when a.budget_min > 0 and a.budget_max > 0 then (a.budget_min + a.budget_max) / 2
                  when a.budget_max > 0 then a.budget_max
                  when a.budget_min > 0 then a.budget_min end as budget,
             p.posted_at >= b.w0 as in_win
      from job_posts p
      cross join bounds b
      left join job_post_analyses a on a.job_post_id = coalesce(p.duplicate_of, p.id)
      where p.posted_at >= b.p0 and p.posted_at < b.at
        and p.community ~ '^[a-z0-9_]{2,21}$'),
    hiring as (select * from posts where kind = 'hiring' and in_win),
    base as (
      select community,
             count(*) filter (where kind = 'hiring' and in_win)::int as hiring_posts,
             count(*) filter (where kind = 'hiring' and not in_win)::int as hiring_posts_prev,
             count(*) filter (where in_win and coalesce(kind, pre_kind) = 'for_hire')::int as for_hire_posts,
             count(*) filter (where kind = 'hiring' and in_win and budget is not null)::int as budget_stated,
             count(*) filter (where kind = 'hiring' and in_win and cardinality(red_flags) > 0)::int as red_flag_posts,
             count(*) filter (where kind = 'hiring' and in_win
                              and author is not null and lower(author) <> '[deleted]')::int as known_author_posts
      from posts group by community),
    pay as (
      select community, jsonb_object_agg(pay_type, n) as j from (
        select community, pay_type, count(*)::int as n from hiring group by 1, 2) x
      group by community),
    remote as (
      select community, jsonb_object_agg(remote, n) as j from (
        select community, remote, count(*)::int as n from hiring group by 1, 2) x
      group by community),
    flags as (
      select community, jsonb_object_agg(flag, n) as j from (
        select community, flag, count(*)::int as n
        from hiring, unnest(red_flags) as flag group by 1, 2) x
      group by community),
    skills as (
      select community, jsonb_agg(jsonb_build_object('skillId', skill, 'n', n) order by n desc, skill) as j
      from (
        select community, skill, n, row_number() over (partition by community order by n desc, skill) as rn
        from (select community, skill, count(distinct id)::int as n
              from hiring, unnest(skill_ids) as skill group by 1, 2) c) r
      where rn <= 20 group by community),
    budgets as (
      select community, jsonb_agg(jsonb_build_object(
          'currency', currency, 'unit', budget_unit, 'n', n, 'p25', p25, 'median', median, 'p75', p75)
        order by n desc, currency, budget_unit) as j
      from (
        select *, row_number() over (partition by community order by n desc, currency, budget_unit) as rn
        from (select community, currency, budget_unit, count(*)::int as n,
                     round((percentile_cont(0.25) within group (order by budget::float8))::numeric, 2) as p25,
                     round((percentile_cont(0.5) within group (order by budget::float8))::numeric, 2) as median,
                     round((percentile_cont(0.75) within group (order by budget::float8))::numeric, 2) as p75
              from hiring
              where budget is not null and currency is not null and budget_unit is not null
              group by 1, 2, 3) g) r
      where rn <= 6 group by community),
    slotn as (
      select community, slot, count(*)::int as n from (
        select community,
               (extract(isodow from posted_at at time zone 'UTC')::int - 1) * 48
               + extract(hour from posted_at at time zone 'UTC')::int * 2
               + extract(minute from posted_at at time zone 'UTC')::int / 30 as slot
        from hiring) x
      group by 1, 2),
    hours as (
      select b.community, array_agg(coalesce(s.n, 0) order by g.slot) as slots
      from base b
      cross join generate_series(0, 335) as g(slot)
      left join slotn s on s.community = b.community and s.slot = g.slot
      group by b.community),
    repeats as (
      select h.community, count(*)::int as n
      from hiring h
      where h.author is not null and lower(h.author) <> '[deleted]'
        and exists (
          select 1 from job_posts e
          join job_post_analyses ea on ea.job_post_id = coalesce(e.duplicate_of, e.id)
          where e.author = h.author
            and e.posted_at < h.posted_at
            and e.posted_at >= h.posted_at - make_interval(days => ${REPEAT_LOOKBACK_DAYS})
            -- redundant bounds that let the planner use the posted_at index instead of scanning all history
            and e.posted_at >= (select p0 from bounds) - make_interval(days => ${REPEAT_LOOKBACK_DAYS})
            and e.posted_at < (select at from bounds)
            and ea.kind = 'hiring'
            and coalesce(e.duplicate_of, e.id) <> h.root)
      group by h.community),
    up as (
      insert into subreddit_insights as si (
        subreddit, computed_at, window_start, hiring_posts, hiring_posts_prev, for_hire_posts,
        budget_stated, pay_counts, remote_counts, red_flag_posts, red_flag_counts, skill_counts,
        budgets, hour_slots, known_author_posts, repeat_author_posts, history_start)
      select b.community, bd.at, bd.w0, b.hiring_posts, b.hiring_posts_prev, b.for_hire_posts,
             b.budget_stated, coalesce(pay.j, '{}'), coalesce(remote.j, '{}'), b.red_flag_posts,
             coalesce(flags.j, '{}'), coalesce(skills.j, '[]'), coalesce(budgets.j, '[]'),
             hours.slots, b.known_author_posts, coalesce(repeats.n, 0),
             (select min(first_seen_at) from job_posts)
      from base b
      cross join bounds bd
      join hours on hours.community = b.community
      left join pay on pay.community = b.community
      left join remote on remote.community = b.community
      left join flags on flags.community = b.community
      left join skills on skills.community = b.community
      left join budgets on budgets.community = b.community
      left join repeats on repeats.community = b.community
      on conflict (subreddit) do update set
        computed_at = excluded.computed_at, window_start = excluded.window_start,
        hiring_posts = excluded.hiring_posts, hiring_posts_prev = excluded.hiring_posts_prev,
        for_hire_posts = excluded.for_hire_posts, budget_stated = excluded.budget_stated,
        pay_counts = excluded.pay_counts, remote_counts = excluded.remote_counts,
        red_flag_posts = excluded.red_flag_posts, red_flag_counts = excluded.red_flag_counts,
        skill_counts = excluded.skill_counts, budgets = excluded.budgets,
        hour_slots = excluded.hour_slots, known_author_posts = excluded.known_author_posts,
        repeat_author_posts = excluded.repeat_author_posts, history_start = excluded.history_start
      returning 1),
    del as (
      delete from subreddit_insights where subreddit not in (select community from base)
      returning 1)
    select (select count(*) from up)::int as upserted, (select count(*) from del)::int as deleted`);
  return res.rows[0] ?? { upserted: 0, deleted: 0 };
}

/** Insight rows, all of them or just these subreddits (lowercase names), by name. */
export async function insightRows(
  db: Database,
  subreddits?: readonly string[],
): Promise<SubredditInsightsRow[]> {
  if (subreddits && subreddits.length === 0) return [];
  const q = db.select().from(subredditInsights);
  return (
    subreddits
      ? q.where(inArray(subredditInsights.subreddit, [...subreddits]))
      : q
  ).orderBy(asc(subredditInsights.subreddit));
}

/**
 * The subreddits that gave this user a match (not withdrawn) on a post from the last 30 days,
 * most matches first. A match counts in every subreddit its post or a copy of it was posted in.
 * `bestMatches` are the ones with score ≥ BEST_MIN_SCORE.
 */
export async function userInsightSubreddits(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<{ subreddit: string; matches: number; bestMatches: number }[]> {
  const res = await db.execute<{
    community: string;
    matches: number;
    best: number;
  }>(sql`
    with mine as (
      select m.id, m.job_post_id, m.score from matches m
      where m.user_id = ${userId}
        and m.withdrawn_at is null
        and m.posted_at >= ${now.toISOString()}::timestamptz - make_interval(days => ${INSIGHT_SUBREDDITS_DAYS})
        and m.posted_at < ${now.toISOString()}::timestamptz),
    pairs as (
      select mine.id, mine.score, j.community from mine join job_posts j on j.id = mine.job_post_id
      union
      select mine.id, mine.score, d.community from mine join job_posts d on d.duplicate_of = mine.job_post_id)
    select community, count(*)::int as matches,
           (count(*) filter (where score >= ${BEST_MIN_SCORE}))::int as best
    from pairs group by community
    order by matches desc, community`);
  return res.rows.map((r) => ({
    subreddit: r.community,
    matches: r.matches,
    bestMatches: r.best,
  }));
}

/**
 * "Fits you" counts for one subreddit since a date: posts there (originals and copies) with a
 * Best match for this user, and all hiring posts there. Numerator and denominator are the same
 * posts counted by their own `posted_at`, so the first never exceeds the second.
 */
export async function userFitCounts(
  db: Executor,
  userId: string,
  subreddit: string,
  since: Date,
): Promise<{ bestMatches: number; hiringPosts: number }> {
  const res = await db.execute<{ best: number; hiring: number }>(sql`
    select count(*)::int as hiring,
           (count(*) filter (where exists (
             select 1 from matches m
             where m.user_id = ${userId} and m.job_post_id = coalesce(p.duplicate_of, p.id)
               and m.withdrawn_at is null and m.score >= ${BEST_MIN_SCORE})))::int as best
    from job_posts p
    join job_post_analyses a on a.job_post_id = coalesce(p.duplicate_of, p.id) and a.kind = 'hiring'
    where p.community = ${subreddit} and p.posted_at >= ${since.toISOString()}::timestamptz`);
  const r = res.rows[0];
  return { bestMatches: r?.best ?? 0, hiringPosts: r?.hiring ?? 0 };
}

/**
 * `userFitCounts` for many subreddits in one query, keyed by subreddit. Subreddits with no
 * hiring post come back as zeros. `since` is one date for all of them.
 */
export async function userFitCountsMany(
  db: Executor,
  userId: string,
  subreddits: readonly string[],
  since: Date,
): Promise<Map<string, { bestMatches: number; hiringPosts: number }>> {
  const out = new Map(
    subreddits.map((s) => [s, { bestMatches: 0, hiringPosts: 0 }]),
  );
  if (subreddits.length === 0) return out;
  const res = await db.execute<{
    community: string;
    best: number;
    hiring: number;
  }>(sql`
    select p.community, count(*)::int as hiring,
           (count(*) filter (where exists (
             select 1 from matches m
             where m.user_id = ${userId} and m.job_post_id = coalesce(p.duplicate_of, p.id)
               and m.withdrawn_at is null and m.score >= ${BEST_MIN_SCORE})))::int as best
    from job_posts p
    join job_post_analyses a on a.job_post_id = coalesce(p.duplicate_of, p.id) and a.kind = 'hiring'
    where p.community in (${sql.join(
      subreddits.map((s) => sql`${s}`),
      sql`, `,
    )}) and p.posted_at >= ${since.toISOString()}::timestamptz
    group by p.community`);
  for (const r of res.rows)
    out.set(r.community, { bestMatches: r.best, hiringPosts: r.hiring });
  return out;
}

/** The user's newest matches (any score, not dismissed or withdrawn) from one subreddit. */
export async function latestMatchesIn(
  db: Executor,
  userId: string,
  subreddit: string,
  limit: number,
): Promise<FeedItem[]> {
  const { items } = await feedPage(db, userId, {
    view: "all",
    community: subreddit,
    limit,
  });
  return items;
}
