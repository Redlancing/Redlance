import type { Evidence } from "@redlance/core";
import type { recordLlmUsage } from "@redlance/db";
import {
  LlmError,
  createClient,
  createFakeTransport,
  type GenerateRequest,
} from "@redlance/llm";
import { describe, expect, it } from "vitest";
import {
  DraftDeadline,
  generateDraft,
  type GenerateDraftInput,
} from "./generate";
import { DRAFT_PROMPT_VERSION } from "./prompt";

type UsageRow = Parameters<typeof recordLlmUsage>[1];

const DRAFT_MODEL = "flash-test";
const REWRITE_MODEL = "lite-test";
const LINK = "https://github.com/sam/dance-booking";

const evidence: Evidence = {
  project: {
    id: "p1",
    title: "Booking site for a dance school",
    summary: "Class booking and payments in Next.js with Stripe.",
    outcomes: ["Replaced phone bookings"],
    skills: ["Next.js", "Stripe"],
    link: LINK,
    year: 2025,
  },
  role: null,
  skills: ["Next.js"],
  allowedLinks: [LINK],
  rateNote: { mention: false },
  availability: null,
  redFlags: [],
  broad: false,
  employerNamesAllowed: false,
  organisationNames: [],
  evidenceText: "Project: Booking site for a dance school (2025)",
  summary: {
    projectTitle: "Booking site for a dance school",
    roleTitle: null,
    skills: ["Next.js"],
  },
  citedProjectIds: ["p1"],
};

const COMMENT =
  "Built a booking site for a dance school in Next.js. Sent you a DM.";
const DM = [
  "Hi, it sounds like your class bookings need to move online without a lot of back and forth.",
  `I built a booking site for a dance school with Next.js and Stripe, here it is: ${LINK}.`,
  "It replaced their phone bookings.",
  "I would start with your current setup, get booking and payment working first, and keep you posted as I go.",
  "I can share a short plan once I know a bit more about the scope.",
  "Would a quick chat this week work for you?",
].join(" ");

const good = {
  problem: "They need online class booking",
  citedFact: "Built a booking site for a dance school",
  applyInstructions: null,
  comment: COMMENT,
  dm: DM,
};
const invented = {
  ...good,
  dm: DM.replace("It replaced", "It cut no-shows by 60% and replaced"),
};

const input = (over: Partial<GenerateDraftInput> = {}): GenerateDraftInput => ({
  userId: "00000000-0000-0000-0000-000000000001",
  jobPostId: "00000000-0000-0000-0000-000000000002",
  kind: "draft",
  option: null,
  postText:
    "[Hiring] Booking site for my yoga studio. Need class booking online.",
  prompt: {
    evidence,
    post: {
      title: "[Hiring] Booking site for my yoga studio",
      body: "Need class booking online.",
      subreddit: "forhire",
      alsoPostedIn: [],
    },
    analysis: {
      summary: "Online class booking",
      categories: ["development"],
      skillIds: ["nextjs"],
      employmentType: "freelance",
      payType: "paid",
      budgetMin: null,
      budgetMax: null,
      currency: null,
      budgetUnit: null,
      remote: "remote",
      location: null,
      deadline: null,
      applyInstructions: null,
    },
    examples: [],
    voice: null,
    length: { dmMin: 60, dmMax: 150 },
  },
  ...over,
});

const rewrite = (option: "shorter" | "different_project") =>
  input({
    kind: "rewrite",
    option,
    prompt: {
      ...input().prompt,
      rewrite: { option, previous: { comment: COMMENT, dm: DM } },
    },
  });

