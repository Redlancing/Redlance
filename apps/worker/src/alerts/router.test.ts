import {
  ALERTS_CHANNEL,
  MATCH_ALERTS_CHANNEL,
  alertChannels,
  alertDeliveries,
  createDb,
  jobPostAnalyses,
  jobPosts,
  matches,
  profiles,
  users,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPgListener } from "../db";
import { createRouter, type RouterDeps } from "./router";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 10 });
const silent = pino({ level: "silent" });
const noListen = async () => ({ onNotify() {}, async close() {} });

const MIN = 60_000;
const DAY = 86_400_000;

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

let seq = 0;

async function seedUser(
  opts: {
    plan?: "trial" | "standard" | "max";
    trialEndsAt?: Date;
    dailyCap?: number;
    telegram?: "linked" | "none";
  } = {},
): Promise<string> {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|rt${seq}-${Math.random()}`,
      email: "a@example.com",
      emailNormalized: `rt${seq}-${Math.random()}@example.com`,
    })
    .returning();
  await db.insert(profiles).values({
    userId: u!.id,
    displayName: "A",
    categories: ["development"],
    experienceLevel: "intermediate",
    country: "US",
    timeZone: "UTC",
    minRateMinor: 0,
    currency: "USD",
    rateType: "either",
    remoteOnly: true,
    onboardedAt: new Date(),
    plan: opts.plan ?? "trial",
    trialEndsAt: opts.trialEndsAt ?? new Date(Date.now() + 5 * DAY),
    ...(opts.dailyCap ? { alertsDailyCap: opts.dailyCap } : {}),
  });
  if ((opts.telegram ?? "linked") === "linked") {
    await db.insert(alertChannels).values({
      userId: u!.id,
      kind: "telegram",
      target: String(1000 + seq),
      enabled: true,
      verifiedAt: new Date(),
    });
  }
  return u!.id;
}

async function seedMatch(
  userId: string,
  over: {
    score?: number;
    postedAt?: Date;
    alertOutcome?: string | null;
    withdrawn?: boolean;
    createdAt?: Date;
  } = {},
): Promise<string> {
  seq++;
  const postedAt = over.postedAt ?? new Date(Date.now() - 5 * MIN);
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_rt${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/rt${seq}/x/`,
      title: `[Hiring] Gig ${seq}`,
      body: "Need help.",
      postedAt,
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
      postedAt,
      ruleScore: score,
      broad: false,
      features: [],
      ruleReason: "Strong fit",
      aiStatus: "not_needed",
      score,
      profileVersion: 1,
      analysedAt: new Date(),
      alertOutcome: (over.alertOutcome ?? null) as never,
      withdrawnAt: over.withdrawn ? new Date() : null,
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    })
    .returning();
  return m!.id;
}

const outcome = async (id: string) =>
  (await db.select().from(matches).where(eq(matches.id, id)))[0]!.alertOutcome;

function make(over: Partial<RouterDeps> = {}) {
  return createRouter({
    db,
    log: silent,
    listen: noListen,
    maxAgeHours: 24,
    telegramAvailable: true,
    ...over,
  });
}

async function runOnce(over: Partial<RouterDeps> = {}) {
  const r = make(over);
  await r.start();
  await r.idle();
  await r.stop();
}

async function notifications(channel: string, run: () => Promise<unknown>) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  let n = 0;
  c.on("notification", (msg) => {
    if (msg.channel === channel) n++;
  });
  await c.query(`LISTEN ${channel}`);
  await run();
  await new Promise((r) => setTimeout(r, 200));
  await c.end();
  return n;
}

