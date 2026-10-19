import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { reserveCredits } from "./credits";
import {
  DRAFTS_CHANNEL,
  createDraftJob,
  type CreateDraftJobInput,
} from "./draft-jobs";
import { runMigrations } from "./migrate";
import {
  creditBalances,
  creditLedger,
  drafts,
  jobPosts,
  llmUsage,
  matches,
  users,
} from "./schema";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 4 });

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
const now = new Date();
let seq = 0;

async function seedUser(
  balance: number,
  plan: "trial" | "standard" | "max" = "trial",
): Promise<string> {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|j${seq}-${Math.random()}`,
      email: `j${seq}@example.com`,
      emailNormalized: `j${seq}-${Math.random()}@example.com`,
    })
    .returning({ id: users.id });
  await db.insert(creditBalances).values({
    userId: u!.id,
    plan,
    balance,
    periodStart: now,
    periodEnd: new Date(now.getTime() + 5 * DAY),
  });
  return u!.id;
}

async function seedMatch(userId: string) {
  seq++;
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_j${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/j${seq}/x/`,
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

const input = (
  userId: string,
  m: { matchId: string; jobPostId: string },
  over: Partial<CreateDraftJobInput> = {},
): CreateDraftJobInput => ({
  userId,
  matchId: m.matchId,
  jobPostId: m.jobPostId,
  version: 1,
  kind: "draft",
  credits: 7,
  idempotencyKey: `k-${Math.random()}`,
  ...over,
});

const balanceOf = async (userId: string) =>
  (
    await db
      .select({ balance: creditBalances.balance })
      .from(creditBalances)
      .where(eq(creditBalances.userId, userId))
  )[0]?.balance;

const ledger = (userId: string) =>
  db
    .select({
      delta: creditLedger.delta,
      reason: creditLedger.reason,
      draftId: creditLedger.draftId,
    })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));

const draftsOf = (userId: string) =>
  db.select().from(drafts).where(eq(drafts.userId, userId));

/** Collects NOTIFY payloads on `channel` while `run` executes. */
async function notifications(
  channel: string,
  run: () => Promise<unknown>,
): Promise<string[]> {
  const listener = new pg.Client({ connectionString: url });
  await listener.connect();
  const got: string[] = [];
  listener.on("notification", (msg) => {
    if (msg.channel === channel) got.push(msg.payload ?? "");
  });
  await listener.query(`LISTEN ${channel}`);
  await run();
  await new Promise((r) => setTimeout(r, 200));
  await listener.end();
  return got;
}

/** Spends `used` credits today, as reserve rows on a throwaway draft. */
async function spendToday(userId: string, used: number) {
  const m = await seedMatch(userId);
  const [d] = await db
    .insert(drafts)
    .values({
      userId,
      matchId: m.matchId,
      jobPostId: m.jobPostId,
      version: 1,
      kind: "draft",
    })
    .returning({ id: drafts.id });
  const r = await reserveCredits(db, {
    userId,
    amount: used,
    draftId: d!.id,
  });
  expect(r.ok).toBe(true);
}

