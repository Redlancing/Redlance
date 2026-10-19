import type { JobPost, PreKind } from "@redlance/core";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  feedPolls,
  feeds,
  jobPostAnalyses,
  jobPosts,
  llmUsage,
  subreddits,
  type Feed,
  type FeedPoll,
  type JobPostRow,
} from "./schema";

// Storage for ingestion (docs/ingestion/plan.md, Phases 2–4). Posts are saved the moment they
// are fetched; analysis claims them later, so a failed model call never loses a post.

export const JOB_POSTS_CHANNEL = "job_posts";
/** NOTIFY channel: a post finished analysis and waits for the matcher. */
export const POST_ANALYSED_CHANNEL = "post_analysed";
export const MAX_ANALYSIS_ATTEMPTS = 3;

export type NewJobPost = JobPost & {
  preKind: PreKind;
  /** false = stored but never sent to the model (for-hire posts, noise from search feeds). */
  analyse: boolean;
};

const uuidList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

export type DedupeOptions = { windowHours: number; similarity: number };

/**
 * Inserts posts we haven't seen (dedupe on source + external id), marks cross-posts, and wakes
 * the analyser if anything is left to analyse. `newIds` are the external ids of every new row;
 * `duplicateIds` is the subset marked as copies of an earlier post (see `markDuplicates`).
 * Without `opts.dedupe` nothing is marked.
 */
export async function saveJobPosts(
  db: Database,
  posts: NewJobPost[],
  feedId: string | null,
  opts: { dedupe?: DedupeOptions } = {},
): Promise<{ newIds: string[]; duplicateIds: string[] }> {
  if (posts.length === 0) return { newIds: [], duplicateIds: [] };
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(jobPosts)
      .values(
        posts.map((p) => ({
          source: p.source,
          externalId: p.externalId,
          fetchedVia: p.fetchedVia,
          community: p.community,
          url: p.url,
          title: p.title,
          body: p.body,
          author: p.author,
          postedAt: p.postedAt,
          sourceUpdatedAt: p.sourceUpdatedAt,
          firstSeenFeedId: feedId,
          preKind: p.preKind,
          analysisStatus: p.analyse
            ? ("pending" as const)
            : ("skipped" as const),
        })),
      )
      .onConflictDoNothing({ target: [jobPosts.source, jobPosts.externalId] })
      .returning({
        id: jobPosts.id,
        externalId: jobPosts.externalId,
        status: jobPosts.analysisStatus,
      });
    const dupes = new Set(
      opts.dedupe
        ? await markDuplicates(
            tx,
            rows.map((r) => r.id),
            opts.dedupe,
          )
        : [],
    );
    if (rows.some((r) => r.status === "pending" && !dupes.has(r.id)))
      await tx.execute(sql`select pg_notify(${JOB_POSTS_CHANNEL}, '')`);
    return {
      newIds: rows.map((r) => r.externalId),
      duplicateIds: rows
        .filter((r) => dupes.has(r.id))
        .map((r) => r.externalId),
    };
  });
}

/** Titles must be at least this similar (after `normalizeTitle`) for a post to be a copy. */
export const DEDUPE_TITLE_SIMILARITY = 0.9;

/** Lower-case, NFKC, drop emoji and symbols except letters, digits and `$£€₹.`, collapse spaces. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$£€₹.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The numbers in a title, commas removed, sorted (so order does not matter). */
function numberTokens(title: string): string {
  const found = title.normalize("NFKC").match(/\d+(?:[.,]\d+)?/g) ?? [];
  return found
    .map((n) => n.replace(/,/g, ""))
    .sort()
    .join("|");
}

/**
 * Marks which of the given posts are copies of an earlier-stored post by the same author
 * (cross-posts). Strict rule, all of: same non-null author; posted within `windowHours` either
 * way (feed groups can store the later copy first); the original is analysable (not a `skipped`
 * row that was never going to be analysed) and is not itself a copy; normalised titles at least
 * `DEDUPE_TITLE_SIMILARITY` similar (pg_trgm); every number in the title matches; bodies: both
 * filled -> `similarity(left(body, 2000))` at least `similarity`, both empty -> titles identical,
 * one empty -> never a copy. The original is the one stored first (`first_seen_at`, then id).
 * Rows are handled in the order given, and each only picks an original that is not a copy, so
 * chains cannot form. A copy gets `duplicate_of`, status `skipped` and error `DUPLICATE`.
 * Returns the ids marked. Run it inside the insert's transaction.
 */
