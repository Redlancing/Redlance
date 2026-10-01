import {
  claimPostsForAnalysis,
  completePostAnalysis,
  failPostAnalysis,
  llmCostSince,
  pgErrorCode,
  recordLlmUsage,
  requeueStalePostAnalyses,
  type Database,
  type JobPostRow,
} from "@redlance/db";
import { LlmError, PRICES, type LlmClient } from "@redlance/llm";
import type { Logger } from "../logger";
import { PROMPT_VERSION, analysePost } from "./analyse-post";

// Turns pending posts into structured facts (docs/ingestion/plan.md, Phase 3). Same shape as
// the import runner: SKIP LOCKED claims, writes fenced on the claim, a per-post timeout, stale
// sweeps, woken by NOTIFY job_posts with a poll as the safety net. A daily budget pauses it.

export const ANALYSIS_TASK = "post_analysis";

export type AnalyserDeps = {
  db: Database;
  llm: LlmClient;
  log: Logger;
  model: string;
  /** Daily spend cap for post analysis, in micro-dollars (UTC day). */
  dailyBudgetMicros: number;
  listen: () => Promise<{
    onNotify(cb: () => void): void;
    close(): Promise<void>;
  }>;
  concurrency?: number;
  pollMs?: number;
  sweepMs?: number;
  postTimeoutMs?: number;
  now?: () => number;
};

const BUDGET_CHECK_MS = 60_000;

export const startOfUtcDay = (t: number) => {
  const d = new Date(t);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
};

/** Failures on the provider's side: they don't use up a post's attempts, and trip the breaker. */
export const PROVIDER_ERROR_CODES = [
  "LLM_SERVER",
  "LLM_RATE_LIMITED",
  "LLM_QUOTA_EXHAUSTED",
] as const;

export type AnalysisFailure = {
  code: string;
  retryable: boolean;
  /** false = the provider's fault: give the attempt back. */
  countAttempt: boolean;
};

/** Which failures are worth another try, and which count against the post. */
export function classifyAnalysisError(
  err: unknown,
  opts: { timedOut?: boolean } = {},
): AnalysisFailure {
  if (opts.timedOut)
    return { code: "POST_TIMEOUT", retryable: true, countAttempt: true };
  if (err instanceof LlmError) {
    const code = `LLM_${err.kind.toUpperCase()}`;
    if ((PROVIDER_ERROR_CODES as readonly string[]).includes(code))
      return { code, retryable: true, countAttempt: false };
    switch (err.kind) {
      case "timeout":
        return { code, retryable: true, countAttempt: true };
      case "invalid_output":
        return { code, retryable: true, countAttempt: true };
      case "aborted":
        return { code: "SHUTDOWN", retryable: true, countAttempt: false };
      default:
        return { code, retryable: err.retryable, countAttempt: true };
    }
  }
  // Postgres refused the row (bad date, constraint): the same output would fail again.
  const pg = pgErrorCode(err);
  if (pg && /^2[23]/.test(pg))
    return { code: "DB_REJECTED", retryable: false, countAttempt: true };
  return { code: "INTERNAL", retryable: true, countAttempt: true };
}

const BREAKER_TRIP = 3;
const BREAKER_BASE_MS = 60_000;
const BREAKER_MAX_MS = 15 * 60_000;

