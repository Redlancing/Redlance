import type { GenerateRequest } from "@redlance/llm";
import { describe, expect, it } from "vitest";
import { SKILL_BY_ID } from "@redlance/core";
import { fakeResumeResponder, stepOf } from "./fake-llm";
import { hasEvidence, hasSkillEvidence } from "./resume/evidence";
import { buildPipelineInput } from "./resume/pipeline";
import { basicsStep } from "./resume/steps/basics";
import { jobTypesStep } from "./resume/steps/job-types";
import { skillsStep } from "./resume/steps/skills";
import type { StepSpec } from "./resume/steps/shared";

const TEXT = [
  "Sam Lee",
  "Video editor",
  "Skills",
  "Premiere Pro, After Effects, DaVinci Resolve",
  "Experience",
  "Edited YouTube videos and thumbnails for creators since 2021.",
].join("\n");

function request(step: StepSpec<unknown>): GenerateRequest<unknown> {
  return {
    model: "m",
    system: step.system,
    prompt: step.buildPrompt(buildPipelineInput(TEXT)),
    schema: step.schema,
    maxOutputTokens: step.maxOutputTokens,
    timeoutMs: 1000,
  };
}

describe("fakeResumeResponder", () => {
  it("answers each step with schema-valid output", () => {
    for (const step of [basicsStep, jobTypesStep, skillsStep] as StepSpec<unknown>[]) {
      const req = request(step);
      expect(stepOf(req)).toBe(step.name);
      const out = fakeResumeResponder(req);
      expect(() => step.schema.parse(out)).not.toThrow();
    }
  });

  it("builds deterministic output from the resume text", () => {
    expect(fakeResumeResponder(request(basicsStep as StepSpec<unknown>))).toEqual({
      displayName: "Sam Lee",
      headline: null,
      country: null,
    });
    const jobTypes = fakeResumeResponder(request(jobTypesStep as StepSpec<unknown>)) as {
      categories: { id: string; evidence: string }[];
    };
    expect(jobTypes.categories.map((c) => c.id)).toEqual(["video"]);
    const skills = fakeResumeResponder(request(skillsStep as StepSpec<unknown>)) as {
      skills: { id: string; evidence: string }[];
    };
    expect(skills.skills.map((s) => s.id)).toEqual(
      expect.arrayContaining(["premiere-pro", "after-effects"]),
    );
    for (const c of jobTypes.categories) expect(hasEvidence(TEXT, c.evidence)).toBe(true);
    for (const s of skills.skills) {
      const skill = SKILL_BY_ID.get(s.id)!;
      expect(hasSkillEvidence(TEXT, s.evidence, [skill.name, ...skill.aliases])).toBe(true);
    }
  });

  it("returns an empty object for an unknown request", () => {
    expect(
      fakeResumeResponder({ ...request(basicsStep as StepSpec<unknown>), prompt: "hello" }),
    ).toEqual({});
  });
});
