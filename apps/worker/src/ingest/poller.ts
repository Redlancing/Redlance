import type { SubredditStatus } from "@redlance/core";
import {
  markSubredditUnreachable,
  nextFeed,
  pgErrorCode,
  recentFeedPolls,
  splitFeed,
  subreddits,
  subredditsLastPolledAt,
  type Database,
  type Feed,
} from "@redlance/db";
import type { Logger } from "../logger";
import { MIN_SPACING_MS, RequestGovernor } from "./governor";
import { pollFeed, type Catalogue, type PollOutcome } from "./poll-feed";

// The collector loop (docs/ingestion/plan.md, Phase 2). Exactly one poller runs in the whole
// system, held by a Postgres advisory lock: the rate limit is per IP, so two pollers would only
// 429 each other. Requests go out one at a time through the governor.

export type SessionLock = {
  /** Resolves if the lock's connection drops (another worker may take over). */
  lost: Promise<void>;
  release(): Promise<void>;
};

export type PollerDeps = {
  db: Database;
  log: Logger;
  userAgent: string;
  /** Tries the "redlance:reddit-poller" session lock; null if someone else holds it. */
  acquireLock: () => Promise<SessionLock | null>;
  fetch?: typeof fetch;
  minSpacingMs?: number;
  /** Cross-post detection settings, passed to every poll. */
  dedupe?: { windowHours: number; similarity: number };
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Called after every request (tests, the status line). */
  onPoll?: (feed: Feed, outcome: PollOutcome) => void;
  /** Daily upkeep (stats, re-plan, prune): run on taking the lock and then every interval. */
  upkeep?: () => Promise<void>;
  upkeepIntervalMs?: number;
  /** Called after taking the lock / before releasing it: hourly jobs that must run in one process only. */
  onLockAcquired?: () => void;
  onLockReleased?: () => Promise<void> | void;
};

const CATALOGUE_TTL_MS = 5 * 60_000;
const IDLE_MS = 60_000;
const STALL_WARN_MS = 15 * 60_000;
const UPKEEP_RETRY_MS = 10 * 60_000;
/** Answers that mean Reddit refuses this URL (a subreddit in it is private, banned or renamed). */
const REFUSED = new Set(["BLOCKED", "NOT_FOUND", "REDIRECT"]);

