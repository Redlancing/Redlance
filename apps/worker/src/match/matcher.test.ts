import type { MatchPost, MatchProfile } from "@redlance/core";
import {
  MAX_REMATCH_ATTEMPTS,
  POST_ANALYSED_CHANNEL,
  candidateUsersForPost,
  claimPostsForMatching,
  completePostAnalysis,
  createDb,
  failPostMatching,
  feedPage,
  jobPostAnalyses,
  jobPosts,
  loadMatchUser,
  matches,
  profileProjects,
  profileSkills,
  profiles,
  requestRematch,
  requeueStalePostMatching,
  setMatchStatus,
  syncReferenceData,
  upsertMatches,
  users,
  type NewMatch,
  type NewPostAnalysis,
} from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { and, asc, eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPgListener } from "../db";
import { parseWorkerEnv } from "../env";
import {
  createMatcher,
  createMatcherFromEnv,
  decideAiStatus,
  type MatcherDeps,
} from "./matcher";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 10 });
const silent = pino({ level: "silent" });
const noListen = async () => ({ onNotify() {}, async close() {} });

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);

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

type UserSpec = MatchProfile & {
  plan: "trial" | "standard" | "max";
  trialEndsAt: Date;
};
// workSkillIds come from visible projects: seedUser adds one project with them.

const PRIYA: UserSpec = {
  categories: ["development"],
  skills: [
    { id: "nextjs", level: "core" },
    { id: "react", level: "core" },
    { id: "payments", level: "core" },
    { id: "postgresql", level: "secondary" },
  ],
  workSkillIds: ["nextjs", "payments"],
  minRateMinor: 3000,
  currency: "USD",
  rateType: "either",
  remoteOnly: true,
  includeUnpaid: false,
  plan: "trial",
  trialEndsAt: new Date(Date.now() + 5 * DAY),
};
const DAN: UserSpec = {
  categories: ["design"],
  skills: [
    { id: "figma", level: "core" },
    { id: "ui-design", level: "core" },
  ],
  workSkillIds: [],
  minRateMinor: 2500,
  currency: "GBP",
  rateType: "hourly",
  remoteOnly: false,
  includeUnpaid: true,
  plan: "standard",
  trialEndsAt: ago(30 * DAY),
};
const OLD: UserSpec = {
  categories: ["development"],
  skills: [
    { id: "nextjs", level: "core" },
    { id: "react", level: "core" },
  ],
  workSkillIds: [],
  minRateMinor: 3000,
  currency: "USD",
  rateType: "either",
  remoteOnly: false,
  includeUnpaid: false,
  plan: "trial",
  trialEndsAt: ago(DAY),
};
const VEE: UserSpec = {
  categories: ["video"],
  skills: [
    { id: "premiere-pro", level: "core" },
    { id: "video-editing", level: "core" },
  ],
  workSkillIds: [],
  minRateMinor: 0,
  currency: "USD",
  rateType: "fixed",
  remoteOnly: false,
  includeUnpaid: false,
  plan: "standard",
  trialEndsAt: ago(30 * DAY),
};

let seq = 0;

