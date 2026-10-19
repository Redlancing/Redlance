import * as core from "@redlance/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  creditBalances,
  creditLedger,
  createDb,
  DRAFT_KIND_VALUES,
  DRAFT_STATUS_VALUES,
  draftEvalCandidates,
  draftFeedback,
  drafts,
  EVAL_CANDIDATE_REASON_VALUES,
  EVAL_REVIEW_STATUS_VALUES,
  EXAMPLE_SOURCE_VALUES,
  jobPostAnalyses,
  jobPosts,
  LEDGER_REASON_VALUES,
  matches,
  OUTCOME_TYPE_VALUES,
  outcomes,
  pgErrorCode,
  REPLY_KIND_VALUES,
  REPLY_STATUS_VALUES,
  replies,
  users,
  VOICE_UPDATE_STATUS_VALUES,
  voiceProfiles,
  draftExamples,
} from "./index";
import { runMigrations } from "./migrate";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 2 });

beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table job_posts cascade`);
});
afterAll(async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table job_posts cascade`);
  await db.execute(sql`truncate table draft_examples`);
  await pool.end();
});

const check = (err: unknown) => pgErrorCode(err) === "23514";
const unique = (err: unknown) => pgErrorCode(err) === "23505";
let seq = 0;

async function seed() {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|${seq}-${Math.random()}`,
      email: "a@example.com",
      emailNormalized: `${seq}-${Math.random()}@example.com`,
    })
    .returning();
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_d${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/d${seq}/x/`,
      title: "[Hiring] Gig",
      body: "Need help.",
      postedAt: new Date(),
      preKind: "hiring",
    })
    .returning();
  const [m] = await db
    .insert(matches)
    .values({
      userId: u!.id,
      jobPostId: p!.id,
      postedAt: new Date(),
      ruleScore: 50,
      broad: false,
      features: [],
      ruleReason: "r",
      aiStatus: "not_needed",
      score: 50,
      profileVersion: 1,
      analysedAt: new Date(),
    })
    .returning();
  return { userId: u!.id, postId: p!.id, matchId: m!.id };
}
type Seed = Awaited<ReturnType<typeof seed>>;

const draftRow = (s: Seed, over: Partial<typeof drafts.$inferInsert> = {}) => ({
  userId: s.userId,
  matchId: s.matchId,
  jobPostId: s.postId,
  version: 1,
  kind: "draft" as const,
  ...over,
});
const replyRow = (
  s: Seed,
  over: Partial<typeof replies.$inferInsert> = {},
) => ({
  userId: s.userId,
  matchId: s.matchId,
  jobPostId: s.postId,
  kind: "comment" as const,
  sentText: "hello",
  sentAt: new Date(),
  ...over,
});

describe("drafts constraints", () => {
  it("rejects version 6 (and 0)", async () => {
    const s = await seed();
    await expect(
      db.insert(drafts).values(draftRow(s, { version: 6 })),
    ).rejects.toSatisfy(check);
    await expect(
      db.insert(drafts).values(draftRow(s, { version: 0 })),
    ).rejects.toSatisfy(check);
    await db.insert(drafts).values(draftRow(s, { version: 5 }));
  });
  it("rejects the same (user, match, version) twice", async () => {
    const s = await seed();
    await db.insert(drafts).values(draftRow(s));
    await expect(db.insert(drafts).values(draftRow(s))).rejects.toSatisfy(
      unique,
    );
  });
  it("a failed version frees its number (H1)", async () => {
    const s = await seed();
    await db.insert(drafts).values(draftRow(s, { status: "failed" }));
    await db.insert(drafts).values(draftRow(s, { status: "failed" }));
    await db.insert(drafts).values(draftRow(s));
    await expect(db.insert(drafts).values(draftRow(s))).rejects.toSatisfy(
      unique,
    );
  });
  it("rejects a repeated idempotency key but allows null keys twice", async () => {
    const s = await seed();
    await db.insert(drafts).values(draftRow(s, { idempotencyKey: "k" }));
    await expect(
      db
        .insert(drafts)
        .values(draftRow(s, { version: 2, idempotencyKey: "k" })),
    ).rejects.toSatisfy(unique);
    await db.insert(drafts).values(draftRow(s, { version: 2 }));
    await db.insert(drafts).values(draftRow(s, { version: 3 }));
  });
  it("limits the instruction to 200 characters", async () => {
    const s = await seed();
    await expect(
      db.insert(drafts).values(draftRow(s, { instruction: "x".repeat(201) })),
    ).rejects.toSatisfy(check);
    await db
      .insert(drafts)
      .values(draftRow(s, { instruction: "x".repeat(200) }));
  });
  it("rejects negative credits", async () => {
    const s = await seed();
    await expect(
      db.insert(drafts).values(draftRow(s, { credits: -1 })),
    ).rejects.toSatisfy(check);
  });
});