export const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, Math.max(0, ms));
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export function createPoller(deps: PollerDeps) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? abortableSleep;
  const governor = new RequestGovernor(
    deps.minSpacingMs ?? MIN_SPACING_MS,
    now,
  );
  const stop = new AbortController();
  let loop: Promise<void> | null = null;
  let slot = 0;
  let lastSuccessAt = now();
  let lastStallWarnAt = 0;
  let catalogueCache: { at: number; map: Catalogue } | null = null;

  async function catalogue(): Promise<Catalogue> {
    if (catalogueCache && now() - catalogueCache.at < CATALOGUE_TTL_MS)
      return catalogueCache.map;
    const rows = await deps.db
      .select({ name: subreddits.name, status: subreddits.status })
      .from(subreddits);
    const map = new Map(rows.map((r) => [r.name, r.status as SubredditStatus]));
    catalogueCache = { at: now(), map };
    return map;
  }

  async function pickFeed(): Promise<Feed | null> {
    // Odd slots go to catch-up pages when there are any, so a backlog never starves fresh polls.
    if (slot % 2 === 1) {
      const c = await nextFeed(deps.db, { catchUp: true });
      if (c) return c;
    }
    return nextFeed(deps.db, { catchUp: false });
  }

  let nextUpkeepAt = -Infinity;
  let lastUpkeepTry = -Infinity;
  /** Runs upkeep when due, or when forced (no feeds yet) unless it was tried in the last 10 min. */
  async function maybeUpkeep(force = false) {
    if (!deps.upkeep) return;
    const due = now() >= nextUpkeepAt;
    if (!due && !(force && now() - lastUpkeepTry >= UPKEEP_RETRY_MS)) return;
    lastUpkeepTry = now();
    try {
      await deps.upkeep();
      nextUpkeepAt = now() + (deps.upkeepIntervalMs ?? 24 * 60 * 60_000);
    } catch (err) {
      // Retry soon rather than going a day without stats or a feed plan.
      nextUpkeepAt = now() + UPKEEP_RETRY_MS;
      deps.log.error(
        { err: (err as Error).message },
        "ingestion upkeep failed; retrying in 10 min",
      );
    }
  }

  /** Same subreddit refused twice: split its group to find it, or set it aside if it's alone. */
  async function isolateFailure(feed: Feed, outcome: PollOutcome) {
    const code = outcome.fetch.errorCode;
    if (feed.kind !== "subreddits" || !code || !REFUSED.has(code)) return;
    if (outcome.consecutiveErrors < 2) return;
    const names = feed.subreddits ?? [];
    if (names.length > 1) {
      const parts = await splitFeed(deps.db, feed);
      deps.log.warn(
        {
          feedId: feed.id,
          subreddits: names.length,
          errorCode: code,
          newFeeds: parts.length,
        },
        "Reddit keeps refusing a combined feed; split it to find the subreddit",
      );
    } else if (names[0]) {
      await markSubredditUnreachable(deps.db, names[0], code);
      deps.log.warn(
        { subreddit: names[0], errorCode: code },
        "subreddit refused by Reddit (banned, private or renamed?); polling it alone once a day",
      );
    }
  }

  async function runWhileLocked(lock: SessionLock) {
    let lost = false;
    void lock.lost.then(() => (lost = true));
    // A restart or a handover must still respect the spacing and any backoff in progress.
    governor.seed(await recentFeedPolls(deps.db, 20));
    while (!stop.signal.aborted && !lost) {
      await maybeUpkeep();
      const wait = governor.nextAllowedAt() - now();
      if (wait > 0) {
        await sleep(wait, stop.signal);
        continue;
      }
      if (
        now() - lastSuccessAt > STALL_WARN_MS &&
        now() - lastStallWarnAt > STALL_WARN_MS
      ) {
        lastStallWarnAt = now();
        deps.log.error(
          {
            minutes: Math.round((now() - lastSuccessAt) / 60_000),
            ...governor.state(),
          },
          "no successful Reddit poll recently",
        );
      }
      slot++;
      const feed = await pickFeed();
      if (!feed) {
        await maybeUpkeep(true); // no feeds yet: plan them now
        await sleep(IDLE_MS, stop.signal);
        continue;
      }
      const catchUp = feed.catchUpPagesLeft > 0 && slot % 2 === 1;
      if (!catchUp && feed.nextPollAt.getTime() > now()) {
        // Nothing due: wait for the next feed (re-checking each minute in case the plan changes).
        await sleep(
          Math.min(feed.nextPollAt.getTime() - now(), IDLE_MS),
          stop.signal,
        );
        continue;
      }
      governor.reserve();
      const outcome = await pollFeed(
        feed,
        { catchUp },
        {
          db: deps.db,
          userAgent: deps.userAgent,
          catalogue,
          dedupe: deps.dedupe,
          lastPolledAt: (names) => subredditsLastPolledAt(deps.db, names),
          fetch: deps.fetch,
          signal: stop.signal,
          now,
          onError: (err) =>
            deps.log.error(
              {
                feedId: feed.id,
                err: (err as Error)?.message,
                pgCode: pgErrorCode(err),
              },
              "saving a polled page failed",
            ),
        },
      );
      governor.onResult(outcome.fetch, feed.id);
      if (outcome.fetch.ok) lastSuccessAt = now();
      const line = {
        feedId: feed.id,
        kind: feed.kind,
        page: outcome.page,
        status: outcome.fetch.status,
        errorCode: outcome.fetch.errorCode,
        entries: outcome.entries,
        newPosts: outcome.newPosts,
        duplicates: outcome.duplicates,
        malformed: outcome.malformed,
        profilePosts: outcome.profilePosts,
      };
      if (governor.state().blockedStreak > 0)
        deps.log.error(
          line,
          "Reddit refused two different feeds (possible IP block); backing off",
        );
      else if (outcome.fetch.errorCode && outcome.fetch.errorCode !== "ABORTED")
        deps.log.warn(line, "feed poll failed");
      else deps.log.info(line, "feed polled");
      await isolateFailure(feed, outcome);
      deps.onPoll?.(feed, outcome);
    }
  }

  async function run() {
    let waitingLogged = false;
    while (!stop.signal.aborted) {
      let lock: SessionLock | null = null;
      try {
        lock = await deps.acquireLock();
      } catch (err) {
        deps.log.error({ err: (err as Error).message }, "poller lock failed");
      }
      if (!lock) {
        if (!waitingLogged)
          deps.log.info("another worker is polling Reddit; standing by");
        waitingLogged = true;
        await sleep(IDLE_MS, stop.signal);
        continue;
      }
      waitingLogged = false;
      deps.log.info("polling Reddit");
      try {
        deps.onLockAcquired?.();
        await runWhileLocked(lock);
      } catch (err) {
        deps.log.error(
          { err: (err as Error).message },
          "poller loop failed; restarting",
        );
        // Never sooner than the governor allows (the slot was reserved before any request).
        await sleep(
          Math.max(IDLE_MS, governor.nextAllowedAt() - now()),
          stop.signal,
        );
      } finally {
        await Promise.resolve(deps.onLockReleased?.()).catch(() => {});
        await lock.release().catch(() => {});
      }
    }
  }

  return {
    start() {
      loop ??= run();
    },
    /** Finishes the request in flight (its fetch is aborted), then returns. */
    async stop() {
      stop.abort();
      await loop;
    },
    governorState: () => governor.state(),
  };
}
