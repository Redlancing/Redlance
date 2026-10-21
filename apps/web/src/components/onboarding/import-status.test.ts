import { describe, expect, it } from "vitest";
import type { ImportSummary } from "@/server/onboarding/imports";
import {
  adoptImports,
  describeImports,
  importErrorMessage,
  liveAnnouncement,
  reimportDialog,
  startErrorMessage,
} from "./import-status";

const job = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  id: "j1",
  kind: "resume",
  status: "done",
  stage: "done",
  errorCode: null,
  suggestions: null,
  partial: [],
  skipped: [],
  createdAt: new Date().toISOString(),
  ...over,
});

const SUGGESTIONS = {
  v: 2 as const,
  basics: {
    displayName: "Ravi",
    categories: ["development" as const, "design" as const, "video" as const],
  },
  skills: Array.from({ length: 12 }, (_, i) => ({
    id: ["react", "javascript", "typescript", "after-effects"][i % 4]!,
    level: "secondary" as const,
  })).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i),
  githubUsername: null,
  projects: [],
  experience: [],
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
      "Done — we filled in your basics, 3 job types and 4 skills. Check them on the next steps.",
    );
  });

  it("names the step to fill in by hand when an import is partial", () => {
    const view = describeImports(
      [
        job({
          suggestions: { ...SUGGESTIONS, skills: [] },
          partial: ["skills"],
        }),
      ],
      null,
    );
    expect(view.tone).toBe("warning");
    expect(view.message).toContain("add your skills in Skills by hand");
  });

  it("names Projects & experience when a work step failed, but not when it was skipped", () => {
    const view = describeImports(
      [
        job({
          suggestions: SUGGESTIONS,
          partial: ["projects", "experience"],
          skipped: [],
        }),
      ],
      null,
    );
    expect(view.tone).toBe("warning");
    expect(view.message).toContain(
      "add your projects in Projects & experience and your experience in Projects & experience by hand",
    );
    const skipped = describeImports(
      [job({ suggestions: SUGGESTIONS, skipped: ["projects"] })],
      null,
    );
    expect(skipped.tone).toBe("success");
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

  it("says a GitHub account is too large to read", () => {
    expect(importErrorMessage("GITHUB_TOO_LARGE", { kind: "github" })).toBe(
      "That GitHub account has too much data to read. Add your skills by hand.",
    );
  });

  it.each([
    "SHUTDOWN",
    "UNSUPPORTED_JOB",
    "INTERNAL",
    "TIMEOUT",
    "SOMETHING_NEW",
  ])("uses kind-aware retry wording for %s", (code) => {
    expect(importErrorMessage(code, { kind: "resume" })).toBe(
      "Something went wrong reading your resume. Try again, or fill in the steps yourself.",
    );
    expect(importErrorMessage(code, { kind: "github" })).toBe(
      "Something went wrong reading your GitHub. Try again, or add your skills by hand.",
    );
  });

  it("explains a GitHub link from the resume that couldn't be opened", () => {
    expect(
      importErrorMessage("GITHUB_NOT_FOUND", {
        kind: "github",
        fromResume: true,
      }),
    ).toBe(
      "We found a GitHub link in your resume but couldn't open that account.",
    );
    expect(importErrorMessage("GITHUB_NOT_FOUND", { kind: "github" })).toBe(
      "We couldn't find that GitHub account.",
    );
  });

  it("describeImports words each failure by its job", () => {
    const view = describeImports(
      [
        job({
          kind: "github",
          status: "failed",
          stage: "failed",
          errorCode: "GITHUB_NOT_FOUND",
          fromResume: true,
        }),
      ],
      null,
    );
    expect(view.message).toBe(
      "We found a GitHub link in your resume but couldn't open that account.",
    );
  });
});

describe("adoptImports", () => {
  const resumeDone = job({
    id: "r1",
    kind: "resume",
    suggestions: SUGGESTIONS,
  });
  const githubQueued = job({
    id: "g1",
    kind: "github",
    status: "queued",
    stage: "queued",
  });

  it("picks up a GitHub import the worker started, so the step stays busy", () => {
    const adopted = adoptImports([resumeDone], [resumeDone, githubQueued]);
    expect(adopted?.map((j) => j.id)).toEqual(["r1", "g1"]);
    expect(describeImports(adopted!, null).busy).toBe(true);
  });

  it("replaces an older job of the same kind", () => {
    const oldGithub = job({ id: "g0", kind: "github" });
    const adopted = adoptImports([resumeDone, oldGithub], [githubQueued]);
    expect(adopted?.map((j) => j.id)).toEqual(["r1", "g1"]);
  });

  it("changes nothing when every active import is already tracked or none are active", () => {
    expect(adoptImports([githubQueued], [githubQueued])).toBeNull();
    expect(adoptImports([], [resumeDone])).toBeNull();
  });
});

describe("describeImports with a done import that found nothing", () => {
  it("says nothing was found instead of failing", () => {
    const view = describeImports([job({ suggestions: null })], null);
    expect(view.tone).toBe("warning");
    expect(view.message).toBe(
      "We couldn't find anything to fill in from that. Add your details by hand on the next steps.",
    );
  });
});

describe("liveAnnouncement", () => {
  it("keeps the upload percentage out of the live text", () => {
    expect(liveAnnouncement(describeImports([], 45))).toBe(
      "Uploading your resume…",
    );
    const view = describeImports(
      [job({ status: "running", stage: "reading" })],
      null,
    );
    expect(liveAnnouncement(view)).toBe("Reading your resume…");
  });
});

describe("startErrorMessage", () => {
  it("tells a daily quota apart from a burst rate limit", () => {
    expect(startErrorMessage(429, "QUOTA_EXCEEDED", "x")).toBe(
      "You've reached today's import limit.",
    );
    expect(startErrorMessage(429, "RATE_LIMITED", "x")).toBe(
      "Too many requests — try again in a moment.",
    );
  });

  it("maps size and type refusals and passes other messages through", () => {
    expect(startErrorMessage(413, "PAYLOAD_TOO_LARGE", "x")).toBe(
      "That file is over 5 MB.",
    );
    expect(startErrorMessage(415, "UNSUPPORTED_FILE", "x")).toBe(
      "Upload a PDF or Word (.docx) file.",
    );
    expect(startErrorMessage(400, "INVALID_INPUT", "That file is empty.")).toBe(
      "That file is empty.",
    );
  });
});

describe("reimportDialog", () => {
  it("names Projects & experience only when a resume is imported", () => {
    expect(reimportDialog({ resume: false, github: true })).toEqual({
      title: "Replace Basics and Skills?",
      body: "Once the import starts, what's in Basics and Skills will be replaced with suggestions from GitHub.",
    });
    expect(reimportDialog({ resume: true, github: false })).toEqual({
      title: "Replace Basics, Skills, and Projects & experience?",
      body: "Once the import starts, what's in Basics, Skills, and Projects & experience will be replaced with suggestions from the new resume.",
    });
    expect(reimportDialog({ resume: true, github: true }).body).toMatch(
      /from the new resume and GitHub\.$/,
    );
  });
});
