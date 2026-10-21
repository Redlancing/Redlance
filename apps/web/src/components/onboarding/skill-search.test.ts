import { searchSkills, type CategoryId } from "@redlance/core";
import { describe, expect, it } from "vitest";
import { enterAction } from "./skill-search";

function run(
  query: string,
  chosen: string[] = [],
  categories: CategoryId[] = [],
) {
  const set = new Set(chosen);
  const results = searchSkills(query, { categories, limit: 8 }).filter(
    (s) => !set.has(s.id),
  );
  return enterAction(query, { results, chosen: set });
}

describe("enterAction", () => {
  it("adds the taxonomy skill for an alias", () => {
    expect(run("reactjs")).toEqual({ type: "skill", id: "react" });
  });
  it("does nothing when the typed skill is already chosen", () => {
    expect(run("react", ["react"])).toEqual({ type: "none" });
  });
  it("does nothing for a name that isn't a taxonomy skill, even with fuzzy results", () => {
    expect(run("Descript")).toEqual({ type: "none" });
    expect(run("underwater basket weaving")).toEqual({ type: "none" });
  });
  it("adds the prefix match", () => {
    expect(run("prem")).toEqual({ type: "skill", id: "premiere-pro" });
  });
  it("prefers a label starting with the text over the top-ranked result", () => {
    // "Video editing" ranks first (word match) but doesn't start with "edit".
    expect(run("edit")).toEqual({ type: "skill", id: "editing-proofreading" });
  });
});
