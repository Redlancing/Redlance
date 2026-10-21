/**
 * Draft eval: runs every case through the real draft pipeline (evidence, prompt, model,
 * validators), has an AI judge score each draft, and writes `report.json`.
 *
 *   npm run eval:drafts -w @redlance/worker -- [--model <id>] [--judge-model <id>]
 *                                              [--baseline] [--stub] [--cost-limit <usd>]
 *
 *   --model        model for first drafts AND rewrites (default: DRAFT_MODEL / REWRITE_MODEL from env)
 *   --baseline     compare with the previous report.json and print only the cases that got worse
 *   --stub         no network: the stub LLM answers (a smoke test of the harness, not a quality measure)
 *   --cost-limit   stop when the run's cost passes this many USD (default 3)
 *
 * Live runs need GOOGLE_CLOUD_PROJECT/LOCATION and Google credentials (like the other evals).
 * Not part of `npm test`; `guard.test.ts` is, and fails when the prompt version in
 * `report.json` is not the current one.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildEvidence,
  lengthTarget,
  ruleScore,
  DRAFT_EXAMPLES,
  type BudgetUnit,
  type Evidence,
  type EvidenceInput,
  type MatchPost,
  type MatchProfile,
  type RewriteOption,
} from "@redlance/core";
import {
  createClient,
  createFakeTransport,
  type LlmClient,
} from "@redlance/llm";
import {
  DRAFT_PROMPT_VERSION,
  type PromptExample,
} from "../../../src/drafts/prompt";
import { generateDraft } from "../../../src/drafts/generate";
import { stubDraftResponder } from "../../stub-llm";
import {
  loadCases,
  type DraftCase,
  type LoadedCases,
  type RewriteCase,
} from "./cases";
import {
  JUDGE_VERSION,
  isJudgeRequest,
  judgeDraft,
  stubJudgeResponder,
  type JudgeScores,
} from "./judge";
import { PROFILE_BY_ID, type EvalProfile } from "./profiles";

export const REPORT_URL = new URL("./report.json", import.meta.url);
export const DEFAULT_COST_LIMIT_USD = 3;

// ---- Report ------------------------------------------------------------------------------------

export type CaseResult = {
  id: string;
  kind: "draft" | "rewrite";
  baseCaseId?: string;
  /** Why the case could not run (for example, no other project for "different project"). */
  skipped?: string;
  /** The call failed: the message (never the prompt). */
  error?: string;
  model: string | null;
  attempts: number;
  comment: string;
  dm: string;
  validator: { pass: boolean; problems: string[]; warning: boolean };
  scores: JudgeScores | null;
  /** Share of the case's `expect` checks that passed; null without scores. */
  expectPassRate: number | null;
  costUsd: number;
};

export type Totals = {
  cases: number;
  scored: number;
  errors: number;
  skipped: number;
  /** Over the cases that ran (not skipped): share whose draft has no validator problem. */
  validatorPassRate: number;
  means: {
    specific: number | null;
    followsInstructions: number | null;
    soundsHuman: number | null;
    citedWorkFits: number | null;
  };
  inventedCount: number;
  /** Passed checks over all checks. */
  expectPassRate: number | null;
};

export type EvalReport = {
  promptVersion: string;
  judgeVersion: string;
  model: string;
  rewriteModel: string;
  judgeModel: string;
  date: string;
  /** True when the stub LLM answered: a harness smoke test, with simulated costs. */
  stub: boolean;
  costUsd: number;
  totals: Totals;
  cases: CaseResult[];
};

const mean = (xs: number[]) =>
  xs.length
    ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100
    : null;

export function computeTotals(cases: CaseResult[]): Totals {
  const ran = cases.filter((c) => !c.skipped);
  const scored = ran.filter((c) => c.scores);
  const drafted = ran.filter((c) => !c.error);
  const nums = (pick: (s: JudgeScores) => number | null) =>
    scored.flatMap((c) => {
      const v = pick(c.scores!);
      return v === null ? [] : [v];
    });
  const checks = scored.flatMap((c) => c.scores!.expect);
  return {
    cases: cases.length,
    scored: scored.length,
    errors: ran.filter((c) => c.error).length,
    skipped: cases.length - ran.length,
    // Only cases that produced a draft: an errored case has nothing to validate.
    validatorPassRate: drafted.length
      ? Math.round(
          (drafted.filter((c) => c.validator.pass).length / drafted.length) *
            1000,
        ) / 1000
      : 0,
    means: {
      specific: mean(nums((s) => s.specific)),
      followsInstructions: mean(nums((s) => s.followsInstructions)),
      soundsHuman: mean(nums((s) => s.soundsHuman)),
      citedWorkFits: mean(nums((s) => s.citedWorkFits)),
    },
    inventedCount: scored.filter((c) => c.scores!.invented.yes).length,
    expectPassRate: checks.length
      ? Math.round(
          (checks.filter((e) => e.pass).length / checks.length) * 1000,
        ) / 1000
      : null,
  };
}

