import { describe, expect, it } from "vitest";
import { MAX_RESUME_CHARS, cleanResumeText } from "./clean";

describe("cleanResumeText", () => {
  it("removes zero-width chars, bidi overrides and soft hyphens", () => {
    expect(cleanResumeText("a​b‮c­d")).toBe("abcd");
  });
  it("turns tabs into spaces and collapses spaces", () => {
    expect(cleanResumeText("a\t\tb    c")).toBe("a b c");
  });
  it("trims lines and limits blank lines to two", () => {
    expect(cleanResumeText("  a  \n\n\n\n\n b ")).toBe("a\n\n\nb");
  });
  it("applies NFKC and drops control characters but keeps newlines", () => {
    expect(cleanResumeText("ﬁx\u0000\nY")).toBe("fix\nY");
  });
  it("cuts to 30 000 characters", () => {
    expect(cleanResumeText("a".repeat(40_000))).toHaveLength(MAX_RESUME_CHARS);
  });
});
