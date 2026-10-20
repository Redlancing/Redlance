import { sql } from "drizzle-orm";
import type { Database } from "./client";

type Executor = Pick<Database, "execute">;

export type DashboardStats = {
  /** Matches created since midnight in the user's time zone, not dismissed or withdrawn. */
  newToday: number;
  /** Replies marked as sent in the last 7 days. */
  sentThisWeek: number;
  /** Replies ever sent (for the setup checklist). */
  sentEver: number;
  /** Replies the user marked as hired. */
  won: number;
  /** Telegram is linked and on. */
  telegramOn: boolean;
};

/**
 * The overview page's numbers in one query. "Today" starts at local midnight in the profile's
 * time zone (UTC without a profile).
 */
export async function dashboardStats(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<DashboardStats> {
  const res = await db.execute<{
    new_today: number;
    sent_week: number;
    sent_ever: number;
    won: number;
    telegram_on: boolean;
  }>(sql`
    with tz as (
      select coalesce((select time_zone from profiles where user_id = ${userId}), 'UTC') as name),
    day as (
      select (date_trunc('day', ${now}::timestamptz at time zone tz.name) at time zone tz.name) as start
      from tz)
    select
      (select count(*)::int from matches m, day
        where m.user_id = ${userId} and m.created_at >= day.start
          and m.status <> 'dismissed' and m.withdrawn_at is null) as new_today,
      (select count(*)::int from replies r
        where r.user_id = ${userId}
          and r.sent_at >= ${now}::timestamptz - interval '7 days') as sent_week,
      (select count(*)::int from replies r where r.user_id = ${userId}) as sent_ever,
      (select count(*)::int from replies r
        where r.user_id = ${userId} and r.status = 'hired') as won,
      exists (select 1 from alert_channels c
        where c.user_id = ${userId} and c.kind = 'telegram' and c.enabled
          and c.verified_at is not null) as telegram_on`);
  const r = res.rows[0]!;
  return {
    newToday: r.new_today,
    sentThisWeek: r.sent_week,
    sentEver: r.sent_ever,
    won: r.won,
    telegramOn: r.telegram_on,
  };
}
