import {
  ALERTS_CHANNEL,
  MATCH_ALERTS_CHANNEL,
  type Database,
} from "@redlance/db";
import { acquireSessionLock, createPgListener, type Listener } from "../db";
import type { WorkerEnv } from "../env";
import type { Logger } from "../logger";
import { createRouter } from "./router";
import { createTelegramBot, type TelegramBotDeps } from "./telegram/bot";
import { createTelegramClient, type TelegramClient } from "./telegram/client";
import { createTelegramSender } from "./telegram/sender";

// Turns the alert parts on from the worker's env (docs/alerts/plan/07-wiring-ops.md): the router
// always, the Telegram sender and bot only when there is a bot token. The listeners and the
// bot's advisory lock use their own connections, not the pool.

export const BOT_LOCK_KEY = "redlance:telegram-bot";
/** How long the sender may take to finish sends in flight on shutdown. */
export const SENDER_STOP_GRACE_MS = 3_000;

export type Alerts = { start(): Promise<void>; stop(): Promise<void> };

export type AlertsEnv = Pick<
  WorkerEnv,
  | "DATABASE_URL"
  | "ALERTS_ENABLED"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_MAX_PER_SECOND"
  | "ALERT_MAX_AGE_HOURS"
  | "APP_ORIGIN"
>;

export type AlertsDeps = {
  db: Database;
  log: Logger;
  /** Tests: a fake Telegram client, so nothing touches the network. */
  client?: TelegramClient;
  /** Tests: fakes for the listener and the bot's lock. */
  listen?: (channel: string) => Promise<Listener>;
  acquireLock?: TelegramBotDeps["acquireLock"];
};

/** The alert parts configured from env, or null when ALERTS_ENABLED is false. */
export function createAlertsFromEnv(
  env: AlertsEnv,
  deps: AlertsDeps,
): Alerts | null {
  if (!env.ALERTS_ENABLED) return null;
  const { db } = deps;
  const log = deps.log;
  const listen = (channel: string) =>
    deps.listen
      ? () => deps.listen!(channel)
      : () => createPgListener(env.DATABASE_URL, log, channel);

  const hasToken = Boolean(env.TELEGRAM_BOT_TOKEN);
  const router = createRouter({
    db,
    log: log.child({ part: "alert-router" }),
    listen: listen(MATCH_ALERTS_CHANNEL),
    maxAgeHours: env.ALERT_MAX_AGE_HOURS,
    telegramAvailable: hasToken,
  });

  let sender: ReturnType<typeof createTelegramSender> | null = null;
  let bot: ReturnType<typeof createTelegramBot> | null = null;
  if (hasToken) {
    if (!env.APP_ORIGIN) {
      throw new Error("APP_ORIGIN is required when TELEGRAM_BOT_TOKEN is set");
    }
    const client =
      deps.client ?? createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN! });
    sender = createTelegramSender({
      db,
      log: log.child({ part: "alert-sender" }),
      client,
      listen: listen(ALERTS_CHANNEL),
      appOrigin: env.APP_ORIGIN,
      maxPerSecond: env.TELEGRAM_MAX_PER_SECOND,
    });
    bot = createTelegramBot({
      db,
      log: log.child({ part: "telegram-bot" }),
      client,
      acquireLock:
        deps.acquireLock ??
        (() => acquireSessionLock(env.DATABASE_URL, BOT_LOCK_KEY, log)),
    });
  }

  return {
    async start() {
      await router.start();
      await sender?.start();
      bot?.start();
      log.info(
        {
          router: true,
          sender: sender !== null,
          bot: bot !== null,
          maxAgeHours: env.ALERT_MAX_AGE_HOURS,
        },
        hasToken
          ? "alerts started: router, Telegram sender and bot"
          : "alerts started: router only (no TELEGRAM_BOT_TOKEN: the router records skipped_no_channel)",
      );
    },
    async stop() {
      await Promise.all([
        router.stop(),
        sender?.stop(SENDER_STOP_GRACE_MS),
        bot?.stop(),
      ]);
    },
  };
}
