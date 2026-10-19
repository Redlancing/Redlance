import { DOMAIN_IDS, SKILL_BY_ID } from "@redlance/core";
import { describe, expect, it } from "vitest";
import {
  DRAFT_CASE_COUNT,
  HARD_MINIMUMS,
  HARD_TAGS,
  REWRITE_CASE_COUNT,
  REWRITE_MINIMUMS,
  TYPE_MINIMUMS,
  loadCases,
  rewriteKind,
} from "./cases";
import { PROFILES, PROFILE_BY_ID } from "./profiles";

const { drafts, rewrites } = loadCases();
const withTag = (t: (typeof HARD_TAGS)[number]) =>
  drafts.filter((c) => c.tags.includes(t));

describe("draft eval cases (guard case 4)", () => {
  it("loads the starting set: 40 draft cases and 10 rewrite cases", () => {
    expect(drafts).toHaveLength(DRAFT_CASE_COUNT);
    expect(rewrites).toHaveLength(REWRITE_CASE_COUNT);
    const ids = [...drafts, ...rewrites].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("meets the job-type mix", () => {
    const count = (cat: string) =>
      drafts.filter((c) => c.analysis.categories[0] === cat).length;
    for (const [cat, min] of Object.entries(TYPE_MINIMUMS))
      expect(count(cat), cat).toBeGreaterThanOrEqual(min);
    const named = Object.keys(TYPE_MINIMUMS);
    const other = drafts.filter(
      (c) => !named.includes(c.analysis.categories[0]!),
    );
    expect(other.length).toBeGreaterThan(0);
  });

  it("meets every hard-case count", () => {
    for (const tag of HARD_TAGS)
      expect(withTag(tag).length, tag).toBeGreaterThanOrEqual(
        HARD_MINIMUMS[tag],
      );
  });

  it("meets the rewrite mix", () => {
    for (const [kind, min] of Object.entries(REWRITE_MINIMUMS))
      expect(
        rewrites.filter((r) => rewriteKind(r) === kind).length,
        kind,
      ).toBeGreaterThanOrEqual(min);
  });

  it("points every case at a real profile and every rewrite at a real draft case", () => {
    for (const c of drafts)
      expect(PROFILE_BY_ID.has(c.profileId), c.id).toBe(true);
    const ids = new Set(drafts.map((c) => c.id));
    for (const r of rewrites) expect(ids.has(r.baseCaseId), r.id).toBe(true);
  });

  it("uses every profile at least once, and the broad profile for the broad cases", () => {
    for (const p of PROFILES)
      expect(
        drafts.some((c) => c.profileId === p.id),
        p.id,
      ).toBe(true);
    for (const c of withTag("broad"))
      expect(c.profileId, c.id).toBe("broad-generalist");
  });

  it("keeps tags and analysis consistent", () => {
    for (const c of withTag("no_budget")) {
      expect(c.analysis.budgetMin, c.id).toBeNull();
      expect(c.analysis.budgetMax, c.id).toBeNull();
    }
    for (const c of withTag("dm_only"))
      expect(c.analysis.applyInstructions, c.id).toMatch(/dm|pm/i);
    for (const c of withTag("code_word"))
      expect(c.analysis.applyInstructions, c.id).toMatch(/word/i);
    for (const c of drafts) expect(c.analysis.kind).toBe("hiring");
  });

  it("uses known skills and domains", () => {
    for (const c of drafts)
      for (const s of c.analysis.skillIds)
        expect(SKILL_BY_ID.has(s), `${c.id}: ${s}`).toBe(true);
    for (const p of PROFILES) {
      for (const s of p.skills)
        expect(SKILL_BY_ID.has(s.skillId), s.skillId).toBe(true);
      for (const e of [...p.projects, ...p.experience]) {
        for (const s of e.skillIds)
          expect(SKILL_BY_ID.has(s), `${e.id}: ${s}`).toBe(true);
        for (const d of e.domains) expect(DOMAIN_IDS, e.id).toContain(d);
      }
    }
  });

  it("has no Reddit usernames or real emails in any case", () => {
    const text = JSON.stringify([drafts, rewrites]);
    expect(text).not.toMatch(/\bu\/[A-Za-z0-9_-]{3,}/);
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  });
});

describe("synthetic profiles", () => {
  it("follow the phase file", () => {
    expect(PROFILES).toHaveLength(5);
    const by = (id: string) => PROFILE_BY_ID.get(id)!;
    expect(by("web-dev").projects).toHaveLength(4);
    expect(by("web-dev").githubUsername).not.toBeNull();
    expect(by("video-editor").projects).toHaveLength(2);
    expect(by("video-editor").githubUsername).toBeNull();
    expect(by("junior-designer").projects).toHaveLength(1);
    expect(by("junior-designer").experience).toHaveLength(0);
    expect(by("senior-writer").mentionEmployers).toBe(false);
    expect(
      by("senior-writer").experience.some((r) => r.organisation !== null),
    ).toBe(true);
    expect(by("broad-generalist").skills.length).toBeLessThanOrEqual(1);
  });

  it("respect the database limits and the freelance-has-no-organisation rule", () => {
    for (const p of PROFILES) {
      expect(p.projects.length).toBeLessThanOrEqual(8);
      expect(p.experience.length).toBeLessThanOrEqual(6);
      for (const e of [...p.projects, ...p.experience]) {
        expect(e.title.length).toBeLessThanOrEqual(80);
        expect(e.summary.length).toBeLessThanOrEqual(160);
        expect(e.skillIds.length).toBeLessThanOrEqual(10);
      }
      for (const r of p.experience) {
        expect(r.organisationDescription.length).toBeLessThanOrEqual(60);
        if (r.employmentType === "freelance" || r.employmentType === "contract")
          expect(r.organisation, r.id).toBeNull();
      }
    }
  });
});
