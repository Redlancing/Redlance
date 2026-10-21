import { z } from "zod";
import { isCountryCode } from "./countries";
import {
  EXPERIENCE_LEVELS,
  GITHUB_RESERVED,
  GITHUB_USERNAME_RE,
  LIMITS,
  SKILL_LEVELS,
  STEP_SCHEMAS,
  withoutCustomSkills,
  type StepDraft,
} from "./onboarding";
import { CATEGORY_IDS, SKILL_BY_ID } from "./taxonomy";
import {
  WORK_LIMITS,
  experienceSuggestion,
  projectSuggestion,
  type ExperienceSuggestion,
  type ProjectSuggestion,
} from "./work";

export const RESUME_STEP_NAMES = [
  "basics",
  "jobTypes",
  "skills",
  "projects",
  "experience",
] as const;
export type ResumeStepName = (typeof RESUME_STEP_NAMES)[number];

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

// v2 (2026-10-17) added projects and experience. v1 results are refused, not upgraded:
// there is no real data to keep (projects-experience-design.md, "Older imports").
// Custom skills were removed (2026-10-21); results stored before then may still carry a
// `customSkills` key, which is dropped (still v2, so old imports keep pre-filling).
export const suggestionsSchema = z.preprocess(
  withoutCustomSkills,
  z.strictObject({
    v: z.literal(2),
    meta: z
      .strictObject({
        pipelineVersion: z.string(),
        promptVersions: z.record(z.string(), z.string()),
        partial: z.array(z.enum(RESUME_STEP_NAMES)),
        // Steps that didn't run (their section had no text), as opposed to steps that failed.
        skipped: z.array(z.enum(RESUME_STEP_NAMES)).default([]),
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
      .refine(
        (s) => new Set(s.map((x) => x.id)).size === s.length,
        "Unique ids.",
      )
      .default([]),
    githubUsername: z
      .string()
      .regex(GITHUB_USERNAME_RE)
      .refine((n) => !GITHUB_RESERVED.has(n.toLowerCase()))
      .nullable()
      .default(null),
    // Only resume imports fill these; GitHub imports leave them empty.
    projects: z.array(projectSuggestion).max(WORK_LIMITS.projects).default([]),
    experience: z
      .array(experienceSuggestion)
      .max(WORK_LIMITS.roles)
      .default([]),
  }),
);
export type Suggestions = z.output<typeof suggestionsSchema>;

export type SuggestionSource = "resume" | "github";
type Level = "core" | "secondary";

export type MergedSuggestions = {
  basics: Suggestions["basics"];
  skills: { id: string; level: Level; source: SuggestionSource }[];
  githubUsername: string | null;
  /** From the resume only. */
  projects: ProjectSuggestion[];
  experience: ExperienceSuggestion[];
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
  let githubUsername: string | null = null;
  // Projects and experience come only from the resume (never GitHub repos); the first resume wins.
  const resume = parts.find((p) => p.source === "resume")?.suggestions;

  for (const { source, suggestions } of parts) {
    for (const [key, value] of Object.entries(suggestions.basics))
      if (value !== undefined && !(key in basics)) basics[key] = value;
    for (const sk of suggestions.skills) {
      const have = skills.get(sk.id);
      if (!have) skills.set(sk.id, { ...sk, source });
      else if (sk.level === "core") have.level = "core";
    }
    githubUsername ??= suggestions.githubUsername;
  }

  // Cap core skills in order, then the total.
  let core = 0;
  const cappedSkills = [...skills.values()]
    .map((x) => {
      if (x.level !== "core") return x;
      core += 1;
      return core > LIMITS.coreSkills
        ? { ...x, level: "secondary" as const }
        : x;
    })
    .slice(0, LIMITS.totalSkills);

  return {
    basics: basics as Suggestions["basics"],
    skills: cappedSkills,
    githubUsername,
    projects: resume?.projects ?? [],
    experience: resume?.experience ?? [],
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
  step: "work",
  m: MergedSuggestions,
): StepDraft<"work">;
export function suggestedStepData(
  step: "import" | "basics" | "skills" | "work",
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
      return STEP_SCHEMAS.skills.draft.parse({ skills: m.skills });
    case "work":
      return STEP_SCHEMAS.work.draft.parse({
        projects: m.projects.map((p) => ({
          ...p,
          source: "resume",
          hidden: false,
        })),
        experience: m.experience.map((r) => ({
          ...r,
          source: "resume",
          hidden: false,
        })),
      });
  }
}