async function seedUser(spec: UserSpec): Promise<string> {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|mt${seq}`,
      email: `mt${seq}@example.com`,
      emailNormalized: `mt${seq}@example.com`,
    })
    .returning({ id: users.id });
  const userId = u!.id;
  await db.insert(profiles).values({
    userId,
    displayName: `User ${seq}`,
    categories: spec.categories,
    experienceLevel: "experienced",
    country: "GB",
    timeZone: "Europe/London",
    minRateMinor: spec.minRateMinor,
    currency: spec.currency,
    rateType: spec.rateType,
    remoteOnly: spec.remoteOnly,
    includeUnpaid: spec.includeUnpaid,
    plan: spec.plan,
    onboardedAt: new Date(),
    trialEndsAt: spec.trialEndsAt,
  });
  await db.insert(profileSkills).values(
    spec.skills.map((s) => ({
      userId,
      skillId: s.id,
      level: s.level,
      source: "manual" as const,
    })),
  );
  if (spec.workSkillIds.length)
    await db.insert(profileProjects).values({
      userId,
      position: 0,
      title: "Bakery ordering site",
      summary: "Built a bakery ordering site",
      role: "solo",
      kind: "client",
      skillIds: spec.workSkillIds,
      source: "manual",
    });
  return userId;
}

type PostSpec = Partial<MatchPost> & {
  title?: string;
  duplicateOf?: string | null;
};

const analysisOf = (spec: PostSpec): NewPostAnalysis => ({
  pipelineVersion: "post@1",
  kind: spec.kind ?? "hiring",
  employmentType: spec.employmentType ?? "freelance",
  payType: spec.payType ?? "paid",
  categories: spec.categories ?? ["development"],
  skillIds: spec.skillIds ?? [],
  budgetMin: spec.budgetMin ?? null,
  budgetMax: spec.budgetMax ?? null,
  currency: spec.currency ?? null,
  budgetUnit: spec.budgetUnit ?? null,
  remote: spec.remote ?? "remote",
  location: null,
  deadline: spec.deadline ?? null,
  redFlags: spec.redFlags ?? [],
  summary: `Gig ${seq}`,
  model: "gemini-test",
});

/**
 * A post that has just finished analysis: it goes through the real hand-off
 * (`completePostAnalysis`), which queues it for matching and sends NOTIFY post_analysed.
 */
async function analysedPost(spec: PostSpec = {}): Promise<string> {
  seq++;
  const [row] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_mt${seq}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/mt${seq}/x/`,
      title: spec.title ?? `[Hiring] Gig ${seq}`,
      body: "Need help with a project.",
      author: `author${seq}`,
      postedAt: spec.postedAt ?? ago(DAY),
      preKind: "hiring",
      analysisStatus: "running",
      analysisAttempts: 1,
      duplicateOf: spec.duplicateOf ?? null,
    })
    .returning({ id: jobPosts.id });
  const ok = await completePostAnalysis(db, row!.id, 1, analysisOf(spec));
  expect(ok).toBe(true);
  return row!.id;
}

