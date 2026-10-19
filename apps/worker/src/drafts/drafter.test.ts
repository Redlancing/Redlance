import type { Evidence } from "@redlance/core";
import {
  DRAFTS_CHANNEL,
  claimNextDrafts,
  completeDraft,
  createDb,
  createDraftJob,
  creditBalances,
  creditLedger,
  draftEvalCandidates,
  drafts,
  jobPostAnalyses,
  jobPosts,
  llmUsage,
  matches,
  profileExperience,
  profileProjects,
  profileSkills,
  profiles,
  syncReferenceData,
  users,
  type CreateDraftJobInput,
  type Draft,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import {
  LlmError,
  createClient,
  createFakeTransport,
  type GenerateRequest,
} from "@redlance/llm";
import { and, eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  STUB_INVENT_TWICE,
  isDraftRequest,
  stubDraftResponder,
} from "../../test/stub-llm";
import { createPgListener } from "../db";
import {
  createDrafter,
  createDrafterFromEnv,
  type DrafterDeps,
} from "./drafter";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 12 });
const silent = pino({ level: "silent" });

const DAY = 86_400_000;
const DRAFT_MODEL = "gemini-3.8-flash";
const REWRITE_MODEL = "gemini-3.5-flash-lite";
const BUDGET = { DRAFT_BUDGET_ALERT_USD: 40, DRAFT_BUDGET_PAUSE_USD: 80 };

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(
    sql`truncate table matches, job_post_analyses, job_posts, llm_usage cascade`,
  );
};

beforeAll(async () => {
  await runMigrations(url);
  await syncReferenceData(db);
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

// ---- Fixtures ----

let seq = 0;

type ProjectSpec = { title: string; link: string };
const SHOP: ProjectSpec = {
  title: "Shopfront for a bakery",
  link: "https://github.com/sam/shopfront",
};
const BOOKING: ProjectSpec = {
  title: "Booking site for a dance school",
  link: "https://github.com/sam/dance-booking",
};

async function seedUser(projects: ProjectSpec[] = [SHOP], balance = 210) {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|dr${seq}-${Math.random()}`,
      email: `dr${seq}@example.com`,
      emailNormalized: `dr${seq}-${Math.random()}@example.com`,
    })
    .returning({ id: users.id });
  const userId = u!.id;
  const now = new Date();
  await db.insert(profiles).values({
    userId,
    displayName: `User ${seq}`,
    categories: ["development"],
    experienceLevel: "experienced",
    country: "GB",
    timeZone: "Europe/London",
    minRateMinor: 3000,
    currency: "USD",
    rateType: "either",
    remoteOnly: true,
    includeUnpaid: false,
    plan: "trial",
    onboardedAt: now,
    trialEndsAt: new Date(now.getTime() + 5 * DAY),
  });
  await db.insert(profileSkills).values([
    { userId, skillId: "nextjs", level: "core", source: "manual" },
    { userId, skillId: "react", level: "secondary", source: "manual" },
  ]);
  const projectIds: string[] = [];
  for (const [i, p] of projects.entries()) {
    const [row] = await db
      .insert(profileProjects)
      .values({
        userId,
        position: i,
        title: p.title,
        summary: "An online store with payments.",
        role: "solo",
        kind: "client",
        skillIds: ["nextjs"],
        links: [p.link],
        source: "manual",
      })
      .returning({ id: profileProjects.id });
    projectIds.push(row!.id);
  }
  await db.insert(creditBalances).values({
    userId,
    plan: "trial",
    balance,
    periodStart: now,
    periodEnd: new Date(now.getTime() + 5 * DAY),
  });
  return { userId, projectIds };
}

async function seedMatch(
  userId: string,
  body = "Need a Next.js developer for a small shop.",
) {
  seq++;
  const now = new Date();
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_dr${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/dr${seq}/x/`,
      title: `[Hiring] Next.js developer post${seq}`,
      body,
      author: `author${seq}`,
      postedAt: now,
      preKind: "hiring",
      analysisStatus: "done",
      matchStatus: "done",
    })
    .returning({ id: jobPosts.id });
  await db.insert(jobPostAnalyses).values({
    jobPostId: p!.id,
    pipelineVersion: "post@3",
    kind: "hiring",
    employmentType: "freelance",
    payType: "paid",
    categories: ["development"],
    skillIds: ["nextjs"],
    budgetMin: null,
    budgetMax: null,
    currency: null,
    budgetUnit: null,
    remote: "remote",
    location: null,
    deadline: null,
    redFlags: [],
    summary: "A small shop site",
    model: "gemini-test",
  });
  const [m] = await db
    .insert(matches)
    .values({
      userId,
      jobPostId: p!.id,
      postedAt: now,
      ruleScore: 70,
      broad: false,
      features: [{ signal: "core_skill", points: 30, detail: ["nextjs"] }],
      ruleReason: "Matches your Next.js skills",
      aiStatus: "not_needed",
      score: 70,
      profileVersion: 1,
      analysedAt: now,
    })
    .returning({ id: matches.id });
  return { matchId: m!.id, jobPostId: p!.id };
}

