// Numbers for `npm run ingest:status` and `npm run match:status` (matching, Phase 7).
// Plain numbers only: formatting lives in apps/worker/src/cli/match-report.ts.
import {
  AI_STATUSES,
  MATCH_STATUSES,
  PLANS,
  RESCORE_DAILY_CAP,
  aiAllowed,
  type AiStatus,
  type MatchStatus,
  type Plan,
} from "@redlance/core";
import { sql } from "drizzle-orm";
import type { Database } from "./client";

const DAY_MS = 86_400_000;

/** The AI re-score's llm_usage task (Phase 5, apps/worker/src/match/rescore.ts `RESCORE_TASK`). */
const RESCORE_TASK = "match_rescore";

export type MatchingStats = {
  /** job_posts.match_status for posts first seen in the last 24 h. */
  posts: { pending: number; running: number; done: number; skipped: number };
  /** Matches created in the last 24 h, and how many are broad. */
  matchesCreated: number;
  matchesBroad: number;
  /**
   * AI outcomes that finished in the last 24 h (`ai_finished_at`: done, capped, failed), so a
   * later status change or dismissal doesn't move them; pending is the whole backlog right now.
   */
  ai: { done: number; capped: number; failed: number; pending: number };
  /** Re-score spend today (UTC), in millionths of a dollar. */
  rescoreSpendMicros: number;
  /** Users whose re-scores used today reach their plan's daily cap. */
  usersAtCap: number;
};

/** YYYY-MM-DD in UTC: the day key for rescore_usage and today's spend. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export async function matchingStats(
  db: Database,
  now: Date,
): Promise<MatchingStats> {
  const since = new Date(now.getTime() - DAY_MS);
  const today = utcDay(now);
  const startOfToday = new Date(`${today}T00:00:00.000Z`);

  const [posts] = (
    await db.execute<Record<string, string>>(sql`
      select count(*) filter (where match_status = 'pending' and first_seen_at > ${since}) as pending,
             count(*) filter (where match_status = 'running' and first_seen_at > ${since}) as running,
             count(*) filter (where match_status = 'done' and first_seen_at > ${since}) as done,
             count(*) filter (where match_status = 'skipped' and first_seen_at > ${since}) as skipped
      from job_posts`)
  ).rows;

  const [m] = (
    await db.execute<Record<string, string>>(sql`
      select count(*) filter (where created_at > ${since}) as created,
             count(*) filter (where created_at > ${since} and broad) as broad,
             count(*) filter (where ai_status = 'done' and ai_finished_at > ${since}) as ai_done,
             count(*) filter (where ai_status = 'capped' and ai_finished_at > ${since}) as ai_capped,
             count(*) filter (where ai_status = 'failed' and ai_finished_at > ${since}) as ai_failed,
             -- The whole backlog, however old: no 24 h filter.
             count(*) filter (where ai_status = 'pending') as ai_pending
      from matches`)
  ).rows;

  const [spend] = (
    await db.execute<{ micros: string }>(sql`
      select coalesce(sum(cost_micros), 0) as micros from llm_usage
      where task = ${RESCORE_TASK} and created_at >= ${startOfToday}`)
  ).rows;

  const capCase = sql.join(
    PLANS.map((p) => sql`when ${p} then ${RESCORE_DAILY_CAP[p]}::int`),
    sql` `,
  );
  const [cap] = (
    await db.execute<{ n: string }>(sql`
      select count(*) as n from rescore_usage ru
      join profiles p on p.user_id = ru.user_id
      where ru.day = ${today} and ru.used >= (case p.plan ${capCase} end)`)
  ).rows;

  return {
    posts: {
      pending: Number(posts!.pending),
      running: Number(posts!.running),
      done: Number(posts!.done),
      skipped: Number(posts!.skipped),
    },
    matchesCreated: Number(m!.created),
    matchesBroad: Number(m!.broad),
    ai: {
      done: Number(m!.ai_done),
      capped: Number(m!.ai_capped),
      failed: Number(m!.ai_failed),
      pending: Number(m!.ai_pending),
    },
    rescoreSpendMicros: Number(spend!.micros),
    usersAtCap: Number(cap!.n),
  };
}

export type UserMatchReport = {
  plan: Plan;
  trialEndsAt: Date;
  aiAllowed: boolean;
  /** Re-scores used today (UTC) and the plan's cap. */
  usedToday: number;
  cap: number;
  byAiStatus: Record<AiStatus, number>;
  byStatus: Record<MatchStatus, number>;
  /** Best five matches by score: title, score, and the reason the user sees. */
  top: { title: string; score: number; reason: string }[];
};

/** One user's matching state, looked up by normalised email. Null when no such user. */
export async function matchUserReport(
  db: Database,
  emailNormalized: string,
  now: Date,
): Promise<UserMatchReport | null> {
  const [user] = (
    await db.execute<{ user_id: string; plan: Plan; trial_ends_at: Date }>(sql`
      select u.id as user_id, p.plan, p.trial_ends_at
      from users u join profiles p on p.user_id = u.id
      where u.email_normalized = ${emailNormalized}`)
  ).rows;
  if (!user) return null;
  const userId = user.user_id;
  const trialEndsAt = new Date(user.trial_ends_at);

  const [usage] = (
    await db.execute<{ used: number }>(sql`
      select used from rescore_usage where user_id = ${userId} and day = ${utcDay(now)}`)
  ).rows;

  const byAi = (
    await db.execute<{ status: AiStatus; n: string }>(sql`
      select ai_status as status, count(*) as n from matches
      where user_id = ${userId} group by ai_status`)
  ).rows;
  const byStatus = (
    await db.execute<{ status: MatchStatus; n: string }>(sql`
      select status, count(*) as n from matches
      where user_id = ${userId} group by status`)
  ).rows;

  const top = (
    await db.execute<{ title: string; score: number; reason: string }>(sql`
      select j.title, m.score, coalesce(m.ai_reason, m.rule_reason) as reason
      from matches m join job_posts j on j.id = m.job_post_id
      where m.user_id = ${userId}
      order by m.score desc, m.posted_at desc, m.id desc
      limit 5`)
  ).rows;

  return {
    plan: user.plan,
    trialEndsAt,
    aiAllowed: aiAllowed(user.plan, trialEndsAt, now),
    usedToday: usage?.used ?? 0,
    cap: RESCORE_DAILY_CAP[user.plan],
    byAiStatus: countsOf(AI_STATUSES, byAi),
    byStatus: countsOf(MATCH_STATUSES, byStatus),
    top: top.map((t) => ({ title: t.title, score: t.score, reason: t.reason })),
  };
}

function countsOf<K extends string>(
  keys: readonly K[],
  rows: { status: K; n: string }[],
): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}
