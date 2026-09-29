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
});
