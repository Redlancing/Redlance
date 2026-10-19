import type { Suggestions } from "@redlance/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block } from "./resume/entries";
import type { PipelineInput } from "./resume/steps/shared";
import { createDevReport } from "./dev-report";

const suggestions: Suggestions = {
  v: 2,
  basics: {},
  skills: [],
  customSkills: [],
  githubUsername: null,
  projects: [],
  experience: [],
};

const block = (over: Partial<Block> = {}): Block => ({
  id: "P1",
  text: "Meal planner — React app for families\n- Built the menu planner",
  range: { start: { year: 2021, month: 3 }, end: null, current: true },
  year: 2024,
  links: ["https://example.dev"],
  ...over,
});

const input = (over: Partial<PipelineInput> = {}): PipelineInput => ({
  text: "resume text",
  sections: {
    top: "",
    summary: "",
    experience: "",
    skills: "",
    projects: "",
    education: "",
    other: "",
  },
  shortlist: [],
  yearsExperience: null,
  headed: true,
  projectBlocks: [block()],
  experienceBlocks: [
    block({
      id: "E1",
      year: null,
      links: [],
      range: {
        start: { year: 2019, month: null },
        end: { year: 2021, month: 2 },
        current: false,
      },
      text: "Acme Realty — Designer",
    }),
  ],
  ...over,
});

function exercise(report: ReturnType<typeof createDevReport>) {
  report.text("file", { chars: 1200 });
  report.analysis("gemini");
  report.prepass(input(), null);
  report.step({
    step: "basics",
    model: "m",
    ms: 5,
    attempts: [{ attempt: 1, outcome: "ok" }],
    output: { displayName: "A" },
  });
  report.merge({
    dropped: [
      {
        what: "project",
        value: "Ghost app",
        reason: "title not in its block",
        block: "P3",
      },
    ],
    replaced: [
      {
        block: "P1",
        name: "Acme Realty",
        generic: "a US real-estate agency",
        source: "model",
      },
    ],
    partial: [],
    skipped: [{ step: "projects", reason: "no section headings" }],
    suggestions,
  });
  report.result(suggestions);
  report.github({ username: "u", repos: [], suggestions });
  report.end("done", null);
}

function capture(enabled: true) {
  const lines: string[] = [];
  const report = createDevReport({
    enabled,
    jobId: "j1",
    kind: "resume",
    attempt: 1,
    out: (t) => lines.push(t),
  });
  return { lines, report, all: () => lines.join("\n") };
}

describe("createDevReport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints the pre-pass blocks with id, date range, year, links and a text snippet", () => {
    const { report, all } = capture(true);
    report.prepass(input(), null);
    const text = all();
    expect(text).toContain("headings found: yes");
    expect(text).toContain("P1");
    expect(text).toContain("2021-03 – present");
    expect(text).toContain("year 2024");
    expect(text).toContain("links 1");
    expect(text).toContain("Meal planner — React app for families");
    expect(text).toContain("E1");
    expect(text).toContain("2019 – 2021-02");
  });

  it("cuts each block's text to 60 characters on one line", () => {
    const { report, all } = capture(true);
    const long = `${"A".repeat(50)} ${"B".repeat(50)}`;
    report.prepass(
      input({
        projectBlocks: [block({ text: long })],
        experienceBlocks: [],
      }),
      null,
    );
    expect(all()).toContain(`${"A".repeat(50)} ${"B".repeat(9)}`);
    expect(all()).not.toContain("B".repeat(10));
  });

  it("says when no headings were found", () => {
    const { report, all } = capture(true);
    report.prepass(input({ headed: false, projectBlocks: [] }), null);
    expect(all()).toContain("headings found: no");
  });

  it("prints the model, time, attempts and output counts of the new steps", () => {
    const { report, all } = capture(true);
    report.step({
      step: "projects",
      model: "flash-lite-x",
      ms: 1234,
      attempts: [{ attempt: 1, outcome: "ok" }],
      output: { projects: [{}, {}] },
    });
    report.step({
      step: "experience",
      model: "flash-x",
      ms: 900,
      attempts: [{ attempt: 1, outcome: "ok" }],
      output: { experience: [{}] },
    });
    const text = all();
    expect(text).toContain('Gemini step "projects" — flash-lite-x');
    expect(text).toContain("latency 1234 ms · attempts 1 (ok)");
    expect(text).toContain("output: 2 projects");
    expect(text).toContain('Gemini step "experience" — flash-x');
    expect(text).toContain("output: 1 role");
  });

  it("prints skipped steps and why they were skipped", () => {
    const { report, all } = capture(true);
    report.merge({
      dropped: [],
      replaced: [],
      partial: [],
      skipped: [
        { step: "projects", reason: "no section headings" },
        { step: "experience", reason: "no Experience section" },
      ],
      suggestions,
    });
    expect(all()).toContain("projects: skipped (no section headings)");
    expect(all()).toContain("experience: skipped (no Experience section)");
  });

  it("prints dropped projects, roles and lines with their block and reason", () => {
    const { report, all } = capture(true);
    report.merge({
      dropped: [
        {
          what: "project",
          value: "Ghost app",
          reason: "title not in its block",
          block: "P3",
        },
        {
          what: "outcome",
          value: "Grew sales 40%",
          reason: "not word for word in its block",
          block: "E2",
        },
      ],
      replaced: [],
      partial: [],
      skipped: [],
      suggestions,
    });
    expect(all()).toContain(
      'project "Ghost app" in P3: title not in its block',
    );
    expect(all()).toContain(
      'outcome "Grew sales 40%" in E2: not word for word in its block',
    );
  });

  it("prints replaced client names per entry as name → generic", () => {
    const { report, all } = capture(true);
    report.merge({
      dropped: [],
      replaced: [
        {
          block: "P1",
          name: "Acme Realty",
          generic: "a US real-estate agency",
          source: "model",
        },
        {
          block: "E2",
          name: "Blue Bank",
          generic: "a client",
          source: "organisation",
        },
      ],
      partial: [],
      skipped: [],
      suggestions,
    });
    expect(all()).toContain(
      'P1: "Acme Realty" → "a US real-estate agency" (model)',
    );
    expect(all()).toContain('E2: "Blue Bank" → "a client" (organisation)');
  });

  it("prints nothing for the new parts when disabled, even with blocks and replacements", () => {
    const out = vi.fn();
    const report = createDevReport({
      enabled: false,
      jobId: "j1",
      kind: "resume",
      attempt: 1,
      out,
    });
    report.prepass(input(), null);
    report.merge({
      dropped: [
        {
          what: "project",
          value: "Ghost app",
          reason: "title not in its block",
          block: "P3",
        },
      ],
      replaced: [
        {
          block: "P1",
          name: "Acme Realty",
          generic: "a client",
          source: "model",
        },
      ],
      partial: [],
      skipped: [{ step: "projects", reason: "no section headings" }],
      suggestions,
    });
    expect(out).not.toHaveBeenCalled();
  });

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