export function createAnalyser(deps: AnalyserDeps) {
  const now = deps.now ?? Date.now;
  const concurrency = deps.concurrency ?? 4;
  const running = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  let listener: Awaited<ReturnType<AnalyserDeps["listen"]>> | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let pumping: Promise<void> | null = null;
  let pumpAgain = false;
  let budget = { checkedAt: 0, over: false, warnedDay: "" };
  // Circuit breaker: a few provider failures in a row pause claiming, with growing cooldowns.
  let providerFailures = 0;
  let pausedUntil = 0;
  let trips = 0;

  async function overBudget(): Promise<boolean> {
    if (now() - budget.checkedAt < BUDGET_CHECK_MS) return budget.over;
    const spent = await llmCostSince(
      deps.db,
      startOfUtcDay(now()),
      ANALYSIS_TASK,
    );
    budget = {
      ...budget,
      checkedAt: now(),
      over: spent >= deps.dailyBudgetMicros,
    };
    const day = startOfUtcDay(now()).toISOString().slice(0, 10);
    if (budget.over && budget.warnedDay !== day) {
      budget.warnedDay = day;
      deps.log.warn(
        { spentUsd: spent / 1e6, budgetUsd: deps.dailyBudgetMicros / 1e6 },
        "daily post-analysis budget reached; posts wait until tomorrow (UTC)",
      );
    }
    return budget.over;
  }

  async function runPost(post: JobPostRow): Promise<void> {
    const started = now();
    const ac = new AbortController();
    controllers.add(ac);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, deps.postTimeoutMs ?? 20_000);
    const usage: Promise<void>[] = [];
    let outcome = "done";
    try {
      const analysis = await analysePost(post, {
        llm: deps.llm,
        model: deps.model,
        signal: ac.signal,
        onAttempt: (a, model) =>
          usage.push(
            recordLlmUsage(deps.db, {
              jobPostId: post.id,
              task: ANALYSIS_TASK,
              step: "extract",
              promptVersion: PROMPT_VERSION,
              model: a.usage?.model ?? model,
              inputTokens: a.usage?.inputTokens ?? 0,
              cachedInputTokens: a.usage?.cachedInputTokens ?? 0,
              outputTokens: a.usage?.outputTokens ?? 0,
              costMicros: a.usage?.costMicros ?? 0,
              latencyMs: a.usage?.latencyMs ?? 0,
              attempt: a.attempt,
              outcome: a.outcome,
            }),
          ),
      });
      const owned = await completePostAnalysis(
        deps.db,
        post.id,
        post.analysisAttempts,
        analysis,
      );
      if (!owned) outcome = "lost";
      // A success closes the breaker.
      providerFailures = 0;
      trips = 0;
    } catch (err) {
      const { code, retryable, countAttempt } = classifyAnalysisError(err, {
        timedOut,
      });
      if (
        !countAttempt &&
        code !== "SHUTDOWN" &&
        ++providerFailures >= BREAKER_TRIP
      ) {
        trips++;
        providerFailures = 0;
        const cooldown = Math.min(
          BREAKER_BASE_MS * 2 ** (trips - 1),
          BREAKER_MAX_MS,
        );
        pausedUntil = now() + cooldown;
        deps.log.warn(
          { code, cooldownMs: cooldown },
          "model provider failing; pausing analysis",
        );
      }
      if (code === "INTERNAL")
        // Never log the post text; error name and stack frames only.
        deps.log.error(
          {
            jobPostId: post.id,
            errName: (err as Error)?.name,
            pgCode: pgErrorCode(err),
            stack: (err as Error)?.stack
              ?.split("\n")
              .filter((l) => /^\s+at /.test(l))
              .join("\n"),
          },
          "post analysis failed unexpectedly",
        );
      try {
        outcome = await failPostAnalysis(
          deps.db,
          post.id,
          post.analysisAttempts,
          {
            errorCode: code,
            retryable,
            countAttempt,
          },
        );
      } catch (dbErr) {
        outcome = "unrecorded";
        deps.log.error(
          { jobPostId: post.id, pgCode: pgErrorCode(dbErr) },
          "could not record analysis failure",
        );
      }
    } finally {
      clearTimeout(timer);
      controllers.delete(ac);
      for (const r of await Promise.allSettled(usage))
        if (r.status === "rejected")
          deps.log.error(
            { err: (r.reason as Error).message },
            "could not record llm usage",
          );
      deps.log.debug(
        { jobPostId: post.id, outcome, ms: now() - started },
        "post analysed",
      );
    }
  }

  async function pumpOnce(): Promise<void> {
    while (!stopping && running.size < concurrency) {
      if (now() < pausedUntil) return; // breaker open; the poll timer tries again later
      try {
        if (await overBudget()) return;
      } catch (err) {
        deps.log.error({ err: (err as Error).message }, "budget check failed");
        return;
      }
      let posts: JobPostRow[];
      try {
        posts = await claimPostsForAnalysis(
          deps.db,
          concurrency - running.size,
        );
      } catch (err) {
        deps.log.error({ err: (err as Error).message }, "claim failed");
        return;
      }
      if (posts.length === 0) return;
      for (const post of posts) {
        const p: Promise<void> = runPost(post).finally(() => {
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
      const n = await requeueStalePostAnalyses(deps.db);
      if (n > 0) {
        deps.log.warn({ count: n }, "re-queued stale post analyses");
        void pump();
      }
    } catch (err) {
      deps.log.error({ err: (err as Error).message }, "analysis sweep failed");
    }
  }

  return {
    async start() {
      if (!PRICES[deps.model])
        deps.log.error(
          { model: deps.model },
          "no price for this model in packages/llm/src/prices.ts: costs record as 0 and the daily budget can't stop analysis",
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
    /** Resolves once nothing is running or being claimed (tests). */
    async idle() {
      for (;;) {
        if (pumping) await pumping.catch(() => {});
        else if (running.size > 0) await Promise.allSettled([...running]);
        else return;
      }
    },
  };
}
