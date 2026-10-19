import {
  lengthTarget,
  type BudgetUnit,
  type EmploymentType,
  type Evidence,
  type PayType,
  type RemoteType,
  type RewriteOption,
  type VoiceStats,
} from "@redlance/core";
import {
  DRAFTS_CHANNEL,
  addEvalCandidate,
  claimNextDrafts,
  completeDraft,
  draftBudget,
  draftVersions,
  evidenceForDraft,
  expireStuckDrafts,
  failDraft,
  loadDraftContext,
  onceADay,
  pgErrorCode,
  pickExamples,
  recordLlmUsage,
  requeueStaleDrafts,
  type Database,
  type DraftBudgetSettings,
  type DraftClaim,
  type DraftFailure,
} from "@redlance/db";
import { PRICES, type LlmClient } from "@redlance/llm";
import { createPgListener, type Listener } from "../db";
import type { WorkerEnv } from "../env";
import { classifyAnalysisError } from "../ingest/analyser";
import type { Logger } from "../logger";
import { DraftDeadline, generateDraft } from "./generate";
import {
  DRAFT_PROMPT_VERSION,
  styleTags,
  type DraftPromptVoice,
} from "./prompt";
import { createVoiceLoader } from "./voice-job";

// The draft queue (docs/drafts/README.md §3-4, plan/07-worker-drafts.md). Same shape as the
// post analyser: SKIP LOCKED claims, writes fenced on the claim, a per-draft deadline, a stale
// sweep, woken by NOTIFY drafts with a poll as the safety net, a breaker for provider outages.
// The system drafting budget pauses claiming. A final failure refunds (failDraft), once.

/**
 * The voice seam: the voice block for the prompt and the stats that set the DM length.
 * `createVoiceLoader` (voice-job.ts) reads the user's stored voice; without one every user
 * gets the default style and 60-150 words.
 */
export type VoiceLoader = (
  userId: string,
) => Promise<{ voice: DraftPromptVoice | null; stats?: VoiceStats }>;

export const noVoice: VoiceLoader = async () => ({ voice: null });

export type DrafterDeps = {
  db: Database;
  llm: LlmClient;
  log: Logger;
  draftModel: string;
  rewriteModel: string;
  budget: DraftBudgetSettings;
  listen: () => Promise<Listener>;
  loadVoice?: VoiceLoader;
  concurrency?: number;
  pollMs?: number;
  sweepMs?: number;
  /** A draft's whole run (load, AI calls, save). */
  draftTimeoutMs?: number;
  /** A running draft whose lock is older than this goes back to the queue. */
  staleAfterSec?: number;
  /** How long a budget reading is reused. */
  budgetCheckMs?: number;
  now?: () => number;
};

/** A failure that is the draft's own (no AI call can fix it): final, refunded. */
export class DraftStop extends Error {
  constructor(
    readonly code: "MATCH_GONE" | "PARENT_GONE" | "NO_OTHER_PROJECT",
  ) {
    super(code);
    this.name = "DraftStop";
  }
}

/** Which failures retry, which count against the draft's 3 attempts, and which give it back. */
export function classifyDraftError(
  err: unknown,
  opts: { timedOut?: boolean; stopping?: boolean } = {},
): DraftFailure {
  if (err instanceof DraftStop)
    return { code: err.code, retryable: false, countAttempt: true };
  // Shutdown: the next worker should pick it up straight away, attempt not used.
  if (opts.stopping && !opts.timedOut)
    return {
      code: "SHUTDOWN",
      retryable: true,
      countAttempt: false,
      retryInSec: 0,
    };
  if (opts.timedOut)
    return { code: "DRAFT_TIMEOUT", retryable: true, countAttempt: true };
  const f = classifyAnalysisError(err);
  return f.code === "SHUTDOWN" ? { ...f, retryInSec: 0 } : f;
}

const BREAKER_TRIP = 3;
const BREAKER_BASE_MS = 60_000;
const BREAKER_MAX_MS = 15 * 60_000;
/** A third rewrite is version 4. */
const MANY_REWRITES_VERSION = 4;

