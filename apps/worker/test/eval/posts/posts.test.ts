import { readFileSync } from "node:fs";
import {
  BUDGET_UNITS,
  CATEGORY_IDS,
  EMPLOYMENT_TYPES,
  PAY_TYPES,
  POST_KINDS,
  RED_FLAGS,
  REMOTE_TYPES,
  SKILL_BY_ID,
} from "@redlance/core";
import { describe, expect, it } from "vitest";
import { accuracy, scorePost, type LabelledPost } from "./score";

const posts = JSON.parse(
  readFileSync(new URL("./posts.json", import.meta.url), "utf8"),
) as LabelledPost[];

describe("post eval fixtures", () => {
  it("are well-formed and use known values", () => {
    expect(new Set(posts.map((p) => p.name)).size).toBe(posts.length);
    for (const p of posts) {
      const e = p.expected;
      expect(POST_KINDS, p.name).toContain(e.kind);
      expect(p.community).toMatch(/^[a-z0-9_]{2,21}$/);
      if (e.payType) expect(PAY_TYPES).toContain(e.payType);
      for (const t of e.employmentType ?? [])
        expect(EMPLOYMENT_TYPES).toContain(t);
      for (const c of e.categories ?? []) expect(CATEGORY_IDS).toContain(c);
      for (const s of e.mustSkills ?? [])
        expect(SKILL_BY_ID.has(s), s).toBe(true);
      if (e.budget) expect(BUDGET_UNITS).toContain(e.budget.unit);
      if (e.remote) expect(REMOTE_TYPES).toContain(e.remote);
      for (const f of e.mustRedFlags ?? []) expect(RED_FLAGS).toContain(f);
    }
  });

  it("cover all 12 job types and the tricky cases", () => {
    const cats = new Set(posts.flatMap((p) => p.expected.categories ?? []));
    expect(cats.size).toBe(CATEGORY_IDS.length);
    const pays = new Set(posts.map((p) => p.expected.payType));
    for (const t of ["paid", "commission_only", "revshare", "unpaid"])
      expect(pays).toContain(t);
    for (const k of POST_KINDS)
      expect(posts.some((p) => p.expected.kind === k)).toBe(true);
  });
});

describe("scorePost", () => {
  it("scores only the labelled fields", () => {
    const got = {
      pipelineVersion: "post@1",
      kind: "hiring" as const,
      employmentType: "freelance" as const,
      payType: "paid" as const,
      categories: ["design"],
      skillIds: [],
      budgetMin: 150,
      budgetMax: 150,
      currency: "USD",
      budgetUnit: "fixed" as const,
      remote: "unknown" as const,
      location: null,
      deadline: null,
      redFlags: [],
      summary: "x",
      model: "m",
    };
    const s = scorePost(
      {
        kind: "hiring",
        categories: ["design"],
        budget: { min: 150, max: 150, currency: "USD", unit: "fixed" },
      },
      got,
    );
    expect(s).toEqual({ kind: true, categories: true, budget: true });
    expect(scorePost({ kind: "for_hire", budget: null }, got)).toEqual({
      kind: false,
      budget: false,
    });
    expect(accuracy([s]).kind).toEqual({ right: 1, total: 1 });
  });
});
