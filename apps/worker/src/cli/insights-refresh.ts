// `npm run insights:refresh -w @redlance/worker`: recompute the subreddit insight rows once.
// Writes to the database in DATABASE_URL. Needs only DATABASE_URL.
import { createDb, refreshSubredditInsights } from "@redlance/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, pool } = createDb(url, { max: 2 });
try {
  const t0 = Date.now();
  const res = await refreshSubredditInsights(db, new Date());
  console.log(
    `Refreshed: ${res.upserted} upserted, ${res.deleted} deleted, ${Date.now() - t0} ms`,
  );
} finally {
  await pool.end();
}
