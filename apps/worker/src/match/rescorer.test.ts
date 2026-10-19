import {
  MATCHES_CHANNEL,
  claimPairsForRescore,
  completeRescore,
  createDb,
  jobPostAnalyses,
  jobPosts,
  llmUsage,
  loadRescoreContext,
  matches,
  profileExperience,
  profileProjects,
  profileSkills,
  profiles,
  recordLlmUsage,
  rescoreUsage,
  syncReferenceData,
  takeRescoreUnit,
  upsertMatches,
  users,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import {
  LlmError,
  createClient,
  createFakeTransport,
  type GenerateRequest,
} from "@redlance/llm";
import { and, eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { stubRescoreResponder } from "../../test/stub-llm";
import { createPgListener } from "../db";
import {
  createRescorer,
  createRescorerFromEnv,
  type RescorerDeps,
  type RescorerOps,
} from "./rescorer";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 12 });
const silent = pino({ level: "silent" });
const noListen = async () => ({ onNotify() {}, async close() {} });

const DAY = 86_400_000;
const MODEL = "gemini-3.5-flash-lite";
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(
    sql`truncate table match_events, matches, job_post_analyses, job_posts, llm_usage cascade`,
  );
};

beforeAll(async () => {
  await runMigrations(url);
  await syncReferenceData(db);
});
afterAll(async () => {
  await reset();
  await pool.end();
});

// ---- Fixtures ----

let seq = 0;

type UserSpec = {
  plan: "trial" | "standard" | "max";
  trialEndsAt?: Date;
  projects?: { title: string; summary: string; hidden?: boolean }[];
  roles?: {
    title: string;
    organisation: string | null;
    organisationDescription: string;
    summary: string;
  }[];
};

async function seedUser(spec: UserSpec) {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|rs${seq}`,
      email: `rs${seq}@example.com`,
      emailNormalized: `rs${seq}@example.com`,
    })
    .returning({ id: users.id });
  const userId = u!.id;
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
    plan: spec.plan,
    onboardedAt: new Date(),
    trialEndsAt: spec.trialEndsAt ?? new Date(Date.now() + 5 * DAY),
  });
  await db.insert(profileSkills).values([
    { userId, skillId: "nextjs", level: "core", source: "manual" },
    { userId, skillId: "react", level: "core", source: "manual" },
    { userId, skillId: "postgresql", level: "secondary", source: "manual" },
  ]);
  const projectIds: string[] = [];
  for (const [i, p] of (spec.projects ?? []).entries()) {
    const [row] = await db
      .insert(profileProjects)
      .values({
        userId,
        position: i,
        title: p.title,
        summary: p.summary,
        role: "solo",
        kind: "client",
        skillIds: ["nextjs"],
        source: "manual",
        hidden: p.hidden ?? false,
      })
      .returning({ id: profileProjects.id });
    projectIds.push(row!.id);
  }
  const roleIds: string[] = [];
  for (const [i, r] of (spec.roles ?? []).entries()) {
    const [row] = await db
      .insert(profileExperience)
      .values({
        userId,
        position: i,
        title: r.title,
        summary: r.summary,
        organisation: r.organisation,
        organisationDescription: r.organisationDescription,
        employmentType: r.organisation ? "full_time" : "freelance",
        source: "manual",
      })
      .returning({ id: profileExperience.id });
    roleIds.push(row!.id);
  }
  return { userId, projectIds, roleIds };
}

/** An analysed, matched post (match_status done), so only the re-score queue is in play. */
async function seedPost(
  spec: { title?: string; body?: string; skillIds?: string[] } = {},
) {
  seq++;
  const [row] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_rs${seq}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/rs${seq}/x/`,
      title: spec.title ?? `[Hiring] Next.js developer ${seq}`,
      body: spec.body ?? "Need a Next.js developer for a checkout. $400 fixed.",
      author: `author${seq}`,
      postedAt: new Date(Date.now() - 3_600_000),
      preKind: "hiring",
      analysisStatus: "done",
      matchStatus: "done",
    })
    .returning({ id: jobPosts.id });
  await db.insert(jobPostAnalyses).values({
    jobPostId: row!.id,
    pipelineVersion: "post@2",
    kind: "hiring",
    employmentType: "freelance",
    payType: "paid",
    categories: ["development"],
    skillIds: spec.skillIds ?? ["nextjs"],
    budgetMin: 400,
    budgetMax: 400,
    currency: "USD",
    budgetUnit: "fixed",
    remote: "remote",
    location: null,
    deadline: null,
    redFlags: [],
    summary: `Gig ${seq}`,
    model: "gemini-test",
  });
  return row!.id;
}

