import { createHash } from "node:crypto";
import { alertChannels, createDb, createTelegramLinkToken } from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { acquireSessionLock } from "../../db";
import { BOT_REPLIES, createTelegramBot, type SessionLock } from "./bot";
import type { TelegramClient, TelegramUpdate } from "./client";
import { seedUser } from "./test-fixtures";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 5 });
const silent = pino({ level: "silent" });

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
};
beforeAll(async () => {
  await runMigrations(url);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

const TOKEN = "A".repeat(40) + "abc"; // 43 base64url characters
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let updateId = 0;
const msg = (
  text: string,
  chat: { id: number; type?: string } = { id: 42 },
): TelegramUpdate => ({
  update_id: ++updateId,
  message: {
    message_id: updateId,
    chat: { id: chat.id, type: chat.type ?? "private" },
    text,
  },
});

/** A fake Telegram: hands out scripted update batches, then long-polls until aborted. */
function fakeTelegram(batches: TelegramUpdate[][]) {
  const replies: { chatId: string; text: string }[] = [];
  const offsets: (number | undefined)[] = [];
  const client: Pick<TelegramClient, "getUpdates" | "sendText"> = {
    async getUpdates({ offset, signal }) {
      offsets.push(offset);
      const next = batches.shift();
      if (next) return next;
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener("abort", () => resolve());
      });
      throw new Error("aborted");
    },
    async sendText(chatId, text) {
      replies.push({ chatId, text });
      return { messageId: 1 };
    },
  };
  return { client, replies, offsets, polls: () => offsets.length };
}

const fakeLock = (): SessionLock => ({
  lost: new Promise(() => {}),
  release: async () => {},
});

function make(
  tg: ReturnType<typeof fakeTelegram>,
  acquireLock: () => Promise<SessionLock | null> = async () => fakeLock(),
) {
  return createTelegramBot({
    db,
    log: silent,
    client: tg.client,
    acquireLock,
    standbyMs: 20,
  });
}

async function until(cond: () => boolean, ms = 2000) {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
}

const channelOf = async (userId: string) =>
  (
    await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, userId))
  )[0];

