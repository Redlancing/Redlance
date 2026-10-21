import { createClient, createFakeTransport, LlmError } from "@redlance/llm";
import { describe, expect, it } from "vitest";
import { stubDraftResponder } from "../../stub-llm";
import { loadCases } from "./cases";
import { isJudgeRequest, stubJudgeResponder } from "./judge";
import {
  CostLimitError,
  parseArgs,
  runEval,
  stubEvalLlm,
  worsenedCases,
  type CaseResult,
  type EvalReport,
} from "./run";

const cases = loadCases();
const models = {
  draft: "gemini-3.8-flash",
  rewrite: "gemini-3.5-flash-lite",
  judge: "gemini-3.8-flash",
};

describe("run.ts with the stub LLM (case 6)", () => {
  it("scores every case and records the validator results", async () => {
    const report = await runEval({
      cases,
      llm: stubEvalLlm(),
      models,
      stub: true,
    });
    expect(report.cases).toHaveLength(
      cases.drafts.length + cases.rewrites.length,
    );
    expect(report.stub).toBe(true);
    for (const c of report.cases) {
      expect(c.error, c.id).toBeUndefined();
      expect(c.skipped, c.id).toBeUndefined();
      expect(c.scores, c.id).not.toBeNull();
      expect(c.validator.problems, c.id).toBeInstanceOf(Array);
      expect(c.validator.pass, c.id).toBe(c.validator.problems.length === 0);
      expect(c.scores!.expect.length, c.id).toBeGreaterThan(0);
    }
    expect(report.totals).toMatchObject({
      cases: 50,
      scored: 50,
      errors: 0,
      validatorPassRate: 1,
      inventedCount: 0,
      expectPassRate: 1,
    });
    expect(report.totals.means.specific).toBe(4);
    expect(report.promptVersion).toMatch(/^draft@\d+$/);
    expect(report.costUsd).toBeGreaterThan(0);
  });

  it("records a validator failure and an invented fact", async () => {
    const llm = createClient(
      createFakeTransport((req) => {
        if (isJudgeRequest(req.prompt))
          return {
            ...stubJudgeResponder(req.prompt),
            invented: { yes: true, quote: "37% faster" },
          };
        const out = stubDraftResponder(req) as { dm: string };
        return { ...out, dm: `${out.dm} It made pages 37% faster.` };
      }),
      { sleep: async () => {} },
    );
    const report = await runEval({
      cases: { drafts: cases.drafts.slice(0, 2), rewrites: [] },
      llm,
      models,
    });
    for (const c of report.cases) {
      expect(c.validator.pass).toBe(false);
      expect(c.validator.problems).toContain("UNSUPPORTED_NUMBER");
      expect(c.scores!.invented).toEqual({ yes: true, quote: "37% faster" });
    }
    expect(report.totals.validatorPassRate).toBe(0);
    expect(report.totals.inventedCount).toBe(2);
  });

  it("records a failing call as an error and keeps going", async () => {
    let n = 0;
    const llm = createClient(
      createFakeTransport((req) => {
        if (n++ < 2) throw new Error("boom");
        return isJudgeRequest(req.prompt)
          ? stubJudgeResponder(req.prompt)
          : stubDraftResponder(req);
      }),
      { sleep: async () => {} },
    );
    const report = await runEval({
      cases: { drafts: cases.drafts.slice(0, 2), rewrites: [] },
      llm,
      models,
    });
    expect(report.cases[0]!.error).toBeDefined();
    expect(report.cases[1]!.scores).not.toBeNull();
    expect(report.totals.errors).toBe(1);
  });

  it("waits and re-runs a case that Vertex throttled", async () => {
    let throttled = true;
    const llm = createClient(
      createFakeTransport((req) => {
        if (throttled)
          throw new LlmError("rate_limited", "Vertex AI rate limited");
        return isJudgeRequest(req.prompt)
          ? stubJudgeResponder(req.prompt)
          : stubDraftResponder(req);
      }),
      { sleep: async () => {} },
    );
    const waited: number[] = [];
    const report = await runEval({
      cases: { drafts: cases.drafts.slice(0, 1), rewrites: [] },
      llm,
      models,
      retryWaitsMs: [7, 9],
      sleep: async (ms) => {
        waited.push(ms);
        throttled = false;
      },
    });
    expect(waited).toEqual([7]);
    expect(report.cases[0]!.error).toBeUndefined();
    expect(report.cases[0]!.scores).not.toBeNull();
  });

  it("gives up on a throttled case after the last wait", async () => {
    const llm = createClient(
      createFakeTransport(() => {
        throw new LlmError("rate_limited", "Vertex AI rate limited");
      }),
      { sleep: async () => {} },
    );
    const waited: number[] = [];
    const report = await runEval({
      cases: { drafts: cases.drafts.slice(0, 1), rewrites: [] },
      llm,
      models,
      retryWaitsMs: [7, 9],
      sleep: async (ms) => void waited.push(ms),
    });
    expect(waited).toEqual([7, 9]);
    expect(report.cases[0]!.error).toMatch(/rate limited/);
  });

  it("skips a rewrite whose base case is not in the run", async () => {
    const report = await runEval({
      cases: { drafts: [], rewrites: cases.rewrites.slice(0, 1) },
      llm: stubEvalLlm(),
      models,
    });
    expect(report.cases[0]!.skipped).toMatch(/base draft/);
    expect(report.totals.skipped).toBe(1);
  });
});

