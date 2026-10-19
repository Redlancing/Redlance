import { RESCORE_DAILY_CAP, aiAllowed } from "@redlance/core";
import {
  MATCHES_CHANNEL,
  claimPairsForRescore,
  completeRescore,
  failRescore,
  llmCostSince,
  loadRescoreContext,
  markCapped,
  pgErrorCode,
  recordLlmUsage,
  requeueStaleRescores,
  takeRescoreUnit,
  type Database,
  type RescoreClaim,
  type RescoreContext,
} from "@redlance/db";
import {
  LlmError,
  PRICES,
  type AttemptRecord,
  type LlmClient,
} from "@redlance/llm";
import { createPgListener, type Listener } from "../db";
import type { WorkerEnv } from "../env";
import {
  PROVIDER_ERROR_CODES,
  classifyAnalysisError,
} from "../ingest/analyser";
import type { Logger } from "../logger";
import { RESCORE_PROMPT_VERSION, RESCORE_TASK, rescorePair } from "./rescore";

// The AI re-score queue (docs/matching/plan/05-rescorer.md). Same shape as the analyser: woken
// by NOTIFY matches with a poll as the safety net, SKIP LOCKED claims, writes fenced on the
// claim, a per-pair timeout, a stale sweep, a daily budget and a circuit breaker. Each pair
// needs one unit of its user's daily plan cap (rescore_usage), and pays once a day however
// many retries it takes (matches.ai_unit_day). The unit is given back with the attempt
// (failRescore's give-back, one fenced statement) when the provider fails, the budget runs out
// or the worker stops, since no answer came of it.

/** The database functions the re-scorer uses (tests swap single ones). */
const DEFAULT_OPS = {
  claimPairsForRescore,
  loadRescoreContext,
  takeRescoreUnit,
  completeRescore,
  failRescore,
  markCapped,
  requeueStaleRescores,
  llmCostSince,
  recordLlmUsage,
};
export type RescorerOps = typeof DEFAULT_OPS;

export type RescorerDeps = {
  db: Database;
  log: Logger;
  llm: LlmClient;
  /** VERTEX_MODEL_FAST (Flash-Lite). */
  model: string;
  /** LISTEN matches (a dedicated connection). */
  listen: () => Promise<Listener>;
  /** Daily spend cap for re-scores across all users, in micro-dollars (UTC day). */
  dailyBudgetMicros: number;
  now?: () => Date;
  /** Model calls at once. */
  concurrency?: number;
  pollMs?: number;
  sweepMs?: number;
  pairTimeoutMs?: number;
  ops?: Partial<RescorerOps>;
};

export type Rescorer = {
  start(): Promise<void>;
  stop(graceMs?: number): Promise<void>;
  /** Resolves once nothing is running or being claimed (tests). */
  idle(): Promise<void>;
};

const BUDGET_CHECK_MS = 60_000;
const BREAKER_TRIP = 3;
const BREAKER_BASE_MS = 60_000;
const BREAKER_MAX_MS = 15 * 60_000;

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const startOfUtcDay = (d: Date) => new Date(`${utcDay(d)}T00:00:00Z`);