/** Pending pairs for a user, one post each, with these rule scores. Match ids in order. */
async function pending(
  userId: string,
  scores: number[],
  opts: { broad?: boolean } = {},
): Promise<string[]> {
  const postIds: string[] = [];
  for (const _ of scores) postIds.push(await seedPost());
  await upsertMatches(
    db,
    scores.map((ruleScore, i) => ({
      userId,
      jobPostId: postIds[i]!,
      ruleScore,
      broad: opts.broad ?? false,
      features: [],
      ruleReason: "Matches your Next.js skills",
      aiStatus: opts.broad ? "not_needed" : "pending",
      profileVersion: 1,
    })),
  );
  const rows = await db
    .select({ id: matches.id, jobPostId: matches.jobPostId })
    .from(matches)
    .where(inArray(matches.jobPostId, postIds));
  return postIds.map((p) => rows.find((r) => r.jobPostId === p)!.id);
}

const matchRow = async (id: string) =>
  (await db.select().from(matches).where(eq(matches.id, id)))[0]!;
const rowsOf = (userId: string) =>
  db.select().from(matches).where(eq(matches.userId, userId));
const usedOn = async (userId: string, day: string) =>
  (
    await db
      .select({ used: rescoreUsage.used })
      .from(rescoreUsage)
      .where(and(eq(rescoreUsage.userId, userId), eq(rescoreUsage.day, day)))
  )[0]?.used ?? null;
const setUsed = (userId: string, day: string, used: number) =>
  db.insert(rescoreUsage).values({ userId, day, used });