describe("other constraints", () => {
  it("keeps a credit balance at 0 or more", async () => {
    const s = await seed();
    const now = new Date();
    await expect(
      db.insert(creditBalances).values({
        userId: s.userId,
        plan: "trial",
        balance: -1,
        periodStart: now,
        periodEnd: now,
      }),
    ).rejects.toSatisfy(check);
  });
  it("allows one reply per (user, post, kind)", async () => {
    const s = await seed();
    await db.insert(replies).values(replyRow(s));
    await expect(db.insert(replies).values(replyRow(s))).rejects.toSatisfy(
      unique,
    );
    await db.insert(replies).values(replyRow(s, { kind: "dm" }));
  });
  it("limits sent_text to 10,000 characters", async () => {
    const s = await seed();
    await expect(
      db.insert(replies).values(replyRow(s, { sentText: "x".repeat(10_001) })),
    ).rejects.toSatisfy(check);
  });
  it("limits voice notes to 600 characters and 2 best replies", async () => {
    const s = await seed();
    await expect(
      db
        .insert(voiceProfiles)
        .values({ userId: s.userId, notes: "x".repeat(601) }),
    ).rejects.toSatisfy(check);
    const id = "00000000-0000-0000-0000-000000000001";
    await expect(
      db
        .insert(voiceProfiles)
        .values({ userId: s.userId, bestReplyIds: [id, id, id] }),
    ).rejects.toSatisfy(check);
    await db.insert(voiceProfiles).values({
      userId: s.userId,
      notes: "x".repeat(600),
      bestReplyIds: [id, id],
    });
  });
  it("rejects a negative agreed rate", async () => {
    const s = await seed();
    const [r] = await db.insert(replies).values(replyRow(s)).returning();
    await expect(
      db.insert(outcomes).values({
        replyId: r!.id,
        userId: s.userId,
        type: "hired",
        agreedRateMinor: -1,
      }),
    ).rejects.toSatisfy(check);
  });
  it("limits apply_instructions to 300 characters", async () => {
    const s = await seed();
    const row = {
      jobPostId: s.postId,
      pipelineVersion: "post@1",
      kind: "hiring" as const,
      employmentType: "freelance" as const,
      payType: "paid" as const,
      categories: [],
      skillIds: [],
      remote: "remote" as const,
      redFlags: [],
      summary: "s",
      model: "m",
    };
    await expect(
      db
        .insert(jobPostAnalyses)
        .values({ ...row, applyInstructions: "x".repeat(301) }),
    ).rejects.toSatisfy(check);
    await db
      .insert(jobPostAnalyses)
      .values({ ...row, applyInstructions: "x".repeat(300) });
  });
});

describe("cascades", () => {
  it("deletes everything of a user with the user", async () => {
    const s = await seed();
    const [d] = await db.insert(drafts).values(draftRow(s)).returning();
    const now = new Date();
    await db.insert(creditBalances).values({
      userId: s.userId,
      plan: "trial",
      balance: 10,
      periodStart: now,
      periodEnd: now,
    });
    await db.insert(creditLedger).values({
      userId: s.userId,
      delta: -7,
      reason: "reserve",
      draftId: d!.id,
    });
    const [r] = await db.insert(replies).values(replyRow(s)).returning();
    await db
      .insert(outcomes)
      .values({ replyId: r!.id, userId: s.userId, type: "replied" });
    await db.insert(voiceProfiles).values({ userId: s.userId });
    await db.insert(draftFeedback).values({ userId: s.userId, draftId: d!.id });
    await db.delete(users).where(eq(users.id, s.userId));
    for (const t of [
      drafts,
      creditBalances,
      creditLedger,
      replies,
      outcomes,
      voiceProfiles,
      draftFeedback,
    ]) {
      expect(await db.select().from(t)).toHaveLength(0);
    }
  });
  it("deletes drafts with their match and nulls a reply's draft_id", async () => {
    const s = await seed();
    const [d] = await db.insert(drafts).values(draftRow(s)).returning();
    const [r] = await db
      .insert(replies)
      .values(replyRow(s, { draftId: d!.id }))
      .returning();
    await db.delete(matches).where(eq(matches.id, s.matchId));
    expect(await db.select().from(drafts)).toHaveLength(0);
    const [after] = await db
      .select()
      .from(replies)
      .where(eq(replies.id, r!.id));
    expect(after!.draftId).toBeNull();
    expect(after!.matchId).toBeNull();
  });
});