/**
 * The parent's texts for the rewrite prompt, with a project the parent cited but the new
 * evidence no longer has (hidden or deleted since) taken out: its title and links.
 */
function previousTexts(
  parent: {
    comment: string | null;
    dm: string | null;
    evidence: Record<string, unknown> | null;
  },
  evidence: Evidence,
): { comment: string; dm: string } {
  const old = (parent.evidence as Partial<Evidence> | null)?.project;
  let comment = parent.comment ?? "";
  let dm = parent.dm ?? "";
  if (old && old.id !== evidence.project?.id) {
    const terms = [old.title, old.link]
      .filter((t): t is string => !!t && t.trim().length > 0)
      .sort((a, b) => b.length - a.length);
    for (const t of terms) {
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const to = t === old.link ? "" : "a past project";
      comment = comment.replace(re, to);
      dm = dm.replace(re, to);
    }
  }
  return { comment, dm };
}

export function createDrafter(deps: DrafterDeps) {
  const now = deps.now ?? Date.now;
  const concurrency = deps.concurrency ?? 4;
  const loadVoice = deps.loadVoice ?? noVoice;
  const budgetCheckMs = deps.budgetCheckMs ?? 60_000;
  const running = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  const once = onceADay();
  let listener: Listener | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let pumping: Promise<void> | null = null;
  let pumpAgain = false;
  let budget = { checkedAt: -Infinity, paused: false };
  let providerFailures = 0;
  let pausedUntil = 0;
  let trips = 0;

  async function budgetPaused(): Promise<boolean> {
    if (now() - budget.checkedAt < budgetCheckMs) return budget.paused;
    const at = new Date(now());
    const b = await draftBudget(deps.db, deps.budget, at);
    budget = { checkedAt: now(), paused: b.paused };
    const spentUsd = b.spentMicros / 1e6;
    if (b.alert && once("alert", at))
      deps.log.error(
        { spentUsd, alertUsd: deps.budget.DRAFT_BUDGET_ALERT_USD },
        "drafting budget alert: today's drafting spend reached the alert level",
      );
    if (b.paused && once("pause", at))
      deps.log.warn(
        { spentUsd, pauseUsd: deps.budget.DRAFT_BUDGET_PAUSE_USD },
        "drafting paused: today's drafting spend reached the pause level; drafts wait until tomorrow (UTC)",
      );
    return b.paused;
  }

  async function write(claim: DraftClaim, signal: AbortSignal) {
    const timings: Record<string, number> = {};
    let t = now();
    const lap = (name: string) => {
      const n = now();
      timings[name] = (timings[name] ?? 0) + (n - t);
      t = n;
    };

    const ctx = await loadDraftContext(deps.db, {
      userId: claim.userId,
      matchId: claim.matchId,
    });
    if (!ctx) throw new DraftStop("MATCH_GONE");
    const versions =
      claim.kind === "rewrite"
        ? await draftVersions(deps.db, {
            userId: claim.userId,
            matchId: claim.matchId,
          })
        : [];
    lap("load");

    // Evidence: v1 builds it; a rewrite copies its parent's, except "different project".
    const option: RewriteOption | null =
      claim.kind === "rewrite"
        ? (claim.option ?? (claim.instruction ? "custom" : "shorter"))
        : null;
    const parent =
      claim.kind === "rewrite"
        ? versions.find(
            (v) =>
              v.id === claim.parentId && v.status === "done" && v.dm !== null,
          )
        : undefined;
    if (claim.kind === "rewrite" && !parent) throw new DraftStop("PARENT_GONE");
    // Evidence is always rebuilt from the current profile, so a project hidden or employer
    // names turned off since the parent never reach the model (the parent's project and role
    // stay pinned while still visible).
    const built = evidenceForDraft(
      ctx,
      {
        kind: claim.kind,
        option,
        version: claim.version,
        parentEvidence: parent?.evidence ?? null,
      },
      versions,
      new Date(now()),
    );
    if ("stop" in built) throw new DraftStop(built.stop);
    const evidence = built.evidence;
    lap("evidence");

    const [examples, voice] = await Promise.all([
      pickExamples(deps.db, ctx.analysis.categories[0] ?? "general"),
      loadVoice(claim.userId),
    ]);
    lap("load");

    const usage: Promise<void>[] = [];
    try {
      const gen = await generateDraft(
        {
          userId: claim.userId,
          jobPostId: claim.jobPostId,
          kind: claim.kind,
          option,
          postText: [
            ctx.post.title,
            ctx.post.body,
            ctx.analysis.applyInstructions ?? "",
          ].join("\n"),
          instruction: option === "custom" ? claim.instruction : null,
          prompt: {
            evidence,
            post: {
              title: ctx.post.title,
              body: ctx.post.body,
              subreddit: ctx.post.community,
              alsoPostedIn: ctx.post.alsoPostedIn,
            },
            analysis: {
              ...ctx.analysis,
              employmentType: ctx.analysis.employmentType as EmploymentType,
              payType: ctx.analysis.payType as PayType,
              budgetUnit: ctx.analysis.budgetUnit as BudgetUnit | null,
              remote: ctx.analysis.remote as RemoteType,
            },
            examples,
            voice: voice.voice,
            length: lengthTarget(voice.stats),
            rewrite:
              parent && option
                ? {
                    option,
                    instruction: claim.instruction,
                    previous: previousTexts(parent, evidence),
                  }
                : undefined,
          },
        },
        {
          llm: deps.llm,
          draftModel: deps.draftModel,
          rewriteModel: deps.rewriteModel,
          signal,
          onAttempt: (row) => usage.push(recordLlmUsage(deps.db, row)),
        },
      );
      timings.ai = gen.ms.ai;
      timings.validate = gen.ms.validate;
      t = now();

      const out = gen.output;
      const owned = await completeDraft(deps.db, claim, {
        comment: out.comment,
        dm: out.dm,
        problem: out.problem,
        citedFact: out.citedFact,
        applyFollowed: ctx.analysis.applyInstructions
          ? out.applyInstructions !== null
          : null,
        evidence: evidence as unknown as Record<string, unknown>,
        styleTags: styleTags(out),
        warning: gen.warning,
        problems: gen.problems,
        model: gen.model,
        promptVersion: DRAFT_PROMPT_VERSION,
        inputTokens: gen.usage.inputTokens,
        outputTokens: gen.usage.outputTokens,
        costMicros: gen.usage.costMicros,
        timings,
      });
      lap("save");
      if (!owned) return { outcome: "lost", timings };
      if (gen.warning)
        await addEvalCandidate(deps.db, claim.id, "validator_failed_twice");
      if (claim.kind === "rewrite" && claim.version >= MANY_REWRITES_VERSION)
        await addEvalCandidate(deps.db, claim.id, "many_rewrites");
      return {
        outcome: gen.warning ? "done_with_warning" : "done",
        timings,
      };
    } finally {
      for (const r of await Promise.allSettled(usage))
        if (r.status === "rejected")
          deps.log.error(
            {
              pgCode: pgErrorCode(r.reason),
              errName: (r.reason as Error)?.name,
            },
            "could not record llm usage",
          );
    }
  }

  async function runDraft(claim: DraftClaim): Promise<void> {
    const started = now();
    const ac = new AbortController();
    controllers.add(ac);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort(new DraftDeadline());
    }, deps.draftTimeoutMs ?? 40_000);
    let outcome = "done";
    let timings: Record<string, number> | undefined;
    try {
      const res = await write(claim, ac.signal);
      outcome = res.outcome;
      timings = res.timings;
      providerFailures = 0;
      trips = 0;
    } catch (err) {
      const fail = classifyDraftError(err, {
        timedOut,
        stopping: stopping && ac.signal.aborted,
      });
      if (
        !fail.countAttempt &&
        fail.code !== "SHUTDOWN" &&
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
          { code: fail.code, cooldownMs: cooldown },
          "model provider failing; pausing drafting",
        );
      }
      if (fail.code === "INTERNAL")
        // Never log the post, profile or draft text: error name and stack frames only.
        deps.log.error(
          {
            draftId: claim.id,
            errName: (err as Error)?.name,
            pgCode: pgErrorCode(err),
            stack: (err as Error)?.stack
              ?.split("\n")
              .filter((l) => /^\s+at /.test(l))
              .join("\n"),
          },
          "draft failed unexpectedly",
        );
      try {
        outcome = `${await failDraft(deps.db, claim, fail)}:${fail.code}`;
      } catch (dbErr) {
        outcome = "unrecorded";
        deps.log.error(
          { draftId: claim.id, pgCode: pgErrorCode(dbErr) },
          "could not record draft failure",
        );
      }
    } finally {
      clearTimeout(timer);
      controllers.delete(ac);
      deps.log.debug(
        { draftId: claim.id, outcome, ms: now() - started, timings },
        "draft written",
      );
    }
  }

  async function pumpOnce(): Promise<void> {
    while (!stopping && running.size < concurrency) {
      if (now() < pausedUntil) return; // breaker open; the poll tries again later
      try {
        if (await budgetPaused()) return;
      } catch (err) {
        deps.log.error(
          { pgCode: pgErrorCode(err) },
          "draft budget check failed",
        );
        return;
      }
      let claims: DraftClaim[];
      try {
        claims = await claimNextDrafts(deps.db, concurrency - running.size);
      } catch (err) {
        deps.log.error({ pgCode: pgErrorCode(err) }, "draft claim failed");
        return;
      }
      if (claims.length === 0) return;
      for (const claim of claims) {
        const p: Promise<void> = runDraft(claim).finally(() => {
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
      // Drafts stuck for 10 minutes (outage, budget pause) are given up on and refunded.
      const expired = await expireStuckDrafts(deps.db);
      if (expired > 0)
        deps.log.warn({ count: expired }, "expired drafts stuck for too long");
      const n = await requeueStaleDrafts(deps.db, deps.staleAfterSec ?? 60);
      if (n > 0) {
        deps.log.warn({ count: n }, "re-queued stale drafts");
        void pump();
      }
    } catch (err) {
      deps.log.error({ pgCode: pgErrorCode(err) }, "draft sweep failed");
    }
  }

  return {
    async start() {
      for (const model of new Set([deps.draftModel, deps.rewriteModel]))
        if (!PRICES[model])
          deps.log.error(
            { model },
            "no price for this model in packages/llm/src/prices.ts: draft costs record as 0, so the per-user cost cap and the drafting budget can't work",
          );
      listener = await deps.listen();
      listener.onNotify(() => void pump());
      pollTimer = setInterval(() => void pump(), deps.pollMs ?? 5_000);
      sweepTimer = setInterval(() => void sweep(), deps.sweepMs ?? 60_000);
      await sweep();
      await pump();
    },
    /** Lets running drafts finish for up to `graceMs` - 5 s, then aborts them (back to pending). */
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

export type Drafter = ReturnType<typeof createDrafter>;

export function createDrafterFromEnv(
  env: Pick<
    WorkerEnv,
    | "DATABASE_URL"
    | "DRAFTS_ENABLED"
    | "DRAFT_MODEL"
    | "REWRITE_MODEL"
    | "DRAFT_CONCURRENCY"
    | "DRAFT_BUDGET_ALERT_USD"
    | "DRAFT_BUDGET_PAUSE_USD"
  >,
  deps: {
    db: Database;
    log: Logger;
    llm: LlmClient;
    listen?: () => Promise<Listener>;
    loadVoice?: VoiceLoader;
  },
): Drafter | null {
  if (!env.DRAFTS_ENABLED) return null;
  return createDrafter({
    db: deps.db,
    log: deps.log,
    llm: deps.llm,
    draftModel: env.DRAFT_MODEL,
    rewriteModel: env.REWRITE_MODEL,
    budget: {
      DRAFT_BUDGET_ALERT_USD: env.DRAFT_BUDGET_ALERT_USD,
      DRAFT_BUDGET_PAUSE_USD: env.DRAFT_BUDGET_PAUSE_USD,
    },
    concurrency: env.DRAFT_CONCURRENCY,
    loadVoice: deps.loadVoice ?? createVoiceLoader(deps.db),
    listen:
      deps.listen ??
      (() => createPgListener(env.DATABASE_URL, deps.log, DRAFTS_CHANNEL)),
  });
}
