import { describe, expect, it } from "vitest";
import { VALID } from "../../../test/onboarding-fixtures";
import { reviewData, stepInit } from "./page-data";
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
): OnboardingState => ({
  steps,
  resumeAt,
  onboardedAt: null,
  trialEndsAt: null,
});

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