describe("value lists", () => {
  it("rejects unknown values on each table", async () => {
    const s = await seed();
    const bad = (q: string) => db.execute(sql.raw(q));
    const now = new Date();
    await expect(
      db.insert(drafts).values(draftRow(s, { status: "zz" as never })),
    ).rejects.toSatisfy(check);
    await expect(
      db.insert(drafts).values(draftRow(s, { kind: "zz" as never })),
    ).rejects.toSatisfy(check);
    await expect(
      db.insert(drafts).values(draftRow(s, { option: "zz" as never })),
    ).rejects.toSatisfy(check);
    await expect(
      db.insert(replies).values(replyRow(s, { kind: "zz" as never })),
    ).rejects.toSatisfy(check);
    await expect(
      db.insert(replies).values(replyRow(s, { status: "zz" as never })),
    ).rejects.toSatisfy(check);
    await expect(
      db
        .insert(creditLedger)
        .values({ userId: s.userId, delta: 1, reason: "zz" as never }),
    ).rejects.toSatisfy(check);
    await expect(
      db.insert(creditBalances).values({
        userId: s.userId,
        plan: "zz" as never,
        balance: 1,
        periodStart: now,
        periodEnd: now,
      }),
    ).rejects.toSatisfy(check);
    const [r] = await db.insert(replies).values(replyRow(s)).returning();
    await expect(
      db
        .insert(outcomes)
        .values({ replyId: r!.id, userId: s.userId, type: "zz" as never }),
    ).rejects.toSatisfy(check);
    await expect(
      db
        .insert(voiceProfiles)
        .values({ userId: s.userId, updateStatus: "zz" as never }),
    ).rejects.toSatisfy(check);
    const [d] = await db.insert(drafts).values(draftRow(s)).returning();
    await expect(
      db
        .insert(draftEvalCandidates)
        .values({ draftId: d!.id, reason: "zz" as never }),
    ).rejects.toSatisfy(check);
    await expect(
      db.insert(draftEvalCandidates).values({
        draftId: d!.id,
        reason: "heavy_edit",
        reviewStatus: "zz" as never,
      }),
    ).rejects.toSatisfy(check);
    await expect(
      db.insert(draftExamples).values({
        id: "zz-1",
        jobType: "general",
        channel: "zz" as never,
        style: "s",
        postExcerpt: "p",
        text: "t",
        source: "handwritten",
      }),
    ).rejects.toSatisfy(check);
    await expect(
      db.insert(draftExamples).values({
        id: "zz-2",
        jobType: "general",
        channel: "dm",
        style: "s",
        postExcerpt: "p",
        text: "t",
        source: "zz" as never,
      }),
    ).rejects.toSatisfy(check);
    void bad;
  });
  it("allows one eval candidate per (draft, reason) and one feedback per (user, draft)", async () => {
    const s = await seed();
    const [d] = await db.insert(drafts).values(draftRow(s)).returning();
    const c = { draftId: d!.id, reason: "heavy_edit" as const };
    await db.insert(draftEvalCandidates).values(c);
    await expect(db.insert(draftEvalCandidates).values(c)).rejects.toSatisfy(
      unique,
    );
    const f = { userId: s.userId, draftId: d!.id };
    await db.insert(draftFeedback).values(f);
    await expect(db.insert(draftFeedback).values(f)).rejects.toSatisfy(unique);
  });
  it("matches the lists in @redlance/core", () => {
    expect(DRAFT_STATUS_VALUES).toEqual(core.DRAFT_STATUSES);
    expect(DRAFT_KIND_VALUES).toEqual(core.DRAFT_KINDS);
    expect(REPLY_KIND_VALUES).toEqual(core.REPLY_KINDS);
    expect(REPLY_STATUS_VALUES).toEqual(core.REPLY_STATUSES);
    expect(OUTCOME_TYPE_VALUES).toEqual(core.OUTCOME_TYPES);
    expect(LEDGER_REASON_VALUES).toEqual(core.LEDGER_REASONS);
    expect(EVAL_CANDIDATE_REASON_VALUES).toEqual(core.EVAL_CANDIDATE_REASONS);
    expect(EVAL_REVIEW_STATUS_VALUES).toEqual(core.EVAL_REVIEW_STATUSES);
    expect(VOICE_UPDATE_STATUS_VALUES).toEqual(core.VOICE_UPDATE_STATUSES);
    expect(EXAMPLE_SOURCE_VALUES).toEqual(core.EXAMPLE_SOURCES);
  });
});
