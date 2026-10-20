import { budgetLabel, telegramAlert, TEMPLATE_VERSIONS } from "@redlance/core";
import {
  claimDueDeliveries,
  completeDeliveries,
  disableChannel,
  failDeliveries,
  pgErrorCode,
  requeueStaleDeliveries,
  touchDeliveries,
  type Database,
  type DeliveryFailure,
  type DeliveryGroup,
} from "@redlance/db";
import type { Listener } from "../../db";
import type { Logger } from "../../logger";
import {
  createPerKeySpacing,
  createRateLimiter,
  realClock,
  type Clock,
  type RateLimiter,
} from "../pace";
import {
  classifyTelegramError,
  type InlineKeyboard,
  type TelegramClient,
} from "./client";

// The Telegram sender (docs/alerts/README.md §4.3, plan/05-telegram.md): claims due deliveries
// grouped per user, sends one message per group (up to 5 matches), and completes or fails the
// rows. Woken by NOTIFY alerts with a poll as the safety net; a sweep puts back rows whose
// sender died. Paced to stay under Telegram's limits; a run of outages opens a breaker.
// Delivery is at least once: a crash between the send and the complete re-sends that message.
// Right before each send the claim is re-checked (touchDeliveries): a group that waited out a
// long 429 pause may have been swept and claimed again, and then only the new owner sends.

export type TelegramSenderDeps = {
  db: Database;
  log: Logger;
  client: Pick<TelegramClient, "sendMessage">;
  listen: () => Promise<Listener>;
  /** For the links in the message. */
  appOrigin: string;
  /** Bot-wide sends per second (Telegram allows about 30). */
  maxPerSecond?: number;
  /** A limiter shared with the bot's replies; built from `maxPerSecond` when absent. */
  limiter?: RateLimiter;
  /** Gap between two messages to one chat (Telegram allows 1 a second). */
  perChatGapMs?: number;
  /** Users (message groups) in flight at once. */
  maxUsers?: number;
  pollMs?: number;
  sweepMs?: number;
  /** A sending row whose lock is older than this goes back to the queue. */
  staleAfterSec?: number;
  clock?: Clock;
};

const PER_MESSAGE = 5;
const BREAKER_TRIP = 5;
const BREAKER_BASE_MS = 60_000;
const BREAKER_MAX_MS = 15 * 60_000;

