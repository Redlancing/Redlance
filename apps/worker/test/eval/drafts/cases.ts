import { readdirSync, readFileSync } from "node:fs";
import {
  BUDGET_UNITS,
  CATEGORY_IDS,
  EMPLOYMENT_TYPES,
  PAY_TYPES,
  POST_KINDS,
  RED_FLAGS,
  REMOTE_TYPES,
} from "@redlance/core";
import { z } from "zod";

/** Where the case files live: one JSON file per case, `cases/<id>.json`. */
export const CASES_DIR = new URL("./cases/", import.meta.url);

/** The hard-case tags a draft case can carry (see docs/drafts/plan/10-eval.md). */
export const HARD_TAGS = [
  "dm_only",
  "send_rate",
  "code_word",
  "no_budget",
  "below_min",
  "vague",
  "broad",
  "hinglish",
  "urgent",
  "injection",
] as const;
export type HardTag = (typeof HARD_TAGS)[number];

/** How many cases of each kind the eval must have at least. */
export const HARD_MINIMUMS: Record<HardTag, number> = {
  dm_only: 3,
  send_rate: 2,
  code_word: 1,
  no_budget: 3,
  below_min: 2,
  vague: 3,
  broad: 3,
  hinglish: 1,
  urgent: 2,
  injection: 0,
};

/** Minimum cases per job type (the category of the post), and the totals. */
export const TYPE_MINIMUMS = {
  development: 12,
  video: 8,
  design: 6,
  writing: 6,
} as const;
export const DRAFT_CASE_COUNT = 40;
export const REWRITE_CASE_COUNT = 10;
export const REWRITE_MINIMUMS = {
  shorter: 3,
  casual: 2,
  formal: 2,
  different_project: 1,
  custom: 2,
} as const;

const analysisSchema = z.object({
  kind: z.enum(POST_KINDS),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  payType: z.enum(PAY_TYPES),
  categories: z.array(z.enum(CATEGORY_IDS)).min(1).max(3),
  skillIds: z.array(z.string()),
  budgetMin: z.number().nullable(),
  budgetMax: z.number().nullable(),
  currency: z.string().nullable(),
  budgetUnit: z.enum(BUDGET_UNITS).nullable(),
  remote: z.enum(REMOTE_TYPES),
  location: z.string().nullable(),
  deadline: z.string().nullable(),
  redFlags: z.array(z.enum(RED_FLAGS)),
  summary: z.string().min(1),
  /** How the post says to apply, or null. The analyser's new field (<= 300 characters). */
  applyInstructions: z.string().max(300).nullable(),
});

export const draftCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Hard-case labels; the guard test counts these. */
  tags: z.array(z.enum(HARD_TAGS)),
  profileId: z.string(),
  post: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    subreddit: z.string().regex(/^[A-Za-z0-9_]{2,21}$/),
  }),
  analysis: analysisSchema,
  /** What the judge must check, one sentence each. */
  expect: z.array(z.string().min(1)).min(1),
});
export type DraftCase = z.infer<typeof draftCaseSchema>;
export type CaseAnalysis = z.infer<typeof analysisSchema>;

export const REWRITE_OPTIONS = [
  "shorter",
  "casual",
  "formal",
  "different_project",
] as const;

export const rewriteCaseSchema = z
  .object({
    id: z.string().regex(/^rw-[a-z0-9-]+$/),
    baseCaseId: z.string(),
    option: z.enum(REWRITE_OPTIONS).optional(),
    instruction: z.string().min(1).max(300).optional(),
    expect: z.array(z.string().min(1)).min(1),
  })
  .refine((c) => (c.option === undefined) !== (c.instruction === undefined), {
    message: "a rewrite case has exactly one of option and instruction",
  });
export type RewriteCase = z.infer<typeof rewriteCaseSchema>;

export type LoadedCases = { drafts: DraftCase[]; rewrites: RewriteCase[] };

/** Reads and validates every `cases/*.json`; rewrite cases are the files named `rw-*`. */
export function loadCases(dir: URL = CASES_DIR): LoadedCases {
  const drafts: DraftCase[] = [];
  const rewrites: RewriteCase[] = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const f of files) {
    const raw: unknown = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const id = f.slice(0, -".json".length);
    const parsed = f.startsWith("rw-")
      ? rewriteCaseSchema.parse(raw)
      : draftCaseSchema.parse(raw);
    if (parsed.id !== id)
      throw new Error(`${f}: id "${parsed.id}" must match the file name`);
    if ("baseCaseId" in parsed) rewrites.push(parsed);
    else drafts.push(parsed);
  }
  return { drafts, rewrites };
}

/** The kind of a rewrite case, as the rewrite flow names it. */
export const rewriteKind = (c: RewriteCase): keyof typeof REWRITE_MINIMUMS =>
  c.option ?? "custom";
