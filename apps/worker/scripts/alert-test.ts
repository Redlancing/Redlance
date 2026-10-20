// Dev only: inserts one fake fresh hiring post and a match scored 90 for one user, then wakes
// the alert router, so the whole path (route -> queue -> Telegram) can be seen without waiting
// for Reddit. The user must have linked Telegram and be onboarded (a profile).
// Run: npm run alerts:test -w @redlance/worker -- --user <uuid>
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
import { eq, sql } from "drizzle-orm";

const appEnv = process.env.APP_ENV;
if (appEnv !== "local" && appEnv !== "test") {
  console.error(
    `alerts:test only runs with APP_ENV=local or test (APP_ENV is ${appEnv ?? "unset"}).`,
  );
  process.exit(1);
}
const USAGE =
  "Usage: npm run alerts:test -w @redlance/worker -- --user <user uuid>";
const { values } = parseArgs({ options: { user: { type: "string" } } });
const userId = values.user ?? "";
if (!/^[0-9a-f-]{36}$/i.test(userId)) {
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
      externalId: `t3_alerttest${key}`,
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
    pipelineVersion: "post@1",
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