export async function markDuplicates(
  db: Pick<Database, "execute">,
  ids: string[],
  { windowHours, similarity }: DedupeOptions,
): Promise<string[]> {
  const marked: string[] = [];
  for (const [i, id] of ids.entries()) {
    const res = await db.execute<{
      id: string;
      title: string;
      body: string;
      p_title: string;
      p_body: string;
    }>(sql`
      select o.id, o.title, o.body, p.title as p_title, p.body as p_body
      from job_posts p
      join job_posts o on o.author = p.author
        and o.id <> p.id
        and o.duplicate_of is null
        and o.analysis_status <> 'skipped'
        and o.posted_at between p.posted_at - make_interval(hours => ${windowHours})
                            and p.posted_at + make_interval(hours => ${windowHours})
        and (o.first_seen_at < p.first_seen_at
          or (o.first_seen_at = p.first_seen_at and o.id < p.id
              and o.id not in (${uuidList(ids)}))
          ${i > 0 ? sql`or o.id in (${uuidList(ids.slice(0, i))})` : sql``})
      where p.id = ${id}::uuid and p.author is not null
      order by o.first_seen_at, o.id`);
    if (res.rows.length === 0) continue;
    const pTitle = normalizeTitle(res.rows[0]!.p_title);
    const pNumbers = numberTokens(res.rows[0]!.p_title);
    const pBody = res.rows[0]!.p_body.trim();
    const cands = res.rows.filter((o) => {
      const oTitle = normalizeTitle(o.title);
      const oBody = o.body.trim();
      if (numberTokens(o.title) !== pNumbers) return false;
      if ((oBody === "") !== (pBody === "")) return false;
      return oBody !== "" || oTitle === pTitle;
    });
    if (cands.length === 0) continue;
    // Similarity is computed by the database (pg_trgm) over the exact normalised strings.
    const pairs = sql.join(
      cands.map(
        (o, n) =>
          sql`(${n}::int, ${normalizeTitle(o.title)}::text, ${o.body.trim().slice(0, 2000)}::text)`,
      ),
      sql`, `,
    );
    const sims = await db.execute<{ n: number; t: number; b: number }>(sql`
      select v.n, similarity(v.t, ${pTitle}::text) as t,
             similarity(v.b, ${pBody.slice(0, 2000)}::text) as b
      from (values ${pairs}) as v(n, t, b)`);
    const ok = new Set(
      sims.rows
        .filter(
          (r) =>
            r.t >= DEDUPE_TITLE_SIMILARITY &&
            (pBody === "" || r.b >= similarity),
        )
        .map((r) => Number(r.n)),
    );
    const original = cands.find((_, n) => ok.has(n));
    if (!original) continue;
    await db.execute(sql`
      update job_posts set duplicate_of = ${original.id}::uuid,
        analysis_status = 'skipped', analysis_error = 'DUPLICATE'
      where id = ${id}::uuid`);
    marked.push(id);
  }
  return marked;
}

/** The communities each original was also posted in (its copies'), distinct and sorted. */
export async function duplicateCommunities(
  db: Pick<Database, "execute">,
  originalIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (originalIds.length === 0) return out;
  const res = await db.execute<{ original: string; communities: string[] }>(sql`
    select duplicate_of as original, array_agg(distinct community order by community) as communities
    from job_posts
    where duplicate_of in (${uuidList(originalIds)})
    group by duplicate_of`);
  for (const r of res.rows) out.set(r.original, r.communities);
  return out;
}

// ---- Feeds ----

export type FeedPlanItem =
  | { kind: "subreddits"; subreddits: string[]; intervalSeconds: number }
  | { kind: "search"; query: string; intervalSeconds: number };

const feedKey = (f: {
  kind: string;
  subreddits?: string[] | null;
  query?: string | null;
}) =>
  f.kind === "subreddits"
    ? `subreddits|${[...(f.subreddits ?? [])].sort().join(",")}`
    : `search|${f.query}`;

/**
 * Makes the active feeds match the plan: unchanged feeds keep their state (last poll, catch-up),
 * new ones start due now, and feeds no longer planned are retired (kept for feed_polls history).
 */
