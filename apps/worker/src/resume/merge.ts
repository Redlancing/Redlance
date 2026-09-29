import {
  LIMITS,
  SKILL_BY_ID,
  findSkill,
  isCountryCode,
  isUsableSkillName,
  normalizeSkillName,
  suggestionsSchema,
  type ResumeStepName,
  type Suggestions,
} from "@redlance/core";
import { hasEvidence, hasSkillEvidence } from "./evidence";
import { skillLabelOccurs } from "./prepass";
import type { ResumeSections } from "./sections";
import type { BasicsOutput, JobTypesOutput, SkillsOutput } from "./step-types";

type Level = "core" | "secondary";

export function mergeResumeSteps(
  steps: {
    basics?: BasicsOutput;
    jobTypes?: JobTypesOutput;
    skills?: SkillsOutput;
  },
  ctx: {
    text: string;
    sections: ResumeSections;
    shortlist: string[];
    yearsExperience: number | null;
    githubUsername: string | null;
    pipelineVersion: string;
    promptVersions: Record<ResumeStepName, string>;
    partial: ResumeStepName[];
  },
): Suggestions {
  const basics: Record<string, unknown> = {};
  const displayName = steps.basics?.displayName?.trim().slice(0, LIMITS.displayName);
  if (displayName) basics.displayName = displayName;
  const headline = steps.basics?.headline?.trim().slice(0, LIMITS.headline);
  if (headline) basics.headline = headline;
  const country = steps.basics?.country?.trim().toUpperCase();
  if (country && isCountryCode(country)) basics.country = country;

  const categories: string[] = [];
  for (const c of steps.jobTypes?.categories ?? []) {
    if (
      hasEvidence(ctx.text, c.evidence) &&
      !categories.includes(c.id) &&
      categories.length < LIMITS.categories
    )
      categories.push(c.id);
  }
  if (categories.length) basics.categories = categories;

  const y = ctx.yearsExperience;
  const level =
    y !== null
      ? y < 1
        ? "beginner"
        : y <= 3
          ? "intermediate"
          : "experienced"
      : steps.jobTypes?.experienceLevel;
  if (level) basics.experienceLevel = level;

  const shortlist = new Set(ctx.shortlist);
  const skills = new Map<string, Level>();
  const custom = new Map<string, { name: string; level: Level }>();
  const add = (id: string, lvl: Level) => {
    const have = skills.get(id);
    if (!have || lvl === "core") skills.set(id, lvl);
  };

  for (const sk of steps.skills?.skills ?? []) {
    const known = SKILL_BY_ID.get(sk.id);
    if (!known || known.retired) continue;
    if (
      hasSkillEvidence(ctx.text, sk.evidence, [known.name, ...known.aliases]) ||
      (shortlist.has(sk.id) && skillLabelOccurs(known, ctx.sections.skills))
    )
      add(sk.id, sk.level);
  }
  for (const c of steps.skills?.customSkills ?? []) {
    const known = findSkill(c.name);
    const labels = known ? [known.name, ...known.aliases, c.name] : [c.name];
    if (!hasSkillEvidence(ctx.text, c.evidence, labels)) continue;
    if (known) {
      if (!known.retired) add(known.id, c.level);
      continue;
    }
    const name = c.name.trim();
    if (!isUsableSkillName(name)) continue;
    const key = normalizeSkillName(name);
    const have = custom.get(key);
    if (!have) custom.set(key, { name, level: c.level });
    else if (c.level === "core") have.level = "core";
  }

  let core = 0;
  const cap = (lvl: Level): Level => {
    if (lvl !== "core") return lvl;
    core += 1;
    return core > LIMITS.coreSkills ? "secondary" : "core";
  };
  const skillList = [...skills]
    .slice(0, LIMITS.totalSkills)
    .map(([id, lvl]) => ({ id, level: cap(lvl) }));
  const customList = [...custom.values()]
    .slice(0, Math.min(10, LIMITS.totalSkills - skillList.length))
    .map((c) => ({ name: c.name, level: cap(c.level) }));

  return suggestionsSchema.parse({
    v: 1,
    meta: {
      pipelineVersion: ctx.pipelineVersion,
      promptVersions: ctx.promptVersions,
      partial: ctx.partial,
    },
    basics,
    skills: skillList,
    customSkills: customList,
    githubUsername: ctx.githubUsername,
  });
}
