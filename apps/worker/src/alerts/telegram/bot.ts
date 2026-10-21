import { createHash } from "node:crypto";
import {
  disableTelegramByChat,
  pgErrorCode,
  useTelegramLinkToken,
  type Database,
} from "@redlance/db";
import type { Logger } from "../../logger";
import { realClock, type Clock, type RateLimiter } from "../pace";
import {
  TelegramError,
  type TelegramClient,
  type TelegramUpdate,
} from "./client";

// The linking bot (docs/alerts/README.md §4.5): long-polls getUpdates and answers /start
// <token> (connect), /start (how to connect) and /stop (alerts off). Telegram allows one
// getUpdates caller per bot, so it runs only while holding a Postgres advisory lock; a second
// worker stands by. The offset lives in memory: after a restart Telegram re-sends the updates
// of the last 24 h that weren't confirmed, which is harmless (link tokens are single use).

export type SessionLock = { lost: Promise<void>; release(): Promise<void> };

export type TelegramBotDeps = {
  db: Database;
  log: Logger;
  client: Pick<TelegramClient, "getUpdates" | "sendText">;
  acquireLock: () => Promise<SessionLock | null>;
  /** The sender's limiter, so replies count toward the bot-wide send rate. */
  limiter?: Pick<RateLimiter, "take">;
  /** Long-poll length. */
  pollTimeoutSec?: number;
  /** Wait before trying the lock again when another worker holds it. */
  standbyMs?: number;
  clock?: Clock;
};

export const BOT_REPLIES = {
  connected:
    "Connected. New Redlance matches will arrive here. Send /stop to turn alerts off.",
  expired:
    "This link has expired or was already used. Open Redlance and press Connect Telegram again.",
  howTo: "To get alerts here, open Redlance and press Connect Telegram.",
  stopped: "Alerts are off. Turn them back on in Redlance.",
  help: "This bot sends your new Redlance matches. Send /stop to turn alerts off.",
  failed: "Something went wrong. Please try the link again in a minute.",
} as const;

/** A link token is 32 random bytes as base64url (43 characters). */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const HELP_GAP_MS = 60 * 60_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createTelegramBot(deps: TelegramBotDeps) {
  const clock = deps.clock ?? realClock;
  const stop = new AbortController();
  const helpSentAt = new Map<string, number>();
  let loop: Promise<void> | null = null;

  async function reply(chatId: string, text: string) {
    try {
      await deps.limiter?.take(stop.signal);
      await deps.client.sendText(chatId, text);
    } catch (err) {
      deps.log.warn(
        { status: err instanceof TelegramError ? err.status : undefined },
        "bot reply failed",
      );
    }
  }

  /** Handles one update; if that throws (e.g. a database error), the chat gets one short reply. */
  async function handle(u: TelegramUpdate): Promise<void> {
    try {
      await handleUnsafe(u);
    } catch (err) {
      // A failed update must not stop the bot; it is skipped after the generic reply.
      deps.log.error(
        {
          updateId: u.update_id,
          pgCode: pgErrorCode(err),
          errName: (err as Error)?.name,
        },
        "telegram update failed",
      );
      const msg = u.message;
      if (msg?.chat.type === "private")
        await reply(String(msg.chat.id), BOT_REPLIES.failed);
    }
  }

  async function handleUnsafe(u: TelegramUpdate): Promise<void> {
    const msg = u.message;
    // Alerts are private only: groups and channels are ignored.
    if (!msg?.text || msg.chat.type !== "private") return;
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
    if (start) {
      const token = start[1];
      if (!token) return reply(chatId, BOT_REPLIES.howTo);
      const userId = TOKEN_RE.test(token)
        ? await useTelegramLinkToken(deps.db, sha256(token), chatId)
        : null;
      deps.log.info({ linked: userId !== null }, "telegram link attempt");
      return reply(
        chatId,
        userId ? BOT_REPLIES.connected : BOT_REPLIES.expired,
      );
    }
    if (/^\/stop(?:@\w+)?$/.test(text)) {
      const n = await disableTelegramByChat(deps.db, chatId, "user_stop");
      deps.log.info({ accounts: n }, "telegram alerts stopped by user");
      return reply(chatId, BOT_REPLIES.stopped);
    }
    // Anything else: a short help line, at most once an hour per chat.
    const t = clock.now();
    const last = helpSentAt.get(chatId);
    if (last !== undefined && t - last < HELP_GAP_MS) return;
    if (helpSentAt.size > 10_000) helpSentAt.clear();
    helpSentAt.set(chatId, t);
    return reply(chatId, BOT_REPLIES.help);
  }

  async function runWhileLocked(lock: SessionLock): Promise<void> {
    let lost = false;
    void lock.lost.then(() => (lost = true));
    let offset: number | undefined;
    let failures = 0;
    while (!stop.signal.aborted && !lost) {
      let updates: TelegramUpdate[];
      try {
        updates = await deps.client.getUpdates({
          offset,
          timeoutSec: deps.pollTimeoutSec ?? 30,
          signal: stop.signal,
        });
        failures = 0;
      } catch (err) {
        if (stop.signal.aborted) return;
        const ms = Math.min(BACKOFF_BASE_MS * 2 ** failures, BACKOFF_MAX_MS);
        failures++;
        // 409: another getUpdates caller or a webhook is set on this bot.
        deps.log.warn(
          {
            status: err instanceof TelegramError ? err.status : undefined,
            retryMs: ms,
          },
          "telegram getUpdates failed",
        );
        await sleep(ms);
        continue;
      }
      for (const u of updates) {
        offset = u.update_id + 1;
        await handle(u);
      }
    }
  }

  function sleep(ms: number): Promise<void> {
    if (stop.signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        stop.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      stop.signal.addEventListener("abort", done);
    });
  }

  async function run() {
    let waitingLogged = false;
    while (!stop.signal.aborted) {
      let lock: SessionLock | null = null;
      try {
        lock = await deps.acquireLock();
      } catch (err) {
        deps.log.error(
          { pgCode: pgErrorCode(err) },
          "telegram bot lock failed",
        );
      }
      if (!lock) {
        if (!waitingLogged)
          deps.log.info("another worker runs the Telegram bot; standing by");
        waitingLogged = true;
        await sleep(deps.standbyMs ?? 30_000);
        continue;
      }
      waitingLogged = false;
      deps.log.info("Telegram bot polling");
      try {
        await runWhileLocked(lock);
      } finally {
        await lock.release().catch(() => {});
      }
    }
  }

  return {
    start() {
      loop ??= run();
    },
    /** Aborts the long poll in flight and returns once the loop has ended. */
    async stop() {
      stop.abort();
      await loop;
    },
    /** Handles one update directly, as the poll loop does (tests). */
    handle,
  };
}

export type TelegramBot = ReturnType<typeof createTelegramBot>;