const result = (id: string, over: Partial<CaseResult> = {}): CaseResult => ({
  id,
  kind: "draft",
  model: "m",
  attempts: 1,
  comment: "c",
  dm: "d",
  validator: { pass: true, problems: [], warning: false },
  scores: {
    specific: 4,
    followsInstructions: 4,
    soundsHuman: 4,
    citedWorkFits: 4,
    invented: { yes: false, quote: null },
    expect: [{ check: "x", pass: true, note: "" }],
  },
  expectPassRate: 1,
  costUsd: 0,
  ...over,
});
const report = (cs: CaseResult[]): EvalReport => ({
  promptVersion: "draft@1",
  judgeVersion: "judge@1",
  model: "m",
  rewriteModel: "m",
  judgeModel: "m",
  date: "2026-10-19T00:00:00.000Z",
  stub: false,
  costUsd: 0,
  totals: {} as EvalReport["totals"],
  cases: cs,
});

describe("--baseline diff (case 7)", () => {
  it("prints the worsened cases only", () => {
    const prev = report([
      result("same"),
      result("worse-score"),
      result("worse-validator"),
      result("worse-invent"),
      result("worse-expect"),
      result("better"),
      result("only-before"),
    ]);
    const s = result("x").scores!;
    const next = report([
      result("same"),
      result("worse-score", { scores: { ...s, soundsHuman: 2 } }),
      result("worse-validator", {
        validator: { pass: false, problems: ["DM_TOO_LONG"], warning: true },
      }),
      result("worse-invent", {
        scores: { ...s, invented: { yes: true, quote: "10 years" } },
      }),
      result("worse-expect", {
        scores: { ...s, expect: [{ check: "x", pass: false, note: "" }] },
      }),
      result("better", { scores: { ...s, specific: 5, soundsHuman: 5 } }),
      result("brand-new", {
        validator: { pass: false, problems: ["EMPTY"], warning: false },
      }),
    ]);
    const lines = worsenedCases(prev, next);
    expect(lines.map((l) => l.split(":")[0])).toEqual([
      "worse-score",
      "worse-validator",
      "worse-invent",
      "worse-expect",
    ]);
    expect(lines[0]).toContain("soundsHuman 4 -> 2");
    expect(lines[1]).toContain("DM_TOO_LONG");
    expect(lines[2]).toContain("10 years");
    expect(worsenedCases(prev, prev)).toEqual([]);
  });

  it("does not count a one-point wobble of 0 and counts a case that now errors", () => {
    const prev = report([result("a"), result("b")]);
    const next = report([
      result("a"),
      result("b", { error: "boom", scores: null }),
    ]);
    expect(worsenedCases(prev, next)).toEqual(["b: now errors"]);
  });
});

describe("cost guard (case 8)", () => {
  it("aborts when the running cost passes the limit", async () => {
    const err = await runEval({
      cases,
      llm: stubEvalLlm(),
      models,
      costLimitUsd: 0.0005,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CostLimitError);
    expect(err.spentUsd).toBeGreaterThan(0.0005);
    expect(err.completed).toBeGreaterThan(0);
    expect(err.completed).toBeLessThan(50);
  });

  it("finishes when the cost stays under the limit", async () => {
    const r = await runEval({
      cases: { drafts: cases.drafts.slice(0, 2), rewrites: [] },
      llm: stubEvalLlm(),
      models,
      costLimitUsd: 3,
    });
    expect(r.cases).toHaveLength(2);
  });
});

describe("parseArgs", () => {
  it("reads the flags", () => {
    expect(
      parseArgs([
        "--model",
        "m1",
        "--baseline",
        "--stub",
        "--cost-limit=1.5",
        "--judge-model",
        "j",
      ]),
    ).toEqual({
      model: "m1",
      judgeModel: "j",
      baseline: true,
      stub: true,
      costLimitUsd: 1.5,
    });
    expect(parseArgs([])).toEqual({
      model: undefined,
      judgeModel: undefined,
      baseline: false,
      stub: false,
      costLimitUsd: undefined,
    });
  });
});