export async function applyFeedPlan(
  db: Database,
  plan: FeedPlanItem[],
): Promise<{ kept: number; added: number; retired: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('redlance:feeds'))`,
    );
    const current = await tx
      .select()
      .from(feeds)
      .where(eq(feeds.status, "active"));
    const byKey = new Map(current.map((f) => [feedKey(f), f]));
    const planned = new Set<string>();
    let kept = 0;
    let added = 0;
    for (const item of plan) {
      const key = feedKey(item);
      if (planned.has(key)) continue;
      planned.add(key);
      const existing = byKey.get(key);
      if (existing) {
        kept++;
        await tx
          .update(feeds)
          .set({
            intervalSeconds: item.intervalSeconds,
            // A shorter interval takes effect now, not after the old one runs out.
            nextPollAt: sql`least(${feeds.nextPollAt}, coalesce(${feeds.lastPolledAt}, now()) + make_interval(secs => ${item.intervalSeconds}))`,
          })
          .where(eq(feeds.id, existing.id));
      } else {
        added++;
        await tx.insert(feeds).values(
          item.kind === "subreddits"
            ? {
                kind: "subreddits",
                subreddits: [...item.subreddits].sort(),
                intervalSeconds: item.intervalSeconds,
              }
            : {
                kind: "search",
                query: item.query,
                intervalSeconds: item.intervalSeconds,
              },
        );
      }
    }
    const stale = current.filter((f) => !planned.has(feedKey(f)));
    for (const f of stale)
      await tx
        .update(feeds)
        .set({ status: "retired" })
        .where(eq(feeds.id, f.id));
    return { kept, added, retired: stale.length };
  });
}

export async function activeFeeds(db: Database): Promise<Feed[]> {
  return db
    .select()
    .from(feeds)
    .where(eq(feeds.status, "active"))
    .orderBy(asc(feeds.nextPollAt));
}

/**
 * The feed to poll next: the most overdue one, or with `catchUp` the most overdue feed that is
 * paging back through a gap. Returns it even if it isn't due yet; the caller waits.
 */
export async function nextFeed(
  db: Database,
  opts: { catchUp: boolean },
): Promise<Feed | null> {
  const [row] = await db
    .select()
    .from(feeds)
    .where(
      opts.catchUp
        ? and(eq(feeds.status, "active"), gt(feeds.catchUpPagesLeft, 0))
        : eq(feeds.status, "active"),
    )
    .orderBy(asc(feeds.nextPollAt))
    .limit(1);
  return row ?? null;
}

export type PollRecord = {
  startedAt: Date;
  durationMs: number;
  httpStatus: number | null;
  entries: number;
  newPosts: number;
  page: number;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
  errorCode: string | null;
};

export type FeedUpdate = {
  /** A successful first-page poll: moves the feed's and its subreddits' last-polled time. */
  polled: boolean;
  nextPollAt: Date;
  consecutiveErrors: number;
  catchUpAfter: string | null;
  catchUpPagesLeft: number;
  catchUpUntil: Date | null;
  /** The feed's subreddits (subreddit feeds only): their last_polled_at moves on success. */
  subreddits?: string[] | null;
};

/** Logs the request and moves the feed's schedule and catch-up state, in one transaction. */
export async function recordFeedPoll(
  db: Database,
  feedId: string | null,
  poll: PollRecord,
  update: FeedUpdate | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(feedPolls).values({ feedId, ...poll });
    if (!feedId || !update) return;
    await tx
      .update(feeds)
      .set({
        ...(update.polled ? { lastPolledAt: poll.startedAt } : {}),
        nextPollAt: update.nextPollAt,
        consecutiveErrors: update.consecutiveErrors,
        catchUpAfter: update.catchUpAfter,
        catchUpPagesLeft: update.catchUpPagesLeft,
        catchUpUntil: update.catchUpUntil,
      })
      .where(eq(feeds.id, feedId));
    if (update.polled && update.subreddits?.length)
      await tx
        .update(subreddits)
        .set({
          lastPolledAt: poll.startedAt,
          unreachableSince: null,
          unreachableReason: null,
        })
        .where(inArray(subreddits.name, update.subreddits));
  });
}

/**
 * When these subreddits were last covered by a successful poll (the oldest of them, ignoring
 * ones never polled). Gap detection compares a page's oldest post with this, so it survives
 * feeds being re-planned. Null when none has been polled.
 */
export async function subredditsLastPolledAt(
  db: Database,
  names: string[],
): Promise<Date | null> {
  if (names.length === 0) return null;
  const [row] = await db
    .select({ at: sql<Date | null>`min(${subreddits.lastPolledAt})` })
    .from(subreddits)
    .where(inArray(subreddits.name, names));
  return row?.at ? new Date(row.at) : null;
}

/** The latest requests, newest first: seeds the request governor after a restart. */
export async function recentFeedPolls(
  db: Database,
  limit = 10,
): Promise<FeedPoll[]> {
  return db
    .select()
    .from(feedPolls)
    .orderBy(desc(feedPolls.startedAt))
    .limit(limit);
}

/**
 * Replaces a failing combined feed with its two halves (due now), to find the subreddit that
 * makes Reddit refuse the whole URL. Returns the new feeds' ids.
 */
export async function splitFeed(db: Database, feed: Feed): Promise<string[]> {
  const names = [...(feed.subreddits ?? [])].sort();
  if (feed.kind !== "subreddits" || names.length < 2) return [];
  const half = Math.ceil(names.length / 2);
  return db.transaction(async (tx) => {
    const retired = await tx
      .update(feeds)
      .set({ status: "retired" })
      .where(and(eq(feeds.id, feed.id), eq(feeds.status, "active")))
      .returning({ id: feeds.id });
    if (retired.length === 0) return [];
    const rows = await tx
      .insert(feeds)
      .values(
        [names.slice(0, half), names.slice(half)].map((part) => ({
          kind: "subreddits" as const,
          subreddits: part,
          intervalSeconds: feed.intervalSeconds,
        })),
      )
      .returning({ id: feeds.id });
    return rows.map((r) => r.id);
  });
}

/** A subreddit Reddit refuses on its own: the planner polls it alone, once a day, until it answers. */
export async function markSubredditUnreachable(
  db: Database,
  name: string,
  reason: string,
): Promise<void> {
  await db
    .update(subreddits)
    .set({
      unreachableSince: sql`coalesce(${subreddits.unreachableSince}, now())`,
      unreachableReason: reason,
    })
    .where(eq(subreddits.name, name));
}

// ---- Analysis queue ----

/** Takes up to `limit` due posts, newest first. SKIP LOCKED lets several workers share the queue. */
export async function claimPostsForAnalysis(
  db: Database,
  limit: number,
): Promise<JobPostRow[]> {
  const res = await db.execute<{ id: string }>(sql`
    update job_posts set
      analysis_status = 'running',
      analysis_attempts = analysis_attempts + 1,
      analysis_locked_at = now()
    where id in (
      select id from job_posts
      where analysis_status = 'pending' and analysis_run_after <= now()
      order by posted_at desc
      limit ${limit}
      for update skip locked)
    returning id`);
  const ids = res.rows.map((r) => r.id);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(jobPosts)
    .where(inArray(jobPosts.id, ids))
    .orderBy(sql`${jobPosts.postedAt} desc`);
}

// Writes are fenced on the claim that owns the post (running + attempts), like import jobs.
const ownedPost = (id: string, claimAttempts: number) =>
  and(
    eq(jobPosts.id, id),
    eq(jobPosts.analysisStatus, "running"),
    eq(jobPosts.analysisAttempts, claimAttempts),
  );

export type NewPostAnalysis = Omit<
  typeof jobPostAnalyses.$inferInsert,
  "jobPostId" | "createdAt"
>;

/**
 * Saves the analysis (replacing an older one), marks the post done and hands it to the matcher:
 * match_status `pending` (plus NOTIFY post_analysed) for a freelance hiring original, or for any
 * post that still has live (new or seen) matches, so the matcher can refresh or withdraw them;
 * else `skipped`. A re-analysis queues it again; matching upserts, so that's safe. match_attempts is
 * left alone so matcher claims stay fenced. False if the claim was lost.
 */
export async function completePostAnalysis(
  db: Database,
  id: string,
  claimAttempts: number,
  analysis: NewPostAnalysis,
): Promise<boolean> {
  const matchable =
    analysis.kind === "hiring" && analysis.employmentType !== "full_time";
  return db.transaction(async (tx) => {
    const done = await tx
      .update(jobPosts)
      .set({
        analysisStatus: "done",
        analysisLockedAt: null,
        analysisError: null,
        // Pending also when the post already has live matches, even if it no longer qualifies
        // (re-analysed as for-hire or full-time, or since marked a duplicate): the matcher then
        // withdraws them.
        matchStatus: sql`case
          when ${matchable} and ${jobPosts.duplicateOf} is null then 'pending'
          when exists (
            select 1 from matches m
            where m.job_post_id = ${jobPosts.id}
              and m.withdrawn_at is null and m.status in ('new', 'seen')) then 'pending'
          else 'skipped' end`,
        matchLockedAt: null,
      })
      .where(ownedPost(id, claimAttempts))
      .returning({ id: jobPosts.id, matchStatus: jobPosts.matchStatus });
    if (done.length === 0) return false;
    if (done[0]!.matchStatus === "pending")
      await tx.execute(sql`select pg_notify(${POST_ANALYSED_CHANNEL}, '')`);
    await tx
      .insert(jobPostAnalyses)
      .values({ jobPostId: id, ...analysis })
      .onConflictDoUpdate({
        target: jobPostAnalyses.jobPostId,
        set: { ...analysis, createdAt: sql`now()` },
      });
    return true;
  });
}

/**
 * Retryable failures go back with backoff (30 s, 60 s, … with jitter); the rest fail for good.
 * `countAttempt: false` (provider outages) gives the attempt back, so an outage never uses up
 * a post's tries.
 */
export async function failPostAnalysis(
  db: Database,
  id: string,
  claimAttempts: number,
  fail: { errorCode: string; retryable: boolean; countAttempt?: boolean },
): Promise<"requeued" | "failed" | "lost"> {
  const giveBack = fail.retryable && fail.countAttempt === false;
  const retry = sql`(${fail.retryable} and (${giveBack} or analysis_attempts < ${MAX_ANALYSIS_ATTEMPTS}))`;
  const res = await db.execute<{ status: string }>(sql`
    update job_posts set
      analysis_status = case when ${retry} then 'pending' else 'failed' end,
      analysis_attempts = case when ${giveBack} then greatest(analysis_attempts - 1, 0) else analysis_attempts end,
      analysis_locked_at = null,
      analysis_error = ${fail.errorCode},
      analysis_run_after = case when ${retry}
        then now() + make_interval(secs => 30 * power(2, greatest(analysis_attempts - 1, 0)) * (0.8 + random() * 0.4))
        else analysis_run_after end
    where id = ${id} and analysis_status = 'running' and analysis_attempts = ${claimAttempts}
    returning analysis_status as status`);
  const status = res.rows[0]?.status;
  if (!status) return "lost";
  return status === "pending" ? "requeued" : "failed";
}

/** Rescues posts whose worker died mid-analysis. */
export async function requeueStalePostAnalyses(
  db: Database,
  olderThanMs = 120_000,
): Promise<number> {
  const res = await db.execute(sql`
    update job_posts set
      analysis_status = case when analysis_attempts < ${MAX_ANALYSIS_ATTEMPTS} then 'pending' else 'failed' end,
      analysis_error = case when analysis_attempts < ${MAX_ANALYSIS_ATTEMPTS} then analysis_error else 'TIMEOUT' end,
      analysis_locked_at = null
    where analysis_status = 'running'
      and analysis_locked_at < now() - make_interval(secs => ${olderThanMs / 1000})`);
  return res.rowCount ?? 0;
}

/** Posts that were stored without analysis (or failed) get another go, e.g. after a prompt change. */
export async function requeuePostsForAnalysis(
  db: Database,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await db.execute(sql`
    update job_posts set analysis_status = 'pending', analysis_attempts = 0,
      analysis_run_after = now(), analysis_error = null
    where id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}) and analysis_status <> 'running'`);
  await db.execute(sql`select pg_notify(${JOB_POSTS_CHANNEL}, '')`);
  return res.rowCount ?? 0;
}

/** Puts recently failed posts back when the failure wasn't the post's fault (upkeep). */
export async function requeueRetryableFailures(
  db: Database,
  codes: readonly string[],
  sinceDays = 7,
): Promise<number> {
  if (codes.length === 0) return 0;
  const res = await db.execute(sql`
    update job_posts set analysis_status = 'pending', analysis_attempts = 0,
      analysis_run_after = now(), analysis_error = null
    where analysis_status = 'failed'
      and analysis_error in (${sql.join(
        codes.map((c) => sql`${c}`),
        sql`, `,
      )})
      and first_seen_at > now() - make_interval(days => ${sinceDays})`);
  return res.rowCount ?? 0;
}

/** Re-analyses recent posts done by an older pipeline version (after a prompt change). */
export async function requeueOutdatedAnalyses(
  db: Database,
  pipelineVersion: string,
  sinceDays = 3,
): Promise<number> {
  const res = await db.execute(sql`
    update job_posts p set analysis_status = 'pending', analysis_attempts = 0,
      analysis_run_after = now(), analysis_error = null
    from job_post_analyses a
    where a.job_post_id = p.id and p.analysis_status = 'done'
      and a.pipeline_version <> ${pipelineVersion}
      and p.first_seen_at > now() - make_interval(days => ${sinceDays})`);
  return res.rowCount ?? 0;
}

/** Model spend since a moment, in micro-dollars, for one task (the daily budget guard). */
export async function llmCostSince(
  db: Database,
  since: Date,
  task: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${llmUsage.costMicros}), 0)` })
    .from(llmUsage)
    .where(and(eq(llmUsage.task, task), gt(llmUsage.createdAt, since)));
  return Number(row?.total ?? 0);
}