// ---- Baseline comparison -----------------------------------------------------------------------

/** The scores a drop in which counts as "worse". */
const SCORE_KEYS = [
  "specific",
  "followsInstructions",
  "soundsHuman",
  "citedWorkFits",
] as const;

/**
 * The cases that got worse between two reports, one line each. A case is worse when the
 * validators passed before and fail now, a judge score dropped by 1 or more, it invented
 * something it didn't before, it passes fewer `expect` checks, or it errored/was skipped now but
 * not before. Cases only in one report are ignored. Improvements are not listed.
 */
export function worsenedCases(prev: EvalReport, next: EvalReport): string[] {
  const before = new Map(prev.cases.map((c) => [c.id, c]));
  const lines: string[] = [];
  for (const c of next.cases) {
    const p = before.get(c.id);
    if (!p) continue;
    const why: string[] = [];
    if ((c.error || c.skipped) && !(p.error || p.skipped))
      why.push(c.error ? "now errors" : `now skipped (${c.skipped})`);
    else if (!c.error && !c.skipped && !p.error && !p.skipped) {
      if (p.validator.pass && !c.validator.pass)
        why.push(`validators now fail (${c.validator.problems.join(", ")})`);
      if (p.scores && c.scores) {
        for (const k of SCORE_KEYS) {
          const a = p.scores[k];
          const b = c.scores[k];
          if (a !== null && b !== null && b <= a - 1)
            why.push(`${k} ${a} -> ${b}`);
        }
        if (!p.scores.invented.yes && c.scores.invented.yes)
          why.push(`now invents: "${c.scores.invented.quote ?? "?"}"`);
        const failed = (s: JudgeScores) =>
          s.expect.filter((e) => !e.pass).length;
        if (failed(c.scores) > failed(p.scores))
          why.push(
            `expect failures ${failed(p.scores)} -> ${failed(c.scores)}`,
          );
      }
    }
    if (why.length) lines.push(`${c.id}: ${why.join("; ")}`);
  }
  return lines;
}

// ---- Cost guard --------------------------------------------------------------------------------

export class CostLimitError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number,
    readonly completed: number,
    readonly total: number,
  ) {
    super(
      `Cost guard: the run reached $${spentUsd.toFixed(4)}, over the $${limitUsd} limit, after ${completed} of ${total} cases`,
    );
    this.name = "CostLimitError";
  }
}

// ---- Case -> pipeline inputs -------------------------------------------------------------------

/** The library examples the prompt shows for a post's job type (DB-free copy of `pickExamples`). */
export function pickEvalExamples(jobType: string, n = 3): PromptExample[] {
  const ranked = [
    ...DRAFT_EXAMPLES.filter((e) => e.jobType === jobType),
    ...DRAFT_EXAMPLES.filter(
      (e) => e.jobType !== jobType && e.jobType === "general",
    ),
  ];
  const comments = ranked.filter((e) => e.channel === "comment");
  const dms = ranked.filter((e) => e.channel === "dm");
  return [...comments.slice(0, 1), ...dms.slice(0, n - 1)].map((e) => ({
    channel: e.channel,
    style: e.style,
    postExcerpt: e.postExcerpt,
    text: e.text,
  }));
}

function matchInputs(c: DraftCase, p: EvalProfile, now: Date) {
  const a = c.analysis;
  const post: MatchPost = {
    postedAt: now,
    kind: a.kind,
    employmentType: a.employmentType,
    payType: a.payType,
    categories: a.categories,
    skillIds: a.skillIds,
    budgetMin: a.budgetMin,
    budgetMax: a.budgetMax,
    currency: a.currency,
    budgetUnit: a.budgetUnit as BudgetUnit | null,
    remote: a.remote,
    deadline: a.deadline,
    redFlags: a.redFlags,
  };
  const profile: MatchProfile = {
    categories: p.categories,
    skills: p.skills.map((s) => ({ id: s.skillId, level: s.level })),
    workSkillIds: [
      ...new Set(
        [...p.projects, ...p.experience]
          .filter((e) => !e.hidden)
          .flatMap((e) => e.skillIds),
      ),
    ],
    minRateMinor: p.minRateMinor,
    currency: p.currency,
    rateType: p.rateType,
    remoteOnly: p.remoteOnly,
    includeUnpaid: p.includeUnpaid,
  };
  return { post, profile };
}

