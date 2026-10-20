import {
  alertChannels,
  alertDeliveries,
  createDb,
  matches,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TelegramError, type TelegramClient } from "./client";
import { createTelegramSender, type TelegramSenderDeps } from "./sender";
import { queueAlerts, seedUser } from "./test-fixtures";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 10 });
const silent = pino({ level: "silent" });
const noListen = async () => ({ onNotify() {}, async close() {} });

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

type Sent = Parameters<TelegramClient["sendMessage"]>[0];

/** A fake Telegram: records messages; `fail` decides per call whether to throw. */
function fakeTelegram(
  fail: (msg: Sent, n: number) => Error | null = () => null,
) {
  const sent: Sent[] = [];
  let n = 0;
  let nextId = 100;
  const client: Pick<TelegramClient, "sendMessage"> = {
    async sendMessage(msg) {
      n++;
      const err = fail(msg, n);
      if (err) throw err;
      sent.push(msg);
      return { messageId: nextId++ };
    },
  };
  return { client, sent, calls: () => n };
}

function make(
  client: Pick<TelegramClient, "sendMessage">,
  over: Partial<TelegramSenderDeps> = {},
) {
  return createTelegramSender({
    db,
    log: silent,
    client,
    listen: noListen,
    appOrigin: "https://redlance.app",
    maxPerSecond: 1000,
    perChatGapMs: 0,
    pollMs: 3_600_000,
    sweepMs: 3_600_000,
    ...over,
  });
}

async function runOnce(s: ReturnType<typeof make>) {
  await s.start();
  await s.idle();
  await s.stop();
}

const deliveries = () => db.select().from(alertDeliveries);
const matchRow = async (id: string) =>
  (await db.select().from(matches).where(eq(matches.id, id)))[0]!;

