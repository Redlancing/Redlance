import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import {
  jobPosts,
  llmUsage,
  matches,
  profiles,
  rescoreUsage,
  users,
} from "./schema";
import { matchingStats, matchUserReport } from "./match-stats";
import { runMigrations } from "./migrate";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 5 });

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(
    sql`truncate table match_events, matches, job_post_analyses, job_posts, llm_usage cascade`,
  );
};

beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

const DAY = 86_400_000;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

let seq = 0;
async function seedUser(plan: "trial" | "standard" | "max", now: Date) {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|s${seq}`,
      email: `s${seq}@example.com`,
      emailNormalized: `s${seq}@example.com`,
    })
    .returning({ id: users.id });
  await db.insert(profiles).values({
    userId: u!.id,
    displayName: `Stats ${seq}`,
    categories: ["development"],
    experienceLevel: "experienced",
    country: "GB",
    timeZone: "Europe/London",
    minRateMinor: 3000,
    currency: "USD",
    rateType: "either",
    remoteOnly: false,
    onboardedAt: now,
    trialEndsAt: new Date(now.getTime() + 5 * DAY),
    plan,
  });
  return u!.id;
}

async function seedPost(
  n: number,
  over: {
    matchStatus?: "pending" | "running" | "done" | "skipped" | null;
    firstSeenAt?: Date;
    duplicateOf?: string | null;
  } = {},
) {
  const [row] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_stats${n}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/stats${n}/x/`,
      title: `[Hiring] Stats gig ${n}`,
      body: "Need help.",
      postedAt: new Date(Date.now() - DAY),
      firstSeenAt: over.firstSeenAt,
      preKind: "hiring",
      analysisStatus: "done",
      duplicateOf: over.duplicateOf ?? null,
      matchStatus: over.matchStatus === undefined ? null : over.matchStatus,
    })
    .returning({ id: jobPosts.id });
  return row!.id;
}

async function seedMatch(
  userId: string,
  postId: string,
  over: {
    broad?: boolean;
    aiStatus?:
      "not_needed" | "pending" | "running" | "done" | "failed" | "capped";
    createdAt?: Date;
    updatedAt?: Date;
    aiScoredAt?: Date | null;
    aiFinishedAt?: Date | null;
    score?: number;
  } = {},
) {
  await db.insert(matches).values({
    userId,
    jobPostId: postId,
    postedAt: new Date(Date.now() - DAY),
    ruleScore: 70,
    broad: over.broad ?? false,
    features: [],
    ruleReason: "2 of your core skills",
    aiStatus: over.aiStatus ?? "not_needed",
    score: over.score ?? 70,
    profileVersion: 1,
    analysedAt: new Date(Date.now() - DAY),
    createdAt: over.createdAt,
    updatedAt: over.updatedAt,
    aiScoredAt: over.aiScoredAt ?? null,
    aiFinishedAt: over.aiFinishedAt ?? null,
  });
}

