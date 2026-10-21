import { describe, expect, it } from "vitest";
import {
  aggregate,
  percentile,
  score,
  type Expected,
  type Suggested,
} from "./score";

const expected: Expected = {
  categories: ["development", "design"],
  experienceLevel: "intermediate",
  mustSkills: ["react", "typescript", "figma", "nodejs"],
  maySkills: ["javascript"],
  mustNotSkills: ["unity"],
};

function sugg(over: {
  skills?: string[];
  categories?: string[];
  level?: string;
}): Suggested {
  return {
    basics: {
      categories: over.categories,
      experienceLevel: over.level,
    },
    skills: (over.skills ?? []).map((id) => ({ id, level: "core" })),
  };
}

describe("score", () => {
  it("computes precision and recall", () => {
    const r = score(
      expected,
      sugg({ skills: ["react", "typescript", "javascript", "python"] }),
    );
    // 3 of 4 suggested are must/may; 2 of 4 must found.
    expect(r.skillPrecision).toBeCloseTo(0.75);
    expect(r.skillRecall).toBeCloseTo(0.5);
  });

  it("perfect run", () => {
    const r = score(
      expected,
      sugg({
        skills: ["react", "typescript", "figma", "nodejs"],
        categories: ["design", "development"],
        level: "intermediate",
      }),
    );
    expect(r).toMatchObject({
      skillPrecision: 1,
      skillRecall: 1,
      categoryAccuracy: 1,
      levelCorrect: true,
      mustNotViolations: [],
    });
  });

  it("category accuracy is the Jaccard overlap", () => {
    const r = score(expected, sugg({ categories: ["development", "video"] }));
    expect(r.categoryAccuracy).toBeCloseTo(1 / 3);
  });

  it("missing basics count as wrong", () => {
    const r = score(expected, sugg({}));
    expect(r.categoryAccuracy).toBe(0);
    expect(r.levelCorrect).toBe(false);
    expect(r.skillPrecision).toBe(1);
    expect(r.skillRecall).toBe(0);
  });

  it("reports must-not violations", () => {
    const r = score(
      { ...expected, mustNotSkills: ["unity", "Kubernetes"] },
      sugg({ skills: ["unity", "react", "kubernetes"] }),
    );
    expect(r.mustNotViolations.sort()).toEqual(["Kubernetes", "unity"]);
  });

  it("handles empty must lists", () => {
    const r = score(
      {
        categories: ["admin"],
        experienceLevel: "beginner",
        mustSkills: [],
        mustNotSkills: [],
      },
      sugg({}),
    );
    expect(r.skillRecall).toBe(1);
    expect(r.skillPrecision).toBe(1);
  });
});

describe("aggregate", () => {
  it("averages and sums", () => {
    const a = score(
      expected,
      sugg({
        skills: ["react"],
        categories: ["design", "development"],
        level: "intermediate",
      }),
    );
    const b = score(expected, sugg({ skills: ["unity"] }));
    const t = aggregate([a, b]);
    expect(t.levelAccuracy).toBe(0.5);
    expect(t.mustNotViolations).toBe(1);
    expect(t.categoryAccuracy).toBeCloseTo(0.5);
  });
});

describe("percentile", () => {
  it("picks the nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 1)).toBe(5);
    expect(percentile([], 0.5)).toBe(0);
  });
});
