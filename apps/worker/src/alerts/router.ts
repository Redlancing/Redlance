import { decideAlert, type AlertOutcome } from "@redlance/core";
import {
  pgErrorCode,
  withRoutingBatch,
  type Database,
  type RoutingDecide,
} from "@redlance/db";
import type { Listener } from "../db";
import type { Logger } from "../logger";

// Turns new matches into alert decisions (docs/alerts/plan/04-router.md). Same shape as the
// matcher: woken by NOTIFY match_alerts with a poll as the safety net, one pump at a time with a
// run-again flag. Each batch is one transaction in `withRoutingBatch`, so a failure leaves
// nothing half-written and the next poll or notify retries it.

export type RouterDeps = {
  db: Database;
  log: Logger;
  /** LISTEN match_alerts (a dedicated connection). */
  listen: () => Promise<Listener>;
  maxAgeHours: number;
  /** False when the worker has no bot token. */
  telegramAvailable: boolean;
  pollMs?: number;
  batchSize?: number;
  now?: () => Date;
};

export type Router = {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Resolves once nothing is being routed (tests). */
  idle(): Promise<void>;
};

/** Error name, Postgres code and stack frames only: never messages, which can quote post text. */
const errorFields = (err: unknown) => ({
  errName: (err as Error)?.name,
  pgCode: pgErrorCode(err),
  stack: (err as Error)?.stack
    ?.split("\n")
    .filter((l) => /^\s+at /.test(l))
    .join("\n"),
});

export function createRouter(deps: RouterDeps): Router {
  const { db, log } = deps;
  const now = deps.now ?? (() => new Date());
  const batchSize = deps.batchSize ?? 200;
  let listener: Listener | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let pumping: Promise<void> | null = null;
  let pumpAgain = false;

  async function pumpOnce(): Promise<void> {
    while (!stopping) {
      const at = now();
      const decide: RoutingDecide = (items, routedToday) => {
        // Alerts queued earlier in this batch count toward the user's cap.
        const running = new Map(routedToday);
        return items.map((item) => {
          if (!item.active) {
            return {
              matchId: item.matchId,
              outcome: "skipped_no_channel" as AlertOutcome,
              channels: [],
            };
          }
          const d = decideAlert(
            {
              match: {
                score: item.score,
                postedAt: item.postedAt,
                withdrawn: item.withdrawn,
                status: item.status,
              },
              user: {
                plan: item.plan,
                trialEndsAt: item.trialEndsAt,
                alertMinScore: item.alertMinScore,
                dailyCap: item.dailyCap,
                routedToday: running.get(item.userId) ?? 0,
              },
              telegram: item.telegram,
              telegramAvailable: deps.telegramAvailable,
              maxAgeHours: deps.maxAgeHours,
            },
            at,
          );
          if (d.outcome === "queued")
            running.set(item.userId, (running.get(item.userId) ?? 0) + 1);
          return { matchId: item.matchId, ...d };
        });
      };
      const started = Date.now();
      let result;
      try {
        result = await withRoutingBatch(
          db,
          { limit: batchSize, now: at },
          decide,
        );
      } catch (err) {
        log.error({ ...errorFields(err) }, "alert routing batch failed");
        return;
      }
      if (result.routed > 0) {
        log.info(
          {
            routed: result.routed,
            queued: result.queued,
            byOutcome: result.byOutcome,
            ms: Date.now() - started,
          },
          "alerts routed",
        );
      }
      if (result.routed < batchSize) return;
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

  return {
    async start() {
      listener = await deps.listen();
      listener.onNotify(() => void pump());
      pollTimer = setInterval(() => void pump(), deps.pollMs ?? 15_000);
      await pump();
    },
    async stop() {
      stopping = true;
      if (pollTimer) clearInterval(pollTimer);
      // The current batch is one short transaction: let it commit or roll back.
      if (pumping) await pumping.catch(() => {});
      await listener?.close();
    },
    async idle() {
      while (pumping) await pumping.catch(() => {});
    },
  };
}
