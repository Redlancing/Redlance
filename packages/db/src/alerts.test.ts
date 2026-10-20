import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ALERTS_CHANNEL,
  alertChannels,
  alertDeliveries,
  alertStats,
  claimDueDeliveries,
  completeDeliveries,
  createDb,
  createTelegramLinkToken,
  disableChannel,
  disableTelegramByChat,
  failDeliveries,
  jobPostAnalyses,
  jobPosts,
  matches,
  profiles,
  pruneAlerts,
  requeueStaleDeliveries,
  routedTodayCounts,
  telegramLinkTokens,
  useTelegramLinkToken,
  users,
  withRoutingBatch,
  type RoutingDecide,
} from "./index";
import { runMigrations } from "./migrate";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 5 });

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table job_posts cascade`);
};
beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

const MIN = 60_000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let seq = 0;

async function seedUser(
  opts: {
    timeZone?: string;
    telegram?: "linked" | "disabled" | "none";
    chatId?: string;
    status?: "active" | "blocked";
  } = {},
): Promise<string> {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|al${seq}-${Math.random()}`,
      email: "a@example.com",
      emailNormalized: `al${seq}-${Math.random()}@example.com`,
      status: opts.status ?? "active",
    })
    .returning();
  await db.insert(profiles).values({
    userId: u!.id,
    displayName: "A",
    categories: ["development"],
    experienceLevel: "intermediate",
    country: "US",
    timeZone: opts.timeZone ?? "UTC",
    minRateMinor: 0,
    currency: "USD",
    rateType: "either",
    remoteOnly: true,
    onboardedAt: new Date(),
    trialEndsAt: new Date(Date.now() + 5 * 86_400_000),
  });
  const tg = opts.telegram ?? "linked";
  if (tg !== "none") {
    await db.insert(alertChannels).values({
      userId: u!.id,
      kind: "telegram",
      target: opts.chatId ?? String(1000 + seq),
      enabled: tg === "linked",
      verifiedAt: new Date(),
      disabledReason: tg === "disabled" ? "blocked" : null,
    });
  }
  return u!.id;
}

