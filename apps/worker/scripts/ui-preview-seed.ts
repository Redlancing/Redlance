// Seeds a separate preview database for looking at the app UI with real data: copies recent
// analysed posts from the dev database (read only), creates one onboarded dev user, and runs the
// real matcher over the posts. Never writes to the dev database.
//
//   PREVIEW_DATABASE_URL=postgres://…/redlance_web_test_me npx tsx scripts/ui-preview-seed.ts
//
// Then start the web app against the preview database and sign in as preview@example.com.
import {
  createDb,
  jobPostAnalyses,
  jobPosts,
  profileSkills,
  profiles,
  syncReferenceData,
  users,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { sql } from "drizzle-orm";
import pino from "pino";
import { createMatcher } from "../src/match/matcher";

const SOURCE = process.env.DATABASE_URL;
const TARGET = process.env.PREVIEW_DATABASE_URL;
if (!SOURCE || !TARGET || SOURCE === TARGET)
  throw new Error(
    "Set DATABASE_URL (source) and a different PREVIEW_DATABASE_URL",
  );
if (!/preview|_test_/.test(TARGET))
  throw new Error("PREVIEW_DATABASE_URL must name a preview or test database");

const EMAIL = "preview@example.com";
const POSTS = Number(process.env.PREVIEW_POSTS ?? 400);

async function main() {
  await runMigrations(TARGET!);
  const src = createDb(SOURCE!, { max: 2 });
  const dst = createDb(TARGET!, { max: 5 });
  try {
    await syncReferenceData(dst.db);
    await dst.db.execute(sql`truncate table users cascade`);
    await dst.db.execute(sql`truncate table job_posts cascade`);

    // Recent originals with their analysis; duplicates come along so "also posted in" shows.
    const posts = await src.db.execute<{ id: string }>(sql`
      select j.id from job_posts j join job_post_analyses a on a.job_post_id = j.id
      where j.duplicate_of is null and a.kind = 'hiring'
      order by j.posted_at desc limit ${POSTS}`);
    const ids = posts.rows.map((r) => r.id);
    const idArray = `{${ids.join(",")}}`;
    const copyPosts = await src.db
      .select()
      .from(jobPosts)
      .where(
        sql`${jobPosts.id} = any(${idArray}::uuid[]) or ${jobPosts.duplicateOf} = any(${idArray}::uuid[])`,
      );
    // Originals first, so a copy's duplicate_of points at a row that exists.
    copyPosts.sort(
      (a, b) => Number(a.duplicateOf !== null) - Number(b.duplicateOf !== null),
    );
    for (const p of copyPosts)
      await dst.db.insert(jobPosts).values({
        ...p,
        // Feeds aren't copied.
        firstSeenFeedId: null,
        matchStatus: p.duplicateOf ? p.matchStatus : "pending",
      });
    const analyses = await src.db
      .select()
      .from(jobPostAnalyses)
      .where(sql`${jobPostAnalyses.jobPostId} = any(${idArray}::uuid[])`);
    for (const a of analyses) await dst.db.insert(jobPostAnalyses).values(a);

    const now = new Date();
    const [u] = await dst.db
      .insert(users)
      .values({ authSub: `dev|${EMAIL}`, email: EMAIL, emailNormalized: EMAIL })
      .returning({ id: users.id });
    await dst.db.insert(profiles).values({
      userId: u!.id,
      displayName: "Preview",
      categories: ["video", "development"],
      experienceLevel: "intermediate",
      country: "US",
      timeZone: "Asia/Kolkata",
      minRateMinor: 2000,
      currency: "USD",
      rateType: "either",
      remoteOnly: true,
      onboardedAt: now,
      trialEndsAt: new Date(now.getTime() + 5 * 86_400_000),
    });
    const skills: [string, "core" | "secondary"][] = [
      ["video-editing", "core"],
      ["short-form-video", "core"],
      ["python", "core"],
      ["automation", "secondary"],
      ["rest-api", "secondary"],
      ["sql", "secondary"],
      ["typescript", "secondary"],
    ];
    for (const [skillId, level] of skills)
      await dst.db
        .insert(profileSkills)
        .values({ userId: u!.id, skillId, level, source: "manual" });

    const log = pino({ level: "warn" });
    const matcher = createMatcher({
      db: dst.db,
      log,
      listen: async () => ({ onNotify() {}, async close() {} }),
      threshold: null,
      // Copies keep their real posting time; allow the whole copied range.
      maxAgeDays: 30,
    });
    await matcher.start();
    await matcher.idle();
    await matcher.stop();
    const n = await dst.db.execute<{ n: number }>(
      sql`select count(*)::int as n from matches`,
    );
    console.log(
      `preview: ${copyPosts.length} posts, ${analyses.length} analyses, ${n.rows[0]!.n} matches for ${EMAIL}`,
    );
  } finally {
    await src.pool.end();
    await dst.pool.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
