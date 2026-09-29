import { searchSkills, type CategoryId } from "@redlance/core";
import { describe, expect, it } from "vitest";
import { enterAction } from "./skill-search";

function run(
  query: string,
  chosen: string[] = [],
  categories: CategoryId[] = [],
  canAddCustom = true,
) {
  const set = new Set(chosen);
  const results = searchSkills(query, { categories, limit: 8 }).filter(
    (s) => !set.has(s.id),
  );
  return enterAction(query, { results, chosen: set, canAddCustom });
}

describe("enterAction", () => {
  it("adds the taxonomy skill for an alias", () => {
    expect(run("reactjs")).toEqual({ type: "skill", id: "react" });
  });
  it("does nothing when the typed skill is already chosen", () => {
    expect(run("react", ["react"])).toEqual({ type: "none" });
  });
  it("adds a custom skill instead of a fuzzy match", () => {
    expect(run("Descript")).toEqual({ type: "custom" });
  });
  it("adds the prefix match", () => {
    expect(run("prem")).toEqual({ type: "skill", id: "premiere-pro" });
  });
  it("prefers a label starting with the text over a custom skill", () => {
    // "Video editing" ranks first (word match) but doesn't start with "edit".
    expect(run("edit")).toEqual({ type: "skill", id: "editing-proofreading" });
  });
  it("does nothing when a custom skill isn't allowed", () => {
    expect(run("Descript", [], [], false)).toEqual({ type: "none" });
  });
});
