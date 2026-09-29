import type { Suggestions } from "@redlance/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevReport } from "./dev-report";

const suggestions: Suggestions = {
  v: 1,
  basics: {},
  skills: [],
  customSkills: [],
  githubUsername: null,
};

function exercise(report: ReturnType<typeof createDevReport>) {
  report.text("file", { chars: 1200 });
  report.analysis("gemini");
  report.step({
    step: "basics",
    model: "m",
    ms: 5,
    attempts: [{ attempt: 1, outcome: "ok" }],
    output: { displayName: "A" },
  });
  report.merge({ dropped: [], partial: [], suggestions });
  report.result(suggestions);
  report.github({ username: "u", repos: [], suggestions });
  report.end("done", null);
}

describe("createDevReport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints nothing when disabled (staging/production)", () => {
    const out = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const report = createDevReport({
      enabled: false,
      jobId: "j1",
      kind: "resume",
      attempt: 1,
      out,
    });
    expect(report.enabled).toBe(false);
    exercise(report);
    expect(out).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("prints a header, the path, each step's output and a closing line when enabled", () => {
    const lines: string[] = [];
    exercise(
      createDevReport({
        enabled: true,
        jobId: "j1",
        kind: "resume",
        attempt: 1,
        out: (t) => lines.push(t),
      }),
    );
    const all = lines.join("\n");
    expect(lines[0]).toContain("── resume import j1 (attempt 1) ──");
    expect(all).toContain("path: parser + Gemini");
    expect(all).toContain('Gemini step "basics"');
    expect(all).toContain('"displayName": "A"');
    expect(all).toContain("── end resume import j1: done");
  });
});
