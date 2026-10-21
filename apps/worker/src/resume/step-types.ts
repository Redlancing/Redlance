import {
  CATEGORY_IDS,
  DOMAIN_IDS,
  EXPERIENCE_LEVELS,
  PROJECT_KINDS,
  PROJECT_ROLES,
  ROLE_EMPLOYMENT_TYPES,
  WORK_LIMITS,
} from "@redlance/core";
import { z } from "zod";
import { MAX_GENERIC_CHARS, MAX_NAME_CHARS } from "./names";

/**
 * Vertex doesn't enforce `maxLength`, so a string over its real limit must never fail a call.
 * The schema only rejects runaway output (4x the limit, at least 300 characters); merge.ts
 * checks the full text and then trims it to the real limit with `fit()`. The real limits are
 * stated in the prompts.
 */
export const safetyMax = (max: number) => Math.max(4 * max, 300);
const text = (max: number) => z.string().max(safetyMax(max));

const level = z.enum(["core", "secondary"]);

export const basicsOutput = z.object({
  displayName: text(60).nullable(),
  headline: text(120).nullable(),
  country: z.string().length(2).nullable(),
});

export const jobTypesOutput = z.object({
  categories: z
    .array(z.object({ id: z.enum(CATEGORY_IDS), evidence: text(160) }))
    .max(3),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable(),
});

export const skillsOutput = z.object({
  skills: z
    .array(z.object({ id: z.string(), level, evidence: text(160) }))
    .max(30),
});

/** The profile call: basics and job types in one answer. */
export const profileOutput = basicsOutput.extend(jobTypesOutput.shape);

export type BasicsOutput = z.infer<typeof basicsOutput>;
export type JobTypesOutput = z.infer<typeof jobTypesOutput>;
export type SkillsOutput = z.infer<typeof skillsOutput>;
export type ProfileOutput = z.infer<typeof profileOutput>;

// ---------- projects and experience (built per call) ----------

/**
 * Client names the model found, each with a generic phrase: on a copied line, the names in
 * that line; on an entry, the names in its title and summary. Code applies every name of an
 * entry to every one of its text fields.
 */
const clientNames = z
  .array(
    z.object({
      name: text(MAX_NAME_CHARS),
      generic: text(MAX_GENERIC_CHARS),
    }),
  )
  .max(4);
/** A line copied word for word from its block (an outcome or a highlight). */
const copiedLine = z.object({
  text: text(WORK_LIMITS.entrySummary),
  clientNames,
});

const tags = {
  categories: z.array(z.enum(CATEGORY_IDS)).max(WORK_LIMITS.entryCategories),
  domains: z.array(z.enum(DOMAIN_IDS)).max(WORK_LIMITS.domains),
};

/**
 * An entry's first and last line number in its section. Only whole numbers are checked here:
 * the per-call bounds (1..line count) are a hint in the JSON schema (`.meta`), not a zod
 * check, so an answer past them never fails the call. merge.ts checks every range.
 */
const lineNumber = (max?: number) =>
  max === undefined ? z.int() : z.int().meta({ minimum: 1, maximum: max });
const lineRange = (max?: number) =>
  z.object({ from: lineNumber(max), to: lineNumber(max) });

const projectItem = z.object({
  lines: lineRange(),
  title: text(WORK_LIMITS.entryTitle),
  summary: text(WORK_LIMITS.entrySummary),
  role: z.enum(PROJECT_ROLES),
  kind: z.enum(PROJECT_KINDS),
  skills: z.array(z.string()).max(WORK_LIMITS.entrySkills),
  ...tags,
  outcomes: z.array(copiedLine).max(WORK_LIMITS.outcomes),
  clientNames,
});

const roleItem = z.object({
  lines: lineRange(),
  title: text(WORK_LIMITS.entryTitle),
  organisation: text(WORK_LIMITS.organisation).nullable(),
  organisationDescription: text(WORK_LIMITS.orgDescription),
  employmentType: z.enum(ROLE_EMPLOYMENT_TYPES),
  summary: text(WORK_LIMITS.entrySummary),
  highlights: z.array(copiedLine).max(WORK_LIMITS.highlights),
  skills: z.array(z.string()).max(WORK_LIMITS.entrySkills),
  ...tags,
  clientNames,
});

export type ProjectsOutput = {
  projects: z.infer<typeof projectItem>[];
};
export type ExperienceOutput = {
  experience: z.infer<typeof roleItem>[];
};
export type CopiedLine = z.infer<typeof copiedLine>;

/** The work call's answer: only the lists that ran for this resume. */
export type WorkOutput = Partial<ProjectsOutput & ExperienceOutput>;

/**
 * Skill ids are an enum of the shortlist (like `outputSchemaFor` in ingest/analyse-post.ts),
 * so the model can't name a skill outside it; line numbers carry their section's bounds as
 * a hint. Only called for a list with at least one line (the list is left out otherwise).
 */
function perCall(lineCount: number, shortlist: string[]) {
  return {
    lines: lineRange(lineCount),
    skills: shortlist.length
      ? z
          .array(z.enum(shortlist as [string, ...string[]]))
          .max(WORK_LIMITS.entrySkills)
      : z.array(z.string()).max(0),
  };
}

/**
 * The work call's schema: a `projects` list when the Projects section has lines, an
 * `experience` list when the Experience section has lines (0: the list is left out).
 *
 * The two outer lists have no `.max()`: Vertex answers 400 INVALID_ARGUMENT to a schema with
 * `maxItems` on a list whose items hold lists with their own `maxItems` (it took every
 * projects call down, 2026-10-21). The prompt asks for at most 8 / 6 and merge.ts cuts to
 * WORK_LIMITS.projects / WORK_LIMITS.roles ("over the limit of N"). The nested limits stay.
 * step-types.test.ts guards this.
 */
export function workSchemaFor(
  projectLines: number,
  experienceLines: number,
  shortlist: string[],
): z.ZodType<WorkOutput> {
  return z.object({
    ...(projectLines > 0
      ? {
          projects: z.array(
            projectItem.extend(perCall(projectLines, shortlist)),
          ),
        }
      : {}),
    ...(experienceLines > 0
      ? {
          experience: z.array(
            roleItem.extend(perCall(experienceLines, shortlist)),
          ),
        }
      : {}),
  }) as z.ZodType<WorkOutput>;
}
