import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, defaultCurrency } from "./countries";
import { ACTIVE_SUBREDDITS, SUBREDDIT_NAME_RE, SUBREDDITS } from "./subreddits";
import {
  CATEGORY_IDS,
  SKILLS,
  findSkill,
  normalizeSkillName,
  searchSkills,
  skillsForCategories,
} from "./taxonomy";

describe("taxonomy integrity", () => {
  it("has unique, url-safe skill ids", () => {
    const ids = SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("puts every skill in a known category, and every category has skills", () => {
    for (const s of SKILLS) expect(CATEGORY_IDS).toContain(s.category);
    for (const c of CATEGORY_IDS)
      expect(SKILLS.some((s) => s.category === c)).toBe(true);
  });

  it("never lets an id, name or alias point at two skills", () => {
    const seen = new Map<string, string>();
    for (const s of SKILLS) {
      for (const label of [s.id, s.name, ...s.aliases]) {
        const key = normalizeSkillName(label);
        const owner = seen.get(key);
        expect(
          owner === undefined || owner === s.id,
          `${key}: ${owner} vs ${s.id}`,
        ).toBe(true);
        seen.set(key, s.id);
      }
    }
  });

  it("maps a GitHub language to at most one skill", () => {
    const langs = SKILLS.flatMap((s) => s.githubLanguages ?? []);
    expect(new Set(langs).size).toBe(langs.length);
  });
});

describe("findSkill / searchSkills", () => {
  it("finds by name, alias and id, ignoring case and spacing", () => {
    expect(findSkill("React.js")?.id).toBe("react");
    expect(findSkill("  premiere  ")?.id).toBe("premiere-pro");
    expect(findSkill("nextjs")?.id).toBe("nextjs");
    expect(findSkill("C#")?.id).toBe("csharp");
    expect(findSkill("underwater basket weaving")).toBeUndefined();
  });

  it("ranks exact, then prefix, then substring matches, preferring the user's job types", () => {
    const results = searchSkills("edit", { categories: ["video"] }).map(
      (s) => s.id,
    );
    expect(results[0]).toBe("video-editing");
    expect(results).toContain("editing-proofreading");
  });

  it("returns nothing for an empty query and skips retired skills", () => {
    expect(searchSkills("   ")).toEqual([]);
    expect(searchSkills("a", { limit: 500 }).every((s) => !s.retired)).toBe(
      true,
    );
  });

  it("lists popular skills for chosen job types", () => {
    const skills = skillsForCategories(["writing"], 5);
    expect(skills).toHaveLength(5);
    expect(skills.every((s) => s.category === "writing")).toBe(true);
  });
});

describe("subreddits", () => {
  it("uses lowercase names without r/ and known categories", () => {
    for (const s of SUBREDDITS) {
      expect(s.name).toMatch(SUBREDDIT_NAME_RE);
      for (const c of s.categories) expect(CATEGORY_IDS).toContain(c);
    }
    expect(new Set(SUBREDDITS.map((s) => s.name)).size).toBe(SUBREDDITS.length);
  });

  it("matches display names, and explains every subreddit it doesn't poll", () => {
    for (const s of SUBREDDITS) {
      expect(s.displayName.toLowerCase()).toBe(s.name);
      if (s.status !== "active") expect(s.note, s.name).toBeTruthy();
    }
  });

  it("polls the main boards and none of the excluded ones", () => {
    const active = new Set(ACTIVE_SUBREDDITS.map((s) => s.name));
    for (const name of [
      "forhire",
      "hiring",
      "slavelabour",
      "designjobs",
      "photoshoprequest",
    ])
      expect(active).toContain(name);
    for (const name of [
      "jobboardsearch",
      "freelance",
      "homeworkhelp",
      "chatterjobs",
    ])
      expect(active).not.toContain(name);
    expect(ACTIVE_SUBREDDITS.length).toBeGreaterThan(150);
  });
});

describe("countries", () => {
  it("has all 249 ISO 3166-1 alpha-2 codes", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(COUNTRY_CODES).toContain("IN");
  });

  it("picks a sensible default currency", () => {
    expect(defaultCurrency("IN")).toBe("INR");
    expect(defaultCurrency("GB")).toBe("GBP");
    expect(defaultCurrency("DE")).toBe("EUR");
    expect(defaultCurrency("US")).toBe("USD");
    expect(defaultCurrency(null)).toBe("USD");
  });
});
