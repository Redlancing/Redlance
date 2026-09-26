import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it.each([
    ["  Alex@Example.com ", "alex@example.com"],
    ["alex+jobs@example.com", "alex@example.com"],
    ["A.L.E.X+x@gmail.com", "alex@gmail.com"],
    ["a.lex@googlemail.com", "alex@gmail.com"],
    ["a.lex@company.co.uk", "a.lex@company.co.uk"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });
});
