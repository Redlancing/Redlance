// Alerts (docs/alerts/README.md): the router's batch, the delivery queue the senders drain,
// Telegram linking and upkeep. Same queue shape as draft-jobs.ts: claims take rows with
// FOR UPDATE SKIP LOCKED and count the attempt; every later write is fenced on
// (status = 'sending', attempts = the claim's attempts), so a claim that was swept and taken
// again can't be completed or failed twice.
import {
  CAPPED_OUTCOMES,
  deliveryBackoffMs,
  MAX_DELIVERY_ATTEMPTS,
  startOfLocalDay,
  type AlertOutcome,
  type ChannelDisabledReason,
  type DeliveryChannel,
  type MatchStatus,
  type Plan,
} from "@redlance/core";
import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { alertDeliveries } from "./schema";

/** NOTIFY channel: deliveries are waiting for a sender. */
export const ALERTS_CHANNEL = "alerts";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Pick<Database, "execute">;

const uuids = (ids: string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;
const ints = (ns: number[]) => sql`${`{${ns.join(",")}}`}::int[]`;
const texts = (ss: string[]) =>
  sql`${`{${ss.map((s) => `"${s.replaceAll(/["\\]/g, "\\$&")}"`).join(",")}}`}::text[]`;

// ---- The router's side ----

/** One unrouted match with everything decideAlert needs. */
export type RoutingItem = {
  matchId: string;
  userId: string;
  score: number;
  status: MatchStatus;
  withdrawn: boolean;
  postedAt: Date;
  /** False when the user is blocked or has no profile: never alerted. */
  active: boolean;
  plan: Plan;
  trialEndsAt: Date;
  alertMinScore: number;
  dailyCap: number;
  timeZone: string;
  /** The user's Telegram channel, or null when never linked. */
  telegram: { enabled: boolean; verified: boolean } | null;
};

export type RoutingDecision = {
  matchId: string;
  outcome: AlertOutcome;
  channels: DeliveryChannel[];
};

/**
 * `routedToday`: per user, the alerts already queued, sent or failed since the start of their
 * local day. Must return one decision per item.
 */
export type RoutingDecide = (
  items: RoutingItem[],
  routedToday: Map<string, number>,
) => RoutingDecision[];

export type RoutingResult = {
  routed: number;
  byOutcome: Partial<Record<AlertOutcome, number>>;
  /** Deliveries inserted (one per queued match and channel). */
  queued: number;
};

type RoutingRow = {
  id: string;
  user_id: string;
  score: number;
  status: MatchStatus;
  withdrawn: boolean;
  posted_at: Date | string;
  active: boolean;
  plan: Plan;
  trial_ends_at: Date | string;
  alert_min_score: number;
  alerts_daily_cap: number;
  time_zone: string;
  tg_enabled: boolean | null;
  tg_verified: boolean | null;
};

const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

/**
 * Routes up to `limit` unrouted matches, oldest first, in one transaction: claims them (SKIP
 * LOCKED, so routers never share a match), locks each user (so two routers can't both take
 * a user's last alert of the day), counts today's alerts per user, asks `decide`, writes every
 * outcome and inserts a delivery per queued channel. NOTIFY `alerts` (on commit) when a
 * delivery was inserted. A throw anywhere rolls the whole batch back.
 */
export async function withRoutingBatch(
  db: Database,
  opts: { limit: number; now?: Date },
  decide: RoutingDecide,
): Promise<RoutingResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const res = await tx.execute<RoutingRow>(sql`
      with picked as (
        select id from matches
        where alert_outcome is null
        order by created_at, id
        limit ${opts.limit}
        for update skip locked)
      select m.id, m.user_id, m.score, m.status, m.withdrawn_at is not null as withdrawn,
        m.posted_at,
        (u.status = 'active' and p.user_id is not null) as active,
        coalesce(p.plan, 'trial') as plan,
        coalesce(p.trial_ends_at, 'epoch'::timestamptz) as trial_ends_at,
        coalesce(p.alert_min_score, 100) as alert_min_score,
        coalesce(p.alerts_daily_cap, 1) as alerts_daily_cap,
        coalesce(p.time_zone, 'UTC') as time_zone,
        c.enabled as tg_enabled, c.verified_at is not null as tg_verified
      from picked
      join matches m on m.id = picked.id
      join users u on u.id = m.user_id
      left join profiles p on p.user_id = m.user_id
      left join alert_channels c on c.user_id = m.user_id and c.kind = 'telegram'
      order by m.created_at, m.id`);
    if (res.rows.length === 0) return { routed: 0, byOutcome: {}, queued: 0 };

    const items: RoutingItem[] = res.rows.map((r) => ({
      matchId: r.id,
      userId: r.user_id,
      score: r.score,
      status: r.status,
      withdrawn: r.withdrawn,
      postedAt: asDate(r.posted_at),
      active: r.active,
      plan: r.plan,
      trialEndsAt: asDate(r.trial_ends_at),
      alertMinScore: r.alert_min_score,
      dailyCap: r.alerts_daily_cap,
      timeZone: r.time_zone,
      telegram:
        r.tg_enabled === null
          ? null
          : { enabled: r.tg_enabled, verified: r.tg_verified === true },
    }));

    const zones = new Map<string, string>();
    for (const i of items) zones.set(i.userId, i.timeZone);
    const userIds = [...zones.keys()].sort();
    // Sorted, so two routers lock users in the same order and can't deadlock.
    for (const id of userIds) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`alerts:${id}`}, 0))`,
      );
    }
    const routedToday = await routedTodayCounts(
      tx,
      userIds.map((id) => ({
        userId: id,
        since: startOfLocalDay(zones.get(id)!, now),
      })),
    );

    const decisions = decide(items, routedToday);
    const byId = new Map(decisions.map((d) => [d.matchId, d]));
    if (byId.size !== items.length || items.some((i) => !byId.has(i.matchId))) {
      throw new Error("decide must return exactly one decision per item");
    }

    const ordered = items.map((i) => byId.get(i.matchId)!);
    await tx.execute(sql`
      update matches m set
        alert_outcome = d.outcome,
        alert_routed_at = ${now.toISOString()}::timestamptz,
        alert_score = m.score
      from unnest(${uuids(ordered.map((d) => d.matchId))}, ${texts(ordered.map((d) => d.outcome))})
        as d(id, outcome)
      where m.id = d.id`);

    const userOf = new Map(items.map((i) => [i.matchId, i.userId]));
    const deliveries = ordered
      .filter((d) => d.outcome === "queued")
      .flatMap((d) =>
        d.channels.map((channel) => ({
          userId: userOf.get(d.matchId)!,
          matchId: d.matchId,
          channel,
        })),
      );
    let queued = 0;
    if (deliveries.length > 0) {
      const inserted = await tx
        .insert(alertDeliveries)
        .values(deliveries)
        .onConflictDoNothing()
        .returning({ id: alertDeliveries.id });
      queued = inserted.length;
      if (queued > 0) {
        await tx.execute(sql`select pg_notify(${ALERTS_CHANNEL}, '')`);
      }
    }

    const byOutcome: Partial<Record<AlertOutcome, number>> = {};
    for (const d of ordered)
      byOutcome[d.outcome] = (byOutcome[d.outcome] ?? 0) + 1;
    return { routed: ordered.length, byOutcome, queued };
  });
}

/** Per user: matches queued, sent or failed since `since` (the cap counts these). */
export async function routedTodayCounts(
  db: Executor,
  users: { userId: string; since: Date }[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (users.length === 0) return counts;
  const res = await db.execute<{ user_id: string; n: number }>(sql`
    select s.user_id, count(m.id)::int as n
    from unnest(${uuids(users.map((u) => u.userId))},
                ${sql`${`{${users.map((u) => u.since.toISOString()).join(",")}}`}::timestamptz[]`})
      as s(user_id, since)
    left join matches m on m.user_id = s.user_id
      and m.alert_outcome in (${sql.raw(CAPPED_OUTCOMES.map((o) => `'${o}'`).join(", "))})
      and m.alert_routed_at >= s.since
    group by s.user_id`);
  for (const r of res.rows) counts.set(r.user_id, r.n);
  return counts;
}

// ---- The sender's side ----

/** One claimed delivery: `attempts` fences the later complete or fail. */
export type ClaimedDelivery = {
  id: string;
  attempts: number;
  matchId: string;
  score: number;
  reason: string;
  title: string;
  community: string;
  url: string;
  postedAt: Date;
  budget: {
    min: number | null;
    max: number | null;
    currency: string | null;
    unit: string | null;
  };
};

/** A user's claimed deliveries for one channel: sent as one message. */
export type DeliveryGroup = {
  userId: string;
  channel: DeliveryChannel;
  /** The channel's target (the Telegram chat id); null if the channel row is gone. */
  target: string | null;
  /** False when the channel was turned off after routing: fail the rows, don't send. */
  channelEnabled: boolean;
  deliveries: ClaimedDelivery[];
};

type ClaimedRow = {
  id: string;
  user_id: string;
  match_id: string;
  attempts: number;
  score: number;
  reason: string;
  title: string;
  community: string;
  url: string;
  posted_at: Date | string;
  budget_min: string | null;
  budget_max: string | null;
  currency: string | null;
  budget_unit: string | null;
  target: string | null;
  enabled: boolean | null;
};

/**
 * Claims due pending deliveries for `channel`: at most `perUser` per user (oldest first) and
 * `maxUsers` users (the longest-waiting first). Each claimed row becomes `sending`, with its
 * attempt counted. Returns them grouped by user with what the message needs.
 */
export async function claimDueDeliveries(
  db: Database,
  channel: DeliveryChannel,
  opts: { maxUsers: number; perUser: number },
): Promise<DeliveryGroup[]> {
  if (opts.maxUsers <= 0 || opts.perUser <= 0) return [];
  // Enough rows to fill every slot even when some users have more than perUser waiting.
  const scan = opts.maxUsers * opts.perUser * 4;
  const claimed = await db.execute<{ id: string }>(sql`
    with locked as (
      select id, user_id, run_after, created_at from alert_deliveries
      where channel = ${channel} and status = 'pending' and run_after <= now()
      order by run_after, id
      limit ${scan}
      for update skip locked
    ), ranked as (
      select id, user_id,
        row_number() over (partition by user_id order by created_at, id) as rn,
        min(run_after) over (partition by user_id) as first_due
      from locked
    ), chosen_users as (
      select user_id from ranked
      group by user_id
      order by min(first_due), user_id
      limit ${opts.maxUsers}
    )
    update alert_deliveries d set
      status = 'sending',
      locked_at = now(),
      attempts = d.attempts + 1
    from ranked r
    join chosen_users cu on cu.user_id = r.user_id
    where d.id = r.id and r.rn <= ${opts.perUser}
    returning d.id`);
  const ids = claimed.rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const res = await db.execute<ClaimedRow>(sql`
    select d.id, d.user_id, d.match_id, d.attempts,
      coalesce(m.alert_score, m.score) as score,
      case when m.ai_status = 'done' and m.ai_reason is not null then m.ai_reason
           else m.rule_reason end as reason,
      p.title, p.community, p.url, p.posted_at,
      a.budget_min, a.budget_max, a.currency, a.budget_unit,
      c.target, c.enabled
    from alert_deliveries d
    join matches m on m.id = d.match_id
    join job_posts p on p.id = m.job_post_id
    left join job_post_analyses a on a.job_post_id = p.id
    left join alert_channels c on c.user_id = d.user_id and c.kind = d.channel
    where d.id = any(${uuids(ids)})
    order by d.user_id, d.created_at, d.id`);

  const groups = new Map<string, DeliveryGroup>();
  for (const r of res.rows) {
    let g = groups.get(r.user_id);
    if (!g) {
      g = {
        userId: r.user_id,
        channel,
        target: r.target,
        channelEnabled: r.enabled === true,
        deliveries: [],
      };
      groups.set(r.user_id, g);
    }
    g.deliveries.push({
      id: r.id,
      attempts: r.attempts,
      matchId: r.match_id,
      score: r.score,
      reason: r.reason,
      title: r.title,
      community: r.community,
      url: r.url,
      postedAt: asDate(r.posted_at),
      budget: {
        min: r.budget_min === null ? null : Number(r.budget_min),
        max: r.budget_max === null ? null : Number(r.budget_max),
        currency: r.currency,
        unit: r.budget_unit,
      },
    });
  }
  return [...groups.values()];
}

type Fence = { id: string; attempts: number };

/**
 * A message went out: deletes the deliveries (fenced) and marks their matches sent, in one
 * transaction. Rows whose claim was lost are skipped. Returns how many were completed.
 */
export async function completeDeliveries(
  db: Database,
  rows: Fence[],
  opts: {
    channel: DeliveryChannel;
    /** Telegram's message_id. */
    messageId: number | null;
    template: string;
  },
): Promise<number> {
  if (rows.length === 0) return 0;
  return db.transaction(async (tx) => {
    const done = await tx.execute<{ match_id: string }>(sql`
      delete from alert_deliveries d
      using unnest(${uuids(rows.map((r) => r.id))}, ${ints(rows.map((r) => r.attempts))})
        as x(id, attempts)
      where d.id = x.id and d.status = 'sending' and d.attempts = x.attempts
      returning d.match_id`);
    const matchIds = done.rows.map((r) => r.match_id);
    if (matchIds.length === 0) return 0;
    const telegramId =
      opts.channel === "telegram" && opts.messageId !== null
        ? sql`${opts.messageId}::bigint`
        : sql`telegram_message_id`;
    await tx.execute(sql`
      update matches set
        alert_outcome = 'sent',
        alerted_at = coalesce(alerted_at, now()),
        alert_channels = case when ${opts.channel} = any(alert_channels) then alert_channels
                              else array_append(alert_channels, ${opts.channel}::text) end,
        alert_template = ${opts.template},
        telegram_message_id = ${telegramId}
      where id = any(${uuids(matchIds)})`);
    return matchIds.length;
  });
}

export type DeliveryFailure = {
  /** An error code only, never message text. */
  code: string;
  retryable: boolean;
  /** false = not this message's fault (rate limit, shutdown): the attempt is given back. */
  countAttempt: boolean;
  /** Delay before the retry; defaults to deliveryBackoffMs(attempts). */
  retryInMs?: number;
};

/**
 * A send failed. Retryable failures go back to pending (with backoff) while attempts remain;
 * one that doesn't count always goes back. Anything else is final: `failed`, and the match
 * becomes `failed` once none of its deliveries is still pending or sending.
 */
export async function failDeliveries(
  db: Database,
  rows: Fence[],
  fail: DeliveryFailure,
): Promise<{ requeued: number; failed: number; lost: number }> {
  if (rows.length === 0) return { requeued: 0, failed: 0, lost: 0 };
  const giveBack = fail.retryable && !fail.countAttempt;
  const plans = rows.map((r) => {
    const retry =
      fail.retryable && (giveBack || r.attempts < MAX_DELIVERY_ATTEMPTS);
    const delayMs = Math.max(
      0,
      fail.retryInMs ?? deliveryBackoffMs(r.attempts),
    );
    return { ...r, retry, delayMs };
  });
  return db.transaction(async (tx) => {
    const res = await tx.execute<{ match_id: string; status: string }>(sql`
      update alert_deliveries d set
        status = case when x.retry then 'pending' else 'failed' end,
        attempts = case when ${giveBack} then greatest(d.attempts - 1, 0) else d.attempts end,
        run_after = case when x.retry then now() + make_interval(secs => x.delay_ms / 1000.0)
                         else d.run_after end,
        locked_at = null,
        error_code = ${fail.code}
      from unnest(${uuids(plans.map((p) => p.id))}, ${ints(plans.map((p) => p.attempts))},
                  ${sql`${`{${plans.map((p) => p.retry).join(",")}}`}::boolean[]`},
                  ${ints(plans.map((p) => p.delayMs))})
        as x(id, attempts, retry, delay_ms)
      where d.id = x.id and d.status = 'sending' and d.attempts = x.attempts
      returning d.match_id, d.status`);
    const failedMatches = res.rows
      .filter((r) => r.status === "failed")
      .map((r) => r.match_id);
    await markMatchesFailed(tx, failedMatches);
    const failed = failedMatches.length;
    return {
      requeued: res.rows.length - failed,
      failed,
      lost: rows.length - res.rows.length,
    };
  });
}

/** Queued matches whose deliveries have all failed become `failed`. */
async function markMatchesFailed(tx: Executor, matchIds: string[]) {
  if (matchIds.length === 0) return;
  await tx.execute(sql`
    update matches m set alert_outcome = 'failed'
    where m.id = any(${uuids(matchIds)}) and m.alert_outcome = 'queued'
      and not exists (
        select 1 from alert_deliveries d
        where d.match_id = m.id and d.status in ('pending', 'sending'))`);
}

/**
 * Turns a user's channel off (the bot was blocked, or the user stopped alerts) and fails their
 * pending deliveries for it (`CHANNEL_DISABLED`), so nothing waits forever. Rows already being
 * sent are left to their sender. Returns how many deliveries were failed.
 */
export async function disableChannel(
  db: Database,
  userId: string,
  kind: DeliveryChannel,
  reason: ChannelDisabledReason,
): Promise<number> {
  return db.transaction((tx) => disableChannelTx(tx, userId, kind, reason));
}

async function disableChannelTx(
  tx: Tx,
  userId: string,
  kind: DeliveryChannel,
  reason: ChannelDisabledReason,
): Promise<number> {
  await tx.execute(sql`
    update alert_channels set enabled = false, disabled_reason = ${reason}
    where user_id = ${userId} and kind = ${kind}`);
  const res = await tx.execute<{ match_id: string }>(sql`
    update alert_deliveries set status = 'failed', error_code = 'CHANNEL_DISABLED', locked_at = null
    where user_id = ${userId} and channel = ${kind} and status = 'pending'
    returning match_id`);
  await markMatchesFailed(
    tx,
    res.rows.map((r) => r.match_id),
  );
  return res.rows.length;
}

/**
 * Rescues deliveries whose sender died mid-send: back to pending (the attempt stays counted)
 * while attempts remain, else `failed` (`STALE`). A message may have gone out before the crash,
 * so this can send it twice (delivery is at least once). Returns how many it moved.
 */
export async function requeueStaleDeliveries(
  db: Database,
  olderThanSec = 120,
): Promise<number> {
  return db.transaction(async (tx) => {
    const res = await tx.execute<{ match_id: string; status: string }>(sql`
      update alert_deliveries set
        status = case when attempts < ${MAX_DELIVERY_ATTEMPTS} then 'pending' else 'failed' end,
        error_code = case when attempts < ${MAX_DELIVERY_ATTEMPTS} then error_code else 'STALE' end,
        run_after = now(),
        locked_at = null
      where status = 'sending' and locked_at < now() - make_interval(secs => ${olderThanSec})
      returning match_id, status`);
    await markMatchesFailed(
      tx,
      res.rows.filter((r) => r.status === "failed").map((r) => r.match_id),
    );
    return res.rows.length;
  });
}

// ---- Telegram linking ----

export const TELEGRAM_LINK_TTL_MIN = 15;

/** Stores a link token's sha256 (hex). The raw token only ever lives in the t.me link. */
export async function createTelegramLinkToken(
  db: Executor,
  userId: string,
  tokenHash: string,
  ttlMin = TELEGRAM_LINK_TTL_MIN,
): Promise<Date> {
  const res = await db.execute<{ expires_at: Date | string }>(sql`
    insert into telegram_link_tokens (token_hash, user_id, expires_at)
    values (${tokenHash}, ${userId}, now() + make_interval(mins => ${ttlMin}))
    returning expires_at`);
  return asDate(res.rows[0]!.expires_at);
}

/**
 * Uses a link token (once, before it expires) to connect `chatId` to its user: the channel is
 * created or replaced, enabled and verified. A chat belongs to one account: if another user
 * had this chat, their channel is turned off. Returns the user id, or null for an unknown,
 * used or expired token.
 */
export async function useTelegramLinkToken(
  db: Database,
  tokenHash: string,
  chatId: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const res = await tx.execute<{ user_id: string }>(sql`
      update telegram_link_tokens set used_at = now()
      where token_hash = ${tokenHash} and used_at is null and expires_at > now()
      returning user_id`);
    const userId = res.rows[0]?.user_id;
    if (!userId) return null;
    const others = await tx.execute<{ user_id: string }>(sql`
      select user_id from alert_channels
      where kind = 'telegram' and target = ${chatId} and user_id <> ${userId} and enabled
      for update`);
    for (const o of others.rows) {
      await disableChannelTx(tx, o.user_id, "telegram", "user_stop");
    }
    await tx.execute(sql`
      insert into alert_channels (id, user_id, kind, target, enabled, verified_at, disabled_reason)
      values (gen_random_uuid(), ${userId}, 'telegram', ${chatId}, true, now(), null)
      on conflict (user_id, kind) do update set
        target = excluded.target, enabled = true, verified_at = now(), disabled_reason = null`);
    return userId;
  });
}

/** /stop from a chat: turns off every account linked to it. Returns how many. */
export async function disableTelegramByChat(
  db: Database,
  chatId: string,
  reason: ChannelDisabledReason,
): Promise<number> {
  return db.transaction(async (tx) => {
    const res = await tx.execute<{ user_id: string }>(sql`
      select user_id from alert_channels
      where kind = 'telegram' and target = ${chatId} and enabled
      for update`);
    for (const r of res.rows) {
      await disableChannelTx(tx, r.user_id, "telegram", reason);
    }
    return res.rows.length;
  });
}

// ---- Upkeep and stats ----

export const FAILED_DELIVERY_RETENTION_DAYS = 30;

/** Deletes failed deliveries older than 30 days and link tokens expired over a day ago. */
export async function pruneAlerts(
  db: Executor,
  now: Date = new Date(),
): Promise<{ deliveries: number; tokens: number }> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const d = await db.execute(sql`
    delete from alert_deliveries
    where status = 'failed'
      and created_at < ${at} - make_interval(days => ${FAILED_DELIVERY_RETENTION_DAYS})`);
  const t = await db.execute(sql`
    delete from telegram_link_tokens where expires_at < ${at} - interval '1 day'`);
  return { deliveries: d.rowCount ?? 0, tokens: t.rowCount ?? 0 };
}

export type AlertStats = {
  /** Matches waiting for the router. */
  backlog: number;
  /** Routing outcomes since `since`. */
  outcomes: Partial<Record<AlertOutcome, number>>;
  deliveries: { pending: number; sending: number; failed: number };
  oldestPendingRunAfter: Date | null;
  sentSince: number;
  telegram: { linked: number; disabled: number };
};

/** Counts for `alerts:status`. */
export async function alertStats(
  db: Executor,
  since: Date,
): Promise<AlertStats> {
  const s = sql`${since.toISOString()}::timestamptz`;
  const [backlog, outcomes, deliveries, sent, channels] = await Promise.all([
    db.execute<{ n: number }>(
      sql`select count(*)::int as n from matches where alert_outcome is null`,
    ),
    db.execute<{ outcome: AlertOutcome; n: number }>(sql`
      select alert_outcome as outcome, count(*)::int as n from matches
      where alert_routed_at >= ${s} group by 1`),
    db.execute<{ status: string; n: number; oldest: Date | string | null }>(sql`
      select status, count(*)::int as n,
        min(run_after) filter (where status = 'pending') as oldest
      from alert_deliveries group by 1`),
    db.execute<{ n: number }>(
      sql`select count(*)::int as n from matches where alerted_at >= ${s}`,
    ),
    db.execute<{ enabled: boolean; n: number }>(sql`
      select enabled, count(*)::int as n from alert_channels
      where kind = 'telegram' and verified_at is not null group by 1`),
  ]);
  const byStatus = new Map(deliveries.rows.map((r) => [r.status, r]));
  const oldest = byStatus.get("pending")?.oldest ?? null;
  return {
    backlog: backlog.rows[0]!.n,
    outcomes: Object.fromEntries(outcomes.rows.map((r) => [r.outcome, r.n])),
    deliveries: {
      pending: byStatus.get("pending")?.n ?? 0,
      sending: byStatus.get("sending")?.n ?? 0,
      failed: byStatus.get("failed")?.n ?? 0,
    },
    oldestPendingRunAfter: oldest === null ? null : asDate(oldest),
    sentSince: sent.rows[0]!.n,
    telegram: {
      linked: channels.rows.find((r) => r.enabled)?.n ?? 0,
      disabled: channels.rows.find((r) => !r.enabled)?.n ?? 0,
    },
  };
}
