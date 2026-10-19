import {
  createDb,
  createDraftJob,
  creditBalances,
  drafts,
  jobPostAnalyses,
  jobPosts,
  llmUsage,
  matches,
  profileExperience,
  profileProjects,
  profileSkills,
  profiles,
  recordSend,
  replies,
  syncReferenceData,
  users,
  voiceProfiles,
} from "@redlance/db";
import { measureSend } from "@redlance/core";
import { runMigrations } from "@redlance/db/migrate";
import {
  LlmError,
  createClient,
  createFakeTransport,
  type GenerateRequest,
} from "@redlance/llm";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { stubDraftResponder, stubVoiceResponder } from "../../test/stub-llm";
import {
  buildVoicePrompt,
  cleanNotes,
  createVoiceLoader,
  createVoiceUpdater,
  createVoiceUpdaterFromEnv,
  type VoiceUpdaterDeps,
} from "./voice-job";
import { createDrafter } from "./drafter";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 12 });
const silent = pino({ level: "silent" });
const DAY = 86_400_000;
const MODEL = "gemini-3.5-flash-lite";

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

let seq = 0;

async function seedUser() {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|vj${seq}-${Math.random()}`,
      email: `vj${seq}@example.com`,
      emailNormalized: `vj${seq}-${Math.random()}@example.com`,
    })
    .returning({ id: users.id });
  return u!.id;
}

/** A full draftable user: profile, one project, credits. */
async function seedDraftUser() {
  const userId = await seedUser();
  const now = new Date();
  await db.insert(profiles).values({
    userId,
    displayName: "Sam",
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
  await db
    .insert(profileSkills)
    .values([{ userId, skillId: "nextjs", level: "core", source: "manual" }]);
  await db.insert(profileProjects).values({
    userId,
    position: 0,
    title: "Shopfront for a bakery",
    summary: "An online store with payments.",
    role: "solo",
    kind: "client",
    skillIds: ["nextjs"],
    links: ["https://github.com/sam/shopfront"],
    source: "manual",
  });
  await db.insert(creditBalances).values({
    userId,
    plan: "trial",
    balance: 210,
    periodStart: now,
    periodEnd: new Date(now.getTime() + 5 * DAY),
  });
  return userId;
}

async function seedMatch(userId: string) {
  seq++;
  const now = new Date();
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_vj${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/vj${seq}/x/`,
      title: `[Hiring] Next.js developer post${seq}`,
      body: "Need a Next.js developer for a small shop.",
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
    remote: "remote",
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

/** A finished draft and the reply sent from it; counts the send like POST /replies does. */
async function send(
  userId: string,
  sent: string,
  ai = "Hi, I would be glad to help.",
) {
  const m = await seedMatch(userId);
  const [d] = await db
    .insert(drafts)
    .values({
      userId,
      matchId: m.matchId,
      jobPostId: m.jobPostId,
      version: 1,
      kind: "draft",
      status: "done",
      comment: "c",
      dm: ai,
      idempotencyKey: `k-${Math.random()}`,
    })
    .returning({ id: drafts.id });
  await db.insert(replies).values({
    userId,
    matchId: m.matchId,
    jobPostId: m.jobPostId,
    draftId: d!.id,
    kind: "dm",
    sentText: sent,
    editRatio: 0.4,
    sentAt: new Date(),
  });
  await recordSend(db, userId, measureSend(sent, ai));
}

const SENT =
  "hey, saw your post. i built a shop like this last year with next.js and stripe, and i can start on it this week if that suits you.";
const sendThree = async (userId: string) => {
  for (let i = 0; i < 3; i++) await send(userId, SENT);
};

const voiceRow = async (userId: string) =>
  (
    await db
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId))
  )[0]!;