describe("createDraftJob", () => {
  it("12: happy path: a pending draft, a reserve row and a NOTIFY", async () => {
    const userId = await seedUser(210);
    const m = await seedMatch(userId);
    let result: Awaited<ReturnType<typeof createDraftJob>> | undefined;
    const got = await notifications(DRAFTS_CHANNEL, async () => {
      result = await createDraftJob(
        db,
        input(userId, m, { evidence: { facts: ["x"] } }),
      );
    });
    expect(result && "draft" in result).toBe(true);
    if (!result || !("draft" in result)) throw new Error("no draft");
    const { draft } = result;
    expect(result.created).toBe(true);
    expect(draft).toMatchObject({
      userId,
      matchId: m.matchId,
      status: "pending",
      version: 1,
      kind: "draft",
      credits: 7,
      evidence: { facts: ["x"] },
    });
    expect(got).toEqual([draft.id]);
    expect(await balanceOf(userId)).toBe(203);
    expect(await ledger(userId)).toEqual([
      { delta: -7, reason: "reserve", draftId: draft.id },
    ]);
  });

  it("13: the same idempotency key twice makes one draft and one reserve", async () => {
    const userId = await seedUser(210);
    const m = await seedMatch(userId);
    const req = input(userId, m, { idempotencyKey: "same" });
    const a = await createDraftJob(db, req);
    const b = await createDraftJob(db, req);
    if (!("draft" in a) || !("draft" in b)) throw new Error("no draft");
    expect(b.draft.id).toBe(a.draft.id);
    expect(b.created).toBe(false);
    expect(await draftsOf(userId)).toHaveLength(1);
    expect(await ledger(userId)).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(203);
  });

  it("13b: the same key sent concurrently still charges once", async () => {
    const userId = await seedUser(210);
    const m = await seedMatch(userId);
    const req = input(userId, m, { idempotencyKey: "race" });
    const c1 = createDb(url, { max: 1 });
    const c2 = createDb(url, { max: 1 });
    try {
      const [a, b] = await Promise.all([
        createDraftJob(c1.db, req),
        createDraftJob(c2.db, req),
      ]);
      if (!("draft" in a) || !("draft" in b)) throw new Error("no draft");
      expect(a.draft.id).toBe(b.draft.id);
    } finally {
      await c1.pool.end();
      await c2.pool.end();
    }
    expect(await ledger(userId)).toHaveLength(1);
  });

  it("14: the same (user, match, version) with a new key returns the existing draft", async () => {
    const userId = await seedUser(210);
    const m = await seedMatch(userId);
    const a = await createDraftJob(db, input(userId, m));
    const b = await createDraftJob(db, input(userId, m));
    if (!("draft" in a) || !("draft" in b)) throw new Error("no draft");
    expect(b.draft.id).toBe(a.draft.id);
    expect(b.created).toBe(false);
    expect(await ledger(userId)).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(203);
  });

  it("14b: a failed (user, match, version) doesn't block a new draft with a new key (H1)", async () => {
    const userId = await seedUser(210);
    const m = await seedMatch(userId);
    const a = await createDraftJob(db, input(userId, m));
    if (!("draft" in a)) throw new Error("no draft");
    await db
      .update(drafts)
      .set({ status: "failed", error: "INVALID_OUTPUT" })
      .where(eq(drafts.id, a.draft.id));
    const b = await createDraftJob(db, input(userId, m));
    if (!("draft" in b)) throw new Error("no draft");
    expect(b.created).toBe(true);
    expect(b.draft.id).not.toBe(a.draft.id);
    expect(b.draft.version).toBe(1);
    expect(await balanceOf(userId)).toBe(196);
  });

  it("15: the daily credit cap (trial: 105 used today) gives daily_limit, no reserve", async () => {
    const userId = await seedUser(210);
    await spendToday(userId, 105);
    const m = await seedMatch(userId);
    expect(await createDraftJob(db, input(userId, m))).toEqual({
      error: "daily_limit",
    });
    expect(await ledger(userId)).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(105);
  });

  it("15b: a draft that would cross the cap is refused; one that fits is allowed", async () => {
    const userId = await seedUser(210);
    await spendToday(userId, 99);
    const m = await seedMatch(userId);
    expect(await createDraftJob(db, input(userId, m))).toEqual({
      error: "daily_limit",
    });
    const r = await createDraftJob(
      db,
      input(userId, m, { credits: 1, kind: "rewrite", option: "shorter" }),
    );
    expect("draft" in r).toBe(true);
  });

  it("16: today's AI cost at the cap gives daily_limit", async () => {
    const userId = await seedUser(210);
    await db.insert(llmUsage).values({
      userId,
      task: "draft",
      step: "s",
      promptVersion: "p@1",
      model: "gemini-test",
      inputTokens: 1,
      outputTokens: 1,
      costMicros: 200_000,
      latencyMs: 1,
      attempt: 1,
      outcome: "ok",
    });
    const m = await seedMatch(userId);
    expect(await createDraftJob(db, input(userId, m))).toEqual({
      error: "daily_limit",
    });
    expect(await draftsOf(userId)).toHaveLength(0);
    expect(await ledger(userId)).toHaveLength(0);
  });

  it("17: 20 concurrent drafts for different matches never pass the daily cap", async () => {
    for (let run = 0; run < 5; run++) {
      await reset();
      const userId = await seedUser(210);
      const ms = [];
      for (let i = 0; i < 20; i++) ms.push(await seedMatch(userId));
      const conns = Array.from({ length: 20 }, () => createDb(url, { max: 1 }));
      let results;
      try {
        results = await Promise.all(
          ms.map((m, i) => createDraftJob(conns[i]!.db, input(userId, m))),
        );
      } finally {
        await Promise.all(conns.map((c) => c.pool.end()));
      }
      const made = results.filter((r) => "draft" in r);
      expect(made).toHaveLength(15);
      expect(results.filter((r) => "error" in r)).toHaveLength(5);
      for (const r of results)
        if ("error" in r) expect(r.error).toBe("daily_limit");
      expect(await draftsOf(userId)).toHaveLength(15);
      expect(await balanceOf(userId)).toBe(210 - 105);
      const spent = (await ledger(userId)).reduce((s, r) => s - r.delta, 0);
      expect(spent).toBe(105);
    }
  });

  it("18: insufficient balance gives insufficient and no draft row", async () => {
    const userId = await seedUser(6);
    const m = await seedMatch(userId);
    expect(await createDraftJob(db, input(userId, m))).toEqual({
      error: "insufficient",
    });
    expect(await draftsOf(userId)).toHaveLength(0);
    expect(await balanceOf(userId)).toBe(6);
  });

  it("a user with no credit balance is insufficient", async () => {
    const userId = await seedUser(0);
    await db.delete(creditBalances).where(eq(creditBalances.userId, userId));
    const m = await seedMatch(userId);
    expect(await createDraftJob(db, input(userId, m))).toEqual({
      error: "insufficient",
    });
  });

  it("an expired period is insufficient", async () => {
    const userId = await seedUser(210);
    await db
      .update(creditBalances)
      .set({ periodEnd: new Date(now.getTime() - 1000) })
      .where(eq(creditBalances.userId, userId));
    const m = await seedMatch(userId);
    expect(await createDraftJob(db, input(userId, m))).toEqual({
      error: "insufficient",
    });
    expect(await draftsOf(userId)).toHaveLength(0);
  });

  it("a rewrite stores its parent, option and instruction", async () => {
    const userId = await seedUser(210);
    const m = await seedMatch(userId);
    const v1 = await createDraftJob(db, input(userId, m));
    if (!("draft" in v1)) throw new Error("no draft");
    const v2 = await createDraftJob(
      db,
      input(userId, m, {
        version: 2,
        kind: "rewrite",
        parentId: v1.draft.id,
        option: "custom",
        instruction: "mention my Stripe work",
        credits: 1,
      }),
    );
    if (!("draft" in v2)) throw new Error("no draft");
    expect(v2.draft).toMatchObject({
      version: 2,
      parentId: v1.draft.id,
      option: "custom",
      instruction: "mention my Stripe work",
      credits: 1,
    });
    expect(await balanceOf(userId)).toBe(202);
  });

  it("rejects non-positive credits before touching the database", async () => {
    const userId = await seedUser(210);
    const m = await seedMatch(userId);
    await expect(
      createDraftJob(db, input(userId, m, { credits: 0 })),
    ).rejects.toThrow();
    expect(await draftsOf(userId)).toHaveLength(0);
  });
});
