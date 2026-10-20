import * as core from "@redlance/core";
import { eq, sql } from "drizzle-orm";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ALERT_OUTCOMES,
  alertChannels,
  alertDeliveries,
  CHANNEL_DISABLED_REASONS,
  createDb,
  DELIVERY_CHANNELS,
  DELIVERY_STATUSES,
  jobPosts,
  matches,
  pgErrorCode,
  profiles,
  telegramLinkTokens,
  users,
} from "./index";
import { migrationsFolder, runMigrations } from "./migrate";

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
      authSub: `dev|a${seq}-${Math.random()}`,
      email: "a@example.com",
      emailNormalized: `a${seq}-${Math.random()}@example.com`,
    })
    .returning();
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_a${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/a${seq}/x/`,
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
      ruleScore: 80,
      broad: false,
      features: [],
      ruleReason: "r",
      aiStatus: "not_needed",
      score: 80,
      profileVersion: 1,
      analysedAt: new Date(),
    })
    .returning();
  return { userId: u!.id, matchId: m!.id };
}

const expectReject = async (
  p: Promise<unknown>,
  test: (e: unknown) => boolean,
) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the write to fail").not.toBeNull();
  expect(test(err), String(err)).toBe(true);
};

describe("alert lists mirror core", () => {
  it("matches @redlance/core", () => {
    expect(ALERT_OUTCOMES).toEqual(core.ALERT_OUTCOMES);
    expect(DELIVERY_CHANNELS).toEqual(core.DELIVERY_CHANNELS);
    expect(DELIVERY_STATUSES).toEqual(core.DELIVERY_STATUSES);
    expect(CHANNEL_DISABLED_REASONS).toEqual(core.CHANNEL_DISABLED_REASONS);
  });
});

describe("alert columns", () => {
  it("defaults a new match to not routed, with no channels", async () => {
    const s = await seed();
    const [m] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, s.matchId));
    expect(m!.alertOutcome).toBeNull();
    expect(m!.alertChannels).toEqual([]);
    expect(m!.telegramMessageId).toBeNull();
  });

  it("rejects an unknown outcome and an out-of-range alert score", async () => {
    const s = await seed();
    await expectReject(
      db.execute(
        sql`update matches set alert_outcome = 'nope' where id = ${s.matchId}`,
      ),
      check,
    );
    await expectReject(
      db
        .update(matches)
        .set({ alertScore: 101 })
        .where(eq(matches.id, s.matchId)),
      check,
    );
  });

  it("stores a large Telegram message id", async () => {
    const s = await seed();
    await db
      .update(matches)
      .set({ telegramMessageId: 2 ** 40 })
      .where(eq(matches.id, s.matchId));
    const [m] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, s.matchId));
    expect(m!.telegramMessageId).toBe(2 ** 40);
  });

  it("checks the profile threshold and cap ranges", async () => {
    const s = await seed();
    await db.insert(profiles).values({
      userId: s.userId,
      displayName: "A",
      categories: ["web_dev"],
      experienceLevel: "intermediate",
      country: "US",
      timeZone: "UTC",
      minRateMinor: 0,
      currency: "USD",
      rateType: "hourly",
      remoteOnly: true,
      onboardedAt: new Date(),
      trialEndsAt: new Date(),
    });
    const [p] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, s.userId));
    expect(p!.alertMinScore).toBe(70);
    expect(p!.alertsDailyCap).toBe(20);
    for (const set of [
      { alertMinScore: 101 },
      { alertMinScore: -1 },
      { alertsDailyCap: 0 },
      { alertsDailyCap: 101 },
    ]) {
      await expectReject(
        db.update(profiles).set(set).where(eq(profiles.userId, s.userId)),
        check,
      );
    }
  });

  it("checks the channel's disabled reason", async () => {
    const s = await seed();
    await db
      .insert(alertChannels)
      .values({
        userId: s.userId,
        kind: "telegram",
        target: "123",
        disabledReason: "blocked",
      });
    await expectReject(
      db.execute(
        sql`update alert_channels set disabled_reason = 'other' where user_id = ${s.userId}`,
      ),
      check,
    );
  });
});

describe("alert_deliveries", () => {
  it("allows one row per match and channel", async () => {
    const s = await seed();
    await db
      .insert(alertDeliveries)
      .values({ userId: s.userId, matchId: s.matchId, channel: "telegram" });
    await expectReject(
      db
        .insert(alertDeliveries)
        .values({ userId: s.userId, matchId: s.matchId, channel: "telegram" }),
      unique,
    );
  });

  it("rejects unknown channels and statuses", async () => {
    const s = await seed();
    await expectReject(
      db.execute(
        sql`insert into alert_deliveries (id, user_id, match_id, channel) values (gen_random_uuid(), ${s.userId}, ${s.matchId}, 'email')`,
      ),
      check,
    );
    await expectReject(
      db.execute(
        sql`insert into alert_deliveries (id, user_id, match_id, channel, status) values (gen_random_uuid(), ${s.userId}, ${s.matchId}, 'telegram', 'sent')`,
      ),
      check,
    );
  });

  it("is deleted with its match", async () => {
    const s = await seed();
    await db
      .insert(alertDeliveries)
      .values({ userId: s.userId, matchId: s.matchId, channel: "telegram" });
    await db.delete(matches).where(eq(matches.id, s.matchId));
    expect(await db.select().from(alertDeliveries)).toHaveLength(0);
  });
});

describe("telegram_link_tokens", () => {
  it("only stores a sha256 hex hash", async () => {
    const s = await seed();
    await db.insert(telegramLinkTokens).values({
      tokenHash: "a".repeat(64),
      userId: s.userId,
      expiresAt: new Date(),
    });
    await expectReject(
      db.insert(telegramLinkTokens).values({
        tokenHash: "raw-token",
        userId: s.userId,
        expiresAt: new Date(),
      }),
      check,
    );
  });
});

describe("migration 0015_alerts", () => {
  const dbName = `redlance_mig_${process.pid}_${Date.now()}`;
  const tmp = mkdtempSync(join(tmpdir(), "redlance-mig-"));
  const freshUrl = (() => {
    const u = new URL(url);
    u.pathname = `/${dbName}`;
    return u.toString();
  })();

  afterAll(async () => {
    await db.execute(
      sql.raw(`drop database if exists "${dbName}" with (force)`),
    );
    rmSync(tmp, { recursive: true, force: true });
  });

  it("marks matches that already exist as skipped_backfill", async () => {
    await db.execute(sql.raw(`create database "${dbName}"`));

    // Apply every migration before 0015 from a copy with a trimmed journal.
    const before = join(tmp, "before");
    cpSync(migrationsFolder, before, { recursive: true });
    const journalPath = join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const at = journal.entries.findIndex(
      (e: { tag: string }) => e.tag === "0015_alerts",
    );
    expect(at).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, at);
    writeFileSync(journalPath, JSON.stringify(journal));

    const fresh = createDb(freshUrl, { max: 1 });
    try {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(fresh.db, { migrationsFolder: before });
      await fresh.db.execute(sql`
        with u as (
          insert into users (auth_sub, email, email_normalized)
          values ('dev|m', 'm@example.com', 'm@example.com') returning id
        ), p as (
          insert into job_posts (id, source, external_id, fetched_via, community, url, title, body, posted_at, pre_kind)
          values (gen_random_uuid(), 'reddit', 't3_m', 'rss', 'forhire',
            'https://www.reddit.com/r/forhire/comments/m/x/', 'Gig', 'b', now(), 'hiring')
          returning id
        )
        insert into matches (id, user_id, job_post_id, posted_at, rule_score, broad, features,
          rule_reason, ai_status, score, profile_version, analysed_at)
        select gen_random_uuid(), u.id, p.id, now(), 80, false, '[]', 'r', 'not_needed', 80, 1, now()
        from u, p`);

      await migrate(fresh.db, { migrationsFolder });
      const rows = await fresh.db.execute(
        sql`select alert_outcome from matches`,
      );
      expect(rows.rows).toEqual([{ alert_outcome: "skipped_backfill" }]);
    } finally {
      await fresh.pool.end();
    }
  });
});
