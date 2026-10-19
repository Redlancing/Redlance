import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import {
  costTodayMicros,
  creditsUsedToday,
  draftBudget,
  getCredits,
  grantCredits,
  grantPlanCredits,
  isDraftingPaused,
  onceADay,
  refundCredits,
  reserveCredits,
  systemDraftCostTodayMicros,
} from "./credits";
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
const later = (ms: number) => new Date(now.getTime() + ms);
let seq = 0;

async function seedUser(): Promise<string> {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|c${seq}-${Math.random()}`,
      email: `c${seq}@example.com`,
      emailNormalized: `c${seq}-${Math.random()}@example.com`,
    })
    .returning({ id: users.id });
  return u!.id;
}

/** A draft row for `userId` (on its own match), so ledger rows can reference it. */
async function seedDraft(userId: string): Promise<string> {
  seq++;
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_c${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/c${seq}/x/`,
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
  const [d] = await db
    .insert(drafts)
    .values({
      userId,
      matchId: m!.id,
      jobPostId: p!.id,
      version: 1,
      kind: "draft",
      credits: 7,
    })
    .returning({ id: drafts.id });
  return d!.id;
}

/** Sets a balance directly (no ledger rows), for reserve/refund tests. */
async function setBalance(
  userId: string,
  balance: number,
  periodEnd = later(5 * DAY),
) {
  await db
    .insert(creditBalances)
    .values({
      userId,
      plan: "trial",
      balance,
      periodStart: now,
      periodEnd,
    })
    .onConflictDoUpdate({
      target: creditBalances.userId,
      set: { balance, periodEnd },
    });
}

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
    .where(eq(creditLedger.userId, userId))
    .orderBy(creditLedger.id);

async function addUsage(
  userId: string | null,
  task: string,
  costMicros: number,
  createdAt = now,
) {
  await db.insert(llmUsage).values({
    userId,
    task,
    step: "s",
    promptVersion: "p@1",
    model: "gemini-test",
    inputTokens: 1,
    outputTokens: 1,
    costMicros,
    latencyMs: 1,
    attempt: 1,
    outcome: "ok",
    createdAt,
  });
}

describe("grantCredits", () => {
  it("1: grants 210 to a trial user", async () => {
    const userId = await seedUser();
    await grantCredits(db, {
      userId,
      plan: "trial",
      amount: 210,
      periodStart: now,
      periodEnd: later(5 * DAY),
    });
    expect(await balanceOf(userId)).toBe(210);
    expect(await ledger(userId)).toEqual([
      { delta: 210, reason: "grant", draftId: null },
    ]);
    expect(await getCredits(db, userId)).toEqual({
      plan: "trial",
      balance: 210,
      periodEnd: later(5 * DAY),
    });
  });

  it("2: a new grant expires the leftover and replaces the balance", async () => {
    const userId = await seedUser();
    await grantCredits(db, {
      userId,
      plan: "trial",
      amount: 210,
      periodStart: now,
      periodEnd: later(5 * DAY),
    });
    await db
      .update(creditBalances)
      .set({ balance: 50 })
      .where(eq(creditBalances.userId, userId));
    await grantPlanCredits(db, userId, "standard", later(30 * DAY), now);
    expect(await balanceOf(userId)).toBe(2100);
    expect((await ledger(userId)).slice(1)).toEqual([
      { delta: -50, reason: "expire", draftId: null },
      { delta: 2100, reason: "grant", draftId: null },
    ]);
    expect((await getCredits(db, userId))?.plan).toBe("standard");
  });

  it("writes no expire row when nothing is left", async () => {
    const userId = await seedUser();
    await setBalance(userId, 0);
    await grantPlanCredits(db, userId, "trial", later(5 * DAY), now);
    expect(await ledger(userId)).toEqual([
      { delta: 210, reason: "grant", draftId: null },
    ]);
  });

  it("rejects a bad amount or period", async () => {
    const userId = await seedUser();
    const base = {
      userId,
      plan: "trial" as const,
      periodStart: now,
      periodEnd: later(DAY),
    };
    await expect(grantCredits(db, { ...base, amount: -1 })).rejects.toThrow();
    await expect(grantCredits(db, { ...base, amount: 1.5 })).rejects.toThrow();
    await expect(
      grantCredits(db, { ...base, amount: 10, periodEnd: now }),
    ).rejects.toThrow();
    expect(await ledger(userId)).toEqual([]);
  });

  it("two concurrent first grants leave a consistent ledger", async () => {
    const userId = await seedUser();
    const a = createDb(url, { max: 1 });
    const b = createDb(url, { max: 1 });
    try {
      await Promise.all([
        grantPlanCredits(a.db, userId, "trial", later(5 * DAY), now),
        grantPlanCredits(b.db, userId, "trial", later(5 * DAY), now),
      ]);
    } finally {
      await a.pool.end();
      await b.pool.end();
    }
    const rows = await ledger(userId);
    const sum = rows.reduce((s, r) => s + r.delta, 0);
    expect(await balanceOf(userId)).toBe(210);
    expect(sum).toBe(210);
  });
});

