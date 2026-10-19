import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_IDS, EXPERIENCE_LEVELS, SKILL_BY_ID } from "@redlance/core";
import { cleanResumeText, MIN_RESUME_CHARS } from "../../src/resume/clean";
import type { Expected } from "./score";

const dir = join(import.meta.dirname, "fixtures");
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".txt"))
  .map((f) => f.replace(/\.txt$/, ""));

describe("eval fixtures", () => {
  it("has about 14 fixtures covering every job type", () => {
    expect(names.length).toBeGreaterThanOrEqual(14);
    const cats = new Set<string>();
    for (const n of names) {
      const e = JSON.parse(
        readFileSync(join(dir, `${n}.expected.json`), "utf8"),
      ) as Expected;
      e.categories.forEach((c) => cats.add(c));
    }
    expect([...cats].sort()).toEqual([...CATEGORY_IDS].sort());
  });

  it.each(names)("%s is well formed", (n) => {
    const text = readFileSync(join(dir, `${n}.txt`), "utf8");
    const e = JSON.parse(
      readFileSync(join(dir, `${n}.expected.json`), "utf8"),
    ) as Expected;
    expect(cleanResumeText(text).length).toBeGreaterThanOrEqual(
      MIN_RESUME_CHARS,
    );
    expect(text).not.toMatch(/@(?!example\.com)[a-z0-9-]+\.[a-z]/i);
    expect(EXPERIENCE_LEVELS).toContain(e.experienceLevel);
    for (const c of e.categories) expect(CATEGORY_IDS).toContain(c);
    for (const id of [...e.mustSkills, ...(e.maySkills ?? [])])
      expect(SKILL_BY_ID.has(id), `unknown skill ${id}`).toBe(true);
  });
});
