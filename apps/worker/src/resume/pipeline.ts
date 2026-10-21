import type { ResumeStepName, Suggestions } from "@redlance/core";
import {
  LlmError,
  type AttemptRecord,
  type LlmClient,
  type LlmErrorKind,
} from "@redlance/llm";
import { JobError } from "../jobs/types";
import { yearsOfExperience } from "./dates";
import { mergeResumeSteps, type DroppedItem, type ReplacedName } from "./merge";
import { skillShortlist } from "./prepass";
import { numberSection } from "./entries";
import { splitSectionsWithFlag } from "./sections";
import type {
  CallSpec,
  PipelineInput,
  ResumeCallName,
  SkippedStep,
  StepOutputs,
} from "./steps/shared";
import { profileCall } from "./steps/profile";
import { skillsCall } from "./steps/skills";
import { workCall } from "./steps/work";

export type {
  CallSpec,
  PipelineInput,
  ResumeCallName,
  SkippedStep,
} from "./steps/shared";

/** One call's outcome: the validated JSON the model returned, or why it failed. */
export type StepResult = {
  call: ResumeCallName;
  /** The logical steps the call filled for this resume. */
  parts: ResumeStepName[];
  model: string;
  ms: number;
  attempts: AttemptRecord[];
  output?: unknown;
  error?: LlmErrorKind | "unknown";
};

export type MergeReport = {
  dropped: DroppedItem[];
  /** Names taken out of projects and experience (local dev console only). */
  replaced: ReplacedName[];
  partial: ResumeStepName[];
  skipped: SkippedStep[];
  suggestions: Suggestions;
};

// resume@3: three calls (profile, skills, work) instead of five, all on Flash-Lite.
// resume@4: more section headings (skills variants, headings that end a section) and no
// maxItems on the outer projects/experience lists (Vertex 400); merge.ts cuts them.
// resume@5: an over-long string never fails a call (schemas only stop runaway output; merge.ts
// trims to the real limit).
// resume@6: the work call gets numbered lines and picks each entry's lines (work@2); code no
// longer cuts the sections into blocks.
export const PIPELINE_VERSION = "resume@6";
/** The default per-call timeout; a call can set its own (work: 20 s). */
export const STEP_TIMEOUT_MS = 10_000;
export const PIPELINE_DEADLINE_MS = 25_000;

/**
 * The calls, run in parallel. Each fills one or two logical steps (ResumeStepName), which
 * are what partial/skipped and the suggestions meta talk about, so the web app didn't change.
 */
export const CALLS = [profileCall, skillsCall, workCall] as const;

/**
 * The cache key stored as import_jobs.pipeline_version: everything that
 * changes the output (pipeline, prompt versions, the models the calls use), so a
 * change to any of them misses the cache. A model no call uses isn't in it.
 */
export function resumeCacheKey(env: {
  VERTEX_MODEL_FAST: string;
  VERTEX_MODEL_SMART: string;
}): string {
  const kinds = [...new Set(CALLS.map((c) => c.model))].sort();
  return [
    PIPELINE_VERSION,
    ...CALLS.map((c) => c.version),
    ...kinds.map((k) =>
      k === "fast" ? env.VERTEX_MODEL_FAST : env.VERTEX_MODEL_SMART,
    ),
  ].join("|");
}

/** The deterministic pre-pass (no model). GitHub is added by the job, not here. */
export function buildPipelineInput(text: string): PipelineInput {
  const { sections, headed } = splitSectionsWithFlag(text);
  return {
    text,
    sections,
    shortlist: skillShortlist(text, sections),
    yearsExperience: yearsOfExperience(sections.experience),
    headed,
    projectLines: numberSection(sections.projects, "projects", { headed }),
    experienceLines: numberSection(sections.experience, "experience"),
  };
}

