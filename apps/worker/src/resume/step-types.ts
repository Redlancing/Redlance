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

const level = z.enum(["core", "secondary"]);

export const basicsOutput = z.object({
  displayName: z.string().max(60).nullable(),
  headline: z.string().max(120).nullable(),
  country: z.string().length(2).nullable(),
});

export const jobTypesOutput = z.object({
  categories: z
    .array(
      z.object({ id: z.enum(CATEGORY_IDS), evidence: z.string().max(160) }),
    )
    .max(3),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable(),
});

export const skillsOutput = z.object({
  skills: z
    .array(z.object({ id: z.string(), level, evidence: z.string().max(160) }))
    .max(30),
  customSkills: z
    .array(
      z.object({
        name: z.string().max(40),
        level,
        evidence: z.string().max(160),
      }),
    )
    .max(10),
});

export type BasicsOutput = z.infer<typeof basicsOutput>;
export type JobTypesOutput = z.infer<typeof jobTypesOutput>;
export type SkillsOutput = z.infer<typeof skillsOutput>;

// ---------- projects and experience (built per call) ----------

/**
 * Client names the model found, each with a generic phrase: on a copied line, the names in
 * that line; on an entry, the names in its title and summary. Code applies every name of an
 * entry to every one of its text fields.
 */
const clientNames = z
  .array(
    z.object({
      name: z.string().max(MAX_NAME_CHARS),
      generic: z.string().max(MAX_GENERIC_CHARS),
    }),
  )
  .max(4);
/** A line copied word for word from its block (an outcome or a highlight). */
const copiedLine = z.object({
  text: z.string().max(WORK_LIMITS.entrySummary),
  clientNames,
});

const tags = {
  categories: z.array(z.enum(CATEGORY_IDS)).max(WORK_LIMITS.entryCategories),
  domains: z.array(z.enum(DOMAIN_IDS)).max(WORK_LIMITS.domains),
};

const projectItem = z.object({
  block: z.string(),
  title: z.string().max(WORK_LIMITS.entryTitle),
  summary: z.string().max(WORK_LIMITS.entrySummary),
  role: z.enum(PROJECT_ROLES),
  kind: z.enum(PROJECT_KINDS),
  skills: z.array(z.string()).max(WORK_LIMITS.entrySkills),
  ...tags,
  outcomes: z.array(copiedLine).max(WORK_LIMITS.outcomes),
  clientNames,
});

const roleItem = z.object({
  block: z.string(),
  title: z.string().max(WORK_LIMITS.entryTitle),
  organisation: z.string().max(WORK_LIMITS.organisation).nullable(),
  organisationDescription: z.string().max(WORK_LIMITS.orgDescription),
  employmentType: z.enum(ROLE_EMPLOYMENT_TYPES),
  summary: z.string().max(WORK_LIMITS.entrySummary),
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

/**
 * Block ids and skill ids are enums of what this call allows (like `outputSchemaFor` in
 * ingest/analyse-post.ts), so the model can't point at a block that doesn't exist or a skill
 * outside the shortlist. Only called with at least one block (the step is skipped otherwise).
 */
function perCall(blockIds: string[], shortlist: string[]) {
  return {
    block: z.enum(blockIds as [string, ...string[]]),
    skills: shortlist.length
      ? z
          .array(z.enum(shortlist as [string, ...string[]]))
          .max(WORK_LIMITS.entrySkills)
      : z.array(z.string()).max(0),
  };
}

export function projectsSchemaFor(
  blockIds: string[],
  shortlist: string[],
): z.ZodType<ProjectsOutput> {
  return z.object({
    projects: z
      .array(projectItem.extend(perCall(blockIds, shortlist)))
      .max(WORK_LIMITS.projects),
  });
}

export function experienceSchemaFor(
  blockIds: string[],
  shortlist: string[],
): z.ZodType<ExperienceOutput> {
  return z.object({
    experience: z
      .array(roleItem.extend(perCall(blockIds, shortlist)))
      .max(WORK_LIMITS.roles),
  });
}
