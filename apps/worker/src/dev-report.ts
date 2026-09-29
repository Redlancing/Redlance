import type { Suggestions } from "@redlance/core";
import { repoSkillIds, type GithubRepo } from "./github/map";
import type { MergeReport, StepResult } from "./resume/pipeline";
import type { PipelineInput } from "./resume/steps/shared";

/**
 * Readable, multi-line console output of what an import job did, for local dev
 * only (APP_ENV=local). It shows model output and evidence quotes, so it must
 * never be enabled in staging or production; there every method is a no-op.
 */
export type DevReport = {
  readonly enabled: boolean;
  /** Where the resume text came from. */
  text(source: "file" | "saved-text", info: { chars: number }): void;
  /** Whether Gemini ran or the cached result was served. */
  analysis(path: "gemini" | "cache"): void;
  prepass(input: PipelineInput, githubUsername: string | null): void;
  step(result: StepResult): void;
  merge(report: MergeReport): void;
  /** The suggestions the job returns. */
  result(suggestions: Suggestions): void;
  github(info: {
    username: string;
    repos: GithubRepo[];
    suggestions: Suggestions;
  }): void;
  /** Closing line: status, error code, total time and model cost. */
  end(status: string, errorCode: string | null): void;
};

const NOOP: DevReport = {
  enabled: false,
  text() {},
  analysis() {},
  prepass() {},
  step() {},
  merge() {},
  result() {},
  github() {},
  end() {},
};

const indent = (s: string, n = 4) =>
  s
    .split("\n")
    .map((l) => " ".repeat(n) + l)
    .join("\n");
const json = (v: unknown) => indent(JSON.stringify(v, null, 2));
const dollars = (micros: number) => `$${(micros / 1e6).toFixed(6)}`;

export function createDevReport(opts: {
  enabled: boolean;
  jobId: string;
  kind: string;
  attempt: number;
  /** Where lines go (tests); defaults to console.log. */
  out?: (text: string) => void;
}): DevReport {
  if (!opts.enabled) return NOOP;
  const out = opts.out ?? ((t: string) => console.log(t));
  const started = Date.now();
  let costMicros = 0;
  let calls = 0;
  let headed = false;
  const print = (text: string) => {
    if (!headed) {
      headed = true;
      out(
        `\n── ${opts.kind} import ${opts.jobId} (attempt ${opts.attempt}) ──`,
      );
    }
    out(text);
  };

  return {
    enabled: true,
    text(source, info) {
      print(
        source === "file"
          ? `path: parser read the uploaded file → ${info.chars} chars of text`
          : `path: retry: using saved text (file already deleted) → ${info.chars} chars`,
      );
    },
    analysis(path) {
      print(
        path === "gemini"
          ? "path: parser + Gemini"
          : "path: served from cache — Gemini NOT called",
      );
    },
    prepass(input, githubUsername) {
      const sections = Object.entries(input.sections)
        .filter(([, v]) => v.trim())
        .map(([k, v]) => `${k} (${v.length})`);
      print(
        [
          "pre-pass (no model):",
          `  text length:   ${input.text.length} chars`,
          `  sections:      ${sections.join(", ") || "(none)"}`,
          `  years of exp.: ${input.yearsExperience ?? "unknown"}`,
          `  shortlist:     ${input.shortlist.length} skill ids — ${input.shortlist.join(", ") || "(none)"}`,
          `  GitHub user:   ${githubUsername ?? "(none found)"}`,
        ].join("\n"),
      );
    },
    step(r) {
      calls += r.attempts.length;
      const tokens = { input: 0, output: 0, thought: 0, cost: 0 };
      for (const a of r.attempts) {
        tokens.input += a.usage?.inputTokens ?? 0;
        tokens.output += a.usage?.outputTokens ?? 0;
        tokens.thought += a.usage?.thoughtTokens ?? 0;
        tokens.cost += a.usage?.costMicros ?? 0;
      }
      costMicros += tokens.cost;
      const outcomes = r.attempts.map((a) => a.outcome).join(", ") || "none";
      print(
        [
          `Gemini step "${r.step}" — ${r.model}`,
          `  latency ${r.ms} ms · attempts ${r.attempts.length} (${outcomes})`,
          `  tokens: input ${tokens.input} · output ${tokens.output} (thought ${tokens.thought}) · cost ${dollars(tokens.cost)}`,
          r.error ? `  FAILED: ${r.error}` : `  returned:\n${json(r.output)}`,
        ].join("\n"),
      );
    },
    merge(m) {
      const lines = ["evidence check + merge:"];
      if (m.dropped.length === 0) lines.push("  dropped: nothing");
      else {
        lines.push(`  dropped ${m.dropped.length}:`);
        for (const d of m.dropped)
          lines.push(`    - ${d.what} ${JSON.stringify(d.value)}: ${d.reason}`);
      }
      if (m.partial.length)
        lines.push(`  partial (steps that failed): ${m.partial.join(", ")}`);
      print(lines.join("\n"));
    },
    result(suggestions) {
      print(`final suggestions:\n${json(suggestions)}`);
    },
    github({ username, repos, suggestions }) {
      const lines = [`GitHub user ${username}: ${repos.length} repos fetched`];
      for (const r of repos) {
        const skipped = r.fork ? "fork" : r.archived ? "archived" : null;
        const ids = skipped ? [] : [...repoSkillIds(r)];
        lines.push(
          `  - ${r.name}${skipped ? ` (skipped: ${skipped})` : ""}: ` +
            `language ${r.language ?? "none"}, topics [${r.topics.join(", ")}], ★${r.stargazers_count}` +
            (skipped ? "" : ` → ${ids.join(", ") || "no skills"}`),
        );
      }
      print(lines.join("\n"));
      print(`final suggestions:\n${json(suggestions)}`);
    },
    end(status, errorCode) {
      const ms = Date.now() - started;
      print(
        `── end ${opts.kind} import ${opts.jobId}: ${status}` +
          (errorCode ? ` (${errorCode})` : "") +
          ` · ${ms} ms total` +
          (calls
            ? ` · ${calls} Gemini calls · cost ${dollars(costMicros)}`
            : "") +
          " ──",
      );
    },
  };
}

/** For handlers called without a runner (tests). */
export const noDevReport: DevReport = NOOP;
