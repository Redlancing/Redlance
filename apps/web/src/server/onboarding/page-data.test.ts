import { describe, expect, it } from "vitest";
import { VALID } from "../../../test/onboarding-fixtures";
import { mergedSuggestions, reviewData, stepInit } from "./page-data";
import type { ImportSummary } from "./imports";
import type { OnboardingState } from "./service";

const row = (
  step: string,
  data: unknown,
  status: "draft" | "completed" = "completed",
  version = 1,
) =>
  ({
    step,
    status,
    data,
    version,
    updatedAt: new Date(),
  }) as OnboardingState["steps"][number];

const state = (
  steps: OnboardingState["steps"],
  resumeAt: OnboardingState["resumeAt"] = "import",
  imports: OnboardingState["imports"] = { resume: null, github: null },
): OnboardingState => ({
  steps,
  resumeAt,
  onboardedAt: null,
  trialEndsAt: null,
  imports,
});

const job = (
  kind: ImportSummary["kind"],
  suggestions: ImportSummary["suggestions"],
  status: ImportSummary["status"] = "done",
): ImportSummary => ({
  id: `${kind}-job`,
  kind,
  status,
  stage: status === "done" || status === "failed" ? status : "reading",
  errorCode: null,
  suggestions,
  partial: [],
  createdAt: new Date().toISOString(),
});

const RESUME = {
  v: 1 as const,
  basics: {
    displayName: "Ravi Kumar",
    headline: "Web developer",
    categories: ["development" as const],
    experienceLevel: "experienced" as const,
  },
  skills: [
    { id: "react", level: "core" as const },
    { id: "javascript", level: "secondary" as const },
  ],
  customSkills: [],
  githubUsername: null,
};

const GITHUB = {
  v: 1 as const,
  basics: {},
  skills: [
    { id: "typescript", level: "secondary" as const },
    { id: "javascript", level: "core" as const },
  ],
  customSkills: [],
  githubUsername: "ravi-k",
};

describe("stepInit", () => {
  it("returns the saved data, status and version", () => {
    const init = stepInit(
      state([row("basics", VALID.basics, "draft", 3)]),
      "u1",
      "basics",
    );
    expect(init).toMatchObject({
      userId: "u1",
      step: "basics",
      status: "draft",
      version: 3,
    });
    expect(init.data.displayName).toBe("Asha");
  });

  it("starts new rates in the Basics country's currency", () => {
    const s = state([row("basics", { ...VALID.basics, country: "GB" })]);
    expect(stepInit(s, "u1", "rates").data.currency).toBe("GBP");
    expect(stepInit(s, "u1", "rates").version).toBe(0);
  });

  it("falls back to an empty draft (keeping the version) when saved data no longer parses", () => {
    const init = stepInit(
      state([row("basics", { displayName: 42 }, "draft", 2)]),
      "u1",
      "basics",
    );
    expect(init.data.displayName).toBe("");
    expect(init.version).toBe(2);
  });
});

describe("reviewData", () => {
  it("parses every step with its complete schema", () => {
    const steps = (["import", "basics", "skills", "rates"] as const).map((s) =>
      row(s, VALID[s]),
    );
    const result = reviewData(state(steps, "review"));
    expect(result.ok && result.data.rates.minRate).toBe(25);
  });

  it("points at the first step that no longer passes", () => {
    const steps = (["import", "basics", "skills", "rates"] as const).map((s) =>
      row(s, s === "skills" ? { skills: [] } : VALID[s]),
    );
    expect(reviewData(state(steps, "review"))).toEqual({
      ok: false,
      step: "skills",
    });
  });
});

describe("pre-fill from imports", () => {
  const withResume = (steps: OnboardingState["steps"] = []) =>
    state(steps, "import", { resume: job("resume", RESUME), github: null });

  it("fills Basics and Skills from a finished resume import", () => {
    const s = withResume();
    const basics = stepInit(s, "u1", "basics");
    expect(basics.data.displayName).toBe("Ravi Kumar");
    expect(basics.data.categories).toEqual(["development"]);
    expect(basics.data.timeZone).toBeNull();
    expect(basics.version).toBe(0);
    const skills = stepInit(s, "u1", "skills").data.skills;
    expect(skills).toContainEqual({
      id: "react",
      level: "core",
      source: "resume",
    });
  });

  it("lets a saved row win over suggestions", () => {
    const s = withResume([row("basics", VALID.basics, "draft", 2)]);
    expect(stepInit(s, "u1", "basics").data.displayName).toBe("Asha");
  });

  it("leaves the steps empty without finished imports", () => {
    expect(mergedSuggestions(state([]))).toBeNull();
    const running = state([], "import", {
      resume: job("resume", null, "running"),
      github: null,
    });
    expect(mergedSuggestions(running)).toBeNull();
    expect(stepInit(running, "u1", "basics").data.displayName).toBe("");
    expect(stepInit(running, "u1", "skills").data.skills).toEqual([]);
  });

  it("merges resume and GitHub (union of skills, highest level wins)", () => {
    const s = state([], "import", {
      resume: job("resume", RESUME),
      github: job("github", GITHUB),
    });
    const skills = stepInit(s, "u1", "skills").data.skills;
    expect(skills.map((x) => x.id).sort()).toEqual([
      "javascript",
      "react",
      "typescript",
    ]);
    expect(skills.find((x) => x.id === "javascript")).toMatchObject({
      level: "core",
      source: "resume",
    });
    expect(skills.find((x) => x.id === "typescript")?.source).toBe("github");
    expect(stepInit(s, "u1", "import").data.githubUsername).toBe("ravi-k");
  });

  it("keeps rates unchanged", () => {
    const s = withResume();
    expect(stepInit(s, "u1", "rates").data).toEqual(
      stepInit(state([]), "u1", "rates").data,
    );
  });
});
