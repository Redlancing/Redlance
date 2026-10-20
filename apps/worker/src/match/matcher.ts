import {
  MATCH_MAX_AGE_DAYS,
  RESCORE_THRESHOLD_DEFAULT,
  aiAllowed,
  isCandidate,
  passesFilters,
  ruleScore,
  type MatchProfile,
  type MatchStatus,
  type Plan,
} from "@redlance/core";
import {
  POST_ANALYSED_CHANNEL,
  candidatePostsForUser,
  candidateUsersForPost,
  claimPostsForMatching,
  claimRematch,
  completePostMatching,
  completeRematch,
  dropAbandonedRematches,
  failPostMatching,
  failRematch,
  loadMatchPost,
  loadMatchUser,
  pgErrorCode,
  requeueStalePostMatching,
  upsertMatches,
  withdrawPostMatches,
  withdrawStaleUserMatches,
  type Database,
  type MatchPostWithId,
  type MatchUser,
  type NewMatch,
  type RematchClaim,
} from "@redlance/db";
import { createPgListener, type Listener } from "../db";
import type { WorkerEnv } from "../env";
import type { Logger } from "../logger";

// Turns analysed posts into `matches` rows (docs/matching/plan/04-matcher.md). Same shape as the
// analyser: woken by NOTIFY post_analysed with a poll as the safety net, SKIP LOCKED claims,
// writes fenced on the claim, a stale sweep and a graceful stop. Each poll also serves one
// re-match request at a time (backfill after onboarding, re-match after a profile change);
// those have no channel. Matches that no longer qualify (a re-analysis, a profile change) are
// withdrawn: out of the feed and the AI queue. No model calls here: the rule score is pure code (core), and the AI
// re-score is a separate loop (Phase 5) woken by NOTIFY matches.

/** The database functions the matcher uses (tests swap single ones). */
const DEFAULT_OPS = {
  claimPostsForMatching,
  completePostMatching,
  failPostMatching,
  requeueStalePostMatching,
  loadMatchPost,
  candidateUsersForPost,
  upsertMatches,
  withdrawPostMatches,
  withdrawStaleUserMatches,
  claimRematch,
  completeRematch,
  failRematch,
  dropAbandonedRematches,
  loadMatchUser,
  candidatePostsForUser,
};
export type MatcherOps = typeof DEFAULT_OPS;

export type MatcherDeps = {
  db: Database;
  log: Logger;
  /** LISTEN post_analysed (a dedicated connection). Re-match requests are polled. */
  listen: () => Promise<Listener>;
  now?: () => Date;
  /** Rule score at or above which a match is queued for the AI re-score; null when the re-scorer is off. */
  threshold?: number | null;
  maxAgeDays?: number;
  /** Posts matched at once. */
  concurrency?: number;
  pollMs?: number;
  sweepMs?: number;
  ops?: Partial<MatcherOps>;
};

export type Matcher = {
  start(): Promise<void>;
  stop(graceMs?: number): Promise<void>;
  /** Resolves once nothing is running or being claimed (tests). */
  idle(): Promise<void>;
};

/**
 * Post-level filters only (kind, full-time, age, deadline): a profile that accepts onsite and
 * unpaid work, so `passesFilters` can only fail on the post itself.
 */
const PERMISSIVE: MatchProfile = {
  categories: [],
  skills: [],
  workSkillIds: [],
  minRateMinor: 0,
  currency: "USD",
  rateType: "either",
  remoteOnly: false,
  includeUnpaid: true,
};

/** Re-match requests served per poll (a failed one backs off, so it isn't claimed again). */
const REMATCHES_PER_POLL = 20;

/**
 * Whether a new match waits for an AI re-score. Broad matches never do; neither do dismissed
 * matches, users whose plan doesn't allow AI (expired trials), scores below the threshold, or any
 * match while the re-scorer is off (threshold null), so nothing waits for AI that never comes.
 */