/** A fake-transport client that counts calls and keeps every request. */
function stub(
  respond: (req: GenerateRequest<unknown>) => unknown = stubRescoreResponder,
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

const make = (over: Partial<RescorerDeps> = {}) =>
  createRescorer({
    db,
    log: silent,
    llm: stub().llm,
    model: MODEL,
    listen: noListen,
    dailyBudgetMicros: 1_000_000,
    pollMs: 3_600_000,
    sweepMs: 3_600_000,
    ...over,
  });

async function runOnce(over: Partial<RescorerDeps> = {}) {
  const r = make(over);
  await r.start();
  await r.idle();
  await r.stop();
}

async function waitFor(cond: () => Promise<boolean>, ms = 5000) {
  const until = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
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

const BAKERY = {
  title: "Bakery ordering site",
  summary: "Built a bakery ordering site with payments.",
};

describe("re-scorer (database)", () => {
  beforeEach(reset);

  it("10: re-scores a pending pair woken by NOTIFY matches, and records its cost", async () => {
    const priya = await seedUser({
      plan: "trial",
      projects: [
        BAKERY,
        { title: "Secret side project", summary: "Hidden.", hidden: true },
      ],
      roles: [
        {
          title: "Frontend developer at Acme Realty",
          organisation: "Acme Realty",
          organisationDescription: "a real-estate agency",
          summary: "Built ACME REALTY's listing pages.",
        },
      ],
    });
    const { llm, seen } = stub();
    const { log, raw } = captureLog();
    const r = make({
      llm,
      log,
      // Poll and sweep are an hour apart: only the notification can wake it.
      listen: () => createPgListener(url, silent, MATCHES_CHANNEL),
    });
    await r.start();
    await r.idle();
    const [id] = await pending(priya.userId, [80]);
    await waitFor(async () => (await matchRow(id!)).aiStatus === "done");
    await r.idle();
    await r.stop();

    const m = await matchRow(id!);
    expect(m).toMatchObject({
      aiStatus: "done",
      aiScore: 85,
      score: 85,
      ruleScore: 80,
      aiReason: "You built Bakery ordering site.",
      bestProjectId: priya.projectIds[0],
      bestRoleId: priya.roleIds[0],
      aiModel: MODEL,
      aiAttempts: 1,
      aiError: null,
    });
    const usage = await db.select().from(llmUsage);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      userId: priya.userId,
      jobPostId: m.jobPostId,
      task: "match_rescore",
      step: "rescore",
      promptVersion: "rescore@1",
      model: MODEL,
      outcome: "ok",
      costMicros: 30, // 100 in + 50 out at Flash-Lite prices
    });
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(1);
    // Case 1 end to end: the organisation's name and hidden work never reach the model.
    expect(seen).toHaveLength(1);
    const sent = `${seen[0]!.system}\n${seen[0]!.prompt}`;
    expect(sent).toContain("a real-estate agency");
    expect(sent).toContain("Frontend developer at a real-estate agency");
    expect(sent).toContain("a real-estate agency's listing pages");
    expect(sent.toLowerCase()).not.toContain("acme");
    expect(sent).not.toContain("Secret side project");
    // Logs carry ids and codes, never post or profile text.
    expect(raw.join("")).not.toMatch(/Next\.js developer|Bakery|Acme/);
  });

  it("11: a trial user with 16 pending gets 15 re-scores, highest rule scores first", async () => {
    const priya = await seedUser({ plan: "trial", projects: [BAKERY] });
    const scores = Array.from({ length: 16 }, (_, i) => 95 - i * 3); // 95 … 50
    // Insert in a shuffled order so creation order can't explain the result.
    const order = [7, 0, 15, 3, 11, 1, 14, 5, 9, 2, 13, 4, 8, 12, 6, 10];
    const ids = await pending(
      priya.userId,
      order.map((i) => scores[i]!),
    );
    const { llm, seen } = stub();
    await runOnce({ llm, concurrency: 4 });

    const rows = await rowsOf(priya.userId);
    const done = rows.filter((r) => r.aiStatus === "done");
    const capped = rows.filter((r) => r.aiStatus === "capped");
    expect(done).toHaveLength(15);
    expect(capped).toHaveLength(1);
    expect(capped[0]!.ruleScore).toBe(50); // the lowest
    expect(capped[0]).toMatchObject({
      score: 50,
      aiError: null,
      aiScore: null,
    });
    expect(Math.min(...done.map((r) => r.ruleScore))).toBe(53);
    expect(seen).toHaveLength(15);
    expect(ids).toHaveLength(16);
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(15);
  });

  it("12: a Max user with 30 pending gets all 30", async () => {
    const max = await seedUser({ plan: "max", trialEndsAt: new Date(0) });
    await pending(
      max.userId,
      Array.from({ length: 30 }, (_, i) => 50 + i),
    );
    await runOnce({ concurrency: 4 });
    const rows = await rowsOf(max.userId);
    expect(rows.filter((r) => r.aiStatus === "done")).toHaveLength(30);
    expect(rows.every((r) => r.aiScore === 85 && r.score === 85)).toBe(true);
    expect(await usedOn(max.userId, utcDay(new Date()))).toBe(30);
  });

  it("13: the cap resets when the UTC day rolls over", async () => {
    const dan = await seedUser({ plan: "standard", trialEndsAt: new Date(0) });
    const today = new Date();
    const tomorrow = new Date(today.getTime() + DAY);
    await setUsed(dan.userId, utcDay(today), 15);
    const [a] = await pending(dan.userId, [70]);
    await runOnce({ now: () => today });
    expect((await matchRow(a!)).aiStatus).toBe("capped");

    const [b] = await pending(dan.userId, [70]);
    await runOnce({ now: () => tomorrow });
    expect((await matchRow(b!)).aiStatus).toBe("done");
    expect(await usedOn(dan.userId, utcDay(today))).toBe(15);
    expect(await usedOn(dan.userId, utcDay(tomorrow))).toBe(1);
  });

  it("14: with 2 units left, both pending pairs are done and broad matches are never claimed", async () => {
    const priya = await seedUser({ plan: "trial" });
    await setUsed(priya.userId, utcDay(new Date()), 13); // trial cap 15: 2 left
    const specific = await pending(priya.userId, [60, 55]);
    const broad = await pending(priya.userId, [45, 45, 30], { broad: true });
    const claimed: string[] = [];
    const { llm, seen } = stub();
    await runOnce({
      llm,
      ops: {
        claimPairsForRescore: async (d, limit) => {
          const got = await claimPairsForRescore(d, limit);
          claimed.push(...got.map((g) => g.matchId));
          return got;
        },
      },
    });
    for (const id of specific)
      expect((await matchRow(id)).aiStatus).toBe("done");
    for (const id of broad)
      expect(await matchRow(id)).toMatchObject({
        aiStatus: "not_needed",
        aiAttempts: 0,
        aiScore: null,
      });
    expect(claimed.sort()).toEqual([...specific].sort());
    expect(seen).toHaveLength(2);
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(15);
  });

  it("15: a trial that ended after matching is capped with NOT_ALLOWED and no model call", async () => {
    const old = await seedUser({ plan: "trial" });
    const [id] = await pending(old.userId, [80]);
    await db
      .update(profiles)
      .set({ trialEndsAt: new Date(Date.now() - 3_600_000) })
      .where(eq(profiles.userId, old.userId));
    const { llm, seen } = stub();
    await runOnce({ llm });
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "capped",
      aiError: "NOT_ALLOWED",
      score: 80,
    });
    expect(seen).toHaveLength(0);
    expect(await usedOn(old.userId, utcDay(new Date()))).toBeNull();
  });

  it("16: a rate-limited call refunds the unit and puts the pair back, due after 5 s, without using an attempt", async () => {
    const priya = await seedUser({ plan: "trial" });
    await setUsed(priya.userId, utcDay(new Date()), 3);
    const [id] = await pending(priya.userId, [80]);
    const { llm, seen } = stub(() => {
      throw new LlmError("rate_limited", "429");
    });
    await runOnce({ llm });
    const m = await matchRow(id!);
    expect(m).toMatchObject({
      aiStatus: "pending",
      aiAttempts: 0,
      aiError: "LLM_RATE_LIMITED",
      aiUnitDay: null,
      score: 80,
    });
    // No backoff growth: a give-back is due after GIVE_BACK_DELAY_MS, not at once.
    expect(m.aiRunAfter.getTime()).toBeGreaterThan(Date.now() + 3_000);
    expect(m.aiRunAfter.getTime()).toBeLessThan(Date.now() + 7_000);
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(3);
    // One try (2 calls with the client's retry), not re-claimed in the same pass, recorded
    // with no tokens.
    expect(seen).toHaveLength(2);
    const usage = await db.select().from(llmUsage);
    expect(usage.map((u) => u.outcome)).toEqual(Array(2).fill("error"));
    expect(usage.every((u) => u.userId === priya.userId)).toBe(true);
  });

  it("17: invalid output counts: after 3 claims the pair fails and keeps its rule score, for one unit", async () => {
    const priya = await seedUser({ plan: "trial" });
    const [id] = await pending(priya.userId, [72]);
    const { llm, seen } = stub(() => ({ score: "high" }));
    for (let claim = 1; claim <= 3; claim++) {
      await runOnce({ llm });
      const m = await matchRow(id!);
      expect(m.aiAttempts).toBe(claim);
      expect(m.aiError).toBe("LLM_INVALID_OUTPUT");
      expect(m.aiStatus).toBe(claim < 3 ? "pending" : "failed");
      // One unit for the pair: its retries today take no second one.
      expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(1);
      expect(m.aiUnitDay).toBe(utcDay(new Date()));
      // Skip the backoff for the next claim.
      await db
        .update(matches)
        .set({ aiRunAfter: new Date(Date.now() - 1000) })
        .where(eq(matches.id, id!));
    }
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "failed",
      score: 72,
      aiScore: null,
    });
    expect(seen).toHaveLength(6);
    const usage = await db.select().from(llmUsage);
    expect(usage).toHaveLength(6);
    expect(usage.every((u) => u.outcome === "invalid_output")).toBe(true);
  });

  it("18: once today's budget is spent nothing is claimed, with one warning", async () => {
    const priya = await seedUser({ plan: "trial" });
    const [id] = await pending(priya.userId, [80]);
    const usage = (task: string, costMicros: number) =>
      recordLlmUsage(db, {
        task,
        step: "x",
        promptVersion: "x@1",
        model: MODEL,
        inputTokens: 1,
        outputTokens: 1,
        costMicros,
        latencyMs: 1,
        attempt: 1,
        outcome: "ok",
      });
    await usage("match_rescore", 2_000_000);
    await usage("post_analysis", 9_000_000); // other tasks have their own budgets
    let t = Date.now();
    let wake = () => {};
    const { log, lines } = captureLog();
    const { llm, seen } = stub();
    const r = make({
      llm,
      log,
      dailyBudgetMicros: 2_000_000,
      now: () => new Date(t),
      listen: async () => ({
        onNotify(cb) {
          wake = cb;
        },
        async close() {},
      }),
    });
    await r.start();
    await r.idle();
    for (let i = 0; i < 2; i++) {
      t += 61_000; // past the budget check's cache
      wake();
      await r.idle();
    }
    await r.stop();
    expect(seen).toHaveLength(0);
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "pending",
      aiAttempts: 0,
    });
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBeNull();
    const warnings = lines.filter((l) =>
      String(l.msg).includes("re-score budget"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: 40, budgetUsd: 2 });
  });

  it("18: the budget running out after a claim refunds the unit and puts the pair back", async () => {
    const priya = await seedUser({ plan: "trial" });
    const [id] = await pending(priya.userId, [80]);
    let t = Date.now();
    let checks = 0;
    const { llm, seen } = stub();
    await runOnce({
      llm,
      now: () => new Date(t),
      ops: {
        // Under budget when claiming, spent by the check after the unit is taken.
        llmCostSince: async () => (checks++ === 0 ? 0 : 5_000_000),
        claimPairsForRescore: async (d, limit) => {
          const got = await claimPairsForRescore(d, limit);
          t += 61_000;
          return got;
        },
      },
    });
    expect(seen).toHaveLength(0);
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "pending",
      aiAttempts: 0,
      aiError: "BUDGET",
    });
    expect(await usedOn(priya.userId, utcDay(new Date(t)))).toBe(0);
  });

  it("19: three provider failures in a row pause claiming", async () => {
    const priya = await seedUser({ plan: "trial" });
    const ids = await pending(priya.userId, [90, 85, 80, 75, 70]);
    const { log, lines } = captureLog();
    const { llm, seen } = stub(() => {
      throw new LlmError("server", "503");
    });
    await runOnce({ llm, log, concurrency: 1 });
    // A give-back is due after 5 s, so three different pairs are tried (2 calls each with the
    // client's retry); after 3 failures the breaker opens.
    expect(seen).toHaveLength(6);
    for (const id of ids)
      expect(await matchRow(id)).toMatchObject({
        aiStatus: "pending",
        aiAttempts: 0,
      });
    const errors = await db
      .select()
      .from(matches)
      .where(eq(matches.aiError, "LLM_SERVER"));
    expect(errors.map((e) => e.ruleScore).sort()).toEqual([80, 85, 90]);
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(0);
    expect(
      lines.filter((l) => String(l.msg).includes("pausing re-scores")),
    ).toHaveLength(1);
  });

  it("20: the sweep re-queues a stale running pair with its unit back, and it is re-scored", async () => {
    const priya = await seedUser({ plan: "trial" });
    const [id] = await pending(priya.userId, [80]);
    const today = utcDay(new Date());
    // A crashed worker's pair: claimed, its unit taken, never finished.
    await setUsed(priya.userId, today, 1);
    await db
      .update(matches)
      .set({
        aiStatus: "running",
        aiAttempts: 1,
        aiUnitDay: today,
        aiLockedAt: new Date(Date.now() - 5 * 60_000),
      })
      .where(eq(matches.id, id!));
    const { log, lines } = captureLog();
    await runOnce({ log });
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "done",
      aiAttempts: 2,
      aiUnitDay: today,
    });
    // Refunded by the sweep (0), taken again by the re-score (1): never 2.
    expect(await usedOn(priya.userId, today)).toBe(1);
    expect(
      lines.some((l) => l.msg === "re-queued stale re-scores" && l.count === 1),
    ).toBe(true);
  });

  it("21: stop() aborts a call in flight, refunds the unit and puts the pair back", async () => {
    const priya = await seedUser({ plan: "trial" });
    const [id] = await pending(priya.userId, [80]);
    const { llm, seen } = stub(() => new Promise(() => {})); // never answers
    const r = make({ llm });
    await r.start();
    await waitFor(async () => seen.length === 1);
    const started = Date.now();
    await r.stop(5_300); // aborts 5 s before the grace ends
    const took = Date.now() - started;
    expect(took).toBeLessThan(5_300);
    expect(took).toBeGreaterThanOrEqual(250);
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "pending",
      aiAttempts: 0,
      aiError: "SHUTDOWN",
    });
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(0);
  });

  it("22: two re-scorers on one queue never process a pair twice or exceed the cap", async () => {
    const priya = await seedUser({ plan: "trial" });
    const max = await seedUser({ plan: "max", trialEndsAt: new Date(0) });
    await pending(
      priya.userId,
      Array.from({ length: 20 }, (_, i) => 50 + i),
    );
    await pending(
      max.userId,
      Array.from({ length: 10 }, (_, i) => 60 + i),
    );
    const claimed: string[] = [];
    const completed: string[] = [];
    const ops: RescorerDeps["ops"] = {
      claimPairsForRescore: async (d, limit) => {
        const got = await claimPairsForRescore(d, limit);
        claimed.push(...got.map((g) => g.matchId));
        return got;
      },
      completeRescore: async (d, id, claim, result) => {
        completed.push(id);
        return completeRescore(d, id, claim, result);
      },
    };
    // A small delay keeps both loops busy at the same time.
    const { llm, seen } = stub(
      (req) =>
        new Promise((r) => setTimeout(() => r(stubRescoreResponder(req)), 5)),
    );
    const a = make({ llm, ops, concurrency: 4 });
    const b = make({ llm, ops, concurrency: 4 });
    await Promise.all([a.start(), b.start()]);
    await Promise.all([a.idle(), b.idle()]);
    await Promise.all([a.stop(), b.stop()]);

    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed).toHaveLength(30);
    expect(new Set(completed).size).toBe(completed.length);
    const p = await rowsOf(priya.userId);
    expect(p.filter((r) => r.aiStatus === "done")).toHaveLength(15);
    expect(p.filter((r) => r.aiStatus === "capped")).toHaveLength(5);
    const m = await rowsOf(max.userId);
    expect(m.every((r) => r.aiStatus === "done")).toBe(true);
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(15);
    expect(await usedOn(max.userId, utcDay(new Date()))).toBe(10);
    expect(seen).toHaveLength(25);
    const usage = await db.select().from(llmUsage);
    expect(new Set(usage.map((u) => u.jobPostId)).size).toBe(25);
  });
});

