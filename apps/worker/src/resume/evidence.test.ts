import { describe, expect, it } from "vitest";
import { hasEvidence } from "./evidence";

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
});