export function decideAiStatus(
  m: {
    existingStatus: MatchStatus | null;
    plan: Plan;
    trialEndsAt: Date;
    broad: boolean;
    score: number;
  },
  threshold: number | null,
  now: Date,
): NewMatch["aiStatus"] {
  if (threshold === null) return "not_needed";
  if (m.existingStatus === "dismissed") return "not_needed";
  if (!aiAllowed(m.plan, m.trialEndsAt, now)) return "not_needed";
  if (m.broad) return "not_needed";
  return m.score >= threshold ? "pending" : "not_needed";
}

class Shutdown extends Error {
  constructor() {
    super("matcher stopping");
    this.name = "Shutdown";
  }
}

/** Error name, Postgres code and stack frames only: never messages, which can quote post text. */
const errorFields = (err: unknown) => ({
  errName: (err as Error)?.name,
  pgCode: pgErrorCode(err),
  stack: (err as Error)?.stack
    ?.split("\n")
    .filter((l) => /^\s+at /.test(l))
    .join("\n"),
});

export function createMatcher(deps: MatcherDeps): Matcher {
  const ops: MatcherOps = { ...DEFAULT_OPS, ...deps.ops };
  const { db, log } = deps;
  const now = deps.now ?? (() => new Date());
  const threshold =
    deps.threshold === undefined ? RESCORE_THRESHOLD_DEFAULT : deps.threshold;
  const maxAgeDays = deps.maxAgeDays ?? MATCH_MAX_AGE_DAYS;
  const concurrency = deps.concurrency ?? 4;
  const running = new Set<Promise<void>>();
  const ac = new AbortController();
  let listener: Listener | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let pumping: Promise<void> | null = null;
  let pumpAgain = false;
  let rematching: Promise<void> | null = null;

  const checkpoint = () => {
    if (ac.signal.aborted) throw new Shutdown();
  };

  /**
   * Scores one post-user pair. Null when core disagrees with the candidate query, which means
   * the SQL and core have drifted: skip the pair and log it as an error. Callers check the
   * post-level filters first, so a filter failure here is a user-level one: drift too.
   */
  function score(
    post: MatchPostWithId,
    user: MatchUser,
    existingStatus: MatchStatus | null,
    at: Date,
  ): NewMatch | null {
    let check: "candidate" | "filters" | null = null;
    if (!isCandidate(post, user.profile)) check = "candidate";
    else if (!passesFilters(post, user.profile, at, maxAgeDays))
      check = "filters";
    if (check) {
      log.error(
        { jobPostId: post.id, userId: user.userId, check },
        "candidate query and core disagree; pair skipped",
      );
      return null;
    }
    const r = ruleScore(post, user.profile);
    return {
      userId: user.userId,
      jobPostId: post.id,
      ruleScore: r.score,
      broad: r.broad,
      features: r.features,
      ruleReason: r.reason,
      analysedAt: post.analysedAt,
      aiStatus: decideAiStatus(
        {
          existingStatus,
          plan: user.plan,
          trialEndsAt: user.trialEndsAt,
          broad: r.broad,
          score: r.score,
        },
        threshold,
        at,
      ),
      profileVersion: user.profileVersion,
    };
  }

  async function matchPost(postId: string, claim: number): Promise<void> {
    const started = Date.now();
    let outcome = "done";
    let candidates = 0;
    let written = 0;
    let withdrawn = 0;
    try {
      const at = now();
      const post = await ops.loadMatchPost(db, postId);
      checkpoint();
      if (!post) outcome = "no_analysis";
      else if (
        post.duplicateOf !== null ||
        !passesFilters(post, PERMISSIVE, at, maxAgeDays)
      ) {
        // The post no longer qualifies for anyone (a re-analysis, or marked a duplicate).
        outcome = "filtered";
        withdrawn = await ops.withdrawPostMatches(
          db,
          post.id,
          post.analysedAt,
          null,
        );
      } else {
        const users = await ops.candidateUsersForPost(db, post);
        candidates = users.length;
        checkpoint();
        const rows: NewMatch[] = [];
        for (const u of users) {
          const row = score(post, u, u.existingStatus, at);
          if (row) rows.push(row);
        }
        written = await ops.upsertMatches(db, rows, { origin: "post" });
        // Users who were matched before but aren't candidates any more.
        withdrawn = await ops.withdrawPostMatches(
          db,
          post.id,
          post.analysedAt,
          rows.map((r) => r.userId),
        );
      }
      if (!(await ops.completePostMatching(db, postId, claim)))
        outcome = "lost";
    } catch (err) {
      const code = err instanceof Shutdown ? "SHUTDOWN" : "INTERNAL";
      try {
        outcome = await ops.failPostMatching(db, postId, claim);
      } catch (dbErr) {
        outcome = "unrecorded";
        log.error(
          { jobPostId: postId, pgCode: pgErrorCode(dbErr) },
          "could not record matching failure",
        );
      }
      if (code === "SHUTDOWN")
        log.info({ jobPostId: postId, code, outcome }, "post matching stopped");
      else
        log.error(
          { jobPostId: postId, code, outcome, ...errorFields(err) },
          "post matching failed",
        );
    } finally {
      log.debug(
        {
          jobPostId: postId,
          outcome,
          candidates,
          written,
          withdrawn,
          ms: Date.now() - started,
        },
        "post matched",
      );
    }
  }

  /**
   * Matches one user against their candidate posts since `since` (backfill or re-match), then
   * withdraws their matches in that window that the new profile version no longer produces.
   * Clears the request on success (unless a newer one arrived meanwhile); a failure backs the
   * request off (dropped after MAX_REMATCH_ATTEMPTS). Never throws.
   */
  async function runRematch(req: RematchClaim): Promise<void> {
    const started = Date.now();
    try {
      const user = await ops.loadMatchUser(db, req.userId);
      // Blocked or no profile: nothing to match; the request is cleared.
      if (!user) {
        await ops.completeRematch(db, req);
        return;
      }
      const at = now();
      const posts = await ops.candidatePostsForUser(db, req.userId, req.since);
      checkpoint();
      const rows: NewMatch[] = [];
      for (const post of posts) {
        // Age and deadline are core's (the query doesn't check them): not drift.
        if (!passesFilters(post, PERMISSIVE, at, maxAgeDays)) continue;
        // A dismissed match is kept dismissed (and not_needed) by upsertMatches.
        const row = score(post, user, null, at);
        if (row) rows.push(row);
      }
      checkpoint();
      // Backfill rows never alert (skipped_backfill).
      const written = await ops.upsertMatches(db, rows, { origin: "backfill" });
      const withdrawn = await ops.withdrawStaleUserMatches(
        db,
        req.userId,
        req.since,
        user.profileVersion,
      );
      const cleared = await ops.completeRematch(db, req);
      log.info(
        {
          userId: req.userId,
          since: req.since.toISOString(),
          posts: posts.length,
          written,
          withdrawn,
          // false: a newer request arrived while this ran; it stays for the next poll.
          cleared,
          ms: Date.now() - started,
        },
        "re-match done",
      );
    } catch (err) {
      const code = err instanceof Shutdown ? "SHUTDOWN" : "INTERNAL";
      let outcome: string;
      try {
        // A shutdown isn't the request's fault: give the attempt back, no backoff.
        outcome = await ops.failRematch(db, req, {
          countAttempt: code !== "SHUTDOWN",
        });
      } catch (dbErr) {
        // The lease expires and the request is claimed again.
        outcome = "unrecorded";
        log.error(
          { userId: req.userId, pgCode: pgErrorCode(dbErr) },
          "could not record re-match failure",
        );
      }
      if (code === "SHUTDOWN")
        log.info({ userId: req.userId, code, outcome }, "re-match stopped");
      else
        log.error(
          { userId: req.userId, code, outcome, ...errorFields(err) },
          outcome === "dropped"
            ? "re-match failed too often; request dropped"
            : "re-match failed",
        );
    }
  }

  async function pumpOnce(): Promise<void> {
    while (!stopping && running.size < concurrency) {
      let posts: { id: string; claim: number }[];
      try {
        posts = await ops.claimPostsForMatching(db, concurrency - running.size);
      } catch (err) {
        log.error({ pgCode: pgErrorCode(err) }, "claim failed");
        return;
      }
      if (posts.length === 0) return;
      for (const { id, claim } of posts) {
        const p: Promise<void> = matchPost(id, claim).finally(() => {
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

  /**
   * Serves re-match requests one at a time; a poll that finds one already running skips. A
   * failed request backs off (so it isn't claimed again this poll) and the loop moves on: one
   * bad request never holds up the others.
   */
  function rematches(): Promise<void> {
    if (stopping || rematching) return rematching ?? Promise.resolve();
    rematching = (async () => {
      try {
        for (let i = 0; i < REMATCHES_PER_POLL && !stopping; i++) {
          let req: RematchClaim | null;
          try {
            req = await ops.claimRematch(db);
          } catch (err) {
            log.error({ pgCode: pgErrorCode(err) }, "re-match claim failed");
            return;
          }
          if (!req) return;
          await runRematch(req);
        }
      } finally {
        rematching = null;
      }
    })();
    return rematching;
  }

  async function sweep() {
    try {
      const n = await ops.requeueStalePostMatching(db);
      if (n > 0) {
        log.warn({ count: n }, "re-queued stale post matching");
        void pump();
      }
      // Requests whose every claim crashed the matcher (failRematch never ran).
      for (const userId of await ops.dropAbandonedRematches(db))
        log.error(
          { userId, code: "ABANDONED" },
          "re-match failed too often; request dropped",
        );
    } catch (err) {
      log.error({ pgCode: pgErrorCode(err) }, "matching sweep failed");
    }
  }

  function poll() {
    void pump();
    void rematches();
  }

  return {
    async start() {
      listener = await deps.listen();
      listener.onNotify(() => void pump());
      pollTimer = setInterval(poll, deps.pollMs ?? 10_000);
      sweepTimer = setInterval(() => void sweep(), deps.sweepMs ?? 60_000);
      await sweep();
      await Promise.all([pump(), rematches()]);
    },
    async stop(graceMs = 20_000) {
      stopping = true;
      if (pollTimer) clearInterval(pollTimer);
      if (sweepTimer) clearInterval(sweepTimer);
      if (pumping) await pumping.catch(() => {});
      // Matching is quick database work: let it finish, and abort what's left near the end of
      // the grace period (aborted posts go back to pending, re-matches are re-requested).
      const abortTimer = setTimeout(
        () => ac.abort(),
        Math.max(0, graceMs - 5000),
      );
      await Promise.race([
        Promise.allSettled([...running, rematching]),
        new Promise((r) => setTimeout(r, graceMs)),
      ]);
      clearTimeout(abortTimer);
      await listener?.close();
    },
    async idle() {
      for (;;) {
        if (pumping) await pumping.catch(() => {});
        else if (running.size > 0) await Promise.allSettled([...running]);
        else if (rematching) await rematching.catch(() => {});
        else return;
      }
    },
  };
}

/** The matcher configured from the worker's env, or null when MATCHING_ENABLED is false. */
export function createMatcherFromEnv(
  env: Pick<
    WorkerEnv,
    | "DATABASE_URL"
    | "MATCHING_ENABLED"
    | "RESCORE_ENABLED"
    | "RESCORE_THRESHOLD"
    | "MATCH_MAX_AGE_DAYS"
    | "WORKER_CONCURRENCY"
  >,
  deps: { db: Database; log: Logger; listen?: () => Promise<Listener> },
): Matcher | null {
  if (!env.MATCHING_ENABLED) return null;
  return createMatcher({
    db: deps.db,
    log: deps.log,
    listen:
      deps.listen ??
      (() =>
        createPgListener(env.DATABASE_URL, deps.log, POST_ANALYSED_CHANNEL)),
    threshold: env.RESCORE_ENABLED ? env.RESCORE_THRESHOLD : null,
    maxAgeDays: env.MATCH_MAX_AGE_DAYS,
    concurrency: env.WORKER_CONCURRENCY,
  });
}