describe("re-scorer edge cases (database)", () => {
  beforeEach(reset);

  /** The matcher re-matches the pair under a new profile version (as not_needed, so it stays put). */
  const reVersion = async (matchId: string) => {
    const m = await matchRow(matchId);
    await upsertMatches(db, [
      {
        userId: m.userId,
        jobPostId: m.jobPostId,
        ruleScore: m.ruleScore,
        broad: false,
        features: [],
        ruleReason: "Matches your Next.js skills",
        aiStatus: "not_needed",
        profileVersion: m.profileVersion + 1,
      },
    ]);
  };

  it("a pair re-versioned between claim and prepare is let go: no unit, no model call", async () => {
    const priya = await seedUser({ plan: "trial" });
    const [id] = await pending(priya.userId, [80]);
    let takes = 0;
    const { llm, seen } = stub();
    await runOnce({
      llm,
      ops: {
        loadRescoreContext: async (d, matchId) => {
          await reVersion(matchId);
          return loadRescoreContext(d, matchId);
        },
        takeRescoreUnit: async (...args) => {
          takes++;
          return takeRescoreUnit(...args);
        },
      },
    });
    expect(takes).toBe(0);
    expect(seen).toHaveLength(0);
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBeNull();
    // The new version's row is untouched by the stale claim.
    expect(await matchRow(id!)).toMatchObject({
      profileVersion: 2,
      aiStatus: "not_needed",
      aiAttempts: 0,
      aiError: null,
    });
  });

  it("a database error in prepare refunds the unit once, uses no attempt, and is retried after 5 s", async () => {
    const priya = await seedUser({ plan: "trial" });
    await setUsed(priya.userId, utcDay(new Date()), 3);
    const [id] = await pending(priya.userId, [80]);
    let t = Date.now();
    let checks = 0;
    const takes: string[] = [];
    const { llm, seen } = stub();
    const opts = {
      llm,
      now: () => new Date(t),
      ops: {
        // Fine when claiming, a lost connection on the check after the unit is taken.
        llmCostSince: async () => {
          if (++checks === 2) throw new Error("Connection terminated");
          return 0;
        },
        claimPairsForRescore: async (d, limit) => {
          const got = await claimPairsForRescore(d, limit);
          t += 61_000; // past the budget check's cache
          return got;
        },
        takeRescoreUnit: async (...args) => {
          const unit = await takeRescoreUnit(...args);
          takes.push(unit);
          return unit;
        },
      } satisfies Partial<RescorerOps>,
    };
    await runOnce(opts);
    expect(checks).toBeGreaterThanOrEqual(2);
    // Given back and due after 5 s, so not retried in this pass; the unit is refunded.
    expect(takes).toEqual(["taken"]);
    expect(seen).toHaveLength(0);
    expect(await usedOn(priya.userId, utcDay(new Date(t)))).toBe(3);
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "pending",
      aiAttempts: 0,
      aiUnitDay: null,
    });
    // Make it due, and the retry takes the unit afresh.
    await db
      .update(matches)
      .set({ aiRunAfter: new Date(Date.now() - 1000) })
      .where(eq(matches.id, id!));
    await runOnce(opts);
    expect(takes).toEqual(["taken", "taken"]);
    expect(seen).toHaveLength(1);
    // 3, taken (4), given back once (3), taken again (4) and spent.
    expect(await usedOn(priya.userId, utcDay(new Date(t)))).toBe(4);
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "done",
      aiAttempts: 1,
      aiError: null,
    });
  });

  it("a prepare step that always throws gives back once, then counts until the pair fails", async () => {
    const priya = await seedUser({ plan: "trial" });
    const [id] = await pending(priya.userId, [80]);
    let loads = 0;
    const { llm, seen } = stub();
    const ops: RescorerDeps["ops"] = {
      loadRescoreContext: async () => {
        loads++;
        throw new TypeError("a bug");
      },
    };
    // First pass: the give-back is due after 5 s, so the pair is not claimed again in the pass.
    await runOnce({ llm, ops });
    expect(loads).toBe(1);
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "pending",
      aiAttempts: 0,
      aiError: "INTERNAL",
    });
    // Make it due: the second failure in a row counts (and backs off).
    await db
      .update(matches)
      .set({ aiRunAfter: new Date(Date.now() - 1000) })
      .where(eq(matches.id, id!));
    await runOnce({ llm, ops });
    expect(loads).toBe(2);
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "pending",
      aiAttempts: 1,
      aiError: "INTERNAL",
    });
    for (let pass = 0; pass < 5; pass++) {
      if ((await matchRow(id!)).aiStatus !== "pending") break;
      // Skip the backoff.
      await db
        .update(matches)
        .set({ aiRunAfter: new Date(Date.now() - 1000) })
        .where(eq(matches.id, id!));
      await runOnce({ llm, ops });
    }
    expect(loads).toBe(4);
    expect(seen).toHaveLength(0);
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "failed",
      aiAttempts: 3,
      aiError: "INTERNAL",
      score: 80,
      aiScore: null,
    });
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBeNull();
  });

  it("the per-pair timeout aborts the call and counts the attempt as PAIR_TIMEOUT", async () => {
    const priya = await seedUser({ plan: "trial" });
    const [id] = await pending(priya.userId, [80]);
    const signals: (AbortSignal | undefined)[] = [];
    const { llm, seen } = stub((req) => {
      signals.push(req.signal);
      return new Promise(() => {}); // never answers
    });
    const started = Date.now();
    await runOnce({ llm, pairTimeoutMs: 150 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(seen).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "pending",
      aiAttempts: 1,
      aiError: "PAIR_TIMEOUT",
      score: 80,
    });
    // An attempt that counts spends its unit.
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(1);
  });

  it("a pair whose post or profile is gone fails with NO_CONTEXT, with no unit or call", async () => {
    const priya = await seedUser({ plan: "trial" });
    const [id] = await pending(priya.userId, [80]);
    const { llm, seen } = stub();
    await runOnce({ llm, ops: { loadRescoreContext: async () => null } });
    expect(seen).toHaveLength(0);
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBeNull();
    expect(await matchRow(id!)).toMatchObject({
      aiStatus: "failed",
      aiError: "NO_CONTEXT",
      score: 80,
      aiScore: null,
    });
  });

  it("a re-version during the call loses the claim: nothing saved, the unit spent, no refund", async () => {
    const priya = await seedUser({ plan: "trial", projects: [BAKERY] });
    const [id] = await pending(priya.userId, [80]);
    const saved: boolean[] = [];
    const { llm, seen } = stub(async (req) => {
      await reVersion(id!);
      return stubRescoreResponder(req);
    });
    await runOnce({
      llm,
      ops: {
        completeRescore: async (...args) => {
          const ok = await completeRescore(...args);
          saved.push(ok);
          return ok;
        },
      },
    });
    expect(seen).toHaveLength(1);
    expect(saved).toEqual([false]);
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(1);
    expect(await matchRow(id!)).toMatchObject({
      profileVersion: 2,
      aiStatus: "not_needed",
      aiScore: null,
      aiReason: null,
      bestProjectId: null,
    });
    // The call still cost money, so it is recorded.
    expect(await db.select().from(llmUsage)).toHaveLength(1);
  });

  it("stop() while pairs are claimed but not prepared puts them back with SHUTDOWN", async () => {
    const priya = await seedUser({ plan: "trial" });
    const ids = await pending(priya.userId, [80, 70]);
    let reached = () => {};
    const atGate = new Promise<void>((r) => (reached = r));
    let open = () => {};
    const gate = new Promise<void>((r) => (open = r));
    const { llm, seen } = stub();
    const r = make({
      llm,
      concurrency: 2,
      ops: {
        loadRescoreContext: async (d, matchId) => {
          reached();
          await gate;
          return loadRescoreContext(d, matchId);
        },
      },
    });
    const starting = r.start();
    await atGate; // both pairs claimed, the first one being prepared
    const stopping = r.stop(2_000);
    open();
    await starting;
    await stopping;
    expect(seen).toHaveLength(0);
    for (const id of ids)
      expect(await matchRow(id)).toMatchObject({
        aiStatus: "pending",
        aiAttempts: 0,
        aiError: "SHUTDOWN",
      });
    // The first pair took a unit before it noticed the stop, and gave it back once.
    expect(await usedOn(priya.userId, utcDay(new Date()))).toBe(0);
    for (const id of ids) expect((await matchRow(id)).aiUnitDay).toBeNull();
  });

  it("the breaker resumes claiming once its cooldown has passed", async () => {
    const priya = await seedUser({ plan: "trial" });
    const ids = await pending(priya.userId, [90, 85, 80, 75, 70]);
    let t = Date.now();
    let wake = () => {};
    let calls = 0;
    const { llm, seen } = stub((req) => {
      // The first 3 tries (three pairs, 2 calls each with the client's retry) fail;
      // then the provider is back.
      if (++calls <= 6) throw new LlmError("server", "503");
      return stubRescoreResponder(req);
    });
    const r = make({
      llm,
      concurrency: 1,
      now: () => new Date(t),
      listen: async () => ({
        onNotify(cb) {
          wake = cb;
        },
        async close() {},
      }),
    });
    await r.start();
    await r.idle();
    expect(seen).toHaveLength(6);

    // Still inside the 1-minute cooldown: a wake-up claims nothing.
    t += 30_000;
    wake();
    await r.idle();
    expect(seen).toHaveLength(6);

    // Past it: every pair is claimed and re-scored. The three given-back pairs are due again
    // once their 5 s delay has passed (moved back here rather than slept).
    await db
      .update(matches)
      .set({ aiRunAfter: new Date(Date.now() - 1000) })
      .where(
        sql`${matches.id} in (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})`,
      );
    t += 31_000;
    wake();
    await r.idle();
    await r.stop();
    expect(seen).toHaveLength(11);
    const rows = await Promise.all(ids.map(matchRow));
    expect(rows.every((m) => m.aiStatus === "done")).toBe(true);
    expect(await usedOn(priya.userId, utcDay(new Date(t)))).toBe(5);
  });
});

describe("createRescorerFromEnv", () => {
  const env = {
    DATABASE_URL: url,
    MATCHING_ENABLED: true,
    RESCORE_ENABLED: true,
    RESCORE_DAILY_BUDGET_USD: 5,
    VERTEX_MODEL_FAST: MODEL,
    WORKER_CONCURRENCY: 2,
  };
  const deps = { db, log: silent, llm: stub().llm, listen: noListen };
  it("is off unless both matching and re-scoring are on", () => {
    expect(createRescorerFromEnv(env, deps)).not.toBeNull();
    expect(
      createRescorerFromEnv({ ...env, RESCORE_ENABLED: false }, deps),
    ).toBeNull();
    expect(
      createRescorerFromEnv({ ...env, MATCHING_ENABLED: false }, deps),
    ).toBeNull();
  });
});
