import { describe, expect, it } from "vitest";
import { hasEvidence, hasSkillEvidence } from "./evidence";

describe("hasEvidence", () => {
  const text = "Built   dashboards\nwith React and Node.";
  it("is case and whitespace insensitive", () => {
    expect(hasEvidence(text, "BUILT dashboards with react")).toBe(true);
  });
  it("is false for missing, short or absent quotes", () => {
    expect(hasEvidence(text, undefined)).toBe(false);
    expect(hasEvidence(text, "Re")).toBe(false);
    expect(hasEvidence(text, "Vue and Svelte")).toBe(false);
  });
  it("rejects filler quotes", () => {
    expect(hasEvidence("this and that", "and")).toBe(false);
    expect(hasEvidence("I use React", "React")).toBe(false);
    expect(hasEvidence("I use React", "use React")).toBe(true);
  });
  it("skill evidence must mention a label", () => {
    const t = "Built dashboards with React and Node";
    expect(hasSkillEvidence(t, "dashboards with React", ["React"])).toBe(true);
    expect(hasSkillEvidence(t, "Built dashboards with", ["React"])).toBe(false);
    expect(hasSkillEvidence(t, "Built dashboards", ["c"])).toBe(false);
  });
  it("accepts hyphenated evidence", () => {
    expect(
      hasSkillEvidence(
        "Built React-based dashboards",
        "React-based dashboards",
        ["React"],
      ),
    ).toBe(true);
  });
});