export async function runResumePipeline(
  text: string,
  deps: {
    llm: LlmClient;
    models: { fast: string; smart: string };
    onAttempt?: (
      call: ResumeCallName,
      version: string,
      attempt: AttemptRecord,
      model: string,
    ) => void;
    /** Hooks for the dev console (optional; no effect on the result). */
    onPrepass?: (input: PipelineInput) => void;
    onStepResult?: (result: StepResult) => void;
    onMerge?: (report: MergeReport) => void;
    deadlineMs?: number;
    signal?: AbortSignal;
  },
): Promise<{
  suggestions: Suggestions;
  partial: ResumeStepName[];
  skipped: ResumeStepName[];
}> {
  const input = buildPipelineInput(text);
  deps.onPrepass?.(input);

  // A part with nothing to read (no Projects heading, no Experience section) is skipped;
  // a call whose parts are all skipped sends no request.
  const skipped: SkippedStep[] = [];
  const running: { call: CallSpec<unknown>; parts: ResumeStepName[] }[] = [];
  for (const call of CALLS as readonly CallSpec<unknown>[]) {
    const off = call.skipParts?.(input) ?? [];
    skipped.push(...off);
    const parts = call.parts.filter((p) => !off.some((s) => s.step === p));
    if (parts.length) running.push({ call, parts });
  }

  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(),
    deps.deadlineMs ?? PIPELINE_DEADLINE_MS,
  );
  const onOuter = () => deadline.abort();
  if (deps.signal?.aborted) deadline.abort();
  else deps.signal?.addEventListener("abort", onOuter, { once: true });

  const report = (
    call: CallSpec<unknown>,
    model: string,
    attempts: AttemptRecord[],
  ) => {
    for (const a of attempts)
      deps.onAttempt?.(call.name, call.version, a, model);
  };

  let settled: PromiseSettledResult<unknown>[];
  try {
    settled = await Promise.allSettled(
      running.map(async ({ call, parts }) => {
        const model = deps.models[call.model];
        const t0 = Date.now();
        try {
          const res = await deps.llm.generateStructured({
            model,
            system: call.system,
            prompt: call.buildPrompt(input),
            schema: call.schemaFor ? call.schemaFor(input) : call.schema,
            maxOutputTokens: call.maxOutputTokens,
            timeoutMs: call.timeoutMs ?? STEP_TIMEOUT_MS,
            retries: 1,
            temperature: 0,
            thinking: call.thinking,
            signal: deadline.signal,
          });
          report(call, model, res.attempts);
          deps.onStepResult?.({
            call: call.name,
            parts,
            model,
            ms: Date.now() - t0,
            attempts: res.attempts,
            output: res.data,
          });
          return res.data;
        } catch (e) {
          if (e instanceof LlmError) report(call, model, e.attempts);
          deps.onStepResult?.({
            call: call.name,
            parts,
            model,
            ms: Date.now() - t0,
            attempts: e instanceof LlmError ? e.attempts : [],
            error: e instanceof LlmError ? e.kind : "unknown",
          });
          throw e;
        }
      }),
    );
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onOuter);
  }

  // The worker is stopping (not our own deadline): retry the whole job cleanly.
  if (deps.signal?.aborted)
    throw new JobError(
      "SHUTDOWN",
      true,
      "stopped before the analysis finished",
    );

  // A failed call marks every part it ran as partial (profile: basics and jobTypes).
  const partial: ResumeStepName[] = [];
  let outputs: StepOutputs = {};
  settled.forEach((r, i) => {
    const { call, parts } = running[i]!;
    if (r.status === "fulfilled")
      outputs = { ...outputs, ...call.split(r.value) };
    else partial.push(...parts);
  });

  // Only the calls that ran count: a skipped part isn't a failure.
  if (settled.every((r) => r.status === "rejected")) {
    const quota = settled.some(
      (r) =>
        r.status === "rejected" &&
        r.reason instanceof LlmError &&
        r.reason.kind === "quota_exhausted",
    );
    throw quota
      ? new JobError("LLM_BUSY", true, "the model quota is exhausted")
      : new JobError("LLM_FAILED", true, "every resume call failed");
  }

  const dropped: DroppedItem[] = [];
  const replaced: ReplacedName[] = [];
  const skippedNames = skipped.map((s) => s.step);
  const suggestions = mergeResumeSteps(outputs, {
    ...input,
    githubUsername: null,
    pipelineVersion: PIPELINE_VERSION,
    promptVersions: Object.fromEntries(CALLS.map((c) => [c.name, c.version])),
    partial,
    skipped: skippedNames,
    dropped,
    replaced,
  });
  deps.onMerge?.({ dropped, replaced, partial, skipped, suggestions });
  return { suggestions, partial, skipped: skippedNames };
}
