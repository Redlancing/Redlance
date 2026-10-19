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
import { splitEntries } from "./entries";
import { splitSectionsWithFlag } from "./sections";
import type {
  BasicsOutput,
  ExperienceOutput,
  JobTypesOutput,
  ProjectsOutput,
  SkillsOutput,
} from "./step-types";
import { basicsStep } from "./steps/basics";
import { experienceStep } from "./steps/experience";
import { jobTypesStep } from "./steps/job-types";
import { projectsStep } from "./steps/projects";
import type { PipelineInput, StepSpec } from "./steps/shared";
import { skillsStep } from "./steps/skills";

export type { PipelineInput, StepSpec } from "./steps/shared";

/** One step's outcome: the validated JSON the model returned, or why it failed. */
export type StepResult = {
  step: ResumeStepName;
  model: string;
  ms: number;
  attempts: AttemptRecord[];
  output?: unknown;
  error?: LlmErrorKind | "unknown";
};

/** A step that didn't run for this resume, and why. */
export type SkippedStep = { step: ResumeStepName; reason: string };

export type MergeReport = {
  dropped: DroppedItem[];
  /** Names taken out of projects and experience (local dev console only). */
  replaced: ReplacedName[];
  partial: ResumeStepName[];
  skipped: SkippedStep[];
  suggestions: Suggestions;
};

// resume@2: wider headings and entry blocks change what every step reads.
export const PIPELINE_VERSION = "resume@2";
/** The default per-call timeout; a step can set its own (projects and experience: 14 s). */
export const STEP_TIMEOUT_MS = 10_000;
export const PIPELINE_DEADLINE_MS = 25_000;

const STEPS = [
  basicsStep,
  jobTypesStep,
  skillsStep,
  projectsStep,
  experienceStep,
] as const;

/**
 * The cache key stored as import_jobs.pipeline_version: everything that
 * changes the output (pipeline, prompt versions, models), so a
 * change to any of them misses the cache.
 */
export function resumeCacheKey(env: {
  VERTEX_MODEL_FAST: string;
  VERTEX_MODEL_SMART: string;
}): string {
  return [
    PIPELINE_VERSION,
    ...STEPS.map((s) => s.version),
    env.VERTEX_MODEL_FAST,
    env.VERTEX_MODEL_SMART,
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
    projectBlocks: splitEntries(sections.projects, "projects", { headed }),
    experienceBlocks: splitEntries(sections.experience, "experience", {
      headed,
    }),
  };
}

export async function runResumePipeline(
  text: string,
  deps: {
    llm: LlmClient;
    models: { fast: string; smart: string };
    onAttempt?: (
      step: ResumeStepName,
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

  // A step with nothing to read (no Projects heading, no Experience section) sends no request.
  const skipped: SkippedStep[] = [];
  const running: StepSpec<unknown>[] = [];
  for (const step of STEPS as readonly StepSpec<unknown>[]) {
    const reason = step.skip?.(input) ?? null;
    if (reason) skipped.push({ step: step.name, reason });
    else running.push(step);
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
    step: StepSpec<unknown>,
    model: string,
    attempts: AttemptRecord[],
  ) => {
    for (const a of attempts)
      deps.onAttempt?.(step.name, step.version, a, model);
  };

  let settled: PromiseSettledResult<unknown>[];
  try {
    settled = await Promise.allSettled(
      running.map(async (step) => {
        const model = deps.models[step.model];
        const t0 = Date.now();
        try {
          const res = await deps.llm.generateStructured({
            model,
            system: step.system,
            prompt: step.buildPrompt(input),
            schema: step.schemaFor ? step.schemaFor(input) : step.schema,
            maxOutputTokens: step.maxOutputTokens,
            timeoutMs: step.timeoutMs ?? STEP_TIMEOUT_MS,
            retries: 1,
            temperature: 0,
            thinking: step.thinking,
            signal: deadline.signal,
          });
          report(step, model, res.attempts);
          deps.onStepResult?.({
            step: step.name,
            model,
            ms: Date.now() - t0,
            attempts: res.attempts,
            output: res.data,
          });
          return res.data;
        } catch (e) {
          if (e instanceof LlmError) report(step, model, e.attempts);
          deps.onStepResult?.({
            step: step.name,
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

  const partial: ResumeStepName[] = [];
  const out: Record<string, unknown> = {};
  settled.forEach((r, i) => {
    const step = running[i]!;
    if (r.status === "fulfilled") out[step.name] = r.value;
    else partial.push(step.name);
  });

  // Only the steps that ran count: a skipped step isn't a failure.
  if (partial.length === running.length) {
    const quota = settled.some(
      (r) =>
        r.status === "rejected" &&
        r.reason instanceof LlmError &&
        r.reason.kind === "quota_exhausted",
    );
    throw quota
      ? new JobError("LLM_BUSY", true, "the model quota is exhausted")
      : new JobError("LLM_FAILED", true, "every resume step failed");
  }

  const dropped: DroppedItem[] = [];
  const replaced: ReplacedName[] = [];
  const skippedNames = skipped.map((s) => s.step);
  const suggestions = mergeResumeSteps(
    {
      basics: out.basics as BasicsOutput | undefined,
      jobTypes: out.jobTypes as JobTypesOutput | undefined,
      skills: out.skills as SkillsOutput | undefined,
      projects: out.projects as ProjectsOutput | undefined,
      experience: out.experience as ExperienceOutput | undefined,
    },
    {
      ...input,
      githubUsername: null,
      pipelineVersion: PIPELINE_VERSION,
      promptVersions: Object.fromEntries(STEPS.map((s) => [s.name, s.version])),
      partial,
      skipped: skippedNames,
      dropped,
      replaced,
    },
  );
  deps.onMerge?.({ dropped, replaced, partial, skipped, suggestions });
  return { suggestions, partial, skipped: skippedNames };
}
