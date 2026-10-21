// `npm run insights:status -w @redlance/worker`: the subreddit insight rows (count, age, busiest
// subreddits). Counts only, no user data. Needs only DATABASE_URL.
import { createDb, insightRows } from "@redlance/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, pool } = createDb(url, { max: 2 });
try {
  const rows = await insightRows(db);
  console.log("\nSubreddit insights");
  console.log(`  rows: ${rows.length}`);
  if (rows.length > 0) {
    const times = rows.map((r) => r.computedAt.getTime());
    console.log(
      `  oldest computed_at: ${new Date(Math.min(...times)).toISOString()}`,
    );
    console.log(
      `  newest computed_at: ${new Date(Math.max(...times)).toISOString()}`,
    );
    console.log("  top 10 by hiring posts (28-day window):");
    const top = [...rows]
      .sort((a, b) => b.hiringPosts - a.hiringPosts)
      .slice(0, 10);
    for (const r of top) {
      const days = Math.max(
        1,
        (r.computedAt.getTime() - r.windowStart.getTime()) / 86_400_000,
      );
      const perWeek = ((r.hiringPosts / days) * 7).toFixed(1);
      console.log(
        `    r/${r.subreddit.padEnd(24)} ${String(r.hiringPosts).padStart(5)} posts  ${perWeek.padStart(6)}/week`,
      );
    }
  }
  console.log("");
} finally {
  await pool.end();
}