async function seedMatch(
  userId: string,
  over: { score?: number; alertOutcome?: string | null; createdAt?: Date } = {},
): Promise<string> {
  seq++;
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_al${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/al${seq}/x/`,
      title: `[Hiring] Gig ${seq}`,
      body: "Need help.",
      postedAt: new Date(Date.now() - 5 * MIN),
      preKind: "hiring",
    })
    .returning();
  await db.insert(jobPostAnalyses).values({
    jobPostId: p!.id,
    pipelineVersion: "t",
    kind: "hiring",
    employmentType: "freelance",
    payType: "paid",
    categories: ["development"],
    skillIds: [],
    budgetMin: 400,
    budgetMax: 600,
    currency: "USD",
    budgetUnit: "fixed",
    remote: "remote",
    redFlags: [],
    summary: "s",
    model: "m",
  });
  const score = over.score ?? 80;
  const [m] = await db
    .insert(matches)
    .values({
      userId,
      jobPostId: p!.id,
      postedAt: p!.postedAt,
      ruleScore: score,
      broad: false,
      features: [],
      ruleReason: "Strong fit: Next.js",
      aiStatus: "not_needed",
      score,
      profileVersion: 1,
      analysedAt: new Date(),
      alertOutcome: (over.alertOutcome ?? null) as never,
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    })
    .returning();
  return m!.id;
}

const matchRow = async (id: string) =>
  (await db.select().from(matches).where(eq(matches.id, id)))[0]!;
const deliveryRows = () =>
  db.select().from(alertDeliveries).orderBy(alertDeliveries.createdAt);

/** Queues when score >= 70 and Telegram is usable, else the obvious skip; counts toward a cap of 3. */
const simpleDecide: RoutingDecide = (items, routedToday) => {
  const counts = new Map(routedToday);
  return items.map((i) => {
    const n = counts.get(i.userId) ?? 0;
    if (!i.active)
      return {
        matchId: i.matchId,
        outcome: "skipped_no_channel",
        channels: [],
      };
    if (i.score < 70)
      return { matchId: i.matchId, outcome: "below_threshold", channels: [] };
    if (n >= 3)
      return { matchId: i.matchId, outcome: "skipped_cap", channels: [] };
    if (!i.telegram?.enabled) {
      return {
        matchId: i.matchId,
        outcome: "skipped_no_channel",
        channels: [],
      };
    }
    counts.set(i.userId, n + 1);
    return { matchId: i.matchId, outcome: "queued", channels: ["telegram"] };
  });
};

/** Counts NOTIFYs on `channel` while `run` executes. */
async function notifications(channel: string, run: () => Promise<unknown>) {
  const listener = new pg.Client({ connectionString: url });
  await listener.connect();
  let n = 0;
  listener.on("notification", (msg) => {
    if (msg.channel === channel) n++;
  });
  await listener.query(`LISTEN ${channel}`);
  await run();
  await new Promise((r) => setTimeout(r, 200));
  await listener.end();
  return n;
}

/** Queues `n` deliveries for a user (routed through the real batch). */
async function queued(userId: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await seedMatch(userId));
  await withRoutingBatch(db, { limit: 1000 }, (items) =>
    items.map((i) => ({
      matchId: i.matchId,
      outcome: "queued",
      channels: ["telegram"],
    })),
  );
  return ids;
}

describe("withRoutingBatch", () => {
  it("writes every outcome and queues deliveries only for queued matches", async () => {
    const linked = await seedUser();
    const none = await seedUser({ telegram: "none" });
    const blocked = await seedUser({ status: "blocked" });
    const strong = await seedMatch(linked, { score: 85 });
    const weak = await seedMatch(linked, { score: 40 });
    const noChannel = await seedMatch(none, { score: 90 });
    const blockedUser = await seedMatch(blocked, { score: 90 });
    const backfill = await seedMatch(linked, {
      alertOutcome: "skipped_backfill",
    });

    const now = new Date();
    let res;
    const n = await notifications(ALERTS_CHANNEL, async () => {
      res = await withRoutingBatch(db, { limit: 200, now }, simpleDecide);
    });
    expect(n).toBe(1);
    expect(res).toEqual({
      routed: 4,
      byOutcome: { queued: 1, below_threshold: 1, skipped_no_channel: 2 },
      queued: 1,
    });
    expect((await matchRow(strong)).alertOutcome).toBe("queued");
    expect((await matchRow(strong)).alertRoutedAt).toEqual(now);
    expect((await matchRow(strong)).alertScore).toBe(85);
    expect((await matchRow(weak)).alertOutcome).toBe("below_threshold");
    expect((await matchRow(noChannel)).alertOutcome).toBe("skipped_no_channel");
    expect((await matchRow(blockedUser)).alertOutcome).toBe(
      "skipped_no_channel",
    );
    expect((await matchRow(backfill)).alertRoutedAt).toBeNull();
    const ds = await deliveryRows();
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      userId: linked,
      matchId: strong,
      channel: "telegram",
      status: "pending",
      attempts: 0,
    });
  });

  it("does not notify when nothing was queued, and routes nothing twice", async () => {
    const u = await seedUser();
    await seedMatch(u, { score: 10 });
    expect(
      await notifications(ALERTS_CHANNEL, () =>
        withRoutingBatch(db, { limit: 200 }, simpleDecide),
      ),
    ).toBe(0);
    expect(await withRoutingBatch(db, { limit: 200 }, simpleDecide)).toEqual({
      routed: 0,
      byOutcome: {},
      queued: 0,
    });
  });

  it("takes the oldest first and honours the limit", async () => {
    const u = await seedUser();
    const late = await seedMatch(u, { createdAt: new Date(Date.now() - MIN) });
    const early = await seedMatch(u, {
      createdAt: new Date(Date.now() - 10 * MIN),
    });
    const seen: string[] = [];
    await withRoutingBatch(db, { limit: 1 }, (items, counts) => {
      seen.push(...items.map((i) => i.matchId));
      return simpleDecide(items, counts);
    });
    expect(seen).toEqual([early]);
    expect((await matchRow(late)).alertOutcome).toBeNull();
  });

  it("rolls the whole batch back when decide throws or misses an item", async () => {
    const u = await seedUser();
    const a = await seedMatch(u);
    await seedMatch(u);
    await expect(
      withRoutingBatch(db, { limit: 10 }, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(
      withRoutingBatch(db, { limit: 10 }, (items) => [
        {
          matchId: items[0]!.matchId,
          outcome: "queued",
          channels: ["telegram"],
        },
      ]),
    ).rejects.toThrow(/one decision per item/);
    expect((await matchRow(a)).alertOutcome).toBeNull();
    expect(await deliveryRows()).toHaveLength(0);
  });

  it("passes today's count so the cap holds across batches", async () => {
    const u = await seedUser();
    for (let i = 0; i < 2; i++) await seedMatch(u);
    await withRoutingBatch(db, { limit: 10 }, simpleDecide);
    for (let i = 0; i < 3; i++) await seedMatch(u);
    const res = await withRoutingBatch(db, { limit: 10 }, simpleDecide);
    expect(res.byOutcome).toEqual({ queued: 1, skipped_cap: 2 });
  });

  it("two routers at once route every match exactly once", async () => {
    const userIds = await Promise.all(
      Array.from({ length: 5 }, () => seedUser()),
    );
    for (const u of userIds) for (let i = 0; i < 40; i++) await seedMatch(u);
    const other = createDb(url, { max: 1 });
    try {
      const drain = async (d: typeof db) => {
        let total = 0;
        for (;;) {
          const r = await withRoutingBatch(d, { limit: 15 }, simpleDecide);
          total += r.routed;
          if (r.routed === 0) return total;
        }
      };
      const [a, b] = await Promise.all([drain(db), drain(other.db)]);
      expect(a + b).toBe(200);
    } finally {
      await other.pool.end();
    }
    const rows = await db.execute<{ outcome: string; n: number }>(
      sql`select alert_outcome as outcome, count(*)::int as n from matches group by 1`,
    );
    expect(Object.fromEntries(rows.rows.map((r) => [r.outcome, r.n]))).toEqual({
      queued: 15, // 3 per user: the cap held under concurrency
      skipped_cap: 185,
    });
    expect(await deliveryRows()).toHaveLength(15);
  });
});

describe("routedTodayCounts", () => {
  it("counts queued, sent and failed since the user's day started", async () => {
    const u = await seedUser();
    const now = new Date("2026-10-20T12:00:00Z");
    const set = async (outcome: string, routedAt: Date) => {
      const id = await seedMatch(u);
      await db.execute(
        sql`update matches set alert_outcome = ${outcome}, alert_routed_at = ${routedAt.toISOString()}::timestamptz where id = ${id}`,
      );
    };
    await set("queued", new Date("2026-10-20T01:00:00Z"));
    await set("sent", new Date("2026-10-20T11:00:00Z"));
    await set("failed", new Date("2026-10-20T11:30:00Z"));
    await set("below_threshold", new Date("2026-10-20T11:00:00Z"));
    await set("skipped_cap", new Date("2026-10-20T11:00:00Z"));
    await set("sent", new Date("2026-10-19T23:00:00Z")); // yesterday in UTC
    const other = await seedUser();
    const counts = await routedTodayCounts(db, [
      { userId: u, since: new Date("2026-10-20T00:00:00Z") },
      { userId: other, since: now },
    ]);
    expect(counts.get(u)).toBe(3);
    expect(counts.get(other)).toBe(0);
    // In Kolkata the day began at 18:30 UTC the day before, so yesterday's 23:00 counts.
    const ist = await routedTodayCounts(db, [
      { userId: u, since: new Date("2026-10-19T18:30:00Z") },
    ]);
    expect(ist.get(u)).toBe(4);
  });
});

describe("claimDueDeliveries", () => {
  it("claims due rows grouped per user with the message fields", async () => {
    const u = await seedUser({ chatId: "555" });
    const [m] = await queued(u, 1);
    const groups = await claimDueDeliveries(db, "telegram", {
      maxUsers: 25,
      perUser: 5,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      userId: u,
      channel: "telegram",
      target: "555",
      channelEnabled: true,
    });
    expect(groups[0]!.deliveries[0]).toMatchObject({
      attempts: 1,
      matchId: m,
      score: 80,
      reason: "Strong fit: Next.js",
      community: "forhire",
      budget: { min: 400, max: 600, currency: "USD", unit: "fixed" },
    });
    expect(groups[0]!.deliveries[0]!.title).toMatch(/^\[Hiring\] Gig/);
    expect((await deliveryRows())[0]).toMatchObject({
      status: "sending",
      attempts: 1,
    });
    // Nothing left to claim.
    expect(
      await claimDueDeliveries(db, "telegram", { maxUsers: 25, perUser: 5 }),
    ).toEqual([]);
  });

  it("skips rows that aren't due and honours perUser and maxUsers", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const c = await seedUser();
    await queued(a, 7);
    await queued(b, 2);
    await queued(c, 1);
    await db.execute(
      sql`update alert_deliveries set run_after = now() + interval '1 hour' where user_id = ${c}`,
    );
    const first = await claimDueDeliveries(db, "telegram", {
      maxUsers: 1,
      perUser: 5,
    });
    expect(first).toHaveLength(1);
    const rest = await claimDueDeliveries(db, "telegram", {
      maxUsers: 25,
      perUser: 5,
    });
    const sizes = (gs: typeof first) =>
      Object.fromEntries(gs.map((g) => [g.userId, g.deliveries.length]));
    // The longest-waiting user first, capped at perUser.
    expect(sizes(first)).toEqual({ [a]: 5 });
    // a's first message is still being sent, so a waits; c is not due yet.
    expect(sizes(rest)).toEqual({ [b]: 2 });
  });

  it("skips a user whose earlier message is still being sent", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await queued(a, 7);
    await queued(b, 1);
    const first = await claimDueDeliveries(db, "telegram", {
      maxUsers: 1,
      perUser: 5,
    });
    expect(first.map((g) => g.userId)).toEqual([a]);
    // a's other 2 rows wait until the first message is done.
    const second = await claimDueDeliveries(db, "telegram", {
      maxUsers: 25,
      perUser: 5,
    });
    expect(second.map((g) => g.userId)).toEqual([b]);
    await completeDeliveries(db, first[0]!.deliveries, {
      channel: "telegram",
      messageId: 1,
      template: "tg@1",
    });
    const third = await claimDueDeliveries(db, "telegram", {
      maxUsers: 25,
      perUser: 5,
    });
    expect(third.map((g) => [g.userId, g.deliveries.length])).toEqual([[a, 2]]);
  });

  it("25 concurrent claimers never share a row", async () => {
    const userIds = await Promise.all(
      Array.from({ length: 10 }, () => seedUser()),
    );
    for (const u of userIds) await queued(u, 3);
    const extra = await Promise.all(
      Array.from({ length: 4 }, () => createDb(url, { max: 6 })),
    );
    try {
      const dbs = [db, ...extra.map((e) => e.db)];
      const results = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          claimDueDeliveries(dbs[i % dbs.length]!, "telegram", {
            maxUsers: 2,
            perUser: 2,
          }),
        ),
      );
      const ids = results.flat().flatMap((g) => g.deliveries.map((d) => d.id));
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      await Promise.all(extra.map((e) => e.pool.end()));
    }
  });

  it("reports a channel turned off after routing", async () => {
    const u = await seedUser();
    await queued(u, 1);
    await db
      .update(alertChannels)
      .set({ enabled: false })
      .where(eq(alertChannels.userId, u));
    const [g] = await claimDueDeliveries(db, "telegram", {
      maxUsers: 5,
      perUser: 5,
    });
    expect(g!.channelEnabled).toBe(false);
  });
});

describe("completeDeliveries", () => {
  it("deletes the rows and marks the matches sent", async () => {
    const u = await seedUser();
    const ids = await queued(u, 3);
    const [g] = await claimDueDeliveries(db, "telegram", {
      maxUsers: 5,
      perUser: 5,
    });
    const done = await completeDeliveries(db, g!.deliveries, {
      channel: "telegram",
      messageId: 777,
      template: "tg@1",
    });
    expect(done).toBe(3);
    expect(await deliveryRows()).toHaveLength(0);
    for (const id of ids) {
      expect(await matchRow(id)).toMatchObject({
        alertOutcome: "sent",
        alertChannels: ["telegram"],
        alertTemplate: "tg@1",
        telegramMessageId: 777,
      });
      expect((await matchRow(id)).alertedAt).not.toBeNull();
    }
  });

  it("never duplicates a channel and keeps the first alerted_at", async () => {
    const u = await seedUser();
    const [id] = await queued(u, 1);
    const first = new Date("2026-10-01T00:00:00Z");
    await db.execute(
      sql`update matches set alert_channels = array['telegram'], alerted_at = ${first.toISOString()}::timestamptz where id = ${id}`,
    );
    const [g] = await claimDueDeliveries(db, "telegram", {
      maxUsers: 5,
      perUser: 5,
    });
    await completeDeliveries(db, g!.deliveries, {
      channel: "telegram",
      messageId: 1,
      template: "tg@1",
    });
    expect((await matchRow(id!)).alertChannels).toEqual(["telegram"]);
    expect((await matchRow(id!)).alertedAt).toEqual(first);
  });

  it("does nothing for a lost claim", async () => {
    const u = await seedUser();
    const [id] = await queued(u, 1);
    const [g] = await claimDueDeliveries(db, "telegram", {
      maxUsers: 5,
      perUser: 5,
    });
    // Swept and claimed again by another sender.
    await db.execute(sql`update alert_deliveries set attempts = attempts + 1`);
    expect(
      await completeDeliveries(db, g!.deliveries, {
        channel: "telegram",
        messageId: 1,
        template: "tg@1",
      }),
    ).toBe(0);
    expect(await deliveryRows()).toHaveLength(1);
    expect((await matchRow(id!)).alertOutcome).toBe("queued");
  });
});

describe("failDeliveries", () => {
  const claimOne = async (u: string) =>
    (await claimDueDeliveries(db, "telegram", { maxUsers: 5, perUser: 5 }))
      .filter((g) => g.userId === u)
      .flatMap((g) => g.deliveries);

  it("requeues a retryable failure with backoff", async () => {
    const u = await seedUser();
    await queued(u, 1);
    const ds = await claimOne(u);
    const res = await failDeliveries(db, ds, {
      code: "TG_UNAVAILABLE",
      retryable: true,
      countAttempt: true,
    });
    expect(res).toEqual({ requeued: 1, failed: 0, lost: 0 });
    const [row] = await deliveryRows();
    expect(row).toMatchObject({
      status: "pending",
      attempts: 1,
      errorCode: "TG_UNAVAILABLE",
    });
    const wait = row!.runAfter.getTime() - Date.now();
    expect(wait).toBeGreaterThan(25_000);
    expect(wait).toBeLessThan(35_000);
  });

  it("gives the attempt back for a rate limit and waits retry_after", async () => {
    const u = await seedUser();
    await queued(u, 1);
    const ds = await claimOne(u);
    await failDeliveries(db, ds, {
      code: "RATE_LIMITED",
      retryable: true,
      countAttempt: false,
      retryInMs: 7_000,
    });
    const [row] = await deliveryRows();
    expect(row!.attempts).toBe(0);
    const wait = row!.runAfter.getTime() - Date.now();
    expect(wait).toBeGreaterThan(5_000);
    expect(wait).toBeLessThan(9_000);
  });

  it("fails for good after the fifth attempt, and the match becomes failed", async () => {
    const u = await seedUser();
    const [id] = await queued(u, 1);
    for (let i = 1; i <= 5; i++) {
      await db.execute(sql`update alert_deliveries set run_after = now()`);
      const ds = await claimOne(u);
      expect(ds[0]!.attempts).toBe(i);
      const res = await failDeliveries(db, ds, {
        code: "TG_UNAVAILABLE",
        retryable: true,
        countAttempt: true,
      });
      expect(res.failed).toBe(i === 5 ? 1 : 0);
    }
    expect((await deliveryRows())[0]).toMatchObject({ status: "failed" });
    expect((await matchRow(id!)).alertOutcome).toBe("failed");
  });

  it("a final error fails at once", async () => {
    const u = await seedUser();
    const [id] = await queued(u, 1);
    const ds = await claimOne(u);
    await failDeliveries(db, ds, {
      code: "TG_BAD_REQUEST",
      retryable: false,
      countAttempt: true,
    });
    expect((await deliveryRows())[0]).toMatchObject({
      status: "failed",
      errorCode: "TG_BAD_REQUEST",
    });
    expect((await matchRow(id!)).alertOutcome).toBe("failed");
  });

  it("a lost claim is reported and left alone", async () => {
    const u = await seedUser();
    await queued(u, 1);
    const ds = await claimOne(u);
    await db.execute(sql`update alert_deliveries set attempts = 9`);
    expect(
      await failDeliveries(db, ds, {
        code: "X",
        retryable: false,
        countAttempt: true,
      }),
    ).toEqual({ requeued: 0, failed: 0, lost: 1 });
    expect((await deliveryRows())[0]!.status).toBe("sending");
  });
});

describe("disableChannel", () => {
  it("turns the channel off and fails only that user's pending rows", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const [ma] = await queued(a, 1);
    await queued(b, 1);
    expect(await disableChannel(db, a, "telegram", "blocked")).toBe(1);
    const [ch] = await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, a));
    expect(ch).toMatchObject({ enabled: false, disabledReason: "blocked" });
    const rows = await deliveryRows();
    expect(rows.find((r) => r.userId === a)).toMatchObject({
      status: "failed",
      errorCode: "CHANNEL_DISABLED",
    });
    expect(rows.find((r) => r.userId === b)!.status).toBe("pending");
    expect((await matchRow(ma!)).alertOutcome).toBe("failed");
  });
});

describe("requeueStaleDeliveries", () => {
  it("puts old sending rows back and fails those out of attempts", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await queued(a, 1);
    const [mb] = await queued(b, 1);
    await claimDueDeliveries(db, "telegram", { maxUsers: 5, perUser: 5 });
    // Fresh claims are left alone.
    expect(await requeueStaleDeliveries(db, 120)).toBe(0);
    await db.execute(
      sql`update alert_deliveries set locked_at = now() - interval '5 minutes'`,
    );
    await db.execute(
      sql`update alert_deliveries set attempts = 5 where user_id = ${b}`,
    );
    expect(await requeueStaleDeliveries(db, 120)).toBe(2);
    const rows = await deliveryRows();
    expect(rows.find((r) => r.userId === a)).toMatchObject({
      status: "pending",
      attempts: 1,
      lockedAt: null,
    });
    expect(rows.find((r) => r.userId === b)).toMatchObject({
      status: "failed",
      errorCode: "STALE",
    });
    expect((await matchRow(mb!)).alertOutcome).toBe("failed");
  });
});

describe("Telegram link tokens", () => {
  it("links a chat once, and only before it expires", async () => {
    const u = await seedUser({ telegram: "none" });
    const expires = await createTelegramLinkToken(db, u, sha("tok-1"));
    expect(expires.getTime() - Date.now()).toBeGreaterThan(14 * MIN);
    expect(await useTelegramLinkToken(db, sha("wrong"), "42")).toBeNull();
    expect(await useTelegramLinkToken(db, sha("tok-1"), "42")).toBe(u);
    expect(await useTelegramLinkToken(db, sha("tok-1"), "42")).toBeNull();
    const [ch] = await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, u));
    expect(ch).toMatchObject({ kind: "telegram", target: "42", enabled: true });
    expect(ch!.verifiedAt).not.toBeNull();

    await createTelegramLinkToken(db, u, sha("tok-old"), 0);
    expect(await useTelegramLinkToken(db, sha("tok-old"), "42")).toBeNull();
  });

  it("re-linking replaces the chat and turns the channel back on", async () => {
    const u = await seedUser({ telegram: "disabled", chatId: "1" });
    await createTelegramLinkToken(db, u, sha("tok-2"));
    await useTelegramLinkToken(db, sha("tok-2"), "2");
    const rows = await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, u));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      target: "2",
      enabled: true,
      disabledReason: null,
    });
  });

  it("one chat, one account: linking it elsewhere turns the old link off", async () => {
    const first = await seedUser({ chatId: "99" });
    await queued(first, 1);
    const second = await seedUser({ telegram: "none" });
    await createTelegramLinkToken(db, second, sha("tok-3"));
    expect(await useTelegramLinkToken(db, sha("tok-3"), "99")).toBe(second);
    const chans = await db.select().from(alertChannels);
    expect(chans.find((c) => c.userId === first)).toMatchObject({
      enabled: false,
      disabledReason: "user_stop",
    });
    expect(chans.find((c) => c.userId === second)).toMatchObject({
      enabled: true,
    });
    // The first account's waiting alert is failed, not sent to the new owner.
    expect((await deliveryRows())[0]).toMatchObject({ status: "failed" });
  });

  it("/stop turns off every account on the chat", async () => {
    const u = await seedUser({ chatId: "7" });
    expect(await disableTelegramByChat(db, "7", "user_stop")).toBe(1);
    const [ch] = await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, u));
    expect(ch).toMatchObject({ enabled: false, disabledReason: "user_stop" });
    expect(await disableTelegramByChat(db, "7", "user_stop")).toBe(0);
  });
});

describe("pruneAlerts", () => {
  it("deletes old failures and long-expired tokens, keeps recent ones", async () => {
    const u = await seedUser();
    await queued(u, 2);
    await db.execute(sql`update alert_deliveries set status = 'failed'`);
    const [old] = await deliveryRows();
    await db.execute(
      sql`update alert_deliveries set created_at = now() - interval '31 days' where id = ${old!.id}`,
    );
    await createTelegramLinkToken(db, u, sha("fresh"));
    await db.insert(telegramLinkTokens).values({
      tokenHash: sha("stale"),
      userId: u,
      expiresAt: new Date(Date.now() - 2 * 86_400_000),
    });
    expect(await pruneAlerts(db)).toEqual({ deliveries: 1, tokens: 1 });
    expect(await deliveryRows()).toHaveLength(1);
    expect(await db.select().from(telegramLinkTokens)).toHaveLength(1);
  });
});

describe("alertStats", () => {
  it("counts the backlog, outcomes, queue and channels", async () => {
    const u = await seedUser();
    await seedUser({ telegram: "disabled" });
    await queued(u, 2);
    await seedMatch(u); // not routed yet
    const s = await alertStats(db, new Date(Date.now() - 86_400_000));
    expect(s).toMatchObject({
      backlog: 1,
      outcomes: { queued: 2 },
      deliveries: { pending: 2, sending: 0, failed: 0 },
      sentSince: 0,
      telegram: { linked: 1, disabled: 1 },
    });
    expect(s.oldestPendingRunAfter).toBeInstanceOf(Date);
  });
});
