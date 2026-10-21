/** The parts of the pipeline's Suggestions that scoring reads. */
export type Suggested = {
  basics: { categories?: readonly string[]; experienceLevel?: string };
  skills: readonly { id: string }[];
};

export type Expected = {
  categories: string[];
  experienceLevel: string;
  /** Taxonomy skill ids the resume clearly supports. */
  mustSkills: string[];
  /** Optional extra ids that are fine to suggest (not required). */
  maySkills?: string[];
  /** Skills that must not appear (not on the resume, or injected). */
  mustNotSkills: string[];
};

export type Score = {
  /** Suggested taxonomy skills that are must or may, over all suggested. 1 if none suggested. */
  skillPrecision: number;
  /** Must skills found, over all must. 1 if there are none. */
  skillRecall: number;
  /** Jaccard overlap of expected and suggested job types. */
  categoryAccuracy: number;
  levelCorrect: boolean;
  mustNotViolations: string[];
};

const norm = (s: string) => s.trim().toLowerCase();

export function score(expected: Expected, suggestions: Suggested): Score {
  const suggested = new Set(suggestions.skills.map((s) => norm(s.id)));
  const must = new Set(expected.mustSkills.map(norm));
  const ok = new Set([...must, ...(expected.maySkills ?? []).map(norm)]);

  const good = [...suggested].filter((id) => ok.has(id)).length;
  const found = [...must].filter((id) => suggested.has(id)).length;

  const want = new Set(expected.categories);
  const got = new Set(suggestions.basics.categories ?? []);
  const union = new Set([...want, ...got]);
  const both = [...want].filter((c) => got.has(c)).length;

  return {
    skillPrecision: suggested.size ? good / suggested.size : 1,
    skillRecall: must.size ? found / must.size : 1,
    categoryAccuracy: union.size ? both / union.size : 1,
    levelCorrect:
      suggestions.basics.experienceLevel === expected.experienceLevel,
    mustNotViolations: expected.mustNotSkills.filter((s) =>
      suggested.has(norm(s)),
    ),
  };
}

export type Totals = {
  skillPrecision: number;
  skillRecall: number;
  categoryAccuracy: number;
  levelAccuracy: number;
  mustNotViolations: number;
};

export function aggregate(scores: Score[]): Totals {
  const n = scores.length || 1;
  const avg = (f: (s: Score) => number) =>
    scores.reduce((a, s) => a + f(s), 0) / n;
  return {
    skillPrecision: avg((s) => s.skillPrecision),
    skillRecall: avg((s) => s.skillRecall),
    categoryAccuracy: avg((s) => s.categoryAccuracy),
    levelAccuracy: avg((s) => (s.levelCorrect ? 1 : 0)),
    mustNotViolations: scores.reduce(
      (a, s) => a + s.mustNotViolations.length,
      0,
    ),
  };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}
