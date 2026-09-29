import { describe, expect, it } from "vitest";
import type { ImportSummary } from "@/server/onboarding/imports";
import { describeImports, importErrorMessage } from "./import-status";

const job = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  id: "j1",
  kind: "resume",
  status: "done",
  stage: "done",
  errorCode: null,
  suggestions: null,
  partial: [],
  createdAt: new Date().toISOString(),
  ...over,
});

const SUGGESTIONS = {
  v: 1 as const,
  basics: {
    displayName: "Ravi",
    categories: ["development" as const, "design" as const, "video" as const],
  },
  skills: Array.from({ length: 12 }, (_, i) => ({
    id: ["react", "javascript", "typescript", "after-effects"][i % 4]!,
    level: "secondary" as const,
  })).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i),
  customSkills: [{ name: "Descript", level: "secondary" as const }],
  githubUsername: null,
};

describe("describeImports", () => {
  it("is idle with no jobs", () => {
    expect(describeImports([], null)).toEqual({
      busy: false,
      message: null,
      tone: "info",
      stage: null,
    });
  });

  it("shows the upload percentage while uploading", () => {
    const view = describeImports([], 45);
    expect(view.busy).toBe(true);
    expect(view.stage).toBe("uploading");
    expect(view.message).toBe("Uploading 45%…");
  });

  it("is busy while any job is queued or running", () => {
    expect(
      describeImports([job({ status: "queued", stage: "queued" })], null).busy,
    ).toBe(true);
    expect(
      describeImports(
        [
          job(),
          job({
            id: "j2",
            kind: "github",
            status: "running",
            stage: "reading",
          }),
        ],
        null,
      ).busy,
    ).toBe(true);
    expect(describeImports([job()], null).busy).toBe(false);
  });

  it("names each stage", () => {
    const at = (stage: ImportSummary["stage"]) =>
      describeImports([job({ status: "running", stage })], null).message;
    expect(at("reading")).toBe("Reading your resume…");
    expect(at("analysing")).toBe("Finding your details…");
    expect(at("checking")).toBe("Checking results…");
    expect(at("queued")).toBe("Getting ready…");
  });

  it("summarises what a finished import filled in", () => {
    const view = describeImports([job({ suggestions: SUGGESTIONS })], null);
    expect(view).toMatchObject({ busy: false, tone: "success" });
    expect(view.message).toBe(
      "Done — we filled in your basics, 3 job types and 5 skills. Check them on the next steps.",
    );
  });

  it("names the step to fill in by hand when an import is partial", () => {
    const view = describeImports(
      [
        job({
          suggestions: { ...SUGGESTIONS, skills: [], customSkills: [] },
          partial: ["skills"],
        }),
      ],
      null,
    );
    expect(view.tone).toBe("warning");
    expect(view.message).toContain("add your skills in Skills by hand");
  });

  it("uses the error message when every import failed", () => {
    const view = describeImports(
      [job({ status: "failed", stage: "failed", errorCode: "NO_TEXT" })],
      null,
    );
    expect(view).toMatchObject({ busy: false, tone: "error" });
    expect(view.message).toBe(importErrorMessage("NO_TEXT"));
  });
});

describe("importErrorMessage", () => {
  it.each([
    [
      "NO_TEXT",
      "We couldn't read text from this file. If it's a scanned image, add your details by hand.",
    ],
    ["UNSUPPORTED_FILE", "That file isn't a readable PDF or Word document."],
    [
      "LLM_BUSY",
      "Resume import is busy right now. Fill in the steps yourself or try again later.",
    ],
    [
      "LLM_FAILED",
      "Something went wrong reading your resume. Try again, or fill in the steps yourself.",
    ],
    [
      "INTERNAL",
      "Something went wrong reading your resume. Try again, or fill in the steps yourself.",
    ],
    [
      "TIMEOUT",
      "Something went wrong reading your resume. Try again, or fill in the steps yourself.",
    ],
    ["GITHUB_NOT_FOUND", "We couldn't find that GitHub account."],
    [
      "GITHUB_RATE_LIMITED",
      "GitHub isn't answering right now. Try again in a minute.",
    ],
    [
      "GITHUB_UNAVAILABLE",
      "GitHub isn't answering right now. Try again in a minute.",
    ],
    ["413", "That file is over 5 MB."],
    ["415", "Upload a PDF or Word (.docx) file."],
    ["429", "You've reached today's import limit."],
  ])("%s", (code, message) => {
    expect(importErrorMessage(code)).toBe(message);
  });

  it("falls back to a generic message", () => {
    expect(importErrorMessage(null)).toBe(importErrorMessage("INTERNAL"));
  });
});
