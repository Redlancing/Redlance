import { describe, expect, it } from "vitest";
import { addTag } from "./tag-logic";

const limits = { max: 3, maxLength: 5 };

describe("addTag", () => {
  it("adds the trimmed word", () => {
    expect(addTag(["a"], "  bb ", limits)).toEqual({
      values: ["a", "bb"],
      added: true,
    });
  });
  it("ignores empty, duplicate (any case), too long and over-the-max words", () => {
    expect(addTag(["a"], "   ", limits).added).toBe(false);
    expect(addTag(["Free"], "fREE", limits).added).toBe(false);
    expect(addTag([], "toolong", limits).added).toBe(false);
    expect(addTag(["a", "b", "c"], "d", limits).added).toBe(false);
  });
});
