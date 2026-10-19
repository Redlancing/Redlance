import { describe, expect, it } from "vitest";
import { editRatio, normalise, sentenceCount, wordCount } from "./text";

describe("text measures", () => {
  it("counts words, ignoring stray punctuation", () => {
    expect(wordCount("hey — saw your post, 2 quick questions")).toBe(7);
    expect(wordCount("   ")).toBe(0);
  });

  it("counts sentences", () => {
    expect(sentenceCount("Hi. I built this!! Want a look?")).toBe(3);
    expect(sentenceCount("no full stop at the end")).toBe(1);
    expect(sentenceCount("Costs $2.5k. Done")).toBe(2);
    expect(sentenceCount("")).toBe(0);
  });

  it("normalises case, quotes and whitespace", () => {
    expect(normalise("  I’m   HERE ")).toBe("i'm here");
  });

  it("measures the edit ratio", () => {
    expect(editRatio("same text here", "Same text  here")).toBe(0);
    expect(editRatio("one two three four", "one two six four")).toBe(0.25);
    expect(editRatio("totally different words entirely and more", "a b")).toBe(
      1,
    );
    expect(editRatio("", "")).toBe(0);
    expect(editRatio("something", "")).toBe(1);
  });
});
