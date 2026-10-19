import {
  formatProblemsForRetry,
  validateDraft,
  type Problem,
  type RewriteOption,
} from "@redlance/core";
import type { recordLlmUsage } from "@redlance/db";
import {
  LlmError,
  type AttemptRecord,
  type GenerateResult,
  type LlmClient,
} from "@redlance/llm";
import {
  DRAFT_PROMPT_VERSION,
  buildDraftPrompt,
  draftOutputSchema,
  type DraftModelOutput,
  type DraftPromptInput,
} from "./prompt";

// One draft (docs/drafts/README.md §7-8, plan/07-worker-drafts.md): the AI call, the code
// validators, and at most one retry with the problems listed. A Flash-Lite rewrite that
// fails validation retries on the draft model. Still failing → the draft is kept with a
// warning. Every model attempt is reported through `onAttempt` (counts and cost, never text).

export type LlmUsageRow = Parameters<typeof recordLlmUsage>[1];

export type GenerateDraftInput = {
  userId: string;
  jobPostId: string;
  kind: "draft" | "rewrite";
  option: RewriteOption | null;
  /** Everything for the prompt except the retry problems (added here). */
  prompt: Omit<DraftPromptInput, "retryProblems">;
  /** The post's text, for the number check. */
  postText: string;
  /** The user's typed rewrite instruction: its numbers are allowed. */
  instruction?: string | null;
};

export type GenerateDraftDeps = {
  llm: LlmClient;
  /** First drafts, "different project", and the fallback for a failing rewrite. */
  draftModel: string;
  /** Style and typed rewrites. */
  rewriteModel: string;
  signal?: AbortSignal;
  onAttempt?: (row: LlmUsageRow) => void;
};

export type GenerateDraftResult = {
  output: DraftModelOutput;
  problems: Problem[];
  warning: boolean;
  /** Model calls made (1, or 2 with the validator retry). */
  attempts: number;
  /** The model that wrote the kept answer. */
  model: string;
  /** Summed over every attempt. */
  usage: { inputTokens: number; outputTokens: number; costMicros: number };
  ms: { ai: number; validate: number };
};

/**
 * The abort reason the drafter uses when a draft's own deadline fires (not a shutdown).
 * During the validator retry it keeps the usable first answer instead of losing it.
 */
export class DraftDeadline extends Error {
  constructor() {
    super("draft deadline");
    this.name = "DraftDeadline";
  }
}

export const DRAFT_CALL = {
  temperature: 0.7,
  thinking: "off",
  maxOutputTokens: 800,
  timeoutMs: 15_000,
  retries: 1,
} as const;

/** The model for the first call: the draft model, except style and typed rewrites. */
export function firstModel(
  kind: GenerateDraftInput["kind"],
  option: RewriteOption | null,
  models: { draftModel: string; rewriteModel: string },
): string {
  return kind === "rewrite" && option !== "different_project"
    ? models.rewriteModel
    : models.draftModel;
}

export async function generateDraft(
  ctx: GenerateDraftInput,
  deps: GenerateDraftDeps,
): Promise<GenerateDraftResult> {
  const task = ctx.kind === "draft" ? "draft" : "rewrite";
  const usage = { inputTokens: 0, outputTokens: 0, costMicros: 0 };
  const ms = { ai: 0, validate: 0 };
  const target = ctx.prompt.length;

  const record = (a: AttemptRecord, step: string, model: string) => {
    usage.inputTokens += a.usage?.inputTokens ?? 0;
    usage.outputTokens += a.usage?.outputTokens ?? 0;
    usage.costMicros += a.usage?.costMicros ?? 0;
    deps.onAttempt?.({
      userId: ctx.userId,
      jobPostId: ctx.jobPostId,
      task,
      step,
      promptVersion: DRAFT_PROMPT_VERSION,
      model: a.usage?.model ?? model,
      inputTokens: a.usage?.inputTokens ?? 0,
      cachedInputTokens: a.usage?.cachedInputTokens ?? 0,
      outputTokens: a.usage?.outputTokens ?? 0,
      costMicros: a.usage?.costMicros ?? 0,
      latencyMs: a.usage?.latencyMs ?? 0,
      attempt: a.attempt,
      outcome: a.outcome,
    });
  };

  const call = async (
    model: string,
    step: "generate" | "retry",
    retryProblems?: string,
  ): Promise<DraftModelOutput> => {
    const { system, prompt } = buildDraftPrompt({
      ...ctx.prompt,
      retryProblems,
    });
    const started = Date.now();
    let res: GenerateResult<DraftModelOutput>;
    try {
      res = await deps.llm.generateStructured({
        model,
        system,
        prompt,
        schema: draftOutputSchema,
        ...DRAFT_CALL,
        signal: deps.signal,
      });
    } catch (e) {
      if (e instanceof LlmError)
        for (const a of e.attempts) record(a, step, model);
      throw e;
    } finally {
      ms.ai += Date.now() - started;
    }
    for (const a of res.attempts) record(a, step, model);
    return res.data;
  };

  const check = (out: DraftModelOutput): Problem[] => {
    const started = Date.now();
    try {
      return validateDraft(out, ctx.prompt.evidence, {
        postText: ctx.postText,
        instruction: ctx.instruction ?? undefined,
        target,
      });
    } finally {
      ms.validate += Date.now() - started;
    }
  };

  const model = firstModel(ctx.kind, ctx.option, deps);
  const first = await call(model, "generate");
  const problems = check(first);
  if (problems.length === 0)
    return {
      output: first,
      problems,
      warning: false,
      attempts: 1,
      model,
      usage,
      ms,
    };

  // One retry with the problems listed; a Flash-Lite rewrite moves up to the draft model.
  let second: DraftModelOutput;
  try {
    second = await call(
      deps.draftModel,
      "retry",
      formatProblemsForRetry(problems),
    );
  } catch (e) {
    // Shutdown: let the caller put it back. The draft's own deadline, or any other failure
    // of the retry, keeps the first answer, shown with a warning, rather than losing it.
    const deadline =
      deps.signal?.aborted === true &&
      deps.signal.reason instanceof DraftDeadline;
    if (
      !deadline &&
      (deps.signal?.aborted || (e instanceof LlmError && e.kind === "aborted"))
    )
      throw e;
    return {
      output: first,
      problems,
      warning: true,
      attempts: 2,
      model,
      usage,
      ms,
    };
  }
  const again = check(second);
  return {
    output: second,
    problems: again,
    warning: again.length > 0,
    attempts: 2,
    model: deps.draftModel,
    usage,
    ms,
  };
}
