import {
  BEST_MIN_SCORE,
  REMATCH_DAYS,
  scrubOrganisations,
  type AiStatus,
  type BudgetUnit,
  type EmploymentType,
  type Feature,
  type MatchPost,
  type MatchProfile,
  type MatchStatus,
  type PayType,
  type Plan,
  type PostKind,
  type RemoteType,
} from "@redlance/core";
import { sql, type SQL } from "drizzle-orm";
import type { Database } from "./client";
import { matchEvents, matches } from "./schema";

// Storage for matching (docs/matching/plan/03-database.md): the matcher's post queue, the
// candidate queries, the matches table, re-match requests, the AI re-score queue with its
// daily cap, and the feed. Queue writes are fenced to the claim that owns the row, like
// import_jobs and the analysis queue.

/** NOTIFY channel: a match is waiting for an AI re-score. */
export const MATCHES_CHANNEL = "matches";
export const MAX_MATCH_ATTEMPTS = 3;
export const MAX_RESCORE_ATTEMPTS = 3;
/** A given-back re-score (provider error, shutdown, budget pause) is due again after this, so a pair-specific error cannot hot-loop. */
export const GIVE_BACK_DELAY_MS = 5_000;
/** Claims of one re-match request before it is dropped (each failure backs off first). */
export const MAX_REMATCH_ATTEMPTS = 5;
/** A re-match claim older than this is treated as a crashed matcher's and can be claimed again. */
export const REMATCH_LEASE_MS = 5 * 60_000;

/** Anything that can run a statement: the pool's db or a transaction. */
type Executor = Pick<Database, "execute">;