describe("reserveCredits", () => {
  it("3: reserves 7 from 210", async () => {
    const userId = await seedUser();
    const draftId = await seedDraft(userId);
    await setBalance(userId, 210);
    expect(await reserveCredits(db, { userId, amount: 7, draftId })).toEqual({
      ok: true,
      balance: 203,
    });
    expect(await balanceOf(userId)).toBe(203);
    expect(await ledger(userId)).toEqual([
      { delta: -7, reason: "reserve", draftId },
    ]);
  });

  it("4: refuses 7 from a balance of 6", async () => {
    const userId = await seedUser();
    const draftId = await seedDraft(userId);
    await setBalance(userId, 6);
    expect(await reserveCredits(db, { userId, amount: 7, draftId })).toEqual({
      ok: false,
      reason: "insufficient",
    });
    expect(await balanceOf(userId)).toBe(6);
    expect(await ledger(userId)).toEqual([]);
  });

  it("5: refuses after period_end", async () => {
    const userId = await seedUser();
    const draftId = await seedDraft(userId);
    await setBalance(userId, 210, new Date(now.getTime() - 1000));
    expect(await reserveCredits(db, { userId, amount: 7, draftId })).toEqual({
      ok: false,
      reason: "insufficient",
    });
    expect(await balanceOf(userId)).toBe(210);
  });

  it("refuses a user with no balance row, and a non-positive amount", async () => {
    const userId = await seedUser();
    const draftId = await seedDraft(userId);
    expect((await reserveCredits(db, { userId, amount: 7, draftId })).ok).toBe(
      false,
    );
    await setBalance(userId, 10);
    await expect(
      reserveCredits(db, { userId, amount: 0, draftId }),
    ).rejects.toThrow();
    expect(await balanceOf(userId)).toBe(10);
  });

  it("8: two concurrent reserves of 7 from 10: exactly one succeeds", async () => {
    for (let run = 0; run < 5; run++) {
      await reset();
      const userId = await seedUser();
      const d1 = await seedDraft(userId);
      const d2 = await seedDraft(userId);
      await setBalance(userId, 10);
      const a = createDb(url, { max: 1 });
      const b = createDb(url, { max: 1 });
      let results;
      try {
        results = await Promise.all([
          reserveCredits(a.db, { userId, amount: 7, draftId: d1 }),
          reserveCredits(b.db, { userId, amount: 7, draftId: d2 }),
        ]);
      } finally {
        await a.pool.end();
        await b.pool.end();
      }
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await balanceOf(userId)).toBe(3);
      expect(await ledger(userId)).toHaveLength(1);
    }
  });
});

describe("refundCredits", () => {
  it("6: gives the reserved credits back", async () => {
    const userId = await seedUser();
    const draftId = await seedDraft(userId);
    await setBalance(userId, 210);
    await reserveCredits(db, { userId, amount: 7, draftId });
    expect(await refundCredits(db, { userId, draftId })).toEqual({
      refunded: 7,
    });
    expect(await balanceOf(userId)).toBe(210);
    expect((await ledger(userId)).at(-1)).toEqual({
      delta: 7,
      reason: "refund",
      draftId,
    });
    const [d] = await db
      .select({ credits: drafts.credits })
      .from(drafts)
      .where(eq(drafts.id, draftId));
    expect(d!.credits).toBe(0);
  });

  it("7: a second refund of the same draft does nothing", async () => {
    const userId = await seedUser();
    const draftId = await seedDraft(userId);
    await setBalance(userId, 210);
    await reserveCredits(db, { userId, amount: 7, draftId });
    await refundCredits(db, { userId, draftId });
    expect(await refundCredits(db, { userId, draftId })).toEqual({
      refunded: 0,
    });
    expect(await balanceOf(userId)).toBe(210);
    const refunds = (await ledger(userId)).filter((r) => r.reason === "refund");
    expect(refunds).toHaveLength(1);
  });

  it("two concurrent refunds of one draft refund once", async () => {
    for (let run = 0; run < 5; run++) {
      await reset();
      const userId = await seedUser();
      const draftId = await seedDraft(userId);
      await setBalance(userId, 10);
      await reserveCredits(db, { userId, amount: 7, draftId });
      const a = createDb(url, { max: 1 });
      const b = createDb(url, { max: 1 });
      let results;
      try {
        results = await Promise.all([
          refundCredits(a.db, { userId, draftId }),
          refundCredits(b.db, { userId, draftId }),
        ]);
      } finally {
        await a.pool.end();
        await b.pool.end();
      }
      expect(results.map((r) => r.refunded).sort()).toEqual([0, 7]);
      expect(await balanceOf(userId)).toBe(10);
    }
  });

  it("does nothing for a draft that reserved nothing, or another user's draft", async () => {
    const userId = await seedUser();
    const other = await seedUser();
    const draftId = await seedDraft(userId);
    await setBalance(userId, 10);
    await setBalance(other, 10);
    expect(await refundCredits(db, { userId, draftId })).toEqual({
      refunded: 0,
    });
    await reserveCredits(db, { userId, amount: 7, draftId });
    expect(await refundCredits(db, { userId: other, draftId })).toEqual({
      refunded: 0,
    });
    expect(await balanceOf(other)).toBe(10);
    expect(await ledger(userId)).toHaveLength(1);
  });

  it("the refund-once index rejects a second refund row", async () => {
    const userId = await seedUser();
    const draftId = await seedDraft(userId);
    await db
      .insert(creditLedger)
      .values({ userId, delta: 7, reason: "refund", draftId });
    await expect(
      db
        .insert(creditLedger)
        .values({ userId, delta: 7, reason: "refund", draftId }),
    ).rejects.toThrow();
  });
});

