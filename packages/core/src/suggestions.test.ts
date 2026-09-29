import { describe, expect, it } from "vitest";
import { STEP_SCHEMAS } from "./onboarding";
import {
  mergeSuggestions,
  suggestedStepData,
  suggestionsSchema,
} from "./suggestions";

const s = (x: object) => suggestionsSchema.parse({ v: 1, ...x });

describe("suggestionsSchema", () => {
  it("fills defaults and rejects unknown skill ids, bad countries and >3 categories", () => {
    expect(s({})).toMatchObject({
      basics: {},
      skills: [],
      customSkills: [],
      githubUsername: null,
    });
    expect(
      suggestionsSchema.safeParse({
        v: 1,
        skills: [{ id: "nope", level: "core" }],
      }).success,
    ).toBe(false);
    expect(
      suggestionsSchema.safeParse({ v: 1, basics: { country: "XX" } }).success,
    ).toBe(false);
    expect(
      suggestionsSchema.safeParse({
        v: 1,
        basics: { categories: ["video", "design", "art", "audio"] },
      }).success,
    ).toBe(false);
    expect(suggestionsSchema.safeParse({ v: 2 }).success).toBe(false);
  });

  it("rejects duplicate ids, reserved GitHub names and unusable custom names", () => {
    const dup = { id: "react", level: "core" };
    expect(
      suggestionsSchema.safeParse({ v: 1, skills: [dup, dup] }).success,
    ).toBe(false);
    expect(
      suggestionsSchema.safeParse({ v: 1, githubUsername: "settings" }).success,
    ).toBe(false);
    expect(
      suggestionsSchema.safeParse({
        v: 1,
        customSkills: [{ name: "--", level: "core" }],
      }).success,
    ).toBe(false);
  });
});

describe("mergeSuggestions", () => {
  it("unions skills, core wins, first source kept, first basics field wins", () => {
    const m = mergeSuggestions([
      {
        source: "resume",
        suggestions: s({
          basics: { displayName: "Asha" },
          skills: [{ id: "react", level: "secondary" }],
        }),
      },
      {
        source: "github",
        suggestions: s({
          basics: { displayName: "asha-gh", headline: "Dev" },
          skills: [
            { id: "react", level: "core" },
            { id: "typescript", level: "secondary" },
          ],
          githubUsername: "asha",
        }),
      },
    ]);
    expect(m.basics).toEqual({ displayName: "Asha", headline: "Dev" });
    expect(m.skills).toEqual([
      { id: "react", level: "core", source: "resume" },
      { id: "typescript", level: "secondary", source: "github" },
    ]);
    expect(m.githubUsername).toBe("asha");
  });

  it("caps core at 8 and total at 30, and dedupes custom skills", () => {
    const ids = [
      "javascript",
      "typescript",
      "react",
      "nextjs",
      "nodejs",
      "python",
      "html-css",
      "wordpress",
      "shopify",
      "php",
    ];
    const m = mergeSuggestions([
      {
        source: "resume",
        suggestions: s({
          skills: ids.map((id) => ({ id, level: "core" })),
          customSkills: [
            { name: "Descript", level: "secondary" },
            { name: " descript ", level: "core" },
          ],
        }),
      },
    ]);
    expect(m.skills.filter((x) => x.level === "core")).toHaveLength(8);
    expect(m.customSkills).toHaveLength(1);
  });

  it("drops custom skills that are already a taxonomy skill", () => {
    const m = mergeSuggestions([
      {
        source: "resume",
        suggestions: s({
          skills: [{ id: "react", level: "core" }],
          customSkills: [
            { name: "React", level: "secondary" },
            { name: "Descript", level: "secondary" },
          ],
        }),
      },
    ]);
    expect(m.customSkills.map((c) => c.name)).toEqual(["Descript"]);
  });

  it("returns empty results for no parts", () => {
    expect(mergeSuggestions([])).toEqual({
      basics: {},
      skills: [],
      customSkills: [],
      githubUsername: null,
    });
  });
});

describe("suggestedStepData", () => {
  const m = mergeSuggestions([
    {
      source: "resume",
      suggestions: s({
        basics: {
          displayName: "Asha",
          categories: ["video"],
          experienceLevel: "intermediate",
          country: "IN",
        },
        skills: [{ id: "video-editing", level: "core" }],
        customSkills: [{ name: "Descript", level: "secondary" }],
        githubUsername: "asha-edits",
      }),
    },
  ]);

  it("builds drafts that pass each step's draft schema, with sources", () => {
    const basics = suggestedStepData("basics", m);
    expect(STEP_SCHEMAS.basics.draft.safeParse(basics).success).toBe(true);
    expect(basics).toMatchObject({
      displayName: "Asha",
      categories: ["video"],
      timeZone: null,
    });
    const skills = suggestedStepData("skills", m);
    expect(skills.skills[0]).toEqual({
      id: "video-editing",
      level: "core",
      source: "resume",
    });
    expect(skills.customSkills[0]).toMatchObject({
      name: "Descript",
      source: "resume",
    });
    expect(suggestedStepData("import", m)).toEqual({
      githubUsername: "asha-edits",
    });
  });

  it("gives valid empty drafts when nothing was suggested", () => {
    const e = mergeSuggestions([]);
    expect(suggestedStepData("basics", e)).toMatchObject({
      displayName: "",
      categories: [],
      country: null,
    });
    expect(suggestedStepData("skills", e)).toEqual({
      skills: [],
      customSkills: [],
    });
  });
});