/** A claimed pair holding its unit, ready for the model. */
type Job = {
  matchId: string;
  userId: string;
  claim: RescoreClaim;
  ctx: RescoreContext;
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

/** Which failures count against the pair (and spend its unit), and which give both back. */
export function classifyRescoreError(
  err: unknown,
  opts: { timedOut?: boolean } = {},
): { code: string; retryable: boolean; countAttempt: boolean } {
  if (opts.timedOut)
    return { code: "PAIR_TIMEOUT", retryable: true, countAttempt: true };
  return classifyAnalysisError(err);
}

export function createRescorer(deps: RescorerDeps): Rescorer {
  const ops: RescorerOps = { ...DEFAULT_OPS, ...deps.ops };
  const { db, log } = deps;
  const now = deps.now ?? (() => new Date());
  const concurrency = deps.concurrency ?? 4;
  const running = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  let listener: Listener | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let pumping: Promise<void> | null = null;
  let pumpAgain = false;
  let budget = { checkedAt: -Infinity, over: false, warnedDay: "" };
  // Circuit breaker: a few provider failures in a row pause claiming, with growing cooldowns.
  let providerFailures = 0;
  let pausedUntil = 0;
  let trips = 0;

  async function overBudget(): Promise<boolean> {
    const at = now();
    if (at.getTime() - budget.checkedAt < BUDGET_CHECK_MS) return budget.over;
    const spent = await ops.llmCostSince(db, startOfUtcDay(at), RESCORE_TASK);
    budget = {
      ...budget,
      checkedAt: at.getTime(),
      over: spent >= deps.dailyBudgetMicros,
    };
    if (budget.over && budget.warnedDay !== utcDay(at)) {
      budget.warnedDay = utcDay(at);
      log.warn(
        { spentUsd: spent / 1e6, budgetUsd: deps.dailyBudgetMicros / 1e6 },
        "daily re-score budget reached; pairs wait until tomorrow (UTC)",
      );
    }
    return budget.over;
  }

  /**
   * Puts a pair back without using an attempt, and gives back the unit it holds, if any (one
   * fenced statement). `countRepeats`: see the prepare error below.
   */
  async function release(
    pair: { matchId: string; claim: RescoreClaim },
    code: string,
    opts: { countRepeats?: boolean } = {},
  ): Promise<string> {
    try {
      return await ops.failRescore(db, pair.matchId, pair.claim, {
        code,
        retryable: true,
        countAttempt: false,
        countRepeats: opts.countRepeats,
      });
    } catch (err) {
      log.error(
        { matchId: pair.matchId, code, pgCode: pgErrorCode(err) },
        "could not put the pair back",
      );
      return "unrecorded";
    }
  }

  /**
   * Loads the pair, checks the plan and takes a unit. Runs in claim order (highest rule score
   * first) inside the pump, one pair at a time, so a user's units go to their best matches.
   * Null when the pair needs no model call (capped, gone, budget, stopping).
   */
  async function prepare(pair: {
    matchId: string;
    userId: string;
    claim: RescoreClaim;
  }): Promise<Job | null> {
    const { matchId, claim } = pair;
    if (stopping) {
      await release(pair, "SHUTDOWN");
      return null;
    }
    try {
      const ctx = await ops.loadRescoreContext(db, matchId);
      if (!ctx) {
        // The post or profile is gone: nothing to score.
        await ops.failRescore(db, matchId, claim, {
          code: "NO_CONTEXT",
          retryable: false,
        });
        return null;
      }
      if (ctx.profileVersion !== claim.profileVersion) {
        // Re-matched under a new profile since the claim: the row isn't ours any more (the
        // fenced write is a no-op), so let it go before taking a unit or calling the model.
        await release(pair, "PROFILE_CHANGED");
        log.debug({ matchId, code: "PROFILE_CHANGED" }, "pair let go");
        return null;
      }
      const at = now();
      // The plan or trial changed since matching.
      if (!aiAllowed(ctx.plan, ctx.trialEndsAt, at)) {
        await ops.markCapped(db, matchId, claim, "NOT_ALLOWED");
        log.debug({ matchId, code: "NOT_ALLOWED" }, "pair capped");
        return null;
      }
      // "held": a retry today keeps the unit its first attempt took.
      const unit = await ops.takeRescoreUnit(
        db,
        matchId,
        claim,
        RESCORE_DAILY_CAP[ctx.plan],
        utcDay(at),
      );
      if (unit === "lost") {
        log.debug({ matchId, code: "CLAIM_LOST" }, "pair let go");
        return null;
      }
      if (unit === "capped") {
        await ops.markCapped(db, matchId, claim);
        log.debug({ matchId, code: "DAILY_CAP" }, "pair capped");
        return null;
      }
      if (await overBudget()) {
        await release(pair, "BUDGET");
        return null;
      }
      if (stopping) {
        await release(pair, "SHUTDOWN");
        return null;
      }
      return { ...pair, userId: ctx.userId, ctx };
    } catch (err) {
      // Only database reads and writes happen here (no model call yet), so a failure is most
      // likely our side's (a dropped connection), not the pair's: put it back without using
      // an attempt and give back its unit. But only once in a row (`countRepeats`): if the same
      // pair fails here again, the attempt counts, so a bug that always throws still ends in
      // `failed` with the rule score after MAX_RESCORE_ATTEMPTS more claims.
      log.error(
        { matchId, code: "INTERNAL", ...errorFields(err) },
        "re-score preparation failed",
      );
      await release(pair, "INTERNAL", { countRepeats: true });
      return null;
    }
  }

  async function recordAttempts(job: Job, attempts: AttemptRecord[]) {
    for (const a of attempts) {
      try {
        await ops.recordLlmUsage(db, {
          userId: job.ctx.userId,
          jobPostId: job.ctx.post.id,
          task: RESCORE_TASK,
          step: "rescore",
          promptVersion: RESCORE_PROMPT_VERSION,
          model: a.usage?.model ?? deps.model,
          inputTokens: a.usage?.inputTokens ?? 0,
          cachedInputTokens: a.usage?.cachedInputTokens ?? 0,
          outputTokens: a.usage?.outputTokens ?? 0,
          costMicros: a.usage?.costMicros ?? 0,
          latencyMs: a.usage?.latencyMs ?? 0,
          attempt: a.attempt,
          outcome: a.outcome,
        });
      } catch (err) {
        log.error(
          { matchId: job.matchId, pgCode: pgErrorCode(err) },
          "could not record llm usage",
        );
      }
    }
  }

  async function runPair(job: Job): Promise<void> {
    const started = Date.now();
    const ac = new AbortController();
    controllers.add(ac);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, deps.pairTimeoutMs ?? 20_000);
    let outcome = "done";
    let code: string | null = null;
    try {
      let result;
      try {
        result = await rescorePair(job.ctx, {
          llm: deps.llm,
          model: deps.model,
          signal: ac.signal,
        });
      } catch (err) {
        if (err instanceof LlmError) await recordAttempts(job, err.attempts);
        throw err;
      }
      await recordAttempts(job, result.attempts);
      const { attempts: _a, ...saved } = result;
      if (!(await ops.completeRescore(db, job.matchId, job.claim, saved)))
        outcome = "lost";
      // A success closes the breaker.
      providerFailures = 0;
      trips = 0;
    } catch (err) {
      const fail = classifyRescoreError(err, { timedOut });
      code = fail.code;
      if (
        (PROVIDER_ERROR_CODES as readonly string[]).includes(fail.code) &&
        ++providerFailures >= BREAKER_TRIP
      ) {
        trips++;
        providerFailures = 0;
        const cooldown = Math.min(
          BREAKER_BASE_MS * 2 ** (trips - 1),
          BREAKER_MAX_MS,
        );
        pausedUntil = now().getTime() + cooldown;
        log.warn(
          { code: fail.code, cooldownMs: cooldown },
          "model provider failing; pausing re-scores",
        );
      }
      if (fail.code === "INTERNAL")
        log.error(
          { matchId: job.matchId, code: fail.code, ...errorFields(err) },
          "re-score failed unexpectedly",
        );
      try {
        // No answer came of it (provider outage, shutdown): failRescore gives the attempt and
        // the unit back. A counted failure keeps the unit for the pair's retries.
        outcome = await ops.failRescore(db, job.matchId, job.claim, fail);
      } catch (dbErr) {
        outcome = "unrecorded";
        log.error(
          { matchId: job.matchId, pgCode: pgErrorCode(dbErr) },
          "could not record re-score failure",
        );
      }
    } finally {
      clearTimeout(timer);
      controllers.delete(ac);
      log.debug(
        { matchId: job.matchId, outcome, code, ms: Date.now() - started },
        "pair re-scored",
      );
    }
  }

  async function pumpOnce(): Promise<void> {
    while (!stopping && running.size < concurrency) {
      if (now().getTime() < pausedUntil) return; // breaker open; the poll tries again later
      try {
        if (await overBudget()) return;
      } catch (err) {
        log.error({ pgCode: pgErrorCode(err) }, "budget check failed");
        return;
      }
      let pairs: Awaited<ReturnType<typeof claimPairsForRescore>>;
      try {
        pairs = await ops.claimPairsForRescore(db, concurrency - running.size);
      } catch (err) {
        log.error({ pgCode: pgErrorCode(err) }, "claim failed");
        return;
      }
      if (pairs.length === 0) return;
      for (const pair of pairs) {
        const job = await prepare(pair);
        if (!job) continue;
        const p: Promise<void> = runPair(job).finally(() => {
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
      const n = await ops.requeueStaleRescores(db);
      if (n > 0) {
        log.warn({ count: n }, "re-queued stale re-scores");
        void pump();
      }
    } catch (err) {
      log.error({ pgCode: pgErrorCode(err) }, "re-score sweep failed");
    }
  }

  return {
    async start() {
      if (!PRICES[deps.model])
        log.error(
          { model: deps.model },
          "no price for this model in packages/llm/src/prices.ts: costs record as 0 and the daily budget can't stop re-scores",
        );
      listener = await deps.listen();
      listener.onNotify(() => void pump());
      pollTimer = setInterval(() => void pump(), deps.pollMs ?? 10_000);
      sweepTimer = setInterval(() => void sweep(), deps.sweepMs ?? 60_000);
      await sweep();
      await pump();
    },
    async stop(graceMs = 20_000) {
      stopping = true;
      if (pollTimer) clearInterval(pollTimer);
      if (sweepTimer) clearInterval(sweepTimer);
      if (pumping) await pumping.catch(() => {});
      // Model calls are aborted 5 s before the grace period ends; aborted pairs go back to
      // pending with their attempt and unit given back.
      const abortTimer = setTimeout(
        () => {
          for (const ac of controllers) ac.abort();
        },
        Math.max(0, graceMs - 5000),
      );
      await Promise.race([
        Promise.allSettled([...running]),
        new Promise((r) => setTimeout(r, graceMs)),
      ]);
      clearTimeout(abortTimer);
      await listener?.close();
    },
    async idle() {
      for (;;) {
        if (pumping) await pumping.catch(() => {});
        else if (running.size > 0) await Promise.allSettled([...running]);
        else return;
      }
    },
  };
}

/**
 * The re-scorer configured from the worker's env, or null unless both matching and re-scoring
 * are on.
 */
export function createRescorerFromEnv(
  env: Pick<
    WorkerEnv,
    | "DATABASE_URL"
    | "MATCHING_ENABLED"
    | "RESCORE_ENABLED"
    | "RESCORE_DAILY_BUDGET_USD"
    | "VERTEX_MODEL_FAST"
    | "WORKER_CONCURRENCY"
  >,
  deps: {
    db: Database;
    log: Logger;
    llm: LlmClient;
    listen?: () => Promise<Listener>;
  },
): Rescorer | null {
  if (!env.MATCHING_ENABLED || !env.RESCORE_ENABLED) return null;
  return createRescorer({
    db: deps.db,
    log: deps.log,
    llm: deps.llm,
    model: env.VERTEX_MODEL_FAST,
    dailyBudgetMicros: Math.round(env.RESCORE_DAILY_BUDGET_USD * 1e6),
    concurrency: env.WORKER_CONCURRENCY,
    listen:
      deps.listen ??
      (() => createPgListener(env.DATABASE_URL, deps.log, MATCHES_CHANNEL)),
  });
}