describe("matchingStats", () => {
  // Case 1: correct counts for each number, on seeded data.
  it("counts posts, matches, AI outcomes, spend, caps and duplicates", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 2 * DAY);
    const yesterday = new Date(now.getTime() - DAY);

    // Posts: 2 pending, 1 running, 3 done in 24 h (plus 1 done from 2 days ago), 1 skipped.
    const p1 = await seedPost(1, { matchStatus: "pending" });
    const p2 = await seedPost(2, { matchStatus: "pending" });
    await seedPost(3, { matchStatus: "running" });
    const d1 = await seedPost(4, { matchStatus: "done" });
    await seedPost(5, { matchStatus: "done" });
    await seedPost(6, { matchStatus: "done" });
    await seedPost(7, { matchStatus: "done", firstSeenAt: old });
    await seedPost(8, { matchStatus: "skipped" });
    // A duplicate copy from today: never matched, so it has no match status.
    await seedPost(9, { duplicateOf: d1, matchStatus: null });
    // Old posts outside 24 h are ignored entirely.
    await seedPost(10, { matchStatus: "pending", firstSeenAt: old });

    const alice = await seedUser("standard", now);
    const bob = await seedUser("trial", now);
    const carol = await seedUser("max", now);

    // Matches created in 24 h: 5 for alice (1 broad) and 1 for bob.
    const posts = [p1, p2, d1];
    const a1 = await seedPost(20);
    const a2 = await seedPost(21);
    const a3 = await seedPost(22);
    const a4 = await seedPost(23);
    const a5 = await seedPost(24);
    const a6 = await seedPost(25);
    await seedMatch(alice, a1, {
      aiStatus: "done",
      aiScoredAt: now,
      aiFinishedAt: now,
    });
    await seedMatch(alice, a2, { aiStatus: "capped", aiFinishedAt: now });
    await seedMatch(alice, a3, { aiStatus: "failed", aiFinishedAt: now });
    await seedMatch(alice, a4, { aiStatus: "pending" });
    await seedMatch(alice, a5, { broad: true, aiStatus: "not_needed" });
    // Old match (created and scored 2 days ago): not in any 24 h count.
    await seedMatch(alice, a6, {
      aiStatus: "done",
      createdAt: old,
      updatedAt: old,
      aiScoredAt: old,
      aiFinishedAt: old,
    });
    await seedMatch(bob, posts[0]!, { aiStatus: "pending" });
    // Finished 2 days ago, touched today (saved, dismissed): the finish time decides, so
    // neither counts. A pending pair from 2 days ago is still in the backlog.
    const b1 = await seedPost(26);
    const b2 = await seedPost(27);
    const b3 = await seedPost(28);
    await seedMatch(bob, b1, {
      aiStatus: "capped",
      createdAt: old,
      updatedAt: now,
      aiFinishedAt: old,
    });
    await seedMatch(bob, b2, {
      aiStatus: "failed",
      createdAt: old,
      updatedAt: now,
      aiFinishedAt: old,
    });
    await seedMatch(bob, b3, {
      aiStatus: "pending",
      createdAt: old,
      updatedAt: old,
    });

    // Spend today: 5000 + 7300 micros on match_rescore, plus a yesterday row and another task.
    await db.insert(llmUsage).values([
      llmUsageRow({
        task: "match_rescore",
        costMicros: 5_000,
        createdAt: now,
      }),
      llmUsageRow({
        task: "match_rescore",
        costMicros: 7_300,
        createdAt: now,
      }),
      llmUsageRow({
        task: "match_rescore",
        costMicros: 99_000,
        createdAt: yesterday,
      }),
      llmUsageRow({
        task: "job_analysis",
        costMicros: 500_000,
        createdAt: now,
      }),
    ]);

    // Usage today: alice (standard, 15 of 15) and carol (max, 50 of 50) are at cap; bob (trial, 14 of 15) is not.
    // Yesterday's row for bob at 15 must not count.
    await db.insert(rescoreUsage).values([
      { userId: alice, day: utcDay(now), used: 15 },
      { userId: carol, day: utcDay(now), used: 50 },
      { userId: bob, day: utcDay(now), used: 14 },
      { userId: bob, day: utcDay(yesterday), used: 15 },
    ]);

    const stats = await matchingStats(db, now);
    expect(stats).toEqual({
      posts: { pending: 2, running: 1, done: 3, skipped: 1 },
      matchesCreated: 6,
      matchesBroad: 1,
      ai: { done: 1, capped: 1, failed: 1, pending: 3 },
      rescoreSpendMicros: 12_300,
      usersAtCap: 2,
    });
  });
});

describe("matchUserReport", () => {
  it("returns null for an unknown email, and one user's counts otherwise", async () => {
    const now = new Date();
    expect(await matchUserReport(db, "nobody@example.com", now)).toBeNull();

    const alice = await seedUser("standard", now);
    const scored = await seedPost(30);
    const other = await seedPost(31);
    await seedMatch(alice, scored, {
      aiStatus: "done",
      aiScoredAt: now,
      score: 85,
    });
    await seedMatch(alice, other, { aiStatus: "not_needed", score: 60 });
    await db.insert(rescoreUsage).values({
      userId: alice,
      day: utcDay(now),
      used: 3,
    });

    const report = await matchUserReport(db, "s" + seq + "@example.com", now);
    expect(report).not.toBeNull();
    expect(report!.plan).toBe("standard");
    expect(report!.aiAllowed).toBe(true);
    expect(report!.usedToday).toBe(3);
    expect(report!.cap).toBe(15);
    expect(report!.byAiStatus.done).toBe(1);
    expect(report!.byAiStatus.not_needed).toBe(1);
    expect(report!.byStatus.new).toBe(2);
    expect(report!.top).toHaveLength(2);
    expect(report!.top[0]!.title).toBe("[Hiring] Stats gig 30");
  });
});

function llmUsageRow(over: {
  task: string;
  costMicros: number;
  createdAt: Date;
}) {
  return {
    task: over.task,
    step: "score",
    promptVersion: "test@1",
    model: "gemini-test",
    inputTokens: 1,
    outputTokens: 1,
    costMicros: over.costMicros,
    latencyMs: 1,
    attempt: 1,
    outcome: "ok" as const,
    createdAt: over.createdAt,
  };
}