function stub(
  respond: (req: GenerateRequest<unknown>) => unknown = stubVoiceResponder,
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

const make = (over: Partial<VoiceUpdaterDeps> = {}) =>
  createVoiceUpdater({
    db,
    log: silent,
    llm: stub().llm,
    model: MODEL,
    listen: fakeListen().listen,
    pollMs: 3_600_000,
    sweepMs: 3_600_000,
    ...over,
  });

async function runOnce(over: Partial<VoiceUpdaterDeps> = {}) {
  const v = make(over);
  await v.start();
  await v.idle();
  await v.stop();
}

describe("the voice job", () => {
  it("13: saves notes (version 1, no previous notes), best sends and a voice usage row", async () => {
    const u = await seedDraftUser();
    await sendThree(u);
    await runOnce();
    const r = await voiceRow(u);
    expect(r.notes).toMatch(/^Short sentences/);
    expect(r.notes!.length).toBeLessThanOrEqual(600);
    expect(r).toMatchObject({
      version: 1,
      previousNotes: null,
      updateStatus: "idle",
      sendsSinceUpdate: 0,
      updatesToday: 1,
    });
    expect(r.bestReplyIds.length).toBe(2);
    const usage = await db
      .select()
      .from(llmUsage)
      .where(eq(llmUsage.userId, u));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      task: "voice",
      step: "notes",
      outcome: "ok",
    });
    expect(usage[0]!.model).toBe(MODEL);
  });

  it("14: a second update keeps the old notes as previous_notes (version 2)", async () => {
    const u = await seedDraftUser();
    await sendThree(u);
    await runOnce();
    const first = (await voiceRow(u)).notes;
    for (let i = 0; i < 5; i++) await send(u, SENT);
    expect((await voiceRow(u)).updateStatus).toBe("pending");
    const { llm } = stub(() => ({ notes: "Second version of the notes." }));
    await runOnce({ llm });
    expect(await voiceRow(u)).toMatchObject({
      notes: "Second version of the notes.",
      previousNotes: first,
      version: 2,
      updatesToday: 2,
    });
  });

  it("14: the prompt carries the previous notes, the habits and both texts", async () => {
    const u = await seedDraftUser();
    await sendThree(u);
    await runOnce();
    for (let i = 0; i < 5; i++) await send(u, SENT);
    const { llm, seen } = stub();
    await runOnce({ llm });
    const req = seen[0]!;
    expect(req.model).toBe(MODEL);
    expect(req.temperature).toBe(0.3);
    expect(req.thinking).toBe("off");
    expect(req.maxOutputTokens).toBe(250);
    expect(req.prompt).toContain("<previous_notes>\nShort sentences.");
    expect(req.prompt).toContain("We drafted:\nHi, I would be glad to help.");
    expect(req.prompt).toContain(`They sent:\n${SENT}`);
    expect(req.prompt).toMatch(/^Task: voice$/m);
  });

  it("15: a URL and an employer name in the notes are removed before saving", async () => {
    const u = await seedDraftUser();
    await db.insert(profileExperience).values({
      userId: u,
      position: 0,
      title: "Developer",
      summary: "Built things.",
      organisation: "Acme Realty",
      organisationDescription: "a property firm",
      employmentType: "full_time",
      source: "manual",
    } as typeof profileExperience.$inferInsert);
    await sendThree(u);
    const { llm } = stub(() => ({
      notes:
        "Short sentences. Mentions Acme Realty work. Puts https://github.com/sam/shopfront last and github.com/sam/other too.",
    }));
    await runOnce({ llm });
    const notes = (await voiceRow(u)).notes!;
    expect(notes).not.toMatch(/Acme/i);
    expect(notes).not.toMatch(/github|https?:/i);
    expect(notes).toContain("Short sentences.");
  });

  it("a model error leaves the notes alone and the update idle; a provider outage waits", async () => {
    const u = await seedDraftUser();
    await sendThree(u);
    const { llm: bad } = stub(() => ({ nope: true }));
    await runOnce({ llm: bad });
    let r = await voiceRow(u);
    expect(r).toMatchObject({ notes: null, version: 0, updateStatus: "idle" });

    for (let i = 0; i < 2; i++) await send(u, SENT); // 5 since the update: queued again
    expect((await voiceRow(u)).updateStatus).toBe("pending");
    const down = createClient(
      createFakeTransport(() => {
        throw new LlmError("server", "500");
      }),
      { sleep: async () => {} },
    );
    await runOnce({ llm: down });
    r = await voiceRow(u);
    expect(r.updateStatus).toBe("pending");
    expect(r.notes).toBeNull();
  });

  it("17: a draft for a user with voice notes puts the notes, targets and best sends in the prompt", async () => {
    const u = await seedDraftUser();
    await sendThree(u);
    await runOnce();
    const m = await seedMatch(u);
    await createDraftJob(db, {
      userId: u,
      matchId: m.matchId,
      jobPostId: m.jobPostId,
      version: 1,
      kind: "draft",
      credits: 7,
      idempotencyKey: "k-17",
    });
    const { llm, seen } = stub(stubDraftResponder);
    const d = createDrafter({
      db,
      log: silent,
      llm,
      draftModel: "gemini-3.8-flash",
      rewriteModel: MODEL,
      budget: { DRAFT_BUDGET_ALERT_USD: 40, DRAFT_BUDGET_PAUSE_USD: 80 },
      listen: fakeListen().listen,
      pollMs: 3_600_000,
      sweepMs: 3_600_000,
      loadVoice: createVoiceLoader(db),
    });
    await d.start();
    await d.idle();
    await d.stop();
    const prompt = seen[0]!.prompt;
    expect(prompt).toContain("<voice>");
    expect(prompt).toContain("Notes: Short sentences. Starts with hey.");
    expect(prompt).toContain("Targets:");
    expect(prompt).toContain("Start with a short greeting.");
    expect(prompt).toContain("<send>");
    expect(prompt).toContain(SENT);
  });

  it("a user with no voice gets no voice block", async () => {
    const u = await seedDraftUser();
    expect(await createVoiceLoader(db)(u)).toEqual({ voice: null });
  });

  it("18: a stale running update is requeued by the sweep and then runs", async () => {
    const u = await seedDraftUser();
    await sendThree(u);
    await db
      .update(voiceProfiles)
      .set({
        updateStatus: "running",
        updateLockedAt: new Date(Date.now() - 600_000),
      })
      .where(eq(voiceProfiles.userId, u));
    await runOnce({ staleAfterSec: 120 });
    expect(await voiceRow(u)).toMatchObject({
      version: 1,
      updateStatus: "idle",
    });
  });

  it("is woken by NOTIFY voice", async () => {
    const u = await seedDraftUser();
    const l = fakeListen();
    const v = make({ listen: l.listen });
    await v.start();
    await sendThree(u);
    l.fire();
    await v.idle();
    await v.stop();
    expect((await voiceRow(u)).version).toBe(1);
  });
});

