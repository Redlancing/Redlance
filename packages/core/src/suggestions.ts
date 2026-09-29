import { z } from "zod";
import { isCountryCode } from "./countries";
import {
  EXPERIENCE_LEVELS,
  GITHUB_RESERVED,
  GITHUB_USERNAME_RE,
  LIMITS,
  SKILL_LEVELS,
  STEP_SCHEMAS,
  isUsableSkillName,
  type StepDraft,
} from "./onboarding";
import {
  CATEGORY_IDS,
  SKILL_BY_ID,
  findSkill,
  normalizeSkillName,
} from "./taxonomy";

export const RESUME_STEP_NAMES = ["basics", "jobTypes", "skills"] as const;
export type ResumeStepName = (typeof RESUME_STEP_NAMES)[number];

const MAX_CUSTOM = 10;

const skillLevel = z.enum(SKILL_LEVELS);

const basicsSuggestion = z.strictObject({
  displayName: z.string().trim().max(LIMITS.displayName).optional(),
  headline: z.string().trim().max(LIMITS.headline).optional(),
  categories: z
    .array(z.enum(CATEGORY_IDS))
    .min(1)
    .max(LIMITS.categories)
    .refine((c) => new Set(c).size === c.length, "Each job type once.")
    .optional(),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
  country: z.string().refine(isCountryCode, "Unknown country.").optional(),
});

export const suggestionsSchema = z.strictObject({
  v: z.literal(1),
  meta: z
    .strictObject({
      pipelineVersion: z.string(),
      promptVersions: z.record(z.string(), z.string()),
      partial: z.array(z.enum(RESUME_STEP_NAMES)),
    })
    .optional(),
  basics: basicsSuggestion.default({}),
  skills: z
    .array(
      z.strictObject({
        id: z.string().refine((id) => SKILL_BY_ID.has(id), "Unknown skill."),
        level: skillLevel,
      }),
    )
    .max(LIMITS.totalSkills)
    .refine((s) => new Set(s.map((x) => x.id)).size === s.length, "Unique ids.")
    .default([]),
  customSkills: z
    .array(
      z.strictObject({
        name: z
          .string()
          .trim()
          .min(1)
          .max(LIMITS.customSkillName)
          .refine(isUsableSkillName, "Use letters or numbers."),
        level: skillLevel,
      }),
    )
    .max(MAX_CUSTOM)
    .default([]),
  githubUsername: z
    .string()
    .regex(GITHUB_USERNAME_RE)
    .refine((n) => !GITHUB_RESERVED.has(n.toLowerCase()))
    .nullable()
    .default(null),
});
export type Suggestions = z.output<typeof suggestionsSchema>;

export type SuggestionSource = "resume" | "github";
type Level = "core" | "secondary";

export type MergedSuggestions = {
  basics: Suggestions["basics"];
  skills: { id: string; level: Level; source: SuggestionSource }[];
  customSkills: { name: string; level: Level; source: SuggestionSource }[];
  githubUsername: string | null;
};

/** Merges suggestions from several sources; earlier parts win ties (pass resume first, then GitHub). */
export function mergeSuggestions(
  parts: { source: SuggestionSource; suggestions: Suggestions }[],
): MergedSuggestions {
  const basics: Record<string, unknown> = {};
  const skills = new Map<
    string,
    { id: string; level: Level; source: SuggestionSource }
  >();
  const custom = new Map<
    string,
    { name: string; level: Level; source: SuggestionSource }
  >();
  let githubUsername: string | null = null;

  for (const { source, suggestions } of parts) {
    for (const [key, value] of Object.entries(suggestions.basics))
      if (value !== undefined && !(key in basics)) basics[key] = value;
    for (const sk of suggestions.skills) {
      const have = skills.get(sk.id);
      if (!have) skills.set(sk.id, { ...sk, source });
      else if (sk.level === "core") have.level = "core";
    }
    for (const sk of suggestions.customSkills) {
      const key = normalizeSkillName(sk.name);
      const have = custom.get(key);
      if (!have) custom.set(key, { ...sk, source });
      else if (sk.level === "core") have.level = "core";
    }
    githubUsername ??= suggestions.githubUsername;
  }

  const customList = [...custom.values()]
    .filter((c) => {
      const known = findSkill(c.name);
      return !(known && skills.has(known.id));
    })
    .slice(0, MAX_CUSTOM);

  // Cap core skills across both lists in order, then the total.
  let core = 0;
  const cap = <T extends { level: Level }>(list: T[]): T[] =>
    list.map((x) => {
      if (x.level !== "core") return x;
      core += 1;
      return core > LIMITS.coreSkills
        ? { ...x, level: "secondary" as const }
        : x;
    });
  const cappedSkills = cap([...skills.values()]).slice(0, LIMITS.totalSkills);
  const cappedCustom = cap(customList).slice(
    0,
    LIMITS.totalSkills - cappedSkills.length,
  );

  return {
    basics: basics as Suggestions["basics"],
    skills: cappedSkills,
    customSkills: cappedCustom,
    githubUsername,
  };
}

export function suggestedStepData(
  step: "import",
  m: MergedSuggestions,
): StepDraft<"import">;
export function suggestedStepData(
  step: "basics",
  m: MergedSuggestions,
): StepDraft<"basics">;
export function suggestedStepData(
  step: "skills",
  m: MergedSuggestions,
): StepDraft<"skills">;
export function suggestedStepData(
  step: "import" | "basics" | "skills",
  m: MergedSuggestions,
) {
  switch (step) {
    case "import":
      return STEP_SCHEMAS.import.draft.parse({
        githubUsername: m.githubUsername,
      });
    case "basics":
      return STEP_SCHEMAS.basics.draft.parse({
        displayName: m.basics.displayName,
        headline: m.basics.headline,
        categories: m.basics.categories,
        experienceLevel: m.basics.experienceLevel,
        country: m.basics.country,
        timeZone: null,
      });
    case "skills":
      return STEP_SCHEMAS.skills.draft.parse({
        skills: m.skills,
        customSkills: m.customSkills,
      });
  }
}