async function queue(
  userId: string,
  m: { matchId: string; jobPostId: string },
  over: Partial<CreateDraftJobInput> = {},
): Promise<Draft> {
  const r = await createDraftJob(db, {
    userId,
    matchId: m.matchId,
    jobPostId: m.jobPostId,
    version: 1,
    kind: "draft",
    credits: 7,
    idempotencyKey: `k-${Math.random()}`,
    ...over,
  });
  if (!("draft" in r)) throw new Error(`no draft: ${r.error}`);
  return r.draft;
}

const rewriteOf = (
  userId: string,
  m: { matchId: string; jobPostId: string },
  parent: Draft,
  option: CreateDraftJobInput["option"],
) =>
  queue(userId, m, {
    version: parent.version + 1,
    parentId: parent.id,
    kind: "rewrite",
    option,
    credits: option === "different_project" ? 7 : 1,
  });

const row = async (id: string) =>
  (await db.select().from(drafts).where(eq(drafts.id, id)))[0]!;
const balanceOf = async (userId: string) =>
  (
    await db
      .select({ balance: creditBalances.balance })
      .from(creditBalances)
      .where(eq(creditBalances.userId, userId))
  )[0]!.balance;
const refunds = (draftId: string) =>
  db
    .select()
    .from(creditLedger)
    .where(
      and(eq(creditLedger.draftId, draftId), eq(creditLedger.reason, "refund")),
    );
const candidates = async (draftId: string) =>
  (
    await db
      .select({ reason: draftEvalCandidates.reason })
      .from(draftEvalCandidates)
      .where(eq(draftEvalCandidates.draftId, draftId))
  ).map((r) => r.reason);

/** A fake-transport client that keeps every request; `respond` defaults to the draft stub. */
function stub(
  respond: (req: GenerateRequest<unknown>) => unknown = stubDraftResponder,
) {
  const seen: GenerateRequest<unknown>[] = [];
  const llm = createClient(
    createFakeTransport((req) => {
      seen.push(req);
      return respond(req);
    }),
    { sleep: async () => {} },
  );
  return { llm, seen };
}

function fakeListen() {
  const cbs: (() => void)[] = [];
  return {
    listen: async () => ({
      onNotify(cb: () => void) {
        cbs.push(cb);
      },
      async close() {},
    }),
    fire: () => cbs.forEach((cb) => cb()),
  };
}

const make = (over: Partial<DrafterDeps> = {}) =>
  createDrafter({
    db,
    log: silent,
    llm: stub().llm,
    draftModel: DRAFT_MODEL,
    rewriteModel: REWRITE_MODEL,
    budget: BUDGET,
    listen: fakeListen().listen,
    pollMs: 3_600_000,
    sweepMs: 3_600_000,
    ...over,
  });

