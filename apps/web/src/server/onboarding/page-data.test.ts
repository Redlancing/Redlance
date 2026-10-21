import { STEP_IDS } from "@redlance/core";
import { describe, expect, it } from "vitest";
import { VALID } from "../../../test/onboarding-fixtures";
import {
  mergedSuggestions,
  reviewData,
  stepInit,
  workImportNotice,
} from "./page-data";
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
  skipped: [],
  createdAt: new Date().toISOString(),
});

const RESUME = {
  v: 2 as const,
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
  githubUsername: null,
  projects: [],
  experience: [],
};

const GITHUB = {
  v: 2 as const,
  basics: {},
  skills: [
    { id: "typescript", level: "secondary" as const },
    { id: "javascript", level: "core" as const },
  ],
  githubUsername: "ravi-k",
  projects: [],
  experience: [],
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
    const steps = STEP_IDS.map((s) => row(s, VALID[s]));
    const result = reviewData(state(steps, "review"));
    expect(result.ok && result.data.rates.minRate).toBe(25);
    expect(result.ok && result.data.work.projects).toHaveLength(2);
    expect(result.ok && result.data.work.mentionEmployers).toBe(true);
  });

  it("points at the first step that no longer passes", () => {
    const steps = STEP_IDS.map((s) =>
      row(s, s === "skills" ? { skills: [] } : VALID[s]),
    );
    expect(reviewData(state(steps, "review"))).toEqual({
      ok: false,
      step: "skills",
    });
  });
});

describe("reviewData: work", () => {
  it("points at work when it isn't completed", () => {
    const steps = STEP_IDS.filter((s) => s !== "work").map((s) =>
      row(s, VALID[s]),
    );
    expect(reviewData(state(steps, "review"))).toEqual({
      ok: false,
      step: "work",
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

describe("pre-fill: work", () => {
  const WITH_WORK = {
    ...RESUME,
    projects: [
      {
        title: "Wedding film",
        summary: "Edited a film.",
        skills: ["video-editing"],
        links: ["https://vimeo.com/123"],
        namesRemoved: true,
      },
    ],
    experience: [{ title: "Video editor", organisation: "Acme" }],
  };
  const withResume = (
    steps: OnboardingState["steps"] = [],
    suggestions: ImportSummary["suggestions"] = WITH_WORK as never,
  ) =>
    state(steps, "import", {
      resume: job("resume", suggestions),
      github: null,
    });

  it("work shows the saved row when there is one", () => {
    const saved = { projects: [], experience: [], mentionEmployers: true };
    const s = withResume([row("work", saved, "draft", 3)]);
    const init = stepInit(s, "u1", "work");
    expect(init.data.projects).toEqual([]);
    expect(init.data.mentionEmployers).toBe(true);
    expect(init.version).toBe(3);
  });

  it("work shows resume suggestions when there is no row", () => {
    const init = stepInit(withResume(), "u1", "work");
    expect(init.version).toBe(0);
    expect(init.data.projects).toHaveLength(1);
    expect(init.data.projects[0]).toMatchObject({
      title: "Wedding film",
      source: "resume",
      namesRemoved: true,
    });
    expect(init.data.experience[0]).toMatchObject({
      title: "Video editor",
      source: "resume",
    });
  });

  it("work is empty with no import, or with only a GitHub import", () => {
    const none = stepInit(state([]), "u1", "work").data;
    expect(none.projects).toEqual([]);
    expect(none.experience).toEqual([]);
    const gh = state([], "import", {
      resume: null,
      github: job("github", GITHUB),
    });
    expect(stepInit(gh, "u1", "work").data.projects).toEqual([]);
  });

  it("work falls back to empty when the suggestions don't parse", () => {
    const bad = {
      ...RESUME,
      projects: [{ title: "x", links: [{ nope: 1 }] }],
    } as never;
    const init = stepInit(withResume([], bad), "u1", "work");
    expect(init.data.projects).toEqual([]);
    expect(init.data.experience).toEqual([]);
  });
});

describe("workImportNotice", () => {
  const withJob = (
    over: Partial<ImportSummary>,
    steps: OnboardingState["steps"] = [],
  ) =>
    state(steps, "import", {
      resume: { ...job("resume", RESUME), ...over },
      github: null,
    });

  it("is null without a finished resume import or with nothing missing", () => {
    expect(workImportNotice(state([]))).toBeNull();
    expect(workImportNotice(withJob({}))).toBeNull();
    expect(
      workImportNotice(
        withJob({
          status: "running",
          suggestions: null,
          partial: ["projects"],
        }),
      ),
    ).toBeNull();
  });

  it("reads partial and skipped from the latest resume import", () => {
    expect(workImportNotice(withJob({ partial: ["projects"] }))).toMatch(
      /projects/,
    );
    expect(workImportNotice(withJob({ skipped: ["experience"] }))).toMatch(
      /experience/,
    );
  });

  it("words a skipped step apart from a failed one", () => {
    expect(workImportNotice(withJob({ partial: ["projects"] }))).toBe(
      "We couldn't read your projects. Add them by hand.",
    );
    expect(workImportNotice(withJob({ skipped: ["projects"] }))).toBe(
      "We didn't find a Projects section in your resume, so add any projects by hand.",
    );
  });

  it("is null once the user has saved the step", () => {
    expect(
      workImportNotice(
        withJob({ partial: ["projects"] }, [
          row("work", { projects: [], experience: [] }, "draft"),
        ]),
      ),
    ).toBeNull();
  });
});
