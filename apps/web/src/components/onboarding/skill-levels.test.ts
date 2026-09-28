import { describe, expect, it } from "vitest";
import { nextSkillLevel } from "./skill-levels";

describe("nextSkillLevel", () => {
  it("starts the first three as core, then secondary", () => {
    expect([0, 1, 2].map((n) => nextSkillLevel(n, 8))).toEqual(["core", "core", "core"]);
    expect(nextSkillLevel(3, 8)).toBe("secondary");
    expect(nextSkillLevel(7, 8)).toBe("secondary");
  });
  it("never exceeds the core limit", () => {
    expect(nextSkillLevel(2, 2)).toBe("secondary");
  });
});