// drizzle expands a JS array parameter into ($1, $2, …), so arrays are built explicitly.
const textArray = (values: readonly string[]) =>
  values.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )}]::text[]`;

/** Raw `execute` returns timestamps as strings ("2026-10-17 10:00:00.123+00"). */
const toDate = (v: unknown): Date =>
  v instanceof Date ? v : new Date(String(v));
const toDay = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v);
const toNum = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

// ---- The post queue (matcher) ----

/** Takes up to `limit` posts waiting to be matched, newest first. `claim` fences later writes. */
export async function claimPostsForMatching(
  db: Executor,
  limit: number,
): Promise<{ id: string; claim: number }[]> {
  const res = await db.execute<{
    id: string;
    match_attempts: number;
    posted_at: string;
  }>(sql`
    update job_posts set
      match_status = 'running',
      match_attempts = match_attempts + 1,
      match_locked_at = now()
    where id in (
      select id from job_posts
      where match_status = 'pending'
      order by posted_at desc
      limit ${limit}
      for update skip locked)
    returning id, match_attempts, posted_at`);
  return res.rows
    .sort(
      (a, b) => toDate(b.posted_at).getTime() - toDate(a.posted_at).getTime(),
    )
    .map((r) => ({ id: r.id, claim: r.match_attempts }));
}

/** Marks the post matched. False if the claim was lost (stale sweep, re-analysis). */
export async function completePostMatching(
  db: Executor,
  id: string,
  claim: number,
): Promise<boolean> {
  const res = await db.execute(sql`
    update job_posts set match_status = 'done', match_locked_at = null
    where id = ${id} and match_status = 'running' and match_attempts = ${claim}`);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Back to pending until MAX_MATCH_ATTEMPTS, then skipped (the caller logs the error code).
 * match_attempts is never reset, so an old claim can never match a newer one.
 */
export async function failPostMatching(
  db: Executor,
  id: string,
  claim: number,
): Promise<"requeued" | "skipped" | "lost"> {
  const res = await db.execute<{ status: string }>(sql`
    update job_posts set
      match_status = case when match_attempts < ${MAX_MATCH_ATTEMPTS} then 'pending' else 'skipped' end,
      match_locked_at = null
    where id = ${id} and match_status = 'running' and match_attempts = ${claim}
    returning match_status as status`);
  const status = res.rows[0]?.status;
  if (!status) return "lost";
  return status === "pending" ? "requeued" : "skipped";
}

/** Rescues posts whose matcher died mid-run. */
export async function requeueStalePostMatching(
  db: Executor,
  olderThanMs = 120_000,
): Promise<number> {
  const res = await db.execute(sql`
    update job_posts set
      match_status = case when match_attempts < ${MAX_MATCH_ATTEMPTS} then 'pending' else 'skipped' end,
      match_locked_at = null
    where match_status = 'running'
      and match_locked_at < now() - make_interval(secs => ${olderThanMs / 1000})`);
  return res.rowCount ?? 0;
}

// ---- Candidates ----

export type MatchPostWithId = MatchPost & {
  id: string;
  /** The analysis's created_at (to the millisecond): stored on the match as `analysed_at`. */
  analysedAt: Date;
};

type PostRow = {
  id: string;
  posted_at: string;
  analysed_at: string;
  kind: PostKind;
  employment_type: EmploymentType;
  pay_type: PayType;
  categories: string[];
  skill_ids: string[];
  budget_min: string | null;
  budget_max: string | null;
  currency: string | null;
  budget_unit: BudgetUnit | null;
  remote: RemoteType;
  deadline: string | null;
  red_flags: string[];
};

const postColumns = sql`
  j.id, j.posted_at, date_trunc('milliseconds', a.created_at) as analysed_at, a.kind, a.employment_type, a.pay_type, a.categories, a.skill_ids,
  a.budget_min, a.budget_max, a.currency, a.budget_unit, a.remote, a.deadline, a.red_flags`;

const toMatchPost = (r: PostRow): MatchPostWithId => ({
  id: r.id,
  postedAt: toDate(r.posted_at),
  analysedAt: toDate(r.analysed_at),
  kind: r.kind,
  employmentType: r.employment_type,
  payType: r.pay_type,
  categories: r.categories,
  skillIds: r.skill_ids,
  budgetMin: toNum(r.budget_min),
  budgetMax: toNum(r.budget_max),
  currency: r.currency,
  budgetUnit: r.budget_unit,
  remote: r.remote,
  deadline: toDay(r.deadline),
  redFlags: r.red_flags,
});

/**
 * A post with its analysis, in core's shape, plus `duplicateOf` (a post marked a duplicate
 * after it was matched must lose its matches). Null if it has no analysis.
 */
export async function loadMatchPost(
  db: Executor,
  postId: string,
): Promise<(MatchPostWithId & { duplicateOf: string | null }) | null> {
  const res = await db.execute<PostRow & { duplicate_of: string | null }>(sql`
    select ${postColumns}, j.duplicate_of
    from job_posts j join job_post_analyses a on a.job_post_id = j.id
    where j.id = ${postId}`);
  const row = res.rows[0];
  return row ? { ...toMatchPost(row), duplicateOf: row.duplicate_of } : null;
}

/** A user as the matcher sees them: plan, profile version and core's MatchProfile. */
export type MatchUser = {
  userId: string;
  plan: Plan;
  trialEndsAt: Date;
  profileVersion: number;
  profile: MatchProfile;
};
export type CandidateUser = MatchUser & {
  /** The status of this user's existing match for the post (e.g. dismissed), if any. */
  existingStatus: MatchStatus | null;
};

type UserRow = {
  user_id: string;
  plan: Plan;
  trial_ends_at: string;
  profile_version: number;
  categories: string[];
  min_rate_minor: number;
  currency: MatchProfile["currency"];
  rate_type: MatchProfile["rateType"];
  remote_only: boolean;
  include_unpaid: boolean;
  skills: MatchProfile["skills"];
  work_skill_ids: string[];
  existing_status: MatchStatus | null;
};

// One row per user, skills and work skills folded in with correlated subqueries: one query
// however many users match (no N+1).
const userColumns = sql`
  p.user_id, p.plan, p.trial_ends_at, p.profile_version, p.categories, p.min_rate_minor,
  p.currency, p.rate_type, p.remote_only, p.include_unpaid,
  coalesce((
    select json_agg(json_build_object('id', ps.skill_id, 'level', ps.level) order by ps.skill_id)
    from profile_skills ps where ps.user_id = p.user_id), '[]'::json) as skills,
  coalesce((
    select array_agg(distinct w.s order by w.s) from (
      select unnest(pp.skill_ids) as s from profile_projects pp
      where pp.user_id = p.user_id and not pp.hidden
      union all
      select unnest(pe.skill_ids) from profile_experience pe
      where pe.user_id = p.user_id and not pe.hidden) w), '{}'::text[]) as work_skill_ids`;

const toCandidate = (r: UserRow): CandidateUser => ({
  userId: r.user_id,
  plan: r.plan,
  trialEndsAt: toDate(r.trial_ends_at),
  profileVersion: r.profile_version,
  profile: {
    categories: r.categories,
    skills: r.skills,
    workSkillIds: r.work_skill_ids,
    minRateMinor: r.min_rate_minor,
    currency: r.currency,
    rateType: r.rate_type,
    remoteOnly: r.remote_only,
    includeUnpaid: r.include_unpaid,
  },
  existingStatus: r.existing_status,
});

/** An active user with a profile, for a backfill or re-match. Null otherwise. */
export async function loadMatchUser(
  db: Executor,
  userId: string,
): Promise<MatchUser | null> {
  const res = await db.execute<UserRow>(sql`
    select ${userColumns}, null as existing_status
    from profiles p join users u on u.id = p.user_id and u.status = 'active'
    where p.user_id = ${userId}`);
  const row = res.rows[0];
  if (!row) return null;
  const { existingStatus: _, ...user } = toCandidate(row);
  return user;
}

/**
 * The users a post might suit: core `isCandidate` (a shared skill, or no skills and a shared
 * job type) plus the user-level parts of `passesFilters` (remote-only vs onsite, unpaid work).
 * The post-level filters (kind, full-time, age, deadline) are the caller's: check them once
 * with core `passesFilters` before calling this. One query.
 */
export async function candidateUsersForPost(
  db: Executor,
  post: Pick<
    MatchPostWithId,
    "id" | "skillIds" | "categories" | "remote" | "payType"
  >,
): Promise<CandidateUser[]> {
  let candidate: SQL;
  if (post.skillIds.length > 0)
    candidate = sql`exists (
      select 1 from profile_skills ps
      where ps.user_id = p.user_id and ps.skill_id = any(${textArray(post.skillIds)}))`;
  else if (post.categories.length > 0)
    candidate = sql`p.categories && ${textArray(post.categories)}`;
  else return [];
  const res = await db.execute<UserRow>(sql`
    select ${userColumns}, m.status as existing_status
    from profiles p
    join users u on u.id = p.user_id and u.status = 'active'
    left join matches m on m.user_id = p.user_id and m.job_post_id = ${post.id}::uuid
    where ${candidate}
      and (not p.remote_only or ${post.remote} <> 'onsite')
      and (p.include_unpaid or ${post.payType} in ('paid', 'unknown'))
    order by p.user_id`);
  return res.rows.map(toCandidate);
}

/**
 * `candidateUsersForPost`'s candidate condition and user-level filters, for a profile `p` and an
 * analysis `a` already in the query (the reverse query and the post-side withdrawal).
 */
const candidateWhere = sql`
  (exists (
     select 1 from profile_skills ps
     where ps.user_id = p.user_id and ps.skill_id = any(a.skill_ids))
   or (cardinality(a.skill_ids) = 0 and p.categories && a.categories))
  and (not p.remote_only or a.remote <> 'onsite')
  and (p.include_unpaid or a.pay_type in ('paid', 'unknown'))`;

/**
 * The reverse direction, for backfill and re-match: one user's candidate posts since `since`,
 * newest first. Originals only, analysed as freelance hiring, matchable (`match_status` done,
 * pending or running: upserts are idempotent, so racing the post's own matcher is harmless),
 * with the same candidate condition and user-level filters as `candidateUsersForPost`. Age and
 * deadline stay with core `passesFilters`.
 *
 * Driven by job_posts_posted_idx: each post in the window looks up its analysis by primary key
 * (the `offset 0` keeps the lateral subquery from being flattened into a hash join that scans
 * every analysis), so the cost follows the window, not the table.
 */
export async function candidatePostsForUser(
  db: Executor,
  userId: string,
  since: Date,
): Promise<MatchPostWithId[]> {
  const res = await db.execute<PostRow>(sql`
    select ${postColumns}
    from profiles p
    join users u on u.id = p.user_id and u.status = 'active'
    join job_posts j on j.posted_at >= ${since}
      and j.match_status in ('done', 'pending', 'running')
      and j.duplicate_of is null
    cross join lateral (
      select * from job_post_analyses a0 where a0.job_post_id = j.id offset 0) a
    where p.user_id = ${userId}
      and a.kind = 'hiring' and a.employment_type <> 'full_time'
      and ${candidateWhere}
    order by j.posted_at desc, j.id desc`);
  return res.rows.map(toMatchPost);
}

// ---- Matches ----

export type NewMatch = {
  userId: string;
  jobPostId: string;
  ruleScore: number;
  broad: boolean;
  features: Feature[];
  ruleReason: string;
  /** Broad matches are always stored as not_needed: they never go to AI re-scoring. */
  aiStatus: Extract<AiStatus, "not_needed" | "pending">;
  /** The user's profile_version the rule score was computed from. */
  profileVersion: number;
  /**
   * The analysis the rule score was computed from (`MatchPostWithId.analysedAt`). The matcher
   * always passes it; when omitted (test fixtures) the post's current analysis time is used.
   */
  analysedAt?: Date;
};

const UPSERT_CHUNK = 500;

/**
 * Inserts or refreshes matches. A stored row is replaced only by a strictly newer
 * (profile_version, analysed_at): the same pair again does nothing (re-runs are idempotent), and
 * an older one (a slow matcher's stale snapshot) is ignored, so neither the version nor the
 * analysis can move backwards. A newer row replaces the rule fields, resets the AI fields and
 * clears withdrawn_at. A dismissed match keeps its status and gets ai_status not_needed. Wakes the
 * re-scorer (NOTIFY matches, on commit) when a written row is pending. Returns how many rows
 * were written.
 */
export async function upsertMatches(
  db: Database,
  rows: NewMatch[],
): Promise<number> {
  if (rows.length === 0) return 0;
  return db.transaction(async (tx) => {
    let written = 0;
    let wake = false;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const res = await tx
        .insert(matches)
        .values(
          chunk.map((r) => ({
            userId: r.userId,
            jobPostId: r.jobPostId,
            postedAt: sql`(select posted_at from job_posts where id = ${r.jobPostId}::uuid)`,
            ruleScore: r.ruleScore,
            broad: r.broad,
            features: r.features,
            ruleReason: r.ruleReason,
            aiStatus: r.broad ? ("not_needed" as const) : r.aiStatus,
            score: r.ruleScore,
            profileVersion: r.profileVersion,
            analysedAt:
              r.analysedAt ??
              sql`(select date_trunc('milliseconds', created_at) from job_post_analyses where job_post_id = ${r.jobPostId}::uuid)`,
          })),
        )
        .onConflictDoUpdate({
          target: [matches.userId, matches.jobPostId],
          set: {
            ruleScore: sql`excluded.rule_score`,
            broad: sql`excluded.broad`,
            features: sql`excluded.features`,
            ruleReason: sql`excluded.rule_reason`,
            profileVersion: sql`excluded.profile_version`,
            analysedAt: sql`excluded.analysed_at`,
            withdrawnAt: null,
            score: sql`excluded.rule_score`,
            aiStatus: sql`case when ${matches.status} = 'dismissed' then 'not_needed' else excluded.ai_status end`,
            aiAttempts: 0,
            aiRunAfter: sql`now()`,
            aiLockedAt: null,
            aiError: null,
            aiScore: null,
            aiReason: null,
            aiConcerns: sql`'{}'::text[]`,
            aiModel: null,
            aiScoredAt: null,
            aiFinishedAt: null,
            // A new version pays for its own re-score (a unit the old version held stays spent).
            aiUnitDay: null,
            bestProjectId: null,
            bestRoleId: null,
            updatedAt: sql`now()`,
          },
          // A row comparison: newer means a higher version, or the same version and a later
          // analysis. Never `<>`, which would let a stale snapshot overwrite a newer one.
          setWhere: sql`(${matches.profileVersion}, ${matches.analysedAt}) < (excluded.profile_version, excluded.analysed_at)`,
        })
        .returning({ aiStatus: matches.aiStatus });
      written += res.length;
      if (res.some((r) => r.aiStatus === "pending")) wake = true;
    }
    if (wake) await tx.execute(sql`select pg_notify(${MATCHES_CHANNEL}, '')`);
    return written;
  });
}

// ---- Withdrawing matches that no longer qualify ----

// A withdrawn match leaves the feed and the AI queue: a pending re-score is cancelled (a running
// one finishes; its row stays withdrawn). Only new and seen matches are withdrawn: saved,
// replied and dismissed ones are the user's history and stay as they are. A newer upsert of the
// pair clears withdrawn_at again.
const withdrawSet = sql`
  withdrawn_at = now(),
  ai_status = case when m.ai_status = 'pending' then 'not_needed' else m.ai_status end,
  updated_at = now()`;
const withdrawable = sql`m.withdrawn_at is null and m.status in ('new', 'seen')`;

/**
 * The post side, after the matcher has (re-)matched a post from the analysis at `analysedAt`:
 * - `keepUserIds = null`: the post itself no longer qualifies (re-analysed as for-hire or
 *   full-time, marked a duplicate, too old, deadline passed), so every match is withdrawn;
 * - otherwise the matches of users outside `keepUserIds` (the rows just upserted) are
 *   withdrawn, unless the user is a candidate by the current profile and analysis (a re-match
 *   that raced this one wrote that row).
 * Rows scored from a later analysis than `analysedAt` are never touched (their matcher saw more).
 * Returns how many rows were withdrawn.
 */
export async function withdrawPostMatches(
  db: Executor,
  postId: string,
  analysedAt: Date,
  keepUserIds: string[] | null,
): Promise<number> {
  const others =
    keepUserIds === null
      ? sql`true`
      : sql`not (m.user_id = any(${textArray(keepUserIds)}::uuid[]))
        and not exists (
          select 1 from job_post_analyses a
          join profiles p on p.user_id = m.user_id
          join users u on u.id = p.user_id and u.status = 'active'
          where a.job_post_id = m.job_post_id and ${candidateWhere})`;
  const res = await db.execute(sql`
    update matches m set ${withdrawSet}
    where m.job_post_id = ${postId}::uuid and ${withdrawable}
      and m.analysed_at <= ${analysedAt}::timestamptz
      and ${others}`);
  return res.rowCount ?? 0;
}

/**
 * The user side, after a re-match over posts since `since` with `profileVersion`: the user's
 * matches in that window still on an older version weren't produced again, so they no longer
 * qualify (skills removed, remote-only turned on, …). Returns how many rows were withdrawn.
 */
export async function withdrawStaleUserMatches(
  db: Executor,
  userId: string,
  since: Date,
  profileVersion: number,
): Promise<number> {
  const res = await db.execute(sql`
    update matches m set ${withdrawSet}
    where m.user_id = ${userId}::uuid and ${withdrawable}
      and m.posted_at >= ${since}::timestamptz
      and m.profile_version < ${profileVersion}`);
  return res.rowCount ?? 0;
}

// ---- Re-match requests ----

/**
 * Asks the matcher to match this user against posts since `since` (backfill after onboarding,
 * re-match after a profile change). Requests merge: the earliest `since` wins. A new request is a
 * fresh one: it clears any claim (so a re-match already running can't complete it: it saw the
 * old profile), the backoff and the attempt count. No NOTIFY: the matcher's poll picks requests
 * up.
 */
export async function requestRematch(
  db: Executor,
  userId: string,
  since: Date,
): Promise<void> {
  await db.execute(sql`
    update profiles set
      rematch_since = least(coalesce(rematch_since, ${since}::timestamptz), ${since}::timestamptz),
      rematch_claimed_at = null,
      rematch_after = null,
      rematch_attempts = 0
    where user_id = ${userId}`);
}

/**
 * The hook for profile edits: bumps profile_version (so existing matches get re-scored) and
 * requests a re-match over the last REMATCH_DAYS. Returns the new version, or null without a
 * profile.
 */
export async function bumpProfileVersion(
  db: Database,
  userId: string,
  now: Date,
): Promise<number | null> {
  return db.transaction(async (tx) => {
    const res = await tx.execute<{ profile_version: number }>(sql`
      update profiles set profile_version = profile_version + 1, updated_at = now()
      where user_id = ${userId}
      returning profile_version`);
    const version = res.rows[0]?.profile_version;
    if (version === undefined) return null;
    await requestRematch(
      tx,
      userId,
      new Date(now.getTime() - REMATCH_DAYS * 86_400_000),
    );
    return version;
  });
}

/** A claimed re-match request. `claimedAt` is the lease that fences completeRematch / failRematch. */
export type RematchClaim = { userId: string; since: Date; claimedAt: Date };

/**
 * Leases one due re-match request. The request stays in place while it runs (a crashed matcher
 * loses nothing: the lease expires after REMATCH_LEASE_MS and the request is claimed again).
 * Due means: not backing off (`rematch_after`), not leased by a live claim, and under
 * MAX_REMATCH_ATTEMPTS claims. Oldest first (`coalesce(rematch_after, rematch_since)`), so a
 * failing request backing off doesn't block the others. Concurrent callers never get the same
 * request. Then call `completeRematch` or `failRematch` with the claim.
 */
export async function claimRematch(db: Executor): Promise<RematchClaim | null> {
  const res = await db.execute<{
    user_id: string;
    since: string;
    claimed_at: string;
  }>(sql`
    with next as (
      select user_id from profiles
      where rematch_since is not null
        and rematch_attempts < ${MAX_REMATCH_ATTEMPTS}
        and (rematch_after is null or rematch_after <= now())
        and (rematch_claimed_at is null
             or rematch_claimed_at < now() - make_interval(secs => ${REMATCH_LEASE_MS / 1000}))
      order by coalesce(rematch_after, rematch_since), user_id
      limit 1
      for update skip locked)
    update profiles p set
      -- Milliseconds, so the JS Date handed back fences the later writes exactly.
      rematch_claimed_at = date_trunc('milliseconds', now()),
      rematch_attempts = p.rematch_attempts + 1
    from next where p.user_id = next.user_id
    returning p.user_id, p.rematch_since as since, p.rematch_claimed_at as claimed_at`);
  const row = res.rows[0];
  return row
    ? {
        userId: row.user_id,
        since: toDate(row.since),
        claimedAt: toDate(row.claimed_at),
      }
    : null;
}

const ownedRematch = (claim: RematchClaim) =>
  sql`user_id = ${claim.userId}::uuid and rematch_claimed_at = ${claim.claimedAt}::timestamptz`;

/**
 * Clears the request once it's served: compare-and-clear on the claim's `since` and lease, so a
 * request made while it ran (a wider window, or any new request, which clears the lease)
 * survives for the next poll. False when it survived (or the lease was lost).
 */
export async function completeRematch(
  db: Executor,
  claim: RematchClaim,
): Promise<boolean> {
  const res = await db.execute(sql`
    update profiles set
      rematch_since = null, rematch_claimed_at = null, rematch_after = null, rematch_attempts = 0
    where ${ownedRematch(claim)} and rematch_since = ${claim.since}::timestamptz`);
  return (res.rowCount ?? 0) > 0;
}

/**
 * A re-match failed: release the lease and back off 30 s × 2^(attempts − 1) before the next
 * claim; the claim that reaches MAX_REMATCH_ATTEMPTS drops the request instead ("dropped": the
 * caller logs it as an error). `countAttempt: false` (shutdown) gives the attempt back with no
 * backoff. "lost" when the claim no longer owns the request (a new request cleared the lease).
 */
export async function failRematch(
  db: Executor,
  claim: RematchClaim,
  opts: { countAttempt?: boolean } = {},
): Promise<"retry" | "dropped" | "lost"> {
  const giveBack = opts.countAttempt === false;
  const drop = sql`(not ${giveBack} and rematch_attempts >= ${MAX_REMATCH_ATTEMPTS})`;
  const res = await db.execute<{ dropped: boolean }>(sql`
    update profiles set
      rematch_since = case when ${drop} then null else rematch_since end,
      rematch_claimed_at = null,
      rematch_after = case
        when ${drop} then null
        when ${giveBack} then rematch_after
        else now() + make_interval(secs => 30 * power(2, greatest(rematch_attempts - 1, 0)))
      end,
      rematch_attempts = case
        when ${drop} then 0
        when ${giveBack} then greatest(rematch_attempts - 1, 0)
        else rematch_attempts
      end
    where ${ownedRematch(claim)}
    returning rematch_since is null as dropped`);
  const row = res.rows[0];
  if (!row) return "lost";
  return row.dropped ? "dropped" : "retry";
}

/**
 * Drops requests whose last allowed claim died without a verdict (the matcher crashed on it every
 * time, so failRematch never ran). Returns their user ids for the caller to log as errors.
 */
export async function dropAbandonedRematches(db: Executor): Promise<string[]> {
  const res = await db.execute<{ user_id: string }>(sql`
    update profiles set
      rematch_since = null, rematch_claimed_at = null, rematch_after = null, rematch_attempts = 0
    where rematch_since is not null
      and rematch_attempts >= ${MAX_REMATCH_ATTEMPTS}
      and (rematch_claimed_at is null
           or rematch_claimed_at < now() - make_interval(secs => ${REMATCH_LEASE_MS / 1000}))
    returning user_id`);
  return res.rows.map((r) => r.user_id);
}

// ---- The AI re-score queue ----

/**
 * Fences a re-score write. `attempts` alone isn't enough: a new profile version resets
 * ai_attempts to 0, so the version is part of the claim too.
 */
export type RescoreClaim = { attempts: number; profileVersion: number };

/** Takes up to `limit` due pending pairs: highest rule score first, then newest. */
export async function claimPairsForRescore(
  db: Executor,
  limit: number,
): Promise<{ matchId: string; userId: string; claim: RescoreClaim }[]> {
  const res = await db.execute<{
    id: string;
    user_id: string;
    ai_attempts: number;
    profile_version: number;
    rule_score: number;
    created_at: string;
  }>(sql`
    with picked as (
      select id from matches
      where ai_status = 'pending' and ai_run_after <= now() and withdrawn_at is null
      order by rule_score desc, created_at desc
      limit ${limit}
      for update skip locked)
    update matches m set
      ai_status = 'running',
      ai_attempts = m.ai_attempts + 1,
      ai_locked_at = now()
    from picked where m.id = picked.id
    returning m.id, m.user_id, m.ai_attempts, m.profile_version, m.rule_score, m.created_at`);
  return res.rows
    .sort(
      (a, b) =>
        b.rule_score - a.rule_score ||
        toDate(b.created_at).getTime() - toDate(a.created_at).getTime(),
    )
    .map((r) => ({
      matchId: r.id,
      userId: r.user_id,
      claim: { attempts: r.ai_attempts, profileVersion: r.profile_version },
    }));
}

const ownedPair = (matchId: string, claim: RescoreClaim) =>
  sql`id = ${matchId} and ai_status = 'running'
    and ai_attempts = ${claim.attempts} and profile_version = ${claim.profileVersion}`;

export type RescoreUnit = "taken" | "held" | "capped" | "lost";

/**
 * Makes sure the claimed pair holds one of `day`'s re-scores (`day` is the UTC date,
 * YYYY-MM-DD). A pair pays once a day: when an earlier attempt today already took its unit
 * (ai_unit_day = day, as after invalid output), nothing is taken again ("held"). Otherwise one
 * unit is taken if the user has any left ("taken") and the day is written on the row, so a
 * refund goes back to that same day; "capped" when none is left, "lost" when the claim no
 * longer owns the row. One statement: the row lock and the conditional upsert keep concurrent
 * callers within `cap`.
 */
export async function takeRescoreUnit(
  db: Executor,
  matchId: string,
  claim: RescoreClaim,
  cap: number,
  day: string,
): Promise<RescoreUnit> {
  const res = await db.execute<{
    owned: number;
    held: boolean | null;
    took: number;
  }>(sql`
    with owned as (
      select id, user_id, ai_unit_day from matches
      where ${ownedPair(matchId, claim)}
      for update),
    took as (
      insert into rescore_usage (user_id, day, used)
      select user_id, ${day}::date, 1 from owned
      where ${cap}::int > 0 and ai_unit_day is distinct from ${day}::date
      on conflict (user_id, day) do update set used = rescore_usage.used + 1
        where rescore_usage.used < ${cap}::int
      returning user_id),
    marked as (
      update matches m set ai_unit_day = ${day}::date
      from owned where m.id = owned.id and exists (select 1 from took)
      returning m.id)
    select (select count(*) from owned)::int as owned,
      (select ai_unit_day = ${day}::date from owned) as held,
      (select count(*) from marked)::int as took`);
  const r = res.rows[0]!;
  if (r.owned === 0) return "lost";
  if (r.took > 0) return "taken";
  return r.held ? "held" : "capped";
}

export type RescoreContext = {
  matchId: string;
  userId: string;
  plan: Plan;
  trialEndsAt: Date;
  profileVersion: number;
  ruleScore: number;
  post: {
    id: string;
    title: string;
    /** The first 3,000 characters. */
    body: string;
    kind: PostKind;
    employmentType: EmploymentType;
    payType: PayType;
    categories: string[];
    skillIds: string[];
    budgetMin: number | null;
    budgetMax: number | null;
    currency: string | null;
    budgetUnit: BudgetUnit | null;
    remote: RemoteType;
    deadline: string | null;
    redFlags: string[];
    summary: string;
  };
  profile: {
    categories: string[];
    /** Taxonomy names and the user's own (custom) skills, core first. */
    skills: { name: string; level: "core" | "secondary" }[];
    minRateMinor: number;
    currency: MatchProfile["currency"];
    rateType: MatchProfile["rateType"];
    remoteOnly: boolean;
  };
  /** Visible projects only, in the user's order, at most 8. */
  projects: { id: string; title: string; summary: string }[];
  /**
   * Visible roles only, at most 6. Never an organisation's name: only its description. Names
   * are also scrubbed out of every title and summary here (see `scrubOrganisations`).
   */
  roles: {
    id: string;
    title: string;
    organisationDescription: string;
    summary: string;
  }[];
};

/** Everything the re-score prompt needs for one pair. Null if the match is gone. */
export async function loadRescoreContext(
  db: Executor,
  matchId: string,
): Promise<RescoreContext | null> {
  const res = await db.execute<
    PostRow & {
      match_id: string;
      user_id: string;
      rule_score: number;
      match_profile_version: number;
      title: string;
      body: string;
      summary: string;
      plan: Plan;
      trial_ends_at: string;
      profile_categories: string[];
      min_rate_minor: number;
      profile_currency: MatchProfile["currency"];
      rate_type: MatchProfile["rateType"];
      remote_only: boolean;
    }
  >(sql`
    select m.id as match_id, m.user_id, m.rule_score, m.profile_version as match_profile_version,
      ${postColumns}, j.title, left(j.body, 3000) as body, a.summary,
      p.plan, p.trial_ends_at, p.categories as profile_categories, p.min_rate_minor,
      p.currency as profile_currency, p.rate_type, p.remote_only
    from matches m
    join job_posts j on j.id = m.job_post_id
    join job_post_analyses a on a.job_post_id = j.id
    join profiles p on p.user_id = m.user_id
    where m.id = ${matchId}`);
  const r = res.rows[0];
  if (!r) return null;
  const skills = await db.execute<{
    name: string;
    level: "core" | "secondary";
  }>(sql`
    select s.name, ps.level from profile_skills ps join skills s on s.id = ps.skill_id
    where ps.user_id = ${r.user_id}
    union all
    select cs.name, cs.level from custom_skills cs where cs.user_id = ${r.user_id}
    order by level, name`);
  const projects = await db.execute<{
    id: string;
    title: string;
    summary: string;
  }>(sql`
    select id, title, summary from profile_projects
    where user_id = ${r.user_id} and not hidden
    order by position limit 8`);
  // The organisation is read only to take it out of every profile string: the model only ever
  // sees the description. Hidden roles count too, since visible work can name their employer.
  const roles = await db.execute<{
    id: string;
    title: string;
    organisation: string | null;
    organisation_description: string;
    summary: string;
    hidden: boolean;
  }>(sql`
    select id, title, organisation, organisation_description, summary, hidden
    from profile_experience
    where user_id = ${r.user_id}
    order by position`);
  const orgs = roles.rows.map((e) => ({
    organisation: e.organisation,
    description: e.organisation_description,
  }));
  const scrub = (text: string) => scrubOrganisations(text, orgs);
  const post = toMatchPost(r);
  return {
    matchId: r.match_id,
    userId: r.user_id,
    plan: r.plan,
    trialEndsAt: toDate(r.trial_ends_at),
    profileVersion: r.match_profile_version,
    ruleScore: r.rule_score,
    post: {
      id: post.id,
      title: r.title,
      body: r.body,
      kind: post.kind,
      employmentType: post.employmentType,
      payType: post.payType,
      categories: post.categories,
      skillIds: post.skillIds,
      budgetMin: post.budgetMin,
      budgetMax: post.budgetMax,
      currency: post.currency,
      budgetUnit: post.budgetUnit,
      remote: post.remote,
      deadline: post.deadline,
      redFlags: post.redFlags,
      summary: r.summary,
    },
    profile: {
      categories: r.profile_categories,
      skills: skills.rows.map((s) => ({ name: s.name, level: s.level })),
      minRateMinor: r.min_rate_minor,
      currency: r.profile_currency,
      rateType: r.rate_type,
      remoteOnly: r.remote_only,
    },
    projects: projects.rows.map((p) => ({
      id: p.id,
      title: scrub(p.title),
      summary: scrub(p.summary),
    })),
    roles: roles.rows
      .filter((e) => !e.hidden)
      .slice(0, 6)
      .map((e) => ({
        id: e.id,
        title: scrub(e.title),
        organisationDescription: scrub(e.organisation_description),
        summary: scrub(e.summary),
      })),
  };
}

export type RescoreResult = {
  aiScore: number;
  aiReason: string;
  concerns: string[];
  bestProjectId: string | null;
  bestRoleId: string | null;
  model: string;
};

/**
 * Saves the AI verdict; the AI score becomes the match's score. False if the claim was lost.
 * A best project or role deleted since the context was loaded is saved as null (the key-share
 * lock keeps it from being deleted under the write), so the verdict is never lost to it. The
 * pair's unit stays spent.
 */
export async function completeRescore(
  db: Executor,
  matchId: string,
  claim: RescoreClaim,
  result: RescoreResult,
): Promise<boolean> {
  const res = await db.execute(sql`
    update matches set
      ai_status = 'done',
      ai_score = ${result.aiScore},
      ai_reason = ${result.aiReason},
      ai_concerns = ${textArray(result.concerns)},
      best_project_id = (select p.id from profile_projects p
        where p.id = ${result.bestProjectId}::uuid and p.user_id = matches.user_id
        for key share),
      best_role_id = (select e.id from profile_experience e
        where e.id = ${result.bestRoleId}::uuid and e.user_id = matches.user_id
        for key share),
      ai_model = ${result.model},
      ai_scored_at = now(),
      ai_finished_at = now(),
      ai_locked_at = null,
      ai_error = null,
      score = ${result.aiScore},
      updated_at = now()
    where ${ownedPair(matchId, claim)}`);
  return (res.rowCount ?? 0) > 0;
}

export type RescoreFailure = {
  code: string;
  retryable: boolean;
  /** false: no answer came of it (provider outage, shutdown, budget): give the attempt back. */
  countAttempt?: boolean;
  /**
   * With `countAttempt: false`: give the attempt back only when the pair's last error had
   * another code. The same code twice in a row counts, so a fault that always recurs (a bug
   * before the model call) still ends in `failed` instead of retrying forever.
   */
  countRepeats?: boolean;
};

/**
 * Retryable failures go back with backoff (30 s, 60 s, … with jitter) until
 * MAX_RESCORE_ATTEMPTS; the rest fail for good, and the score stays the rule score.
 *
 * A give-back (`countAttempt: false`) returns the attempt **and the unit**, in this one
 * statement: rescore_usage goes down by one for the day stored in ai_unit_day (never below 0)
 * and ai_unit_day is cleared. The pair is due again at once (no backoff): the circuit breaker
 * and the budget pause stop a tight loop. A counted failure keeps the unit, so the retry pays
 * nothing more (see `takeRescoreUnit`). Fenced on the claim, so a second call refunds nothing.
 */
export async function failRescore(
  db: Executor,
  matchId: string,
  claim: RescoreClaim,
  fail: RescoreFailure,
): Promise<"requeued" | "failed" | "lost"> {
  const giveBack =
    fail.retryable && fail.countAttempt === false
      ? fail.countRepeats
        ? sql`ai_error is distinct from ${fail.code}`
        : sql`true`
      : sql`false`;
  const res = await db.execute<{ status: string }>(sql`
    with old as (
      select id, user_id, ai_unit_day as unit_day, ai_attempts as attempts,
        (${giveBack}) as give_back
      from matches
      where ${ownedPair(matchId, claim)}
      for update),
    decided as (
      select old.*,
        (${fail.retryable} and (give_back or attempts < ${MAX_RESCORE_ATTEMPTS})) as retry
      from old),
    updated as (
      update matches m set
        ai_status = case when d.retry then 'pending' else 'failed' end,
        ai_attempts = case when d.give_back then greatest(d.attempts - 1, 0) else d.attempts end,
        ai_unit_day = case when d.give_back then null else m.ai_unit_day end,
        ai_locked_at = null,
        ai_error = ${fail.code},
        ai_run_after = case
          when d.give_back then now() + make_interval(secs => ${GIVE_BACK_DELAY_MS / 1000})
          when d.retry then now() + make_interval(secs => 30 * power(2, greatest(d.attempts - 1, 0)) * (0.8 + random() * 0.4))
          else m.ai_run_after end,
        ai_finished_at = case when d.retry then m.ai_finished_at else now() end,
        score = case when d.retry then m.score else m.rule_score end,
        updated_at = now()
      from decided d where m.id = d.id
      returning m.ai_status as status),
    refunded as (
      update rescore_usage u set used = greatest(u.used - 1, 0)
      from decided d
      where d.give_back and d.unit_day is not null
        and u.user_id = d.user_id and u.day = d.unit_day
      returning u.user_id)
    select status from updated`);
  const status = res.rows[0]?.status;
  if (!status) return "lost";
  return status === "pending" ? "requeued" : "failed";
}

/** No unit left today (or AI no longer allowed: pass a code like NOT_ALLOWED). Keeps the rule score. */
export async function markCapped(
  db: Executor,
  matchId: string,
  claim: RescoreClaim,
  code: string | null = null,
): Promise<boolean> {
  const res = await db.execute(sql`
    update matches set ai_status = 'capped', ai_locked_at = null, ai_error = ${code},
      ai_finished_at = now(), updated_at = now()
    where ${ownedPair(matchId, claim)}`);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Rescues pairs whose re-scorer died: pending again, or failed (TIMEOUT) once attempts run out.
 * A requeued pair also gets its unit back (the day in ai_unit_day, cleared), in the same
 * statement; a failed one keeps it spent.
 */
export async function requeueStaleRescores(
  db: Executor,
  olderThanMs = 120_000,
): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`
    with stale as (
      select id, user_id, ai_unit_day as unit_day,
        ai_attempts < ${MAX_RESCORE_ATTEMPTS} as retry
      from matches
      where ai_status = 'running'
        and ai_locked_at < now() - make_interval(secs => ${olderThanMs / 1000})
      for update skip locked),
    updated as (
      update matches m set
        ai_status = case when s.retry then 'pending' else 'failed' end,
        ai_error = case when s.retry then m.ai_error else 'TIMEOUT' end,
        score = case when s.retry then m.score else m.rule_score end,
        ai_unit_day = case when s.retry then null else m.ai_unit_day end,
        ai_finished_at = case when s.retry then m.ai_finished_at else now() end,
        ai_locked_at = null,
        updated_at = now()
      from stale s where m.id = s.id
      returning m.id),
    refunded as (
      -- One user can have several stale pairs on one day: refund them together.
      update rescore_usage u set used = greatest(u.used - r.n, 0)
      from (select user_id, unit_day, count(*)::int as n from stale
            where retry and unit_day is not null group by user_id, unit_day) r
      where u.user_id = r.user_id and u.day = r.unit_day
      returning u.user_id)
    select count(*)::int as n from updated`);
  return res.rows[0]?.n ?? 0;
}

// ---- Feed ----

export type FeedCursor = { postedAt: Date; id: string };

export type FeedItem = {
  matchId: string;
  /** The final score: the AI score once done, else the rule score. */
  score: number;
  /** The AI reason once done, else the rule reason. */
  reason: string;
  broad: boolean;
  status: MatchStatus;
  aiStatus: AiStatus;
  bestProject: { id: string; title: string } | null;
  bestRole: { id: string; title: string } | null;
  post: {
    id: string;
    title: string;
    community: string;
    url: string;
    postedAt: Date;
    summary: string;
    categories: string[];
    /** Null when the post names no amount. */
    budget: {
      min: number | null;
      max: number | null;
      currency: string | null;
      unit: BudgetUnit | null;
    } | null;
    payType: PayType;
    remote: RemoteType;
    /** YYYY-MM-DD */
    deadline: string | null;
    redFlags: string[];
    /** How the post says to apply; null when it doesn't say (or an older analysis). */
    applyInstructions: string | null;
    /** Other communities the same gig was cross-posted to (its duplicates), sorted. */
    alsoPostedIn: string[];
  };
};

export type FeedOptions = {
  view: "best" | "all";
  cursor?: FeedCursor;
  /** Only posts sharing one of these job types. */
  categories?: string[];
  pay?: "paid" | "any";
  limit: number;
};

/**
 * One page of a user's feed, newest post first, keyset-paged on (posted_at, match id) so
 * matches added between pages never shift it. Dismissed and withdrawn matches are left out;
 * `best` keeps score ≥ BEST_MIN_SCORE. Served by matches_feed_idx (whose predicate is exactly
 * those two exclusions).
 */
export async function feedPage(
  db: Executor,
  userId: string,
  opts: FeedOptions,
): Promise<{ items: FeedItem[]; next: FeedCursor | null }> {
  const where: SQL[] = [
    sql`m.user_id = ${userId}`,
    sql`m.status <> 'dismissed'`,
    sql`m.withdrawn_at is null`,
  ];
  if (opts.view === "best") where.push(sql`m.score >= ${BEST_MIN_SCORE}`);
  if (opts.cursor)
    where.push(
      sql`(m.posted_at, m.id) < (${opts.cursor.postedAt}::timestamptz, ${opts.cursor.id}::uuid)`,
    );
  if (opts.categories?.length)
    where.push(sql`a.categories && ${textArray(opts.categories)}`);
  if (opts.pay === "paid") where.push(sql`a.pay_type = 'paid'`);
  const res = await db.execute<{
    id: string;
    score: number;
    reason: string;
    broad: boolean;
    status: MatchStatus;
    ai_status: AiStatus;
    posted_at: string;
    bp_id: string | null;
    bp_title: string | null;
    br_id: string | null;
    br_title: string | null;
    post_id: string;
    title: string;
    community: string;
    url: string;
    summary: string;
    categories: string[];
    budget_min: string | null;
    budget_max: string | null;
    currency: string | null;
    budget_unit: BudgetUnit | null;
    pay_type: PayType;
    remote: RemoteType;
    deadline: string | null;
    red_flags: string[];
    apply_instructions: string | null;
    also_posted_in: string[];
  }>(sql`
    select m.id, m.score, m.broad, m.status, m.ai_status, m.posted_at,
      case when m.ai_status = 'done' and m.ai_reason is not null then m.ai_reason else m.rule_reason end as reason,
      bp.id as bp_id, bp.title as bp_title, br.id as br_id, br.title as br_title,
      j.id as post_id, j.title, j.community, j.url,
      a.summary, a.categories, a.budget_min, a.budget_max, a.currency, a.budget_unit,
      a.pay_type, a.remote, a.deadline, a.red_flags, a.apply_instructions,
      coalesce((
        select array_agg(distinct d.community order by d.community) from job_posts d
        where d.duplicate_of = j.id and d.community <> j.community), '{}'::text[]) as also_posted_in
    from matches m
    join job_posts j on j.id = m.job_post_id and j.duplicate_of is null
    join job_post_analyses a on a.job_post_id = j.id
    left join profile_projects bp
      on bp.id = m.best_project_id and bp.user_id = m.user_id and not bp.hidden
    left join profile_experience br
      on br.id = m.best_role_id and br.user_id = m.user_id and not br.hidden
    where ${sql.join(where, sql` and `)}
    order by m.posted_at desc, m.id desc
    limit ${opts.limit + 1}`);
  const rows = res.rows.slice(0, opts.limit);
  const items: FeedItem[] = rows.map((r) => {
    const min = toNum(r.budget_min);
    const max = toNum(r.budget_max);
    return {
      matchId: r.id,
      score: r.score,
      reason: r.reason,
      broad: r.broad,
      status: r.status,
      aiStatus: r.ai_status,
      bestProject:
        r.bp_id && r.bp_title ? { id: r.bp_id, title: r.bp_title } : null,
      bestRole:
        r.br_id && r.br_title ? { id: r.br_id, title: r.br_title } : null,
      post: {
        id: r.post_id,
        title: r.title,
        community: r.community,
        url: r.url,
        postedAt: toDate(r.posted_at),
        summary: r.summary,
        categories: r.categories,
        budget:
          min === null && max === null
            ? null
            : { min, max, currency: r.currency, unit: r.budget_unit },
        payType: r.pay_type,
        remote: r.remote,
        deadline: toDay(r.deadline),
        redFlags: r.red_flags,
        applyInstructions: r.apply_instructions,
        alsoPostedIn: r.also_posted_in,
      },
    };
  });
  const last = items[items.length - 1];
  const next =
    res.rows.length > opts.limit && last
      ? { postedAt: last.post.postedAt, id: last.matchId }
      : null;
  return { items, next };
}

/**
 * Sets the status of one of the user's own matches and logs the change as an event (none when
 * the status is unchanged). Null when the match isn't the user's (nothing written).
 *
 * AI re-scoring and dismissals (pinned by tests):
 * - dismissing a match still waiting for AI (`pending`) cancels the re-score: `not_needed`;
 * - dismissing while the re-score is `running` does not cancel it: the unit is already spent,
 *   and the result is saved on the dismissed row;
 * - un-dismissing (back to new, seen, saved or replied) leaves `not_needed` as it is: the match
 *   keeps its rule score and isn't queued again. A later re-match with a newer profile version
 *   or analysis decides its AI status afresh.
 */
export async function setMatchStatus(
  db: Database,
  userId: string,
  matchId: string,
  status: MatchStatus,
): Promise<{ status: MatchStatus } | null> {
  return db.transaction(async (tx) => {
    const res = await tx.execute<{ status: MatchStatus }>(sql`
      select status from matches where id = ${matchId} and user_id = ${userId}
      for update`);
    const current = res.rows[0];
    if (!current) return null;
    if (current.status === status) return { status };
    await tx.execute(sql`
      update matches set
        status = ${status},
        ai_status = case when ${status} = 'dismissed' and ai_status = 'pending'
          then 'not_needed' else ai_status end,
        updated_at = now()
      where id = ${matchId}`);
    await tx.insert(matchEvents).values({ matchId, userId, event: status });
    return { status };
  });
}