describe("alert router", () => {
  it("queues a good match: outcome, one delivery, NOTIFY alerts", async () => {
    const u = await seedUser();
    const m = await seedMatch(u, { score: 80 });
    const n = await notifications(ALERTS_CHANNEL, () => runOnce());
    expect(await outcome(m)).toBe("queued");
    const d = await db.select().from(alertDeliveries);
    expect(d).toHaveLength(1);
    expect(d[0]!.matchId).toBe(m);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("writes each skip outcome end to end", async () => {
    const u = await seedUser();
    const expired = await seedUser({
      plan: "trial",
      trialEndsAt: new Date(Date.now() - DAY),
    });
    const noTg = await seedUser({ telegram: "none" });
    const low = await seedMatch(u, { score: 50 });
    const stale = await seedMatch(u, {
      postedAt: new Date(Date.now() - 48 * 60 * MIN),
    });
    const trial = await seedMatch(expired);
    const withdrawn = await seedMatch(u, { withdrawn: true });
    const noChannel = await seedMatch(noTg);
    await runOnce();
    expect(await outcome(low)).toBe("below_threshold");
    expect(await outcome(stale)).toBe("skipped_stale");
    expect(await outcome(trial)).toBe("skipped_trial");
    expect(await outcome(withdrawn)).toBe("skipped_withdrawn");
    expect(await outcome(noChannel)).toBe("skipped_no_channel");
    expect(await db.select().from(alertDeliveries)).toHaveLength(0);
  });

  it("counts queued matches in the same batch toward the cap", async () => {
    const u = await seedUser({ dailyCap: 5 });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++)
      ids.push(
        await seedMatch(u, {
          createdAt: new Date(Date.now() - (10 - i) * 1000),
        }),
      );
    await runOnce();
    const outs = await Promise.all(ids.map(outcome));
    expect(outs.filter((o) => o === "queued")).toHaveLength(5);
    expect(outs.filter((o) => o === "skipped_cap")).toHaveLength(1);
    expect(outs[5]).toBe("skipped_cap");
  });

  it("never touches backfill rows", async () => {
    const u = await seedUser();
    const m = await seedMatch(u, { alertOutcome: "skipped_backfill" });
    await runOnce();
    expect(await outcome(m)).toBe("skipped_backfill");
    expect(await db.select().from(alertDeliveries)).toHaveLength(0);
  });

  it("without a bot token everything is skipped_no_channel", async () => {
    const u = await seedUser();
    const m = await seedMatch(u);
    await runOnce({ telegramAvailable: false });
    expect(await outcome(m)).toBe("skipped_no_channel");
  });

  it("wakes on NOTIFY quickly even with a long poll", async () => {
    const u = await seedUser();
    const r = make({
      pollMs: 60_000,
      listen: () => createPgListener(url, silent, MATCH_ALERTS_CHANNEL),
    });
    await r.start();
    const m = await seedMatch(u);
    await db.execute(sql`select pg_notify(${MATCH_ALERTS_CHANNEL}, '')`);
    const t0 = Date.now();
    let o: unknown = null;
    while (Date.now() - t0 < 2000 && (o = await outcome(m)) === null)
      await new Promise((res) => setTimeout(res, 20));
    await r.stop();
    expect(o).toBe("queued");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("the poll alone routes when the listener is stubbed", async () => {
    const u = await seedUser();
    const r = make({ pollMs: 50 });
    await r.start();
    const m = await seedMatch(u);
    const t0 = Date.now();
    let o: unknown = null;
    while (Date.now() - t0 < 3000 && (o = await outcome(m)) === null)
      await new Promise((res) => setTimeout(res, 20));
    await r.stop();
    expect(o).toBe("queued");
  });

  it("loops batches until one comes back short", async () => {
    const u = await seedUser({ dailyCap: 100 });
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await seedMatch(u));
    await runOnce({ batchSize: 3 });
    for (const id of ids) expect(await outcome(id)).not.toBeNull();
  });

  it("stop() during a batch leaves matches routed or untouched, never half", async () => {
    const u = await seedUser({ dailyCap: 100 });
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await seedMatch(u));
    const r = make({ batchSize: 5 });
    const started = r.start();
    await r.stop();
    await started.catch(() => {});
    const rows = await db.select().from(matches);
    const deliveries = await db.select().from(alertDeliveries);
    const queuedN = rows.filter((x) => x.alertOutcome === "queued").length;
    expect(
      rows.every((x) => x.alertOutcome === null || x.alertOutcome === "queued"),
    ).toBe(true);
    expect(deliveries).toHaveLength(queuedN);
    expect(queuedN % 5).toBe(0);
  });

  it("routes 1,000 matches quickly", async () => {
    const users_: string[] = [];
    for (let i = 0; i < 100; i++)
      users_.push(await seedUser({ dailyCap: 100 }));
    // Bulk-seed: copy one post/match shape per user x10 through SQL for speed.
    for (const u of users_) for (let k = 0; k < 10; k++) await seedMatch(u);
    const t0 = Date.now();
    await runOnce();
    const ms = Date.now() - t0;
    console.log(`ROUTED 1000 matches in ${ms} ms`);
    const left = await db.execute(
      sql`select count(*)::int as n from matches where alert_outcome is null`,
    );
    expect((left.rows[0] as { n: number }).n).toBe(0);
    expect(ms).toBeLessThan(5000);
  }, 120_000);
});