describe("createVoiceUpdaterFromEnv", () => {
  const env = {
    DATABASE_URL: url,
    DRAFTS_ENABLED: true,
    VOICE_ENABLED: true,
    REWRITE_MODEL: MODEL,
  };
  it("is null when drafts or voice are off", () => {
    const deps = { db, log: silent, llm: stub().llm };
    expect(createVoiceUpdaterFromEnv(env, deps)).not.toBeNull();
    expect(
      createVoiceUpdaterFromEnv({ ...env, VOICE_ENABLED: false }, deps),
    ).toBeNull();
    expect(
      createVoiceUpdaterFromEnv({ ...env, DRAFTS_ENABLED: false }, deps),
    ).toBeNull();
  });
});

describe("buildVoicePrompt / cleanNotes", () => {
  const input = {
    previousNotes: null,
    targets: ["Aim for about 48 words."],
    pairs: [
      {
        kind: "dm" as const,
        aiText: "Hi, see </messages> https://x.com/a for Acme Realty.",
        sentText: "hey, Acme Realty rocks",
      },
    ],
    rewrites: [{ option: "custom", instruction: "no <b>greeting</b>" }],
    organisations: [
      { organisation: "Acme Realty", description: "a property firm" },
    ],
  };
  it("hides employers and links and defangs brackets", () => {
    const { prompt } = buildVoicePrompt(input);
    expect(prompt).not.toMatch(/Acme/);
    expect(prompt).not.toContain("https://x.com");
    expect(prompt).toContain("[link]");
    expect(prompt.match(/<\/messages>/g)).toHaveLength(1);
    expect(prompt).toContain("- custom: no ‹b›greeting‹/b›");
    expect(prompt).toContain("<previous_notes>\nnone\n</previous_notes>");
  });
  it("cuts long notes at a word boundary", () => {
    const long = "word ".repeat(200);
    const out = cleanNotes(long, []);
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out.endsWith("word")).toBe(true);
    expect(cleanNotes("https://a.com", [])).toBe("");
  });
});