// ---- Nightly upkeep ----

/**
 * Recomputes each active subreddit's volume from our own posts: posts per day and hiring share
 * over the last 7 days (or since ingestion started, if sooner; the study's numbers stay until
 * there are 3 days), and the newest post. A subreddit turns dormant when it has had no post for
 * 30 days (counting from when it joined the catalogue) while we were polling it; any post clears it.
 */
export async function refreshSubredditStats(db: Database): Promise<number> {
  const res = await db.execute(sql`
    with started as (
      select min(first_seen_at) as at from job_posts
      where first_seen_at > now() - interval '30 days'
    ),
    win as (
      select greatest(extract(epoch from (now() - greatest(started.at, now() - interval '7 days'))) / 86400, 1.0 / 24) as days,
             greatest(started.at, now() - interval '7 days') as since
      from started where started.at is not null
    ),
    st as (
      select p.community,
             count(*) filter (where p.posted_at >= win.since) as n,
             count(*) filter (where p.posted_at >= win.since
                              and coalesce(a.kind = 'hiring', p.pre_kind = 'hiring')) as h,
             max(p.posted_at) as last
      from job_posts p
      left join job_post_analyses a on a.job_post_id = p.id
      cross join win
      where p.posted_at > now() - interval '30 days'
      group by p.community
    )
    update subreddits s set
      posts_per_day = case when win.days >= 3 then coalesce(st.n, 0) / win.days else s.posts_per_day end,
      hiring_share = case when win.days >= 3 and coalesce(st.n, 0) > 0 then st.h::real / st.n else s.hiring_share end,
      last_post_at = greatest(st.last, s.last_post_at),
      stats_at = now(),
      dormant_since = case
        when greatest(st.last, s.last_post_at) >= now() - interval '30 days' then null
        when s.dormant_since is not null then s.dormant_since
        when coalesce(greatest(st.last, s.last_post_at), s.created_at) < now() - interval '30 days'
             and s.last_polled_at > now() - interval '2 days' then now()
        else null end
    from win, subreddits s2
    left join st on st.community = s2.name
    where s.name = s2.name and s2.status = 'active'`);
  return res.rowCount ?? 0;
}

