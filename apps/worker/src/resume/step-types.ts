import { CATEGORY_IDS, EXPERIENCE_LEVELS } from "@redlance/core";
import { z } from "zod";

const level = z.enum(["core", "secondary"]);

export const basicsOutput = z.object({
  displayName: z.string().max(60).nullable(),
  headline: z.string().max(120).nullable(),
  country: z.string().length(2).nullable(),
});

export const jobTypesOutput = z.object({
  categories: z
    .array(z.object({ id: z.enum(CATEGORY_IDS), evidence: z.string().max(160) }))
    .max(3),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable(),
});

export const skillsOutput = z.object({
  skills: z
    .array(z.object({ id: z.string(), level, evidence: z.string().max(160) }))
    .max(30),
  customSkills: z
    .array(
      z.object({ name: z.string().max(40), level, evidence: z.string().max(160) }),
    )
    .max(10),
});

export type BasicsOutput = z.infer<typeof basicsOutput>;
export type JobTypesOutput = z.infer<typeof jobTypesOutput>;
export type SkillsOutput = z.infer<typeof skillsOutput>;