/** The evidence input for a case, built the way the drafter builds it from the database. */
export function evidenceInputFor(c: DraftCase, now: Date): EvidenceInput {
  const p = PROFILE_BY_ID.get(c.profileId);
  if (!p) throw new Error(`${c.id}: unknown profile "${c.profileId}"`);
  const { post, profile } = matchInputs(c, p, now);
  const m = ruleScore(post, profile);
  return {
    now,
    post: { title: c.post.title, summary: c.analysis.summary },
    analysis: {
      payType: c.analysis.payType,
      categories: c.analysis.categories,
      skillIds: c.analysis.skillIds,
      budgetMin: c.analysis.budgetMin,
      budgetMax: c.analysis.budgetMax,
      currency: c.analysis.currency,
      budgetUnit: c.analysis.budgetUnit as BudgetUnit | null,
      deadline: c.analysis.deadline,
      redFlags: c.analysis.redFlags,
    },
    match: {
      broad: m.broad,
      features: m.features,
      bestProjectId: null,
      bestRoleId: null,
    },
    profile: {
      skills: profile.skills,
      githubUsername: p.githubUsername,
      mentionEmployers: p.mentionEmployers,
      minRateMinor: p.minRateMinor,
      currency: p.currency,
      rateType: p.rateType,
    },
    projects: p.projects,
    roles: p.experience,
  };
}

// ---- The run -----------------------------------------------------------------------------------

