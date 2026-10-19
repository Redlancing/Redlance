import { existsSync, readFileSync } from "node:fs";
import { DRAFT_EXAMPLES, normalise } from "@redlance/core";
import { describe, expect, it } from "vitest";
import { DRAFT_PROMPT_VERSION } from "../../../src/drafts/prompt";
import { loadCases } from "./cases";

// The CI guard (docs/drafts/plan/10-eval.md): changing the prompt must be followed by an eval
// run. This reads the committed report only, so CI needs no Google credentials. (Guard case 4,
// the case counts, is in cases.test.ts.)

const REPORT = new URL("./report.json", import.meta.url);
const { drafts, rewrites } = loadCases();

describe("draft eval guard", () => {
  it("1. report.json exists", () => {
    expect(
      existsSync(REPORT),
      "run npm run eval:drafts -w @redlance/worker",
    ).toBe(true);
  });

  it("2. the report is for the current prompt version", () => {
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      promptVersion: string;
    };
    expect(
      report.promptVersion,
      `Prompt changed: run npm run eval:drafts (report is ${report.promptVersion}, prompt is ${DRAFT_PROMPT_VERSION})`,
    ).toBe(DRAFT_PROMPT_VERSION);
  });

  it("2b. the report scored every current case", () => {
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      cases: { id: string }[];
    };
    const ids = new Set(report.cases.map((c) => c.id));
    for (const c of [...drafts, ...rewrites])
      expect(
        ids.has(c.id),
        `${c.id} is not in report.json: run npm run eval:drafts`,
      ).toBe(true);
  });

  it("3. no eval case matches a library example (the two stay separate)", () => {
    // A case text equal to, or containing, an example's post excerpt or text (or the reverse)
    // would let the model see an answer to the question it is graded on.
    const same = (a: string, b: string) => {
      const x = normalise(a);
      const y = normalise(b);
      if (!x || !y) return false;
      const short = x.length <= y.length ? x : y;
      const long = short === x ? y : x;
      return short === long || (short.length >= 40 && long.includes(short));
    };
    for (const c of drafts)
      for (const ex of DRAFT_EXAMPLES)
        for (const t of [ex.postExcerpt, ex.text])
          for (const part of [
            c.post.title,
            c.post.body,
            `${c.post.title}\n${c.post.body}`,
          ])
            expect(same(part, t), `${c.id} matches example ${ex.id}`).toBe(
              false,
            );
  });

  it("5. no case contains a Reddit username or a real email", () => {
    for (const c of [...drafts, ...rewrites]) {
      const text = JSON.stringify(c);
      expect(text, c.id).not.toMatch(
        /(?<![A-Za-z0-9])\/?u\/(?!\[user\])[A-Za-z0-9_-]{3,}/,
      );
      for (const m of text.match(
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
      ) ?? [])
        expect(m, `${c.id}: ${m}`).toMatch(/@example\.(com|org|net)$/);
    }
  });
});
