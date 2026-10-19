import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import {
  MAX_DRAFT_ATTEMPTS,
  addEvalCandidate,
  claimNextDrafts,
  completeDraft,
  createDraftJob,
  draftVersions,
  expireStuckDrafts,
  failDraft,
  requeueStaleDrafts,
  type CompleteDraftInput,
  type DraftClaim,
} from "./draft-jobs";
import { runMigrations } from "./migrate";
import {
  creditBalances,
  creditLedger,
  draftEvalCandidates,
  drafts,
  jobPosts,
  matches,
  users,
} from "./schema";

// Phase 7 (docs/drafts/plan/07-worker-drafts.md): the worker's side of the drafts queue.

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 6 });

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table job_posts, llm_usage cascade`);
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
let seq = 0;

async function seedUser(balance = 210): Promise<string> {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|q${seq}-${Math.random()}`,
      email: `q${seq}@example.com`,
      emailNormalized: `q${seq}-${Math.random()}@example.com`,
    })
    .returning({ id: users.id });
  const now = new Date();
  await db.insert(creditBalances).values({
    userId: u!.id,
    plan: "trial",
    balance,
    periodStart: now,
    periodEnd: new Date(now.getTime() + 5 * DAY),
  });
  return u!.id;
}

async function seedMatch(userId: string) {
  seq++;
  const now = new Date();
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_q${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/q${seq}/x/`,
      title: "[Hiring] Gig",
      body: "Need help.",
      postedAt: now,
      preKind: "hiring",
    })
    .returning({ id: jobPosts.id });
  const [m] = await db
    .insert(matches)
    .values({
      userId,
      jobPostId: p!.id,
      postedAt: now,
      ruleScore: 50,
      broad: false,
      features: [],
      ruleReason: "r",
      aiStatus: "not_needed",
      score: 50,
      profileVersion: 1,
      analysedAt: now,
    })
    .returning({ id: matches.id });
  return { matchId: m!.id, jobPostId: p!.id };
}

/** A queued v1 draft with 7 credits reserved. */
async function queued(userId?: string) {
  const uid = userId ?? (await seedUser());
  const m = await seedMatch(uid);
  const r = await createDraftJob(db, {
    userId: uid,
    matchId: m.matchId,
    jobPostId: m.jobPostId,
    version: 1,
    kind: "draft",
    credits: 7,
    idempotencyKey: `k-${Math.random()}`,
  });
  if (!("draft" in r)) throw new Error("no draft");
  return { userId: uid, draft: r.draft, ...m };
}

const row = async (id: string) =>
  (await db.select().from(drafts).where(eq(drafts.id, id)))[0]!;
const balanceOf = async (userId: string) =>
  (
    await db
      .select({ balance: creditBalances.balance })
      .from(creditBalances)
      .where(eq(creditBalances.userId, userId))
  )[0]!.balance;
const refundRows = (draftId: string) =>
  db
    .select()
    .from(creditLedger)
    .where(
      and(eq(creditLedger.draftId, draftId), eq(creditLedger.reason, "refund")),
    );

async function claimOne(): Promise<DraftClaim> {
  const [c] = await claimNextDrafts(db, 1);
  if (!c) throw new Error("nothing claimed");
  return c;
}

const RESULT: CompleteDraftInput = {
  problem: "Their checkout is slow",
  citedFact: "Built a booking site",
  applyFollowed: null,
  comment: "Built something like this. Sent you a DM.",
  dm: "Hi, your checkout sounds slow.",
  evidence: { project: null },
  styleTags: ["problem_first"],
  warning: false,
  problems: [],
  model: "gemini-test",
  promptVersion: "draft@1",
  inputTokens: 100,
  outputTokens: 50,
  costMicros: 300,
  timings: { load: 3, ai: 40 },
};

describe("claimNextDrafts", () => {
  it("claims due pending drafts oldest first, marks them running and counts the attempt", async () => {
    const a = await queued();
    const b = await queued();
    const later = await queued();
    await db
      .update(drafts)
      .set({ runAfter: sql`now() + interval '1 hour'` })
      .where(eq(drafts.id, later.draft.id));

    const claims = await claimNextDrafts(db, 5);
    expect(claims.map((c) => c.id)).toEqual([a.draft.id, b.draft.id]);
    expect(claims[0]).toMatchObject({
      userId: a.userId,
      matchId: a.matchId,
      jobPostId: a.jobPostId,
      version: 1,
      kind: "draft",
      attempts: 1,
    });
    const r = await row(a.draft.id);
    expect(r.status).toBe("running");
    expect(r.lockedAt).not.toBeNull();
    expect((await row(later.draft.id)).status).toBe("pending");
    expect(await claimNextDrafts(db, 5)).toEqual([]);
  });

  it("respects the limit", async () => {
    await queued();
    await queued();
    expect(await claimNextDrafts(db, 1)).toHaveLength(1);
    expect(await claimNextDrafts(db, 0)).toEqual([]);
  });

  it("two claimers at once never get the same draft (SKIP LOCKED)", async () => {
    const userId = await seedUser(1000);
    for (let i = 0; i < 10; i++) await queued(userId);
    const c1 = createDb(url, { max: 1 });
    const c2 = createDb(url, { max: 1 });
    try {
      const [x, y] = await Promise.all([
        claimNextDrafts(c1.db, 10),
        claimNextDrafts(c2.db, 10),
      ]);
      const ids = [...x, ...y].map((c) => c.id);
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
    } finally {
      await c1.pool.end();
      await c2.pool.end();
    }
  });
});

describe("completeDraft", () => {
  it("saves the draft and marks it done; the credits stay reserved", async () => {
    const q = await queued();
    const claim = await claimOne();
    expect(await completeDraft(db, claim, RESULT)).toBe(true);
    const r = await row(q.draft.id);
    expect(r).toMatchObject({
      status: "done",
      comment: RESULT.comment,
      dm: RESULT.dm,
      problem: RESULT.problem,
      citedFact: RESULT.citedFact,
      evidence: RESULT.evidence,
      styleTags: ["problem_first"],
      warning: false,
      problems: [],
      model: "gemini-test",
      promptVersion: "draft@1",
      inputTokens: 100,
      outputTokens: 50,
      costMicros: 300,
      timings: { load: 3, ai: 40 },
      lockedAt: null,
      error: null,
      credits: 7,
    });
    expect(r.finishedAt).not.toBeNull();
    expect(await balanceOf(q.userId)).toBe(203);
  });

  it("needs only the comment and the DM", async () => {
    const q = await queued();
    const claim = await claimOne();
    expect(
      await completeDraft(db, claim, { comment: "Sent you a DM.", dm: "Hi" }),
    ).toBe(true);
    expect(await row(q.draft.id)).toMatchObject({
      status: "done",
      warning: false,
    });
  });

  it("is fenced on the claim: a lost claim (requeued and claimed again) writes nothing", async () => {
    const q = await queued();
    const first = await claimOne();
    await db
      .update(drafts)
      .set({ status: "pending" })
      .where(eq(drafts.id, q.draft.id));
    const second = await claimOne();
    expect(second.attempts).toBe(2);
    expect(await completeDraft(db, first, RESULT)).toBe(false);
    expect((await row(q.draft.id)).status).toBe("running");
    expect(await completeDraft(db, second, RESULT)).toBe(true);
    expect(await completeDraft(db, second, RESULT)).toBe(false);
  });
});

describe("failDraft", () => {
  it("a retryable failure under 3 attempts goes back to pending with a 2^attempts s backoff", async () => {
    const q = await queued();
    const claim = await claimOne();
    expect(
      await failDraft(db, claim, {
        code: "LLM_INVALID_OUTPUT",
        retryable: true,
        countAttempt: true,
      }),
    ).toBe("requeued");
    const r = await row(q.draft.id);
    expect(r).toMatchObject({
      status: "pending",
      attempts: 1,
      error: "LLM_INVALID_OUTPUT",
      lockedAt: null,
    });
    const { rows } = await db.execute<{ secs: number }>(
      sql`select extract(epoch from run_after - now())::float as secs from drafts where id = ${q.draft.id}`,
    );
    expect(rows[0]!.secs).toBeGreaterThan(1);
    expect(rows[0]!.secs).toBeLessThanOrEqual(2.1);
    expect(await refundRows(q.draft.id)).toHaveLength(0);
    expect(await balanceOf(q.userId)).toBe(203);
  });

  it("a provider failure gives the attempt back and doesn't refund", async () => {
    const q = await queued();
    const claim = await claimOne();
    expect(
      await failDraft(db, claim, {
        code: "LLM_RATE_LIMITED",
        retryable: true,
        countAttempt: false,
      }),
    ).toBe("requeued");
    expect(await row(q.draft.id)).toMatchObject({
      status: "pending",
      attempts: 0,
    });
    expect(await refundRows(q.draft.id)).toHaveLength(0);
  });

  it("retryInSec 0 makes it due at once (shutdown)", async () => {
    const q = await queued();
    const claim = await claimOne();
    await failDraft(db, claim, {
      code: "SHUTDOWN",
      retryable: true,
      countAttempt: false,
      retryInSec: 0,
    });
    expect((await claimNextDrafts(db, 1))[0]?.id).toBe(q.draft.id);
  });

  it("a final failure marks it failed and refunds in the same transaction", async () => {
    const q = await queued();
    const claim = await claimOne();
    expect(
      await failDraft(db, claim, {
        code: "MATCH_GONE",
        retryable: false,
        countAttempt: true,
      }),
    ).toBe("failed");
    const r = await row(q.draft.id);
    expect(r).toMatchObject({
      status: "failed",
      error: "MATCH_GONE",
      credits: 0,
    });
    expect(r.finishedAt).not.toBeNull();
    expect(await refundRows(q.draft.id)).toHaveLength(1);
    expect(await balanceOf(q.userId)).toBe(210);
  });

  it(`a retryable failure on attempt ${MAX_DRAFT_ATTEMPTS} fails and refunds`, async () => {
    const q = await queued();
    let claim = await claimOne();
    for (let i = 1; i < MAX_DRAFT_ATTEMPTS; i++) {
      expect(
        await failDraft(db, claim, {
          code: "DRAFT_TIMEOUT",
          retryable: true,
          countAttempt: true,
          retryInSec: 0,
        }),
      ).toBe("requeued");
      claim = await claimOne();
    }
    expect(claim.attempts).toBe(MAX_DRAFT_ATTEMPTS);
    expect(
      await failDraft(db, claim, {
        code: "DRAFT_TIMEOUT",
        retryable: true,
        countAttempt: true,
      }),
    ).toBe("failed");
    expect(await refundRows(q.draft.id)).toHaveLength(1);
    expect(await balanceOf(q.userId)).toBe(210);
  });

  it("refunds exactly once: the same claim failed twice is lost the second time", async () => {
    const q = await queued();
    const claim = await claimOne();
    const fail = { code: "MATCH_GONE", retryable: false, countAttempt: true };
    const [a, b] = await Promise.all([
      failDraft(db, claim, fail),
      failDraft(db, claim, fail),
    ]);
    expect([a, b].sort()).toEqual(["failed", "lost"]);
    expect(await refundRows(q.draft.id)).toHaveLength(1);
    expect(await balanceOf(q.userId)).toBe(210);
  });

  it("a lost claim writes nothing and refunds nothing", async () => {
    const q = await queued();
    const claim = await claimOne();
    await completeDraft(db, claim, RESULT);
    expect(
      await failDraft(db, claim, {
        code: "MATCH_GONE",
        retryable: false,
        countAttempt: true,
      }),
    ).toBe("lost");
    expect((await row(q.draft.id)).status).toBe("done");
    expect(await refundRows(q.draft.id)).toHaveLength(0);
  });
});

describe("requeueStaleDrafts", () => {
  const age = (id: string, secs: number) =>
    db
      .update(drafts)
      .set({ lockedAt: sql`now() - make_interval(secs => ${secs})` })
      .where(eq(drafts.id, id));

  it("puts running drafts with an old lock back; fresh ones stay", async () => {
    const stale = await queued();
    const fresh = await queued();
    await claimNextDrafts(db, 2);
    await age(stale.draft.id, 120);
    expect(await requeueStaleDrafts(db)).toBe(1);
    expect(await row(stale.draft.id)).toMatchObject({
      status: "pending",
      lockedAt: null,
      attempts: 1,
    });
    expect((await row(fresh.draft.id)).status).toBe("running");
  });

  it(`a stale draft already on attempt ${MAX_DRAFT_ATTEMPTS} fails and is refunded once`, async () => {
    const q = await queued();
    await claimOne();
    await db
      .update(drafts)
      .set({ attempts: MAX_DRAFT_ATTEMPTS })
      .where(eq(drafts.id, q.draft.id));
    await age(q.draft.id, 120);
    expect(await requeueStaleDrafts(db)).toBe(1);
    expect(await row(q.draft.id)).toMatchObject({
      status: "failed",
      error: "STALE",
      credits: 0,
    });
    expect(await requeueStaleDrafts(db)).toBe(0);
    expect(await refundRows(q.draft.id)).toHaveLength(1);
    expect(await balanceOf(q.userId)).toBe(210);
  });

  it("takes the age in seconds", async () => {
    const q = await queued();
    await claimOne();
    await age(q.draft.id, 20);
    expect(await requeueStaleDrafts(db, 60)).toBe(0);
    expect(await requeueStaleDrafts(db, 10)).toBe(1);
  });
});

describe("expireStuckDrafts (M4)", () => {
  const ageCreated = (id: string, secs: number) =>
    db
      .update(drafts)
      .set({ createdAt: sql`now() - make_interval(secs => ${secs})` })
      .where(eq(drafts.id, id));

  it("fails a pending draft created 11 minutes ago with EXPIRED and refunds once", async () => {
    const q = await queued();
    await ageCreated(q.draft.id, 11 * 60);
    expect(await balanceOf(q.userId)).toBe(203);
    expect(await expireStuckDrafts(db)).toBe(1);
    expect(await row(q.draft.id)).toMatchObject({
      status: "failed",
      error: "EXPIRED",
      credits: 0,
      lockedAt: null,
    });
    expect(await refundRows(q.draft.id)).toHaveLength(1);
    expect(await balanceOf(q.userId)).toBe(210);
    expect(await expireStuckDrafts(db)).toBe(0);
  });

  it("expired twice at once still refunds exactly once", async () => {
    const q = await queued();
    await ageCreated(q.draft.id, 11 * 60);
    const results = await Promise.all([
      expireStuckDrafts(db),
      expireStuckDrafts(db, { draftId: q.draft.id }),
      expireStuckDrafts(db, { draftId: q.draft.id }),
    ]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await refundRows(q.draft.id)).toHaveLength(1);
    expect(await balanceOf(q.userId)).toBe(210);
  });

  it("expires a running draft too; a fresh or finished one is left alone", async () => {
    const running = await queued();
    const fresh = await queued();
    const done = await queued();
    await claimNextDrafts(db, 3);
    const claimDone = await row(done.draft.id);
    await completeDraft(db, claimDone, RESULT);
    await ageCreated(running.draft.id, 11 * 60);
    await ageCreated(done.draft.id, 11 * 60);
    expect(await expireStuckDrafts(db)).toBe(1);
    expect((await row(running.draft.id)).status).toBe("failed");
    expect((await row(fresh.draft.id)).status).toBe("running");
    expect((await row(done.draft.id)).status).toBe("done");
    // The worker's late finish of the expired draft is fenced off.
    const late = await completeDraft(
      db,
      { id: running.draft.id, attempts: 1 },
      RESULT,
    );
    expect(late).toBe(false);
  });

  it("with a draftId only touches that draft", async () => {
    const a = await queued();
    const b = await queued();
    await ageCreated(a.draft.id, 11 * 60);
    await ageCreated(b.draft.id, 11 * 60);
    expect(await expireStuckDrafts(db, { draftId: a.draft.id })).toBe(1);
    expect((await row(b.draft.id)).status).toBe("pending");
  });
});

describe("addEvalCandidate", () => {
  it("adds one row per draft and reason; a repeat does nothing", async () => {
    const q = await queued();
    await addEvalCandidate(db, q.draft.id, "validator_failed_twice");
    await addEvalCandidate(db, q.draft.id, "validator_failed_twice");
    await addEvalCandidate(db, q.draft.id, "many_rewrites");
    const rows = await db
      .select({ reason: draftEvalCandidates.reason })
      .from(draftEvalCandidates)
      .where(eq(draftEvalCandidates.draftId, q.draft.id));
    expect(rows.map((r) => r.reason).sort()).toEqual([
      "many_rewrites",
      "validator_failed_twice",
    ]);
  });
});

describe("draftVersions", () => {
  it("lists the user's versions for a match in order", async () => {
    const q = await queued();
    const claim = await claimOne();
    await completeDraft(db, claim, RESULT);
    const r = await createDraftJob(db, {
      userId: q.userId,
      matchId: q.matchId,
      jobPostId: q.jobPostId,
      version: 2,
      parentId: q.draft.id,
      kind: "rewrite",
      option: "shorter",
      credits: 1,
      idempotencyKey: "v2",
    });
    if (!("draft" in r)) throw new Error("no draft");
    const other = await seedUser();
    const versions = await draftVersions(db, {
      userId: q.userId,
      matchId: q.matchId,
    });
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [1, "done"],
      [2, "pending"],
    ]);
    expect(versions[0]).toMatchObject({
      id: q.draft.id,
      comment: RESULT.comment,
      dm: RESULT.dm,
      evidence: RESULT.evidence,
    });
    expect(
      await draftVersions(db, { userId: other, matchId: q.matchId }),
    ).toEqual([]);
  });
});
