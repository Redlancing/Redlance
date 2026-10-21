// Dev only: inserts one fake fresh hiring post and a match scored 90 for one user, then wakes
// the alert router, so the whole path (route -> queue -> Telegram) can be seen without waiting
// for Reddit. The user must have linked Telegram and be onboarded (a profile).
// Run: npm run alerts:test -w @redlance/worker -- --user <uuid>
// Afterwards run: npm run alerts:test -w @redlance/worker -- --cleanup
// to delete the fake posts (and their matches) so they never linger in the db.
// Needs DATABASE_URL and APP_ENV=local or test.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import {
  MATCH_ALERTS_CHANNEL,
  createDb,
  jobPostAnalyses,
  jobPosts,
  profiles,
  upsertMatches,
} from "@redlance/db";
import { eq, like, sql } from "drizzle-orm";
import { PIPELINE_VERSION } from "../src/ingest/analyse-post";

const ID_PREFIX = "t3_alerttest_";

const appEnv = process.env.APP_ENV;
if (appEnv !== "local" && appEnv !== "test") {
  console.error(
    `alerts:test only runs with APP_ENV=local or test (APP_ENV is ${appEnv ?? "unset"}).`,
  );
  process.exit(1);
}
const USAGE =
  "Usage: npm run alerts:test -w @redlance/worker -- --user <user uuid>\n" +
  "       npm run alerts:test -w @redlance/worker -- --cleanup   (run this after testing)";
const { values } = parseArgs({
  options: { user: { type: "string" }, cleanup: { type: "boolean" } },
});
const userId = values.user ?? "";
if (!values.cleanup && !/^[0-9a-f-]{36}$/i.test(userId)) {
  console.error(USAGE);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const { db, pool } = createDb(url, { max: 2 });
try {
  if (values.cleanup) {
    // Analyses and matches cascade; a draft made from a fake post would block this delete.
    const gone = await db
      .delete(jobPosts)
      .where(like(jobPosts.externalId, `${ID_PREFIX}%`))
      .returning({ id: jobPosts.id });
    console.log(`Deleted ${gone.length} alerts:test job post(s).`);
    await pool.end();
    process.exit(0);
  }
  const [profile] = await db
    .select({ version: profiles.profileVersion })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!profile) {
    console.error("No profile for that user (finish onboarding first).");
    process.exit(1);
  }
  const key = randomUUID().slice(0, 8);
  const [post] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `${ID_PREFIX}${key}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/alerttest${key}/test_post/`,
      title: `[Hiring] Alert test ${key}: landing page for a small bakery`,
      body: "This is a fake post made by alerts:test. Need a simple landing page, budget $300.",
      author: "alert_test_author",
      postedAt: new Date(),
      preKind: "hiring",
      analysisStatus: "done",
      // Already matched: the real matcher must not pick this post up for every user.
      matchStatus: "done",
    })
    .returning({ id: jobPosts.id });
  await db.insert(jobPostAnalyses).values({
    jobPostId: post!.id,
    pipelineVersion: PIPELINE_VERSION,
    kind: "hiring",
    employmentType: "freelance",
    payType: "paid",
    categories: ["development"],
    skillIds: [],
    budgetMin: 300,
    budgetMax: 300,
    currency: "USD",
    budgetUnit: "fixed",
    remote: "remote",
    location: null,
    deadline: null,
    redFlags: [],
    summary: "Fake post for alerts:test",
    model: "alerts-test",
  });
  // origin "post" leaves alert_outcome null and sends NOTIFY match_alerts on commit.
  await upsertMatches(
    db,
    [
      {
        userId,
        jobPostId: post!.id,
        ruleScore: 90,
        broad: false,
        features: [{ signal: "alerts-test", points: 90 }],
        ruleReason: "Fake match made by alerts:test",
        aiStatus: "not_needed",
        profileVersion: profile.version,
      },
    ],
    { origin: "post" },
  );
  // upsertMatches only notifies when it inserted; say it again so the router wakes either way.
  await db.execute(sql`select pg_notify(${MATCH_ALERTS_CHANNEL}, '')`);
  const row = await db.execute<{ id: string }>(
    sql`select id from matches where user_id = ${userId}::uuid and job_post_id = ${post!.id}::uuid`,
  );
  console.log(
    `Inserted fake match ${row.rows[0]!.id} (score 90) for user ${userId}. The worker's router should pick it up; check: npm run alerts:status -w @redlance/worker`,
  );
} finally {
  await pool.end();
}
