import type { NewPostAnalysis } from "@redlance/db";

// Scoring for the post-analysis eval. Each expected field is optional: a post is only scored
// on the fields its label states.

export type ExpectedPost = {
  kind: "hiring" | "for_hire" | "other";
  payType?: string;
  /** Any of these is right (freelance vs contract is often a judgement call). */
  employmentType?: string[];
  /** Every one must be among the predicted categories. */
  categories?: string[];
  mustSkills?: string[];
  /** null = no budget should be extracted. */
  budget?: { min: number; max: number; currency: string; unit: string } | null;
  remote?: string;
  deadline?: string;
  mustRedFlags?: string[];
};

export type LabelledPost = {
  name: string;
  community: string;
  title: string;
  body: string;
  expected: ExpectedPost;
};

export const FIELDS = [
  "kind",
  "payType",
  "employmentType",
  "categories",
  "skills",
  "budget",
  "remote",
  "deadline",
  "redFlags",
] as const;
export type Field = (typeof FIELDS)[number];

/** Per field: true/false when the label covers it, absent when it doesn't. */
export type PostScore = Partial<Record<Field, boolean>>;

export function scorePost(e: ExpectedPost, got: NewPostAnalysis): PostScore {
  const s: PostScore = { kind: got.kind === e.kind };
  if (e.payType) s.payType = got.payType === e.payType;
  if (e.employmentType)
    s.employmentType = e.employmentType.includes(got.employmentType);
  if (e.categories)
    s.categories = e.categories.every((c) => got.categories.includes(c));
  if (e.mustSkills)
    s.skills = e.mustSkills.every((k) => got.skillIds.includes(k));
  if (e.budget === null)
    s.budget = got.budgetMin === null && got.budgetMax === null;
  else if (e.budget)
    s.budget =
      got.budgetMin === e.budget.min &&
      got.budgetMax === e.budget.max &&
      got.currency === e.budget.currency &&
      got.budgetUnit === e.budget.unit;
  if (e.remote) s.remote = got.remote === e.remote;
  if (e.deadline) s.deadline = got.deadline === e.deadline;
  if (e.mustRedFlags)
    s.redFlags = e.mustRedFlags.every((f) => got.redFlags.includes(f as never));
  return s;
}

export function accuracy(
  scores: PostScore[],
): Record<Field, { right: number; total: number }> {
  const out = Object.fromEntries(
    FIELDS.map((f) => [f, { right: 0, total: 0 }]),
  ) as Record<Field, { right: number; total: number }>;
  for (const s of scores)
    for (const f of FIELDS)
      if (s[f] !== undefined) {
        out[f].total++;
        if (s[f]) out[f].right++;
      }
  return out;
}

/** The bar from the plan (Phase 3): kind ≥ 95%, pay type ≥ 90%, categories ≥ 90%. */
export const BAR: Partial<Record<Field, number>> = {
  kind: 0.95,
  payType: 0.9,
  categories: 0.9,
};
