import type { ResumeStepName, Suggestions } from "@redlance/core";
import { LlmError, type AttemptRecord, type LlmClient } from "@redlance/llm";
import { JobError } from "../jobs/types";
import { yearsOfExperience } from "./dates";
import { mergeResumeSteps } from "./merge";
import { skillShortlist } from "./prepass";
import { splitSections } from "./sections";
import type { BasicsOutput, JobTypesOutput, SkillsOutput } from "./step-types";
import { basicsStep } from "./steps/basics";
import { jobTypesStep } from "./steps/job-types";
import type { PipelineInput, StepSpec } from "./steps/shared";
import { skillsStep } from "./steps/skills";

export type { PipelineInput, StepSpec } from "./steps/shared";

export const PIPELINE_VERSION = "resume@1";
export const STEP_TIMEOUT_MS = 10_000;
export const PIPELINE_DEADLINE_MS = 20_000;

const STEPS = [basicsStep, jobTypesStep, skillsStep] as const;

/** The deterministic pre-pass (no model). GitHub is added by the job, not here. */
export function buildPipelineInput(text: string): PipelineInput {
  const sections = splitSections(text);
  return {
    text,
    sections,
    shortlist: skillShortlist(text, sections),
    yearsExperience: yearsOfExperience(sections.experience),
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
    deadlineMs?: number;
    signal?: AbortSignal;
  },
): Promise<{ suggestions: Suggestions; partial: ResumeStepName[] }> {
  const input = buildPipelineInput(text);

  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(),
    deps.deadlineMs ?? PIPELINE_DEADLINE_MS,
  );
  const onOuter = () => deadline.abort();
  if (deps.signal?.aborted) deadline.abort();
  else deps.signal?.addEventListener("abort", onOuter, { once: true });

  const report = (step: StepSpec<unknown>, model: string, attempts: AttemptRecord[]) => {
    for (const a of attempts) deps.onAttempt?.(step.name, step.version, a, model);
  };

  let settled: PromiseSettledResult<unknown>[];
  try {
    settled = await Promise.allSettled(
      (STEPS as readonly StepSpec<unknown>[]).map(async (step) => {
        const model = deps.models[step.model];
        try {
          const res = await deps.llm.generateStructured({
            model,
            system: step.system,
            prompt: step.buildPrompt(input),
            schema: step.schema,
            maxOutputTokens: step.maxOutputTokens,
            timeoutMs: STEP_TIMEOUT_MS,
            retries: 1,
            temperature: 0,
            thinking: step.thinking,
            signal: deadline.signal,
          });
          report(step, model, res.attempts);
          return res.data;
        } catch (e) {
          if (e instanceof LlmError) report(step, model, e.attempts);
          throw e;
        }
      }),
    );
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onOuter);
  }

  const partial: ResumeStepName[] = [];
  const out: Record<string, unknown> = {};
  settled.forEach((r, i) => {
    const step = STEPS[i]!;
    if (r.status === "fulfilled") out[step.name] = r.value;
    else partial.push(step.name);
  });

  if (partial.length === STEPS.length) {
    const quota = settled.some(
      (r) =>
        r.status === "rejected" &&
        r.reason instanceof LlmError &&
        r.reason.kind === "quota_exhausted",
    );
    throw quota
      ? new JobError("LLM_BUSY", false, "the model quota is exhausted")
      : new JobError("LLM_FAILED", true, "every resume step failed");
  }

  const suggestions = mergeResumeSteps(
    {
      basics: out.basics as BasicsOutput | undefined,
      jobTypes: out.jobTypes as JobTypesOutput | undefined,
      skills: out.skills as SkillsOutput | undefined,
    },
    {
      ...input,
      githubUsername: null,
      pipelineVersion: PIPELINE_VERSION,
      promptVersions: {
        basics: basicsStep.version,
        jobTypes: jobTypesStep.version,
        skills: skillsStep.version,
      },
      partial,
    },
  );
  return { suggestions, partial };
}