describe("Telegram bot", () => {
  it("links a chat with /start <token> and advances the offset", async () => {
    const u = await seedUser(db, { telegram: "none" });
    await createTelegramLinkToken(db, u, sha(TOKEN));
    const tg = fakeTelegram([[msg(`/start ${TOKEN}`, { id: 777 })]]);
    const bot = make(tg);
    bot.start();
    await until(() => tg.polls() >= 2);
    await bot.stop();
    expect(tg.replies).toEqual([
      { chatId: "777", text: BOT_REPLIES.connected },
    ]);
    expect(await channelOf(u)).toMatchObject({ target: "777", enabled: true });
    expect(tg.offsets).toEqual([undefined, updateId + 1]);
  });

  it("answers an expired, reused or malformed token the same way", async () => {
    const u = await seedUser(db, { telegram: "none" });
    await createTelegramLinkToken(db, u, sha(TOKEN));
    const expired = "B".repeat(43);
    await createTelegramLinkToken(db, u, sha(expired), 0);
    const tg = fakeTelegram([]);
    const bot = make(tg);
    await bot.handle(msg(`/start ${TOKEN}`));
    await bot.handle(msg(`/start ${TOKEN}`)); // reused
    await bot.handle(msg(`/start ${expired}`));
    await bot.handle(msg("/start not-a-token"));
    expect(tg.replies.map((r) => r.text)).toEqual([
      BOT_REPLIES.connected,
      BOT_REPLIES.expired,
      BOT_REPLIES.expired,
      BOT_REPLIES.expired,
    ]);
  });

  it("explains how to connect for a bare /start", async () => {
    const tg = fakeTelegram([]);
    await make(tg).handle(msg("/start"));
    expect(tg.replies[0]!.text).toBe(BOT_REPLIES.howTo);
  });

  it("/stop turns alerts off", async () => {
    const u = await seedUser(db, { chatId: "42" });
    const tg = fakeTelegram([]);
    await make(tg).handle(msg("/stop"));
    expect(await channelOf(u)).toMatchObject({
      enabled: false,
      disabledReason: "user_stop",
    });
    expect(tg.replies[0]!.text).toBe(BOT_REPLIES.stopped);
  });

  it("ignores group chats", async () => {
    const u = await seedUser(db, { telegram: "none" });
    await createTelegramLinkToken(db, u, sha(TOKEN));
    const tg = fakeTelegram([]);
    await make(tg).handle(msg(`/start ${TOKEN}`, { id: -100, type: "group" }));
    expect(tg.replies).toEqual([]);
    expect(await channelOf(u)).toBeUndefined();
  });

  it("sends the help line at most once an hour per chat", async () => {
    const tg = fakeTelegram([]);
    const bot = make(tg);
    await bot.handle(msg("hello"));
    await bot.handle(msg("hello again"));
    await bot.handle(msg("hi", { id: 43 }));
    expect(tg.replies.map((r) => r.chatId)).toEqual(["42", "43"]);
  });

  it("a failing update gets one short generic reply (L4)", async () => {
    const tg = fakeTelegram([]);
    const broken = {
      transaction: async () => {
        throw new Error("connection terminated");
      },
    } as unknown as typeof db;
    const bot = createTelegramBot({
      db: broken,
      log: silent,
      client: tg.client,
      acquireLock: async () => fakeLock(),
    });
    await bot.handle(msg(`/start ${TOKEN}`, { id: 55 }));
    expect(tg.replies).toEqual([{ chatId: "55", text: BOT_REPLIES.failed }]);
    expect(BOT_REPLIES.failed).toBe(
      "Something went wrong. Please try the link again in a minute.",
    );
  });

  it("a failing update in the poll loop is answered and the loop goes on (L4)", async () => {
    const tg = fakeTelegram([
      [msg("/stop", { id: 56 }), msg("hello", { id: 57 })],
    ]);
    const broken = {
      transaction: async () => {
        throw new Error("connection terminated");
      },
    } as unknown as typeof db;
    const bot = createTelegramBot({
      db: broken,
      log: silent,
      client: tg.client,
      acquireLock: async () => fakeLock(),
    });
    bot.start();
    await until(() => tg.polls() >= 2);
    await bot.stop();
    expect(tg.replies).toEqual([
      { chatId: "56", text: BOT_REPLIES.failed },
      { chatId: "57", text: BOT_REPLIES.help },
    ]);
  });

  it("takes a slot from the shared limiter before every reply (L8)", async () => {
    const tg = fakeTelegram([]);
    const order: string[] = [];
    const sendText = tg.client.sendText;
    tg.client.sendText = async (chatId, text) => {
      order.push("send");
      return sendText(chatId, text);
    };
    const bot = createTelegramBot({
      db,
      log: silent,
      client: tg.client,
      acquireLock: async () => fakeLock(),
      limiter: {
        take: async () => {
          order.push("take");
        },
      },
    });
    await bot.handle(msg("/start"));
    await bot.handle(msg("hello", { id: 58 }));
    expect(order).toEqual(["take", "send", "take", "send"]);
  });

  it("only the lock holder polls; the other stands by", async () => {
    const lockUrl = url;
    const key = `redlance:telegram-bot-test-${Math.random()}`;
    const acquire = () => acquireSessionLock(lockUrl, key, silent);
    const a = fakeTelegram([]);
    const b = fakeTelegram([]);
    const botA = make(a, acquire);
    botA.start();
    await until(() => a.polls() >= 1);
    const botB = make(b, acquire);
    botB.start();
    await new Promise((r) => setTimeout(r, 150));
    expect(b.polls()).toBe(0);
    // A stops and releases the lock: B takes over.
    await botA.stop();
    await until(() => b.polls() >= 1);
    await botB.stop();
  });
});
