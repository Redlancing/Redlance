import { describe, expect, it } from "vitest";
import { runResumePipeline } from "../src/resume/pipeline";
import { stubLlm } from "./stub-llm";

const RESUME = [
  "Priya Sharma",
  "Freelance web developer",
  "",
  "Skills",
  "React, TypeScript, Node.js",
  "",
  "Experience",
  "Built React dashboards in TypeScript for three startups.",
].join("\n");

describe("stubLlm", () => {
  it("answers every resume step with schema-valid output that passes the evidence checks", async () => {
    const run = await runResumePipeline(RESUME, {
      llm: stubLlm(),
      models: { fast: "fast-model", smart: "smart-model" },
    });
    expect(run.partial).toEqual([]);
    expect(run.suggestions.basics.displayName).toBe("Priya Sharma");
    expect(run.suggestions.basics.categories).toEqual(["development"]);
    expect(run.suggestions.skills.map((s) => s.id)).toEqual(
      expect.arrayContaining(["react", "typescript"]),
    );
  });

  it("answers the projects and experience tasks from the blocks, with a client name on the first line", async () => {
    const run = await runResumePipeline(
      [
        "Priya Sharma",
        "Freelance web developer",
        "",
        "Skills",
        "React, TypeScript, Node.js, WordPress",
        "",
        "Experience",
        "Freelance Developer, Bright Studio · Jan 2020 – Present",
        "- Built React dashboards for Globex Bank's analysts.",
        "- Ran WordPress upkeep for 12 shops.",
        "",
        "Projects",
        "Shopfront — Next.js store, 2023 · github.com/priya/shopfront",
        "- Cut page load to 1 s for Acme Realty's agents.",
        "",
        "TaskFlow (2022)",
        "- React todo app with offline sync.",
      ].join("\n"),
      {
        llm: stubLlm(),
        models: { fast: "fast-model", smart: "smart-model" },
      },
    );
    expect(run.partial).toEqual([]);
    expect(run.skipped).toEqual([]);
    const { projects, experience } = run.suggestions;
    expect(projects.map((p) => [p.title, p.year, p.links, p.outcomes])).toEqual(
      [
        [
          "Shopfront",
          2023,
          ["https://github.com/priya/shopfront"],
          ["Cut page load to 1 s for a client's agents."],
        ],
        ["TaskFlow", 2022, [], ["React todo app with offline sync."]],
      ],
    );
    expect(projects.map((p) => p.namesRemoved)).toEqual([true, false]);
    expect(projects[1]!.skills).toEqual(["react"]);
    expect(experience).toHaveLength(1);
    expect(experience[0]).toMatchObject({
      title: "Freelance Developer",
      organisation: null,
      employmentType: "freelance",
      start: { year: 2020, month: 1 },
      current: true,
      highlights: [
        "Built React dashboards for a client's analysts.",
        "Ran WordPress upkeep for 12 shops.",
      ],
      skills: expect.arrayContaining(["react", "wordpress"]),
      namesRemoved: true,
    });
    expect(JSON.stringify(run.suggestions)).not.toMatch(/acme|globex|bright/i);
  });
});