export async function pruneFeedPolls(
  db: Database,
  olderThanDays = 30,
): Promise<number> {
  const res = await db.execute(sql`
    delete from feed_polls where started_at < now() - make_interval(days => ${olderThanDays})`);
  return res.rowCount ?? 0;
}

/**
 * Subreddits outside the catalogue that the search feeds keep finding hiring posts in: the
 * weekly discovery report. Review these and add the good ones to the catalogue.
 */
export async function uncataloguedCommunities(
  db: Database,
  sinceDays = 7,
  limit = 50,
): Promise<{ community: string; posts: number; hiring: number }[]> {
  const res = await db.execute<{
    community: string;
    posts: string;
    hiring: string;
  }>(sql`
    select p.community, count(*) as posts,
           count(*) filter (where coalesce(a.kind = 'hiring', p.pre_kind = 'hiring')) as hiring
    from job_posts p
    left join job_post_analyses a on a.job_post_id = p.id
    where p.first_seen_at > now() - make_interval(days => ${sinceDays})
      and not exists (select 1 from subreddits s where s.name = p.community)
    group by p.community
    order by hiring desc, posts desc
    limit ${limit}`);
  return res.rows.map((r) => ({
    community: r.community,
    posts: Number(r.posts),
    hiring: Number(r.hiring),
  }));
}
