// `npm run ingest:status -w @redlance/worker`: how collection and analysis are doing.
// Needs only DATABASE_URL (from apps/worker/.env.local).
import {
  activeFeeds,
  createDb,
  llmCostSince,
  uncataloguedCommunities,
} from "@redlance/db";
import { sql } from "drizzle-orm";
import { ANALYSIS_TASK, startOfUtcDay } from "../ingest/analyser";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, pool } = createDb(url, { max: 2 });
const ago = (d: Date | null) =>
  d ? `${Math.round((Date.now() - d.getTime()) / 60_000)} min ago` : "never";
const inMin = (d: Date) => {
  const m = Math.round((d.getTime() - Date.now()) / 60_000);
  return m <= 0 ? "due now" : `in ${m} min`;
};

try {
  const feeds = await activeFeeds(db);
  console.log(`\nFeeds (${feeds.length} active)`);
  for (const f of feeds) {
    const what =
      f.kind === "search"
        ? `search "${f.query}"`
        : `${f.subreddits!.length} subreddits (${f.subreddits!.slice(0, 3).join(", ")}…)`;
    const extra = [
      f.consecutiveErrors ? `${f.consecutiveErrors} errors` : "",
      f.catchUpPagesLeft
        ? `catching up (${f.catchUpPagesLeft} pages left)`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `  ${what.padEnd(58)} every ${f.intervalSeconds / 60} min · last ${ago(f.lastPolledAt)} · next ${inMin(f.nextPollAt)} ${extra}`,
    );
  }

  const [polls] = (
    await db.execute<{
      n: string;
      ok: string;
      limited: string;
      blocked: string;
      last_ok: Date | null;
    }>(sql`
      select count(*) as n,
             count(*) filter (where error_code is null) as ok,
             count(*) filter (where error_code = 'RATE_LIMITED') as limited,
             count(*) filter (where error_code in ('BLOCKED', 'NOT_A_FEED')) as blocked,
             max(started_at) filter (where error_code is null) as last_ok
      from feed_polls where started_at > now() - interval '24 hours'`)
  ).rows;
  console.log(
    `\nRequests, last 24 h: ${polls!.n} (${polls!.ok} ok, ${polls!.limited} rate-limited, ${polls!.blocked} blocked) · last success ${ago(polls!.last_ok ? new Date(polls!.last_ok) : null)}`,
  );

  const [posts] = (
    await db.execute<Record<string, string>>(sql`
      select count(*) filter (where first_seen_at > now() - interval '1 hour') as last_hour,
             count(*) filter (where first_seen_at > now() - interval '24 hours') as last_day,
             count(*) as total,
             count(*) filter (where analysis_status = 'pending') as pending,
             count(*) filter (where analysis_status = 'running') as running,
             count(*) filter (where analysis_status = 'failed') as failed,
             count(*) filter (where pre_kind = 'hiring' and first_seen_at > now() - interval '24 hours') as hiring_tagged_day,
             count(*) filter (where duplicate_of is not null and first_seen_at > now() - interval '24 hours') as duplicates_day
      from job_posts`)
  ).rows;
  console.log(
    `Posts: ${posts!.last_hour} in the last hour, ${posts!.last_day} in 24 h (${posts!.hiring_tagged_day} tagged hiring), ${posts!.total} stored`,
  );
  console.log(`Duplicates (24 h): ${posts!.duplicates_day}`);
  console.log(
    `Analysis: ${posts!.pending} waiting, ${posts!.running} running, ${posts!.failed} failed`,
  );
  const kinds = (
    await db.execute<{ kind: string; n: string }>(sql`
      select kind, count(*) as n from job_post_analyses
      where created_at > now() - interval '24 hours' group by kind order by n desc`)
  ).rows;
  if (kinds.length)
    console.log(
      `Analysed in 24 h: ${kinds.map((k) => `${k.n} ${k.kind}`).join(", ")}`,
    );
  const spent = await llmCostSince(
    db,
    startOfUtcDay(Date.now()),
    ANALYSIS_TASK,
  );
  console.log(`Model spend today (UTC): $${(spent / 1e6).toFixed(4)}`);

  const discovery = await uncataloguedCommunities(db, 7, 10);
  if (discovery.length) {
    console.log("\nOutside the catalogue (last 7 days, from search feeds):");
    for (const d of discovery)
      console.log(
        `  r/${d.community.padEnd(24)} ${d.posts} posts, ${d.hiring} hiring`,
      );
  }
  console.log();
} finally {
  await pool.end();
}