describe("daily usage", () => {
  it("9: reserves of 7 and 1 and a refund of 7 count as 1", async () => {
    const userId = await seedUser();
    const d1 = await seedDraft(userId);
    const d2 = await seedDraft(userId);
    await setBalance(userId, 210);
    await reserveCredits(db, { userId, amount: 7, draftId: d1 });
    await reserveCredits(db, { userId, amount: 1, draftId: d2 });
    await refundCredits(db, { userId, draftId: d1 });
    expect(await creditsUsedToday(db, userId, now)).toBe(1);
  });

  it("10: ledger rows from yesterday aren't counted today", async () => {
    const userId = await seedUser();
    const draftId = await seedDraft(userId);
    await db.insert(creditLedger).values({
      userId,
      delta: -7,
      reason: "reserve",
      draftId,
      createdAt: new Date(now.getTime() - DAY),
    });
    // A grant today isn't usage either.
    await db
      .insert(creditLedger)
      .values({ userId, delta: 210, reason: "grant" });
    expect(await creditsUsedToday(db, userId, now)).toBe(0);
    expect(
      await creditsUsedToday(db, userId, new Date(now.getTime() - DAY)),
    ).toBe(7);
  });

  it("10b: a refund today of a draft reserved yesterday doesn't lower today's usage (L3)", async () => {
    const userId = await seedUser();
    const old = await seedDraft(userId);
    const fresh = await seedDraft(userId);
    await setBalance(userId, 210);
    await db.insert(creditLedger).values({
      userId,
      delta: -7,
      reason: "reserve",
      draftId: old,
      createdAt: new Date(now.getTime() - DAY),
    });
    await reserveCredits(db, { userId, amount: 7, draftId: fresh });
    await refundCredits(db, { userId, draftId: old });
    expect(await creditsUsedToday(db, userId, now)).toBe(7);
    // Yesterday still shows its reserve; the refund belongs to no day's usage there.
    expect(
      await creditsUsedToday(db, userId, new Date(now.getTime() - DAY)),
    ).toBe(7);
  });

  it("11: costTodayMicros sums draft, rewrite and voice only", async () => {
    const userId = await seedUser();
    const other = await seedUser();
    await addUsage(userId, "draft", 5000);
    await addUsage(userId, "rewrite", 700);
    await addUsage(userId, "voice", 300);
    await addUsage(userId, "post_analysis", 9999);
    await addUsage(userId, "draft", 4000, new Date(now.getTime() - DAY));
    await addUsage(other, "draft", 1000);
    expect(await costTodayMicros(db, userId, now)).toBe(6000);
    expect(await systemDraftCostTodayMicros(db, now)).toBe(7000);
  });
});

describe("system drafting budget", () => {
  const budget = {
    DRAFT_BUDGET_ALERT_USD: 0.004,
    DRAFT_BUDGET_PAUSE_USD: 0.01,
  };

  it("21: pauses drafting once today's draft spend reaches the pause level", async () => {
    const userId = await seedUser();
    await addUsage(userId, "draft", 3000);
    expect(await isDraftingPaused(db, budget, now)).toBe(false);
    expect(await draftBudget(db, budget, now)).toEqual({
      spentMicros: 3000,
      alert: false,
      paused: false,
    });
    await addUsage(null, "rewrite", 2000);
    expect(await draftBudget(db, budget, now)).toMatchObject({
      alert: true,
      paused: false,
    });
    await addUsage(userId, "voice", 5000);
    expect(await isDraftingPaused(db, budget, now)).toBe(true);
    // Post analysis spend doesn't count.
    await reset();
    await addUsage(null, "post_analysis", 50_000);
    expect(await isDraftingPaused(db, budget, now)).toBe(false);
  });

  it("onceADay is true once per key per UTC day", () => {
    const once = onceADay();
    const t = new Date("2026-10-19T10:00:00Z");
    expect(once("alert", t)).toBe(true);
    expect(once("alert", new Date("2026-10-19T23:59:00Z"))).toBe(false);
    expect(once("pause", t)).toBe(true);
    expect(once("alert", new Date("2026-10-20T00:01:00Z"))).toBe(true);
  });
});