describe("Telegram sender", () => {
  it("sends one alert and deletes the delivery", async () => {
    const u = await seedUser(db, { chatId: "42" });
    const [m] = await queueAlerts(db, u, 1);
    const tg = fakeTelegram();
    await runOnce(make(tg.client));
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]!.chatId).toBe("42");
    expect(tg.sent[0]!.text).toContain("Gig &lt;");
    expect(tg.sent[0]!.text).toContain("$400–600");
    expect(tg.sent[0]!.text).toContain("Next.js &amp; Stripe");
    expect(tg.sent[0]!.replyMarkup!.inline_keyboard[0]![0]!.url).toBe(
      `https://redlance.app/feed/${m}`,
    );
    expect(await deliveries()).toHaveLength(0);
    expect(await matchRow(m!)).toMatchObject({
      alertOutcome: "sent",
      alertTemplate: "tg@1",
      telegramMessageId: 100,
      alertChannels: ["telegram"],
    });
  });

  it("combines a user's matches into one message", async () => {
    const u = await seedUser(db);
    const ids = await queueAlerts(db, u, 3);
    const tg = fakeTelegram();
    await runOnce(make(tg.client));
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]!.text).toContain("3 new matches");
    for (const id of ids)
      expect((await matchRow(id)).telegramMessageId).toBe(100);
  });

  it("sends at most five matches per message", async () => {
    const u = await seedUser(db);
    await queueAlerts(db, u, 7);
    const tg = fakeTelegram();
    await runOnce(make(tg.client));
    expect(
      tg.sent.map((s) => s.text.match(/^🎯 <b>(\d) new/)?.[1] ?? "1"),
    ).toEqual(["5", "2"]);
  });

  it("a rate limit waits retry_after without using an attempt", async () => {
    const u = await seedUser(db);
    const [m] = await queueAlerts(db, u, 1);
    const tg = fakeTelegram(
      () => new TelegramError("sendMessage", 429, "Too Many Requests", 9),
    );
    await runOnce(make(tg.client));
    const [d] = await deliveries();
    expect(d).toMatchObject({
      status: "pending",
      attempts: 0,
      errorCode: "RATE_LIMITED",
    });
    const wait = d!.runAfter.getTime() - Date.now();
    expect(wait).toBeGreaterThan(7_000);
    expect(wait).toBeLessThan(10_000);
    expect((await matchRow(m!)).alertOutcome).toBe("queued");
  });

  it("a blocked bot turns the channel off and fails the user's other alerts", async () => {
    const u = await seedUser(db);
    const ids = await queueAlerts(db, u, 7); // 5 sent in the first message, 2 wait
    const tg = fakeTelegram(
      () =>
        new TelegramError(
          "sendMessage",
          403,
          "Forbidden: bot was blocked by the user",
        ),
    );
    await runOnce(make(tg.client));
    expect(tg.calls()).toBe(1);
    const [ch] = await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, u));
    expect(ch).toMatchObject({ enabled: false, disabledReason: "blocked" });
    const ds = await deliveries();
    expect(ds.every((d) => d.status === "failed")).toBe(true);
    expect(new Set(ds.map((d) => d.errorCode))).toEqual(
      new Set(["TG_BLOCKED", "CHANNEL_DISABLED"]),
    );
    for (const id of ids)
      expect((await matchRow(id)).alertOutcome).toBe("failed");
  });

  it("an outage retries with backoff and fails after five attempts", async () => {
    const u = await seedUser(db);
    const [m] = await queueAlerts(db, u, 1);
    const tg = fakeTelegram(() => new TelegramError("sendMessage", 502, ""));
    for (let i = 1; i <= 5; i++) {
      await db.execute(sql`update alert_deliveries set run_after = now()`);
      await runOnce(make(tg.client));
      const [d] = await deliveries();
      expect(d!.attempts).toBe(i);
      expect(d!.status).toBe(i < 5 ? "pending" : "failed");
    }
    expect((await matchRow(m!)).alertOutcome).toBe("failed");
  });

  it("five outages in a row pause sending", async () => {
    for (let i = 0; i < 7; i++) await queueAlerts(db, await seedUser(db), 1);
    const tg = fakeTelegram(
      () => new TelegramError("sendMessage", 0, "network error"),
    );
    // One user at a time, so the breaker sees the failures in order.
    await runOnce(make(tg.client, { maxUsers: 1 }));
    expect(tg.calls()).toBe(5);
    expect((await deliveries()).filter((d) => d.attempts === 0)).toHaveLength(
      2,
    );
  });

  it("a channel turned off after routing is never sent to", async () => {
    const u = await seedUser(db);
    const [m] = await queueAlerts(db, u, 1);
    await db
      .update(alertChannels)
      .set({ enabled: false })
      .where(eq(alertChannels.userId, u));
    const tg = fakeTelegram();
    await runOnce(make(tg.client));
    expect(tg.sent).toHaveLength(0);
    expect((await matchRow(m!)).alertOutcome).toBe("failed");
  });

  it("a crash between send and complete is re-sent by the stale sweep", async () => {
    const u = await seedUser(db);
    const [m] = await queueAlerts(db, u, 1);
    // The first worker sent the message, then died before recording it.
    const tg = fakeTelegram();
    await db.execute(
      sql`update alert_deliveries set status = 'sending', attempts = 1, locked_at = now() - interval '5 minutes'`,
    );
    await runOnce(make(tg.client, { staleAfterSec: 120 }));
    expect(tg.sent).toHaveLength(1); // the documented duplicate
    expect((await matchRow(m!)).alertOutcome).toBe("sent");
  });

  it("wakes on NOTIFY alerts", async () => {
    const { createPgListener } = await import("../../db");
    const { ALERTS_CHANNEL } = await import("@redlance/db");
    const u = await seedUser(db);
    const tg = fakeTelegram();
    const s = make(tg.client, {
      listen: () => createPgListener(url, silent, ALERTS_CHANNEL),
    });
    await s.start();
    await queueAlerts(db, u, 1); // the routing batch NOTIFYs on commit
    const deadline = Date.now() + 2000;
    while (tg.sent.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await s.idle();
    await s.stop();
    expect(tg.sent).toHaveLength(1);
  });

  it("a claim swept during a 429 pause is sent once, by its new owner (M1)", async () => {
    const a = await seedUser(db, { chatId: "1" });
    const b = await seedUser(db, { chatId: "2" });
    const [ma] = await queueAlerts(db, a, 1);
    const [mb] = await queueAlerts(db, b, 1);
    // The first send gets a 1 s rate limit; every later one succeeds.
    const tg = fakeTelegram((_, n) =>
      n === 1 ? new TelegramError("sendMessage", 429, "Too Many", 1) : null,
    );
    // 2 a second: the second group waits in the limiter, then in the pause.
    const s = make(tg.client, { maxPerSecond: 2 });
    await s.start();
    // Wait until the 429 is recorded (the rate-limited row is pending again).
    const deadline = Date.now() + 2000;
    const limited = async () =>
      (await deliveries()).some((d) => d.errorCode === "RATE_LIMITED");
    while (!(await limited()) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 10));
    expect(tg.calls()).toBe(1);
    // The other group is still waiting: its lock looks stale and the sweep re-queues it,
    // and the sender claims it again.
    await db.execute(
      sql`update alert_deliveries set locked_at = now() - interval '5 minutes' where status = 'sending'`,
    );
    await s.sweep();
    await s.idle();
    // The rate-limited one comes back after its retry_after.
    await db.execute(sql`update alert_deliveries set run_after = now()`);
    await s.pump();
    await s.idle();
    await s.stop();
    const perChat = (chat: string) =>
      tg.sent.filter((m) => m.chatId === chat).length;
    expect(perChat("1")).toBe(1);
    expect(perChat("2")).toBe(1);
    expect(await deliveries()).toHaveLength(0);
    expect((await matchRow(ma!)).alertOutcome).toBe("sent");
    expect((await matchRow(mb!)).alertOutcome).toBe("sent");
  });

  it("a claim lost before the send is skipped and never sent (M1)", async () => {
    const u = await seedUser(db, { chatId: "9" });
    await queueAlerts(db, u, 1);
    const tg = fakeTelegram();
    // A slow pacer holds the second user's group long enough to steal its claim.
    const s = make(tg.client, { maxPerSecond: 4 });
    await s.start(); // the first group is sent at once
    await queueAlerts(db, await seedUser(db, { chatId: "10" }), 1);
    void s.pump();
    await new Promise((r) => setTimeout(r, 60));
    // Another sender's sweep and claim take the row (attempts moves on).
    await db.execute(
      sql`update alert_deliveries set attempts = attempts + 1 where status = 'sending'`,
    );
    await s.idle();
    await s.stop();
    expect(tg.sent.map((m) => m.chatId)).toEqual(["9"]);
    // Left for its owner: still sending, untouched.
    expect(await deliveries()).toMatchObject([
      { status: "sending", attempts: 2 },
    ]);
  });

  it("stop() aborts a long pacer wait and gives the rows back within the grace (L1)", async () => {
    const u = await seedUser(db);
    await queueAlerts(db, u, 1);
    const tg = fakeTelegram();
    // One send per 100 s: the second group would wait far past the grace.
    const s = make(tg.client, { maxPerSecond: 0.01 });
    await s.start();
    await queueAlerts(db, await seedUser(db), 1);
    void s.pump();
    await new Promise((r) => setTimeout(r, 100));
    const t = Date.now();
    await s.stop(200);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(tg.sent).toHaveLength(1);
    const left = await deliveries();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      status: "pending",
      attempts: 0,
      errorCode: "SHUTDOWN",
    });
  });

  it("leaves out an empty keyboard (a localhost APP_ORIGIN has no buttons)", async () => {
    const u = await seedUser(db);
    await queueAlerts(db, u, 3);
    const tg = fakeTelegram();
    await runOnce(make(tg.client, { appOrigin: "http://localhost:3001" }));
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]!.replyMarkup).toBeUndefined();
  });

  it("stop() gives back a claimed group that wasn't sent yet", async () => {
    const u = await seedUser(db);
    await queueAlerts(db, u, 1);
    const tg = fakeTelegram();
    // A slow pacer: the send is still waiting when stop() arrives.
    const s = make(tg.client, { maxPerSecond: 0.5 });
    await s.start(); // the first take() is immediate
    await queueAlerts(db, await seedUser(db), 1);
    void s.pump();
    await new Promise((r) => setTimeout(r, 100));
    await s.stop(5_000);
    expect(tg.sent).toHaveLength(1);
    const pending = (await deliveries()).filter((d) => d.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ attempts: 0, errorCode: "SHUTDOWN" });
  });
});