async function runOnce(over: Partial<DrafterDeps> = {}) {
  const d = make(over);
  await d.start();
  await d.idle();
  await d.stop();
}

async function waitFor(cond: () => Promise<boolean>, ms = 5000) {
  const until = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function captureLog() {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const log = pino(
    { level: "debug" },
    {
      write: (l: string) => {
        raw.push(l);
        lines.push(JSON.parse(l));
      },
    },
  );
  return { log, lines, raw };
}

/** v1 done for a fresh user, ready to be rewritten. */
async function doneV1(projects: ProjectSpec[] = [SHOP]) {
  const u = await seedUser(projects);
  const m = await seedMatch(u.userId);
  const v1 = await queue(u.userId, m);
  await runOnce();
  return { ...u, m, v1: await row(v1.id) };
}

// ---- Cases ----

describe("drafter", () => {
  it("7: a pending v1 is written: texts, evidence and usage saved; the credits stay reserved", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const d = await queue(userId, m);
    const { llm, seen } = stub();
    await runOnce({ llm });

    const r = await row(d.id);
    expect(r).toMatchObject({
      status: "done",
      attempts: 1,
      warning: false,
      problems: [],
      model: DRAFT_MODEL,
      promptVersion: "draft@1",
      credits: 7,
      error: null,
      lockedAt: null,
    });
    expect(r.comment).toContain(SHOP.title);
    expect(r.dm).toContain(SHOP.link);
    expect(r.dm).toContain("Next.js");
    expect(r.problem).toBeTruthy();
    expect(r.citedFact).toBeTruthy();
    expect(r.styleTags).toContain("has_link");
    const ev = r.evidence as Evidence;
    expect(ev.project?.title).toBe(SHOP.title);
    expect(ev.allowedLinks).toEqual([SHOP.link]);
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(50);
    expect(r.costMicros).toBeGreaterThan(0);
    expect(Object.keys(r.timings ?? {})).toEqual(
      expect.arrayContaining(["load", "evidence", "ai", "validate"]),
    );
    expect(r.finishedAt).not.toBeNull();
    expect(seen).toHaveLength(1);
    expect(isDraftRequest(seen[0]!)).toBe(true);
    expect(seen[0]!.model).toBe(DRAFT_MODEL);
    // Examples from the library made it into the prompt.
    expect(seen[0]!.prompt).toMatch(/^<examples>\nExample 1/);

    const usage = await db.select().from(llmUsage);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      userId,
      jobPostId: m.jobPostId,
      task: "draft",
      step: "generate",
      promptVersion: "draft@1",
      model: DRAFT_MODEL,
      outcome: "ok",
    });
    expect(await balanceOf(userId)).toBe(203);
    expect(await refunds(d.id)).toHaveLength(0);
  });

  it("8: a 'shorter' rewrite of v1: v2 done on the rewrite model, evidence copied, parent set", async () => {
    const { userId, m, v1 } = await doneV1();
    const v2 = await rewriteOf(userId, m, v1, "shorter");
    const { llm, seen } = stub();
    await runOnce({ llm });
    const r = await row(v2.id);
    expect(r.status).toBe("done");
    expect(r.parentId).toBe(v1.id);
    expect(r.evidence).toEqual(v1.evidence);
    expect(r.model).toBe(REWRITE_MODEL);
    expect(seen[0]!.prompt).toContain("<previous>");
    expect(seen[0]!.prompt).toContain(v1.dm!.slice(0, 40));
    const usage = await db
      .select({ task: llmUsage.task, model: llmUsage.model })
      .from(llmUsage)
      .where(eq(llmUsage.userId, userId));
    expect(usage).toContainEqual({ task: "rewrite", model: REWRITE_MODEL });
  });

  it("8b: a rewrite after the cited project is hidden never sends it to the model (M2)", async () => {
    const { userId, m, v1, projectIds } = await doneV1([SHOP]);
    expect((v1.evidence as Evidence).project?.title).toBe(SHOP.title);
    await db
      .update(profileProjects)
      .set({ hidden: true })
      .where(eq(profileProjects.id, projectIds[0]!));
    const v2 = await rewriteOf(userId, m, v1, "shorter");
    const { llm, seen } = stub();
    await runOnce({ llm });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).not.toContain(SHOP.title);
    expect(seen[0]!.prompt).not.toContain(SHOP.link);
    const ev = (await row(v2.id)).evidence as Evidence;
    expect(ev.project).toBeNull();
  });

  it("8c: turning employer names off after v1 keeps them out of the rewrite prompt (M2)", async () => {
    const u = await seedUser([SHOP]);
    await db
      .update(profiles)
      .set({ mentionEmployers: true })
      .where(eq(profiles.userId, u.userId));
    await db.insert(profileExperience).values({
      userId: u.userId,
      position: 0,
      title: "Frontend developer",
      summary: "Built the storefront at Globex Industries.",
      skillIds: ["nextjs"],
      categories: ["development"],
      source: "manual",
      organisation: "Globex Industries",
      organisationDescription: "a retail company",
      employmentType: "full_time",
      startYear: 2021,
      isCurrent: true,
      highlights: ["Rebuilt the Globex Industries checkout"],
    });
    const m = await seedMatch(u.userId);
    const v1 = await queue(u.userId, m);
    await runOnce();
    const done = await row(v1.id);
    expect((done.evidence as Evidence).role?.organisation).toBe(
      "Globex Industries",
    );
    await db
      .update(profiles)
      .set({ mentionEmployers: false })
      .where(eq(profiles.userId, u.userId));
    const v2 = await rewriteOf(u.userId, m, done, "formal");
    const { llm, seen } = stub();
    await runOnce({ llm });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).not.toContain("Globex");
    const ev = (await row(v2.id)).evidence as Evidence;
    expect(ev.role?.title).toBe("Frontend developer");
    expect(ev.role?.organisation).toBeNull();
  });

  it("8d: a rewrite pins the parent's project while it is still visible (M2)", async () => {
    const { userId, m, v1 } = await doneV1([SHOP, BOOKING]);
    const first = (v1.evidence as Evidence).project!.id;
    const v2 = await rewriteOf(userId, m, v1, "casual");
    await runOnce();
    const ev = (await row(v2.id)).evidence as Evidence;
    expect(ev.project?.id).toBe(first);
    expect(ev.citedProjectIds).toContain(first);
  });

  it("9: 'different project' with 2 projects cites the other one", async () => {
    const { userId, m, v1, projectIds } = await doneV1([SHOP, BOOKING]);
    const first = (v1.evidence as Evidence).project!.id;
    const v2 = await rewriteOf(userId, m, v1, "different_project");
    await runOnce();
    const r = await row(v2.id);
    expect(r.status).toBe("done");
    const ev = r.evidence as Evidence;
    expect(ev.project!.id).not.toBe(first);
    expect(projectIds).toContain(ev.project!.id);
    expect(ev.citedProjectIds.sort()).toEqual([...projectIds].sort());
    expect(r.dm).toContain(ev.project!.title);
    expect(r.model).toBe(DRAFT_MODEL);
  });

  it("10: 'different project' with 1 project fails NO_OTHER_PROJECT and refunds", async () => {
    const { userId, m, v1 } = await doneV1([SHOP]);
    const before = await balanceOf(userId);
    const v2 = await rewriteOf(userId, m, v1, "different_project");
    expect(await balanceOf(userId)).toBe(before - 7);
    const { llm, seen } = stub();
    await runOnce({ llm });
    expect(await row(v2.id)).toMatchObject({
      status: "failed",
      error: "NO_OTHER_PROJECT",
      credits: 0,
    });
    expect(seen).toHaveLength(0);
    expect(await refunds(v2.id)).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(before);
  });

  it("11: a match withdrawn before the claim fails MATCH_GONE and refunds", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const d = await queue(userId, m);
    await db
      .update(matches)
      .set({ withdrawnAt: new Date() })
      .where(eq(matches.id, m.matchId));
    await runOnce();
    expect(await row(d.id)).toMatchObject({
      status: "failed",
      error: "MATCH_GONE",
    });
    expect(await refunds(d.id)).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(210);
  });

  it("12: a rate-limited provider puts it back without counting the attempt or refunding", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const d = await queue(userId, m);
    const { llm } = stub(() => {
      throw new LlmError("rate_limited", "429");
    });
    await runOnce({ llm });
    expect(await row(d.id)).toMatchObject({
      status: "pending",
      attempts: 0,
      error: "LLM_RATE_LIMITED",
    });
    expect(await refunds(d.id)).toHaveLength(0);
    expect(await balanceOf(userId)).toBe(203);
    const usage = await db.select().from(llmUsage);
    expect(usage.map((u) => u.outcome)).toEqual(["error", "error"]);
  });

  it("13: invalid output on 3 claims in a row fails it and refunds once", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const d = await queue(userId, m);
    const { llm } = stub(() => "not json");
    for (let i = 1; i <= 3; i++) {
      await runOnce({ llm });
      const r = await row(d.id);
      expect(r.attempts).toBe(i);
      expect(r.error).toBe("LLM_INVALID_OUTPUT");
      expect(r.status).toBe(i < 3 ? "pending" : "failed");
      await db
        .update(drafts)
        .set({ runAfter: sql`now()` })
        .where(eq(drafts.id, d.id));
    }
    await runOnce({ llm });
    expect((await row(d.id)).status).toBe("failed");
    expect(await refunds(d.id)).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(210);
  });

  it("14: the validator failing twice saves it with a warning and an eval candidate", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(
      userId,
      `Need a Next.js developer for a small shop. ${STUB_INVENT_TWICE}`,
    );
    const d = await queue(userId, m);
    const { llm, seen } = stub();
    await runOnce({ llm });
    const r = await row(d.id);
    expect(r.status).toBe("done");
    expect(r.warning).toBe(true);
    expect(r.problems).toEqual([{ code: "UNSUPPORTED_NUMBER", detail: "60%" }]);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.prompt).toContain("<problems>");
    expect(await candidates(d.id)).toEqual(["validator_failed_twice"]);
    const steps = await db
      .select({ step: llmUsage.step })
      .from(llmUsage)
      .where(eq(llmUsage.userId, userId));
    expect(steps.map((s) => s.step).sort()).toEqual(["generate", "retry"]);
  });

  it("15: the 3rd rewrite on a post becomes an eval candidate (many_rewrites)", async () => {
    const { userId, m, v1 } = await doneV1();
    let parent = v1;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const next = await rewriteOf(userId, m, parent, "shorter");
      await runOnce();
      parent = await row(next.id);
      expect(parent.status).toBe("done");
      ids.push(next.id);
    }
    expect(await candidates(v1.id)).toEqual([]);
    expect(await candidates(ids[0]!)).toEqual([]);
    expect(await candidates(ids[1]!)).toEqual([]);
    expect(await candidates(ids[2]!)).toEqual(["many_rewrites"]);
  });

  it("16: a stale running draft is requeued by the sweep, then written", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const d = await queue(userId, m);
    const [claim] = await claimNextDrafts(db, 1);
    expect(claim!.id).toBe(d.id);
    await db
      .update(drafts)
      .set({ lockedAt: sql`now() - interval '5 minutes'` })
      .where(eq(drafts.id, d.id));
    await runOnce();
    const r = await row(d.id);
    expect(r).toMatchObject({ status: "done", attempts: 2 });
    // The dead worker's claim can't overwrite it.
    expect(await completeDraft(db, claim!, { comment: "x", dm: "y" })).toBe(
      false,
    );
  });

  it("16b: the sweep expires a draft pending for over 10 minutes and refunds it (M4)", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const d = await queue(userId, m);
    await db
      .update(drafts)
      .set({
        createdAt: sql`now() - interval '11 minutes'`,
        runAfter: sql`now() + interval '1 hour'`,
      })
      .where(eq(drafts.id, d.id));
    await runOnce();
    expect(await row(d.id)).toMatchObject({
      status: "failed",
      error: "EXPIRED",
      credits: 0,
    });
    expect(await refunds(d.id)).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(210);
  });

  it("17: stop() mid-call aborts it and puts it back uncounted, within the grace period", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const d = await queue(userId, m);
    const { llm, seen } = stub(() => new Promise(() => {}));
    const drafter = make({ llm });
    await drafter.start();
    await waitFor(async () => seen.length > 0);
    const started = Date.now();
    await drafter.stop(1000);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await row(d.id)).toMatchObject({
      status: "pending",
      attempts: 0,
      error: "SHUTDOWN",
    });
    expect(await refunds(d.id)).toHaveLength(0);
    // Due at once, so the next worker picks it up.
    expect((await claimNextDrafts(db, 1))[0]?.id).toBe(d.id);
  });

  it("18: two drafters on one queue process each of 10 drafts exactly once (5 runs)", async () => {
    for (let run = 0; run < 5; run++) {
      await reset();
      const { userId } = await seedUser([SHOP], 1000);
      const ids: string[] = [];
      for (let i = 0; i < 10; i++)
        ids.push((await queue(userId, await seedMatch(userId))).id);
      const a = createDb(url, { max: 4 });
      const b = createDb(url, { max: 4 });
      const s = stub(async (req) => {
        await new Promise((r) => setTimeout(r, 5));
        return stubDraftResponder(req);
      });
      const d1 = make({ db: a.db, llm: s.llm, concurrency: 3 });
      const d2 = make({ db: b.db, llm: s.llm, concurrency: 3 });
      try {
        await Promise.all([d1.start(), d2.start()]);
        await Promise.all([d1.idle(), d2.idle()]);
        await Promise.all([d1.stop(), d2.stop()]);
      } finally {
        await a.pool.end();
        await b.pool.end();
      }
      const rows = await db.select().from(drafts);
      expect(rows.every((r) => r.status === "done" && r.attempts === 1)).toBe(
        true,
      );
      expect(s.seen).toHaveLength(10);
      const titles = s.seen.map(
        (r) => /^Title: (.*)$/m.exec(r.prompt)?.[1] ?? "",
      );
      expect(new Set(titles).size).toBe(10);
      expect(await db.select().from(llmUsage)).toHaveLength(10);
    }
  });

  it("19: at the system budget's pause level nothing is claimed; a warning is logged once", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const d = await queue(userId, m);
    await db.insert(llmUsage).values({
      userId,
      task: "draft",
      step: "generate",
      promptVersion: "draft@1",
      model: DRAFT_MODEL,
      inputTokens: 1,
      outputTokens: 1,
      costMicros: 2_000_000,
      latencyMs: 1,
      attempt: 1,
      outcome: "ok",
    });
    const { log, lines } = captureLog();
    const { llm, seen } = stub();
    const l = fakeListen();
    const drafter = make({
      llm,
      log,
      listen: l.listen,
      budget: { DRAFT_BUDGET_ALERT_USD: 1, DRAFT_BUDGET_PAUSE_USD: 2 },
      budgetCheckMs: 0,
    });
    await drafter.start();
    for (let i = 0; i < 3; i++) {
      l.fire();
      await drafter.idle();
    }
    await drafter.stop();
    expect(seen).toHaveLength(0);
    expect((await row(d.id)).status).toBe("pending");
    const paused = lines.filter((x) => /drafting paused/.test(String(x.msg)));
    expect(paused).toHaveLength(1);
    expect(paused[0]!.level).toBe(40);
    const alerts = lines.filter((x) =>
      /drafting budget alert/.test(String(x.msg)),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe(50);
  });

  it("19b: at the alert level it keeps drafting and logs one error", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const d = await queue(userId, m);
    await db.insert(llmUsage).values({
      userId,
      task: "rewrite",
      step: "generate",
      promptVersion: "draft@1",
      model: DRAFT_MODEL,
      inputTokens: 1,
      outputTokens: 1,
      costMicros: 1_500_000,
      latencyMs: 1,
      attempt: 1,
      outcome: "ok",
    });
    const { log, lines } = captureLog();
    await runOnce({
      log,
      budget: { DRAFT_BUDGET_ALERT_USD: 1, DRAFT_BUDGET_PAUSE_USD: 2 },
      budgetCheckMs: 0,
    });
    expect((await row(d.id)).status).toBe("done");
    expect(
      lines.filter((x) => /drafting budget alert/.test(String(x.msg))),
    ).toHaveLength(1);
    expect(lines.filter((x) => /drafting paused/.test(String(x.msg)))).toEqual(
      [],
    );
  });

  it("20: a NOTIFY on drafts wakes it without waiting for the poll", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    const drafter = make({
      listen: () => createPgListener(url, silent, DRAFTS_CHANNEL),
    });
    await drafter.start();
    try {
      const d = await queue(userId, m);
      const t = Date.now();
      await waitFor(async () => (await row(d.id)).status === "done", 1000);
      expect(Date.now() - t).toBeLessThan(1000);
    } finally {
      await drafter.stop();
    }
  });

  it("logs codes only: no post, profile or draft text", async () => {
    const { userId } = await seedUser();
    const m = await seedMatch(userId);
    await queue(userId, m);
    const { log, raw } = captureLog();
    await runOnce({ log });
    const all = raw.join("\n");
    for (const text of [
      SHOP.title,
      SHOP.link,
      "Next.js developer",
      "small shop",
    ])
      expect(all).not.toContain(text);
  });

  it("three provider failures in a row open the breaker", async () => {
    const { userId } = await seedUser([SHOP], 1000);
    for (let i = 0; i < 5; i++) await queue(userId, await seedMatch(userId));
    const { log, lines } = captureLog();
    const { llm, seen } = stub(() => {
      throw new LlmError("server", "500");
    });
    await runOnce({ llm, log, concurrency: 1 });
    // 3 drafts tried (2 LLM attempts each), then the breaker stops claiming.
    expect(seen).toHaveLength(6);
    expect(
      lines.filter((x) => /provider failing/.test(String(x.msg))),
    ).toHaveLength(1);
  });
});

describe("createDrafterFromEnv", () => {
  const env = {
    DATABASE_URL: url,
    DRAFTS_ENABLED: true,
    DRAFT_MODEL,
    REWRITE_MODEL,
    DRAFT_CONCURRENCY: 2,
    ...BUDGET,
  };
  it("is null when drafting is off", () => {
    expect(
      createDrafterFromEnv(
        { ...env, DRAFTS_ENABLED: false },
        { db, log: silent, llm: stub().llm },
      ),
    ).toBeNull();
    expect(
      createDrafterFromEnv(env, { db, log: silent, llm: stub().llm }),
    ).not.toBeNull();
  });

  it("logs an error at start when a model has no price", async () => {
    const { log, lines } = captureLog();
    const d = createDrafterFromEnv(
      { ...env, REWRITE_MODEL: "no-such-model" },
      { db, log, llm: stub().llm, listen: fakeListen().listen },
    )!;
    await d.start();
    await d.stop();
    const err = lines.find((x) => /no price/.test(String(x.msg)));
    expect(err).toMatchObject({ level: 50, model: "no-such-model" });
  });
});
