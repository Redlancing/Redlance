import { describe, expect, it } from "vitest";
import { STEP_SCHEMAS } from "./onboarding";
import { workSchemas } from "./work";
import {
  RESUME_STEP_NAMES,
  mergeSuggestions,
  suggestedStepData,
  suggestionsSchema,
} from "./suggestions";

const s = (x: object) => suggestionsSchema.parse({ v: 2, ...x });

describe("suggestionsSchema", () => {
  it("fills defaults and rejects unknown skill ids, bad countries and >3 categories", () => {
    expect(s({})).toMatchObject({
      basics: {},
      skills: [],
      githubUsername: null,
    });
    expect(
      suggestionsSchema.safeParse({
        v: 2,
        skills: [{ id: "nope", level: "core" }],
      }).success,
    ).toBe(false);
    expect(
      suggestionsSchema.safeParse({ v: 2, basics: { country: "XX" } }).success,
    ).toBe(false);
    expect(
      suggestionsSchema.safeParse({
        v: 2,
        basics: { categories: ["video", "design", "art", "audio"] },
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate ids and reserved GitHub names", () => {
    const dup = { id: "react", level: "core" };
    expect(
      suggestionsSchema.safeParse({ v: 2, skills: [dup, dup] }).success,
    ).toBe(false);
    expect(
      suggestionsSchema.safeParse({ v: 2, githubUsername: "settings" }).success,
    ).toBe(false);
  });

  it("drops a customSkills key from results stored before custom skills were removed", () => {
    const legacy = suggestionsSchema.safeParse({
      v: 2,
      skills: [{ id: "react", level: "core" }],
      customSkills: [{ name: "Descript", level: "secondary" }],
    });
    expect(legacy.success).toBe(true);
    expect(legacy.data?.skills).toEqual([{ id: "react", level: "core" }]);
    expect(legacy.data && "customSkills" in legacy.data).toBe(false);
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

  it("caps core at 8", () => {
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
        }),
      },
    ]);
    expect(m.skills.filter((x) => x.level === "core")).toHaveLength(8);
    expect(m.skills).toHaveLength(10);
  });

  it("returns empty results for no parts", () => {
    expect(mergeSuggestions([])).toEqual({
      basics: {},
      skills: [],
      githubUsername: null,
      projects: [],
      experience: [],
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
    expect(suggestedStepData("skills", e)).toEqual({ skills: [] });
  });
});

const project = {
  title: "Shopfront",
  summary: "A storefront for a real-estate agency.",
  role: "solo",
  kind: "client",
  skills: ["react"],
  categories: ["development"],
  domains: ["real-estate"],
  outcomes: ["Cut page load from 4 s to 1 s for a US real-estate agency."],
  links: ["https://github.com/example/shopfront"],
  year: 2023,
  namesRemoved: true,
};

const role = {
  title: "Frontend developer",
  organisation: "Acme Pay",
  organisationDescription: "a fintech payments company",
  employmentType: "full_time",
  start: { year: 2021, month: 1 },
  end: null,
  current: true,
  summary: "Built the checkout.",
  highlights: ["Rebuilt the checkout in React."],
  skills: ["react"],
  categories: ["development"],
  domains: ["fintech"],
};

describe("suggestions v2", () => {
  it("parses v2 with projects and experience", () => {
    const parsed = s({ projects: [project], experience: [role] });
    expect(parsed.v).toBe(2);
    expect(parsed.projects[0]).toMatchObject({
      title: "Shopfront",
      namesRemoved: true,
    });
    expect(parsed.experience[0]).toMatchObject({
      organisation: "Acme Pay",
      namesRemoved: false,
    });
  });

  it("refuses v: 1 and unknown keys", () => {
    expect(suggestionsSchema.safeParse({ v: 1 }).success).toBe(false);
    expect(suggestionsSchema.safeParse({ v: 2, extra: 1 }).success).toBe(false);
    expect(
      suggestionsSchema.safeParse({
        v: 2,
        projects: [{ ...project, source: "resume" }],
      }).success,
    ).toBe(false);
    expect(
      suggestionsSchema.safeParse({
        v: 2,
        meta: {
          pipelineVersion: "x",
          promptVersions: {},
          partial: [],
          extra: 1,
        },
      }).success,
    ).toBe(false);
  });

  it("projects and experience default to empty lists and are capped", () => {
    expect(s({})).toMatchObject({ projects: [], experience: [] });
    expect(
      suggestionsSchema.safeParse({ v: 2, projects: Array(9).fill(project) })
        .success,
    ).toBe(false);
    expect(
      suggestionsSchema.safeParse({ v: 2, experience: Array(7).fill(role) })
        .success,
    ).toBe(false);
  });

  it("meta.skipped defaults to an empty list", () => {
    const parsed = s({
      meta: { pipelineVersion: "resume@2", promptVersions: {}, partial: [] },
    });
    expect(parsed.meta?.skipped).toEqual([]);
  });

  it("meta names the projects and experience steps, and nothing else", () => {
    expect(RESUME_STEP_NAMES).toEqual([
      "basics",
      "jobTypes",
      "skills",
      "projects",
      "experience",
    ]);
    const meta = (partial: string[], skipped: string[]) =>
      suggestionsSchema.safeParse({
        v: 2,
        meta: {
          pipelineVersion: "resume@2",
          promptVersions: {},
          partial,
          skipped,
        },
      }).success;
    expect(meta(["experience"], ["projects"])).toBe(true);
    expect(meta(["portfolio"], [])).toBe(false);
    expect(meta([], ["voice"])).toBe(false);
  });
});

describe("work suggestions", () => {
  it("mergeSuggestions takes projects and experience from the resume only", () => {
    const github = s({
      skills: [{ id: "typescript", level: "core" }],
      projects: [{ ...project, title: "From GitHub" }],
      experience: [role],
    });
    expect(
      mergeSuggestions([{ source: "github", suggestions: github }]),
    ).toMatchObject({ projects: [], experience: [] });

    const resume = s({ projects: [project] });
    const m = mergeSuggestions([
      { source: "resume", suggestions: resume },
      { source: "github", suggestions: github },
    ]);
    expect(m.projects.map((p) => p.title)).toEqual(["Shopfront"]);
    expect(m.experience).toEqual([]);
  });

  it('suggestedStepData("work") maps entries with source "resume" and keeps namesRemoved', () => {
    const m = mergeSuggestions([
      {
        source: "resume",
        suggestions: s({ projects: [project], experience: [role] }),
      },
    ]);
    const work = suggestedStepData("work", m);
    expect(workSchemas.draft.safeParse(work).success).toBe(true);
    expect(workSchemas.complete.safeParse(work).success).toBe(true);
    expect(work.mentionEmployers).toBe(false);
    expect(work.projects[0]).toMatchObject({
      title: "Shopfront",
      source: "resume",
      hidden: false,
      namesRemoved: true,
      links: ["https://github.com/example/shopfront"],
    });
    expect(work.experience[0]).toMatchObject({
      organisation: "Acme Pay",
      source: "resume",
      hidden: false,
      namesRemoved: false,
      current: true,
    });
  });

  it('suggestedStepData("work") is empty with nothing suggested', () => {
    expect(suggestedStepData("work", mergeSuggestions([]))).toEqual({
      projects: [],
      experience: [],
      mentionEmployers: false,
    });
  });
});