/** A post matched before (match_status done), e.g. one that arrived before a user signed up. */
async function oldPost(spec: PostSpec = {}): Promise<string> {
  seq++;
  const [row] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_mt${seq}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/mt${seq}/x/`,
      title: `[Hiring] Gig ${seq}`,
      body: "Need help with a project.",
      author: `author${seq}`,
      postedAt: spec.postedAt ?? ago(DAY),
      preKind: "hiring",
      analysisStatus: "done",
      matchStatus: "done",
    })
    .returning({ id: jobPosts.id });
  await db
    .insert(jobPostAnalyses)
    .values({ jobPostId: row!.id, ...analysisOf(spec) });
  return row!.id;
}

/** Re-analysis: the analyser claims the post again and completes it (queued for matching again). */
async function reanalyse(id: string, spec: PostSpec): Promise<void> {
  const [r] = await db
    .update(jobPosts)
    .set({
      analysisStatus: "running",
      analysisAttempts: sql`${jobPosts.analysisAttempts} + 1`,
    })
    .where(eq(jobPosts.id, id))
    .returning({ attempts: jobPosts.analysisAttempts });
  expect(
    await completePostAnalysis(db, id, r!.attempts, analysisOf(spec)),
  ).toBe(true);
}

// Phase 2's post A: Next.js + payments, $400 fixed, remote. Priya scores 80.
const POST_A: PostSpec = {
  skillIds: ["nextjs", "payments"],
  categories: ["development"],
  budgetMin: 400,
  budgetMax: 400,
  currency: "USD",
  budgetUnit: "fixed",
  remote: "remote",
};
// Phase 2's post B: Postgres at $25/hour, below Priya's rate. Priya scores 0.
const POST_B: PostSpec = {
  skillIds: ["postgresql"],
  categories: ["development"],
  budgetMax: 25,
  currency: "USD",
  budgetUnit: "hour",
  remote: "unknown",
};

const matchFor = async (userId: string, postId: string) =>
  (
    await db
      .select()
      .from(matches)
      .where(and(eq(matches.userId, userId), eq(matches.jobPostId, postId)))
  )[0];
const matchesOf = (postId: string) =>
  db
    .select()
    .from(matches)
    .where(eq(matches.jobPostId, postId))
    .orderBy(asc(matches.userId));
const postRow = async (id: string) =>
  (await db.select().from(jobPosts).where(eq(jobPosts.id, id)))[0]!;

async function waitFor(cond: () => Promise<boolean>, ms = 5000) {
  const until = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const make = (over: Partial<MatcherDeps> = {}) =>
  createMatcher({
    db,
    log: silent,
    listen: noListen,
    pollMs: 3_600_000,
    sweepMs: 3_600_000,
    ...over,
  });

/** One full pass: start (sweep, claim, re-match requests), wait for the work, stop. */
async function runOnce(over: Partial<MatcherDeps> = {}) {
  const m = make(over);
  await m.start();
  await m.idle();
  await m.stop();
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const requestOf = async (userId: string) =>
  (
    await db
      .select({
        since: profiles.rematchSince,
        claimedAt: profiles.rematchClaimedAt,
        attempts: profiles.rematchAttempts,
        after: profiles.rematchAfter,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
  )[0]!;

// ---- Unit: the ai_status rule ----

describe("decideAiStatus", () => {
  const now = new Date();
  const base = {
    existingStatus: null,
    plan: "standard" as const,
    trialEndsAt: ago(DAY),
    broad: false,
    score: 80,
  };
  it("queues strong, specific matches for users whose plan allows AI", () => {
    expect(decideAiStatus(base, 50, now)).toBe("pending");
    expect(decideAiStatus({ ...base, score: 50 }, 50, now)).toBe("pending");
    expect(
      decideAiStatus(
        { ...base, plan: "trial", trialEndsAt: new Date(Date.now() + DAY) },
        50,
        now,
      ),
    ).toBe("pending");
  });
  it("never queues dismissed, expired-trial, broad or weak matches", () => {
    expect(
      decideAiStatus({ ...base, existingStatus: "dismissed" }, 50, now),
    ).toBe("not_needed");
    expect(decideAiStatus({ ...base, plan: "trial" }, 50, now)).toBe(
      "not_needed",
    );
    expect(decideAiStatus({ ...base, broad: true, score: 100 }, 0, now)).toBe(
      "not_needed",
    );
    expect(decideAiStatus({ ...base, score: 49 }, 50, now)).toBe("not_needed");
  });
  it("queues nothing while the re-scorer is off", () => {
    expect(decideAiStatus({ ...base, score: 100 }, null, now)).toBe(
      "not_needed",
    );
  });
});

// ---- The matcher (worker test database) ----

describe("matcher (database)", () => {
  let priya: string;
  let dan: string;
  let old: string;
  let vee: string;

  beforeEach(async () => {
    await reset();
    priya = await seedUser(PRIYA);
    dan = await seedUser(DAN);
    old = await seedUser(OLD);
    vee = await seedUser(VEE);
  });

  it("1: matches a post when NOTIFY post_analysed arrives", async () => {
    const m = make({
      // Poll and sweep are an hour apart: only the notification can wake it.
      listen: () => createPgListener(url, silent, POST_ANALYSED_CHANNEL),
    });
    await m.start();
    await m.idle();
    const a = await analysedPost(POST_A);
    await waitFor(async () => (await postRow(a)).matchStatus === "done");
    await m.idle();
    await m.stop();

    const rows = await matchesOf(a);
    expect(rows.map((r) => r.userId).sort()).toEqual([priya, old].sort());
    expect(await matchFor(priya, a)).toMatchObject({
      ruleScore: 80,
      score: 80,
      broad: false,
      aiStatus: "pending",
      status: "new",
      profileVersion: 1,
    });
    expect((await matchFor(priya, a))!.ruleReason).toContain("Next.js");
    // Old's trial ended: rule score only.
    expect((await matchFor(old, a))!.aiStatus).toBe("not_needed");
    expect(await matchFor(dan, a)).toBeUndefined();
    expect(await matchFor(vee, a)).toBeUndefined();
  });

  it("2: a post with no skills gets broad matches by job type, never AI", async () => {
    const written: NewMatch[] = [];
    const p = await analysedPost({
      skillIds: [],
      categories: ["design", "development"],
      remote: "remote",
    });
    await runOnce({
      ops: {
        upsertMatches: async (d, rows) => {
          written.push(...rows);
          return upsertMatches(d, rows);
        },
      },
    });
    const priyaRow = await matchFor(priya, p);
    const danRow = await matchFor(dan, p);
    expect(priyaRow).toMatchObject({ broad: true, aiStatus: "not_needed" });
    expect(danRow).toMatchObject({ broad: true, aiStatus: "not_needed" });
    expect(priyaRow!.ruleScore).toBeLessThanOrEqual(45);
    expect(await matchFor(vee, p)).toBeUndefined();
    // The matcher itself asks for no AI (not only the DB CHECK).
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((r) => r.broad && r.aiStatus === "not_needed")).toBe(
      true,
    );
    expect((await postRow(p)).matchStatus).toBe("done");
  });

  it("3: a match below the threshold is stored with no AI", async () => {
    const b = await analysedPost(POST_B);
    await runOnce();
    expect(await matchesOf(b)).toHaveLength(1);
    expect(await matchFor(priya, b)).toMatchObject({
      ruleScore: 0,
      score: 0,
      aiStatus: "not_needed",
    });
  });

  it("4: a full-time post is never matched", async () => {
    const claimed: string[] = [];
    const p = await analysedPost({ ...POST_A, employmentType: "full_time" });
    expect((await postRow(p)).matchStatus).toBe("skipped");
    await runOnce({
      ops: {
        claimPostsForMatching: async (d, limit) => {
          const got = await claimPostsForMatching(d, limit);
          claimed.push(...got.map((g) => g.id));
          return got;
        },
      },
    });
    expect(claimed).not.toContain(p);
    expect(await matchesOf(p)).toHaveLength(0);
    expect((await postRow(p)).matchStatus).toBe("skipped");
  });

  it("5: a post older than the age limit gets no matches but is done", async () => {
    const p = await analysedPost({ ...POST_A, postedAt: ago(8 * DAY) });
    await runOnce();
    expect(await matchesOf(p)).toHaveLength(0);
    expect((await postRow(p)).matchStatus).toBe("done");
  });

  it("6: a duplicate is never claimed", async () => {
    const original = await oldPost(POST_A);
    const claimed: string[] = [];
    const copy = await analysedPost({ ...POST_A, duplicateOf: original });
    expect((await postRow(copy)).matchStatus).toBe("skipped");
    await runOnce({
      ops: {
        claimPostsForMatching: async (d, limit) => {
          const got = await claimPostsForMatching(d, limit);
          claimed.push(...got.map((g) => g.id));
          return got;
        },
      },
    });
    expect(claimed).not.toContain(copy);
    expect(await matchesOf(copy)).toHaveLength(0);
  });

  it("7: a re-analysis that changes the post refreshes its matches and resets AI", async () => {
    const a = await analysedPost(POST_A);
    await runOnce();
    const before = (await matchFor(priya, a))!;
    expect(before).toMatchObject({ ruleScore: 80, aiStatus: "pending" });
    // The AI re-score finished in the meantime.
    await db
      .update(matches)
      .set({ aiStatus: "done", aiScore: 92, aiReason: "Great fit", score: 92 })
      .where(eq(matches.id, before.id));
    await reanalyse(a, {
      ...POST_A,
      redFlags: ["upfront_fee", "off_platform_payment"],
    });
    expect((await postRow(a)).matchStatus).toBe("pending");
    await runOnce();
    const after = (await matchFor(priya, a))!;
    expect(after).toMatchObject({
      id: before.id,
      ruleScore: 50,
      score: 50,
      aiStatus: "pending",
      aiScore: null,
      aiReason: null,
      profileVersion: 1,
      withdrawnAt: null,
    });
    expect(after.analysedAt.getTime()).toBeGreaterThan(
      before.analysedAt.getTime(),
    );
    expect(after.features.map((f) => f.signal)).toContain("red_flag");
    expect(await matchesOf(a)).toHaveLength(2);
    expect(await postRow(a)).toMatchObject({
      matchStatus: "done",
      matchAttempts: 2,
    });
  });

  it("8: a dismissed match stays dismissed after a re-analysis", async () => {
    const a = await analysedPost(POST_A);
    await runOnce();
    const row = await matchFor(priya, a);
    expect(row!.aiStatus).toBe("pending");
    await setMatchStatus(db, priya, row!.id, "dismissed");
    await reanalyse(a, POST_A);
    await runOnce();
    expect(await matchFor(priya, a)).toMatchObject({
      id: row!.id,
      status: "dismissed",
      aiStatus: "not_needed",
      ruleScore: 80,
    });
  });

  it("9: backfill matches a new user against the last 3 days only", async () => {
    const recent = [
      await oldPost({ ...POST_A, postedAt: ago(DAY) }),
      await oldPost({ ...POST_A, postedAt: ago(1.5 * DAY) }),
      await oldPost({ ...POST_A, postedAt: ago(2 * DAY) }),
    ];
    const older = await oldPost({ ...POST_A, postedAt: ago(5 * DAY) });
    await requestRematch(db, priya, ago(3 * DAY));
    await runOnce();
    const mine = await db
      .select({ postId: matches.jobPostId, aiStatus: matches.aiStatus })
      .from(matches)
      .where(eq(matches.userId, priya));
    expect(mine.map((r) => r.postId).sort()).toEqual([...recent].sort());
    expect(mine.every((r) => r.aiStatus === "pending")).toBe(true);
    expect(mine.map((r) => r.postId)).not.toContain(older);
    // Only Priya asked for a backfill.
    expect(await db.$count(matches)).toBe(3);
    const [p] = await db
      .select({ since: profiles.rematchSince })
      .from(profiles)
      .where(eq(profiles.userId, priya));
    expect(p!.since).toBeNull();
  });

  it("11: a failed post goes back to pending, then succeeds; the log has no post text", async () => {
    const title = "[Hiring] SECRET-TITLE dashboard rebuild";
    const a = await analysedPost({ ...POST_A, title });
    const { log, lines, raw } = captureLog();
    const fails: string[] = [];
    let thrown = 0;
    const m = make({
      log,
      pollMs: 50,
      ops: {
        candidateUsersForPost: async (d, post) => {
          if (thrown++ === 0) throw new Error(`boom near ${title}`);
          return candidateUsersForPost(d, post);
        },
        failPostMatching: async (d, id, claim) => {
          const r = await failPostMatching(d, id, claim);
          fails.push(r);
          return r;
        },
      },
    });
    await m.start();
    await waitFor(async () => (await postRow(a)).matchStatus === "done");
    await m.idle();
    await m.stop();
    expect(fails).toEqual(["requeued"]);
    expect(await postRow(a)).toMatchObject({ matchAttempts: 2 });
    expect((await matchFor(priya, a))!.ruleScore).toBe(80);
    const err = lines.find((l) => l.level === 50 && l.jobPostId === a);
    expect(err).toMatchObject({ code: "INTERNAL", outcome: "requeued" });
    expect(raw.join("")).not.toContain("SECRET-TITLE");
  });

  it("12: skips and logs a candidate that core rejects (SQL/core drift)", async () => {
    const a = await analysedPost(POST_A);
    const onsite = await analysedPost({ ...POST_A, remote: "onsite" });
    const veeUser = (await loadMatchUser(db, vee))!;
    const priyaUser = (await loadMatchUser(db, priya))!;
    const { log, lines } = captureLog();
    await runOnce({
      log,
      ops: {
        candidateUsersForPost: async (d, post) => {
          const real = await candidateUsersForPost(d, post);
          // Vee shares no skill with post A; Priya is remote-only and the post is onsite.
          const extra = post.id === a ? veeUser : priyaUser;
          return [...real, { ...extra, existingStatus: null }];
        },
      },
    });
    expect(await matchFor(vee, a)).toBeUndefined();
    expect(await matchFor(priya, onsite)).toBeUndefined();
    // The real candidates are still matched.
    expect((await matchFor(priya, a))!.ruleScore).toBe(80);
    expect((await matchFor(old, onsite))!.ruleScore).toBeGreaterThan(0);
    const drift = lines.filter(
      (l) => l.level === 50 && /disagree/.test(String(l.msg)),
    );
    expect(drift).toHaveLength(2);
    expect(drift).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobPostId: a,
          userId: vee,
          check: "candidate",
        }),
        expect.objectContaining({
          jobPostId: onsite,
          userId: priya,
          check: "filters",
        }),
      ]),
    );
  });

  it("13: the poll picks a post up when NOTIFY is missed", async () => {
    const m = make({ pollMs: 100 });
    await m.start();
    await m.idle();
    const a = await analysedPost(POST_A);
    await waitFor(async () => (await postRow(a)).matchStatus === "done", 2000);
    await m.idle();
    await m.stop();
    expect((await matchFor(priya, a))!.ruleScore).toBe(80);
  });

  it("14: matches 10 posts with concurrency 4, each once", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++)
      ids.push(
        await analysedPost({ ...POST_A, postedAt: ago((i + 1) * 60_000) }),
      );
    let inFlight = 0;
    let peak = 0;
    // A barrier instead of sleeps: the first batch waits until all 4 posts are in flight
    // together, which proves they run in parallel without depending on timing.
    const allIn = deferred();
    let arrived = 0;
    const upserts = new Map<string, number>();
    await runOnce({
      concurrency: 4,
      ops: {
        candidateUsersForPost: async (d, post) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          if (arrived < 4 && ++arrived === 4) allIn.resolve();
          await allIn.promise;
          inFlight--;
          return candidateUsersForPost(d, post);
        },
        upsertMatches: async (d, rows) => {
          for (const r of rows)
            if (r.userId === priya)
              upserts.set(r.jobPostId, (upserts.get(r.jobPostId) ?? 0) + 1);
          return upsertMatches(d, rows);
        },
      },
    });
    for (const id of ids)
      expect(await postRow(id)).toMatchObject({
        matchStatus: "done",
        matchAttempts: 1,
      });
    expect(peak).toBe(4);
    expect([...upserts.keys()].sort()).toEqual([...ids].sort());
    expect([...upserts.values()].every((n) => n === 1)).toBe(true);
    expect(await db.$count(matches, eq(matches.userId, priya))).toBe(10);
  });

  it("15: stop() during a batch resolves within the grace period", async () => {
    for (let i = 0; i < 6; i++) await analysedPost(POST_A);
    // The batch is held at a gate that only opens after stop() has returned, so stop can only
    // resolve through its grace period (no wall-clock assertion).
    const gate = deferred();
    const allIn = deferred();
    let entered = 0;
    let finished = 0;
    const m = make({
      concurrency: 4,
      ops: {
        candidateUsersForPost: async (d, post) => {
          if (++entered === 4) allIn.resolve();
          await gate.promise;
          finished++;
          return candidateUsersForPost(d, post);
        },
      },
    });
    await m.start();
    await allIn.promise;
    expect(await db.$count(jobPosts, eq(jobPosts.matchStatus, "running"))).toBe(
      4,
    );
    await m.stop(100);
    expect(finished).toBe(0);
    gate.resolve();
    await m.idle();
    expect(finished).toBe(4);
    // The aborted posts went back to pending; the sweep finds nothing left running.
    await requeueStalePostMatching(db, 0);
    expect(await db.$count(jobPosts, eq(jobPosts.matchStatus, "running"))).toBe(
      0,
    );
    expect(await db.$count(jobPosts, eq(jobPosts.matchStatus, "pending"))).toBe(
      6,
    );
    expect(await db.$count(matches)).toBe(0);
  });

  it("16: MATCHING_ENABLED=false creates no matcher; true wires the env settings", async () => {
    const base = {
      APP_ENV: "local",
      DATABASE_URL: url,
      GOOGLE_CLOUD_PROJECT: "p",
      GOOGLE_CLOUD_LOCATION: "global",
    };
    expect(
      createMatcherFromEnv(
        parseWorkerEnv({ ...base, MATCHING_ENABLED: "false" }),
        { db, log: silent, listen: noListen },
      ),
    ).toBeNull();
    const a = await analysedPost(POST_A);
    const m = createMatcherFromEnv(
      parseWorkerEnv({ ...base, RESCORE_THRESHOLD: "90" }),
      { db, log: silent, listen: noListen },
    )!;
    expect(m).not.toBeNull();
    await m.start();
    await m.idle();
    await m.stop();
    // 80 is below the configured threshold of 90.
    expect(await matchFor(priya, a)).toMatchObject({
      ruleScore: 80,
      aiStatus: "not_needed",
    });
  });
});