/** A fake client answering from `answers` in turn (the last one repeats). */
function scripted(answers: unknown[]) {
  const seen: GenerateRequest<unknown>[] = [];
  const llm = createClient(
    createFakeTransport((req) => {
      seen.push(req);
      const a = answers[Math.min(seen.length - 1, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    }),
    { sleep: async () => {} },
  );
  return { llm, seen };
}

function run(
  answers: unknown[],
  over: Partial<GenerateDraftInput> = {},
  ctx?: GenerateDraftInput,
) {
  const { llm, seen } = scripted(answers);
  const records: UsageRow[] = [];
  const result = generateDraft(ctx ?? input(over), {
    llm,
    draftModel: DRAFT_MODEL,
    rewriteModel: REWRITE_MODEL,
    onAttempt: (r) => records.push(r),
  });
  return { result, seen, records };
}

describe("generateDraft", () => {
  it("1: a valid first answer: one call, no problems, the draft model", async () => {
    const { result, seen } = run([good]);
    const r = await result;
    expect(r.attempts).toBe(1);
    expect(r.problems).toEqual([]);
    expect(r.warning).toBe(false);
    expect(r.model).toBe(DRAFT_MODEL);
    expect(r.output).toEqual(good);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      model: DRAFT_MODEL,
      temperature: 0.7,
      thinking: "off",
      maxOutputTokens: 800,
      timeoutMs: 15_000,
      retries: 1,
    });
    expect(r.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      costMicros: 0,
    });
  });

  it("2: an invented 60% is retried once with the problem, and the clean retry is kept", async () => {
    const { result, seen } = run([invented, good]);
    const r = await result;
    expect(r.attempts).toBe(2);
    expect(r.warning).toBe(false);
    expect(r.problems).toEqual([]);
    expect(r.output.dm).toBe(DM);
    expect(seen[0]!.prompt).not.toContain("<problems>");
    expect(seen[1]!.prompt).toContain("<problems>");
    expect(seen[1]!.prompt).toContain("60%");
    expect(seen[1]!.model).toBe(DRAFT_MODEL);
    expect(r.usage.inputTokens).toBe(200);
  });

  it("3: both answers invalid: warning, with the second answer's problems", async () => {
    const r = await run([invented, invented]).result;
    expect(r.attempts).toBe(2);
    expect(r.warning).toBe(true);
    expect(r.problems).toEqual([{ code: "UNSUPPORTED_NUMBER", detail: "60%" }]);
    expect(r.output.dm).toContain("60%");
  });

  it("4: a style rewrite uses the rewrite model; different_project the draft model", async () => {
    const a = run([good], {}, rewrite("shorter"));
    expect((await a.result).model).toBe(REWRITE_MODEL);
    expect(a.seen[0]!.model).toBe(REWRITE_MODEL);
    const b = run([good], {}, rewrite("different_project"));
    expect((await b.result).model).toBe(DRAFT_MODEL);
  });

  it("5: a style rewrite that fails validation retries on the draft model", async () => {
    const { result, seen } = run([invented, good], {}, rewrite("shorter"));
    const r = await result;
    expect(seen.map((s) => s.model)).toEqual([REWRITE_MODEL, DRAFT_MODEL]);
    expect(r.model).toBe(DRAFT_MODEL);
    expect(r.warning).toBe(false);
  });

  it("6: every attempt is recorded with the task and step, and no text", async () => {
    const { result, records } = run([invented, good]);
    await result;
    expect(records).toHaveLength(2);
    expect(records.map((r) => [r.task, r.step, r.model])).toEqual([
      ["draft", "generate", DRAFT_MODEL],
      ["draft", "retry", DRAFT_MODEL],
    ]);
    for (const r of records)
      expect(r).toMatchObject({
        userId: input().userId,
        jobPostId: input().jobPostId,
        promptVersion: DRAFT_PROMPT_VERSION,
        inputTokens: 100,
        outputTokens: 50,
        costMicros: 0,
        attempt: 1,
        outcome: "ok",
      });
    const json = JSON.stringify(records);
    for (const text of ["dance school", "yoga", "60%", "Sent you a DM", LINK])
      expect(json).not.toContain(text);

    const rw = run([good], {}, rewrite("shorter"));
    await rw.result;
    expect(rw.records.map((r) => [r.task, r.step])).toEqual([
      ["rewrite", "generate"],
    ]);
  });

  it("6b: failed LLM attempts are recorded before the error is thrown", async () => {
    const { result, records } = run([new LlmError("rate_limited", "429")]);
    await expect(result).rejects.toMatchObject({ kind: "rate_limited" });
    expect(records.map((r) => [r.step, r.attempt, r.outcome])).toEqual([
      ["generate", 1, "error"],
      ["generate", 2, "error"],
    ]);
  });

  it("an error on the validator retry keeps the first answer, with a warning", async () => {
    const r = await run([invented, new LlmError("server", "500")]).result;
    expect(r.warning).toBe(true);
    expect(r.problems.map((p) => p.code)).toEqual(["UNSUPPORTED_NUMBER"]);
    expect(r.output).toEqual(invented);
  });

  it("a number from the user's typed instruction is allowed", async () => {
    const r = await run([invented], {
      instruction: "say I cut no-shows by 60%",
    }).result;
    expect(r.problems).toEqual([]);
    expect(r.attempts).toBe(1);
  });

  it("the draft's deadline during the validator retry keeps the first answer, with a warning (L8)", async () => {
    const ac = new AbortController();
    const { llm } = scripted([invented, new Promise(() => {})]);
    const p = generateDraft(input(), {
      llm,
      draftModel: DRAFT_MODEL,
      rewriteModel: REWRITE_MODEL,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(new DraftDeadline()), 20);
    const r = await p;
    expect(r.warning).toBe(true);
    expect(r.output).toEqual(invented);
    expect(r.problems.map((x) => x.code)).toEqual(["UNSUPPORTED_NUMBER"]);
  });

  it("an abort is passed through, never turned into a warning", async () => {
    const ac = new AbortController();
    const { llm } = scripted([invented, new Promise(() => {})]);
    const p = generateDraft(input(), {
      llm,
      draftModel: DRAFT_MODEL,
      rewriteModel: REWRITE_MODEL,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
  });
});
