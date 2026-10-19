// `npm run ingest:plan -w @redlance/worker`: rebuild the feed plan from the catalogue now
// (the worker also does it daily). Needs only DATABASE_URL.
import { createDb } from "@redlance/db";
import { planAndApplyFeeds } from "../ingest/upkeep";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const maxGroupSize = Number(process.env.INGEST_MAX_GROUP ?? 80);
const { db, pool } = createDb(url, { max: 2 });
try {
  const r = await planAndApplyFeeds(db, { maxGroupSize });
  console.log(
    `${r.subreddits} active subreddits → ${r.feeds} feeds (${r.kept} kept, ${r.added} added, ${r.retired} retired)`,
  );
} finally {
  await pool.end();
}