export function createTelegramSender(deps: TelegramSenderDeps) {
  const clock = deps.clock ?? realClock;
  const limiter =
    deps.limiter ??
    createRateLimiter({ perSecond: deps.maxPerSecond ?? 25, clock });
  // Aborted by stop(): groups waiting in the limiter or the per-chat spacing give back at once.
  const stopSignal = new AbortController();
  const spacing = createPerKeySpacing(deps.perChatGapMs ?? 1100, clock);
  const maxUsers = deps.maxUsers ?? 25;
  const running = new Set<Promise<void>>();
  let listener: Listener | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let pumping: Promise<void> | null = null;
  let pumpAgain = false;
  let stopping = false;
  let outages = 0;
  let trips = 0;
  let pausedUntil = 0;

  const rows = (g: DeliveryGroup) =>
    g.deliveries.map((d) => ({ id: d.id, attempts: d.attempts }));

  async function fail(g: DeliveryGroup, f: DeliveryFailure) {
    try {
      return await failDeliveries(deps.db, rows(g), f);
    } catch (err) {
      deps.log.error(
        { userId: g.userId, code: f.code, pgCode: pgErrorCode(err) },
        "could not record alert failure",
      );
      return null;
    }
  }

  async function sendGroup(g: DeliveryGroup): Promise<void> {
    const started = clock.now();
    let outcome = "sent";
    if (!g.channelEnabled || !g.target) {
      // Turned off after routing: never send.
      await fail(g, {
        code: "CHANNEL_DISABLED",
        retryable: false,
        countAttempt: true,
      });
      deps.log.info(
        { userId: g.userId, count: g.deliveries.length },
        "alerts dropped: channel off",
      );
      return;
    }
    const message = telegramAlert(
      g.deliveries.map((d) => ({
        matchId: d.matchId,
        score: d.score,
        title: d.title,
        community: d.community,
        url: d.url,
        postedAt: d.postedAt,
        budgetText: budgetLabel(d.budget),
        reason: d.reason,
      })),
      deps.appOrigin,
      new Date(clock.now()),
    );
    await limiter.take(stopSignal.signal);
    await spacing.wait(g.target, stopSignal.signal);
    if (stopping) {
      // Claimed but not sent: the next worker sends it straight away, attempt not used.
      await fail(g, {
        code: "SHUTDOWN",
        retryable: true,
        countAttempt: false,
        retryInMs: 0,
      });
      return;
    }
    let stillOurs = false;
    try {
      stillOurs = await touchDeliveries(deps.db, rows(g));
    } catch (err) {
      deps.log.error(
        { userId: g.userId, pgCode: pgErrorCode(err) },
        "could not check an alert claim",
      );
    }
    if (!stillOurs) {
      // Swept while we waited (another sender may own it now), or the check failed. Give back
      // whatever is still ours (fenced, attempt not used); never send.
      deps.log.warn(
        { userId: g.userId, count: g.deliveries.length },
        "claim lost before send",
      );
      await fail(g, {
        code: "CLAIM_LOST",
        retryable: true,
        countAttempt: false,
        retryInMs: 0,
      });
      return;
    }
    let messageId: number;
    try {
      ({ messageId } = await deps.client.sendMessage({
        chatId: g.target,
        text: message.text,
        replyMarkup: hasButtons(message.replyMarkup)
          ? message.replyMarkup
          : undefined,
      }));
    } catch (err) {
      const f = classifyTelegramError(err);
      outcome = f.code;
      if (f.code === "RATE_LIMITED") limiter.pauseFor(f.retryInMs ?? 5000);
      if (f.code === "TG_UNAVAILABLE" || f.code === "TG_UNAUTHORIZED")
        noteOutage();
      await fail(g, f);
      if (f.disable) {
        try {
          await disableChannel(deps.db, g.userId, "telegram", "blocked");
        } catch (dbErr) {
          deps.log.error(
            { userId: g.userId, pgCode: pgErrorCode(dbErr) },
            "could not disable Telegram channel",
          );
        }
      }
      const line = {
        userId: g.userId,
        code: f.code,
        count: g.deliveries.length,
      };
      if (f.code === "TG_BAD_REQUEST")
        deps.log.error(line, "Telegram rejected an alert");
      else deps.log.warn(line, "alert send failed");
      return;
    }
    outages = 0;
    trips = 0;
    try {
      await completeDeliveries(deps.db, rows(g), {
        channel: "telegram",
        messageId,
        template: TEMPLATE_VERSIONS.telegram,
      });
    } catch (err) {
      // The message went out; the stale sweep will send it again (at least once).
      outcome = "unrecorded";
      deps.log.error(
        { userId: g.userId, pgCode: pgErrorCode(err) },
        "could not record a sent alert",
      );
    } finally {
      deps.log.info(
        {
          userId: g.userId,
          count: g.deliveries.length,
          outcome,
          ms: clock.now() - started,
        },
        "alert sent",
      );
    }
  }

  function noteOutage() {
    outages++;
    if (outages >= BREAKER_TRIP) {
      const ms = Math.min(BREAKER_BASE_MS * 2 ** trips, BREAKER_MAX_MS);
      pausedUntil = clock.now() + ms;
      trips++;
      outages = 0;
      deps.log.error(
        { pauseMs: ms },
        "Telegram unavailable; pausing alert sends",
      );
    }
  }

  async function pumpOnce(): Promise<void> {
    while (!stopping && running.size < maxUsers) {
      if (clock.now() < pausedUntil) return; // breaker open; the poll tries again later
      let groups: DeliveryGroup[];
      try {
        groups = await claimDueDeliveries(deps.db, "telegram", {
          maxUsers: maxUsers - running.size,
          perUser: PER_MESSAGE,
        });
      } catch (err) {
        deps.log.error({ pgCode: pgErrorCode(err) }, "alert claim failed");
        return;
      }
      if (groups.length === 0) return;
      for (const g of groups) {
        const p: Promise<void> = sendGroup(g)
          .catch((err) =>
            deps.log.error(
              { userId: g.userId, errName: (err as Error)?.name },
              "alert send crashed",
            ),
          )
          .finally(() => {
            running.delete(p);
            void pump();
          });
        running.add(p);
      }
    }
  }

  function pump(): Promise<void> {
    if (stopping) return Promise.resolve();
    if (pumping) {
      pumpAgain = true;
      return pumping;
    }
    pumping = (async () => {
      try {
        do {
          pumpAgain = false;
          await pumpOnce();
        } while (pumpAgain && !stopping);
      } finally {
        pumping = null;
      }
    })();
    return pumping;
  }

  async function sweep() {
    try {
      const n = await requeueStaleDeliveries(
        deps.db,
        deps.staleAfterSec ?? 120,
      );
      if (n > 0) {
        deps.log.warn({ count: n }, "re-queued stale alert deliveries");
        void pump();
      }
    } catch (err) {
      deps.log.error({ pgCode: pgErrorCode(err) }, "alert sweep failed");
    }
  }

  return {
    async start() {
      listener = await deps.listen();
      listener.onNotify(() => void pump());
      pollTimer = setInterval(() => void pump(), deps.pollMs ?? 5_000);
      sweepTimer = setInterval(() => void sweep(), deps.sweepMs ?? 60_000);
      await sweep();
      await pump();
    },
    /**
     * Stops claiming, lets sends in flight finish for up to `graceMs`. Claimed groups that
     * haven't been sent yet are given back (attempt not used).
     */
    async stop(graceMs = 10_000) {
      stopping = true;
      stopSignal.abort();
      if (pollTimer) clearInterval(pollTimer);
      if (sweepTimer) clearInterval(sweepTimer);
      if (pumping) await pumping.catch(() => {});
      await Promise.race([
        Promise.allSettled([...running]),
        new Promise((r) => setTimeout(r, graceMs)),
      ]);
      await listener?.close();
    },
    /** Resolves once nothing is being claimed or sent (tests). */
    async idle() {
      for (;;) {
        if (pumping) await pumping.catch(() => {});
        else if (running.size > 0) await Promise.allSettled([...running]);
        else return;
      }
    },
    /** Runs the stale sweep now (tests). */
    sweep,
    /** Wakes the sender (tests). */
    pump,
  };
}

export type TelegramSender = ReturnType<typeof createTelegramSender>;

/** An empty keyboard (no usable app links, e.g. a localhost APP_ORIGIN) is left out. */
function hasButtons(markup: InlineKeyboard | undefined): boolean {
  return Boolean(markup?.inline_keyboard.some((row) => row.length > 0));
}