export type RunOptions = {
  cases: LoadedCases;
  llm: LlmClient;
  models: { draft: string; rewrite: string; judge: string };
  costLimitUsd?: number;
  stub?: boolean;
  now?: Date;
  /** Called after each case (the CLI prints a line). */
  onCase?: (r: CaseResult) => void;
  /** Waits before re-running a case that Vertex throttled or timed out; one retry per entry. */
  retryWaitsMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

/** Vertex's shared Flash-Lite capacity throttles in bursts (2026-10-21 runs lost 36 and 40 of 50). */
const DEFAULT_RETRY_WAITS_MS = [30_000, 60_000, 120_000];
const isTransient = (r: CaseResult) =>
  r.error !== undefined && /rate limited|timed out/i.test(r.error);

const usd = (micros: number) => micros / 1e6;

export async function runEval(opts: RunOptions): Promise<EvalReport> {
  const now = opts.now ?? new Date();
  const limit = opts.costLimitUsd ?? DEFAULT_COST_LIMIT_USD;
  const { drafts, rewrites } = opts.cases;
  const total = drafts.length + rewrites.length;
  const results: CaseResult[] = [];
  let micros = 0;
  const kept = new Map<
    string,
    { comment: string; dm: string; evidence: Evidence; input: EvidenceInput }
  >();
  const draftDeps = {
    llm: opts.llm,
    draftModel: opts.models.draft,
    rewriteModel: opts.models.rewrite,
  };

  async function one(
    c: DraftCase,
    rewrite?: {
      rc: RewriteCase;
      base: NonNullable<ReturnType<typeof kept.get>>;
    },
  ): Promise<CaseResult> {
    const id = rewrite ? rewrite.rc.id : c.id;
    const empty: CaseResult = {
      id,
      kind: rewrite ? "rewrite" : "draft",
      baseCaseId: rewrite?.rc.baseCaseId,
      model: null,
      attempts: 0,
      comment: "",
      dm: "",
      validator: { pass: false, problems: [], warning: false },
      scores: null,
      expectPassRate: null,
      costUsd: 0,
    };
    let spent = 0;
    try {
      const input = rewrite?.base.input ?? evidenceInputFor(c, now);
      const option: RewriteOption | null = rewrite
        ? (rewrite.rc.option ?? "custom")
        : null;
      let evidence: Evidence;
      if (option === "different_project") {
        const cited = rewrite!.base.evidence.citedProjectIds;
        evidence = buildEvidence({ ...input, exclude: { projectIds: cited } });
        if (!evidence.project || cited.includes(evidence.project.id))
          return { ...empty, skipped: "no other project to cite" };
      } else evidence = rewrite ? rewrite.base.evidence : buildEvidence(input);

      const instruction = rewrite?.rc.instruction ?? null;
      const gen = await generateDraft(
        {
          userId: "eval",
          jobPostId: "eval",
          kind: rewrite ? "rewrite" : "draft",
          option,
          instruction,
          postText: [
            c.post.title,
            c.post.body,
            c.analysis.applyInstructions ?? "",
          ].join("\n"),
          prompt: {
            evidence,
            post: { ...c.post, alsoPostedIn: [] },
            analysis: {
              ...c.analysis,
              budgetUnit: c.analysis.budgetUnit as BudgetUnit | null,
            },
            examples: pickEvalExamples(c.analysis.categories[0] ?? "general"),
            voice: null,
            length: lengthTarget(),
            rewrite:
              rewrite && option
                ? {
                    option,
                    instruction,
                    previous: {
                      comment: rewrite.base.comment,
                      dm: rewrite.base.dm,
                    },
                  }
                : undefined,
          },
        },
        draftDeps,
      );
      spent += gen.usage.costMicros;
      const out = gen.output;
      const base: CaseResult = {
        ...empty,
        model: gen.model,
        attempts: gen.attempts,
        comment: out.comment,
        dm: out.dm,
        validator: {
          pass: gen.problems.length === 0,
          problems: gen.problems.map((p) => p.code),
          warning: gen.warning,
        },
      };
      if (!rewrite)
        kept.set(c.id, { comment: out.comment, dm: out.dm, evidence, input });

      const judged = await judgeDraft(
        {
          case: {
            post: c.post,
            analysis: c.analysis,
            expect: rewrite ? rewrite.rc.expect : c.expect,
            rewriteRequest: rewrite
              ? (rewrite.rc.instruction ?? rewrite.rc.option)
              : undefined,
          },
          draft: out,
          previous: rewrite
            ? { comment: rewrite.base.comment, dm: rewrite.base.dm }
            : undefined,
          evidence,
        },
        { llm: opts.llm, model: opts.models.judge },
      );
      spent += judged.costMicros;
      const checks = judged.scores.expect;
      return {
        ...base,
        scores: judged.scores,
        expectPassRate: checks.length
          ? Math.round(
              (checks.filter((e) => e.pass).length / checks.length) * 1000,
            ) / 1000
          : null,
        costUsd: usd(spent),
      };
    } catch (e) {
      return {
        ...empty,
        error: (e as Error).message.slice(0, 300),
        costUsd: usd(spent),
      };
    } finally {
      micros += spent;
    }
  }

  const finish = (r: CaseResult) => {
    results.push(r);
    opts.onCase?.(r);
    if (usd(micros) > limit)
      throw new CostLimitError(usd(micros), limit, results.length, total);
  };

  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const waits = opts.retryWaitsMs ?? (opts.stub ? [] : DEFAULT_RETRY_WAITS_MS);
  async function withRetry(run: () => Promise<CaseResult>) {
    let r = await run();
    for (const ms of waits) {
      if (!isTransient(r)) break;
      await sleep(ms);
      r = await run();
    }
    return r;
  }

  for (const c of drafts) finish(await withRetry(() => one(c)));
  const byId = new Map(drafts.map((c) => [c.id, c]));
  for (const rc of rewrites) {
    const base = kept.get(rc.baseCaseId);
    const baseCase = byId.get(rc.baseCaseId);
    if (!base || !baseCase) {
      finish({
        id: rc.id,
        kind: "rewrite",
        baseCaseId: rc.baseCaseId,
        skipped: "the base draft did not run",
        model: null,
        attempts: 0,
        comment: "",
        dm: "",
        validator: { pass: false, problems: [], warning: false },
        scores: null,
        expectPassRate: null,
        costUsd: 0,
      });
      continue;
    }
    finish(await withRetry(() => one(baseCase, { rc, base })));
  }

  return {
    promptVersion: DRAFT_PROMPT_VERSION,
    judgeVersion: JUDGE_VERSION,
    model: opts.models.draft,
    rewriteModel: opts.models.rewrite,
    judgeModel: opts.models.judge,
    date: now.toISOString(),
    stub: opts.stub ?? false,
    costUsd: Math.round(usd(micros) * 1e6) / 1e6,
    totals: computeTotals(results),
    cases: results,
  };
}

/** A client whose model is the stub: drafts from `stubDraftResponder`, scores from the stub judge. */
export function stubEvalLlm(): LlmClient {
  return createClient(
    createFakeTransport((req) =>
      isJudgeRequest(req.prompt)
        ? stubJudgeResponder(req.prompt)
        : stubDraftResponder(req),
    ),
    { sleep: async () => {} },
  );
}

export function readReport(url: URL = REPORT_URL): EvalReport | null {
  return existsSync(url)
    ? (JSON.parse(readFileSync(url, "utf8")) as EvalReport)
    : null;
}

export function formatTotals(r: EvalReport): string {
  const t = r.totals;
  const f = (n: number | null) => (n === null ? "n/a" : String(n));
  return [
    `Prompt ${r.promptVersion} · ${r.model} (rewrites ${r.rewriteModel}) · judge ${r.judgeModel}${r.stub ? " · STUB" : ""}`,
    `Cases: ${t.cases} (${t.scored} scored, ${t.errors} errors, ${t.skipped} skipped)`,
    `Validators pass: ${(t.validatorPassRate * 100).toFixed(1)}%`,
    `Judge means: specific ${f(t.means.specific)} · follows instructions ${f(t.means.followsInstructions)} · sounds human ${f(t.means.soundsHuman)} · cited work fits ${f(t.means.citedWorkFits)}`,
    `Invented something: ${t.inventedCount} · expect checks pass: ${t.expectPassRate === null ? "n/a" : (t.expectPassRate * 100).toFixed(1) + "%"}`,
    `Cost: $${r.costUsd.toFixed(4)}`,
  ].join("\n");
}

// ---- CLI ---------------------------------------------------------------------------------------

export function parseArgs(argv: string[]) {
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0) return argv[i + 1];
    return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  };
  const limit = value("cost-limit");
  return {
    model: value("model"),
    judgeModel: value("judge-model"),
    baseline: argv.includes("--baseline"),
    stub: argv.includes("--stub"),
    costLimitUsd: limit === undefined ? undefined : Number(limit),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.costLimitUsd !== undefined && !(args.costLimitUsd >= 0))
    throw new Error("--cost-limit must be a number of USD");
  let llm: LlmClient;
  let models: RunOptions["models"];
  if (args.stub) {
    llm = stubEvalLlm();
    models = {
      draft: args.model ?? "gemini-3.8-flash",
      rewrite: args.model ?? "gemini-3.5-flash-lite",
      judge: args.judgeModel ?? "gemini-3.8-flash",
    };
  } else {
    const { parseWorkerEnv } = await import("../../../src/env");
    const { createLlmFromEnv } = await import("../../../src/llm");
    const env = parseWorkerEnv(process.env);
    llm = createLlmFromEnv(env);
    models = {
      draft: args.model ?? env.DRAFT_MODEL,
      rewrite: args.model ?? env.REWRITE_MODEL,
      judge: args.judgeModel ?? env.VERTEX_MODEL_SMART,
    };
  }
  const previous = readReport();
  const cases = loadCases();
  console.log(
    `Draft eval: ${cases.drafts.length} drafts + ${cases.rewrites.length} rewrites · ${models.draft} / ${models.rewrite} · judge ${models.judge}${args.stub ? " · STUB" : ""}\n`,
  );
  let report: EvalReport;
  try {
    report = await runEval({
      cases,
      llm,
      models,
      costLimitUsd: args.costLimitUsd,
      stub: args.stub,
      onCase: (r) =>
        console.log(
          `${r.error ? "x" : r.skipped ? "-" : r.validator.pass ? "ok" : "!!"} ${r.id.padEnd(34)} ${
            r.error
              ? `error: ${r.error}`
              : r.skipped
                ? `skipped: ${r.skipped}`
                : `validators ${r.validator.pass ? "pass" : r.validator.problems.join(",")}${r.scores ? ` · specific ${r.scores.specific} human ${r.scores.soundsHuman}${r.scores.invented.yes ? " · INVENTED" : ""}` : ""}`
          }`,
        ),
    });
  } catch (e) {
    if (e instanceof CostLimitError) {
      console.error(`\n${e.message}. No report written.`);
      process.exit(2);
    }
    throw e;
  }
  console.log(`\n${formatTotals(report)}`);
  if (args.baseline) {
    if (!previous) console.log("\nNo previous report.json to compare with.");
    else {
      const worse = worsenedCases(previous, report);
      console.log(
        `\nBaseline (${previous.promptVersion}, ${previous.model}, ${previous.date.slice(0, 10)}${previous.stub ? ", stub" : ""}): ${worse.length ? `${worse.length} case(s) got worse` : "no case got worse"}`,
      );
      for (const l of worse) console.log(`  ${l}`);
    }
  }
  writeFileSync(REPORT_URL, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nWrote ${REPORT_URL.pathname}`);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
