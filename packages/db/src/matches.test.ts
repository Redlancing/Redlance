import {
  isCandidate,
  passesFilters,
  type MatchPost,
  type MatchProfile,
} from "@redlance/core";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  GIVE_BACK_DELAY_MS,
  MATCHES_CHANNEL,
  MATCH_ALERTS_CHANNEL,
  MAX_REMATCH_ATTEMPTS,
  candidatePostsForUser,
  candidateUsersForPost,
  claimPairsForRescore,
  claimPostsForMatching,
  claimRematch,
  completePostAnalysis,
  completePostMatching,
  completeRematch,
  completeRescore,
  createDb,
  dropAbandonedRematches,
  failPostMatching,
  failRematch,
  failRescore,
  feedPage,
  jobPostAnalyses,
  jobPosts,
  loadMatchPost,
  loadMatchUser,
  loadRescoreContext,
  markCapped,
  matchEvents,
  matches,
  pgErrorCode,
  profileExperience,
  profileProjects,
  profileSkills,
  profiles,
  requestRematch,
  requeueStalePostMatching,
  requeueStaleRescores,
  rescoreUsage,
  setMatchStatus,
  syncReferenceData,
  takeRescoreUnit,
  upsertMatches,
  users,
  withdrawPostMatches,
  withdrawStaleUserMatches,
  type Database,
  type NewMatch,
  type NewPostAnalysis,
} from "./index";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 5 });

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
beforeEach(reset);
afterAll(async () => {
  await reset();
  await pool.end();
});

const DAY = 86_400_000;
const now = new Date();
const ago = (ms: number) => new Date(now.getTime() - ms);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const violates = (code: string) => (err: unknown) => pgErrorCode(err) === code;

// ---- Fixtures ----

type ProfileSpec = MatchProfile & {
  plan?: "trial" | "standard" | "max";
  status?: "active" | "blocked";
  projects?: { title: string; skills: string[]; hidden?: boolean }[];
  roles?: {
    title: string;
    organisation?: string | null;
    organisationDescription: string;
    skills: string[];
    hidden?: boolean;
  }[];
};

const PRIYA: ProfileSpec = {
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
  projects: [
    { title: "Bakery ordering site", skills: ["nextjs", "payments"] },
    { title: "Old Rust toy", skills: ["rust"], hidden: true },
  ],
};
const DESIGNER: ProfileSpec = {
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
};
const EDITOR: ProfileSpec = {
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
};

let seq = 0;

async function seedUser(spec: ProfileSpec, ex: Executor = db): Promise<string> {
  seq++;
  const [u] = await ex
    .insert(users)
    .values({
      authSub: `dev|m${seq}`,
      email: `m${seq}@example.com`,
      emailNormalized: `m${seq}@example.com`,
      status: spec.status ?? "active",
    })
    .returning({ id: users.id });
  const userId = u!.id;
  await ex.insert(profiles).values({
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
    plan: spec.plan ?? "trial",
    onboardedAt: now,
    trialEndsAt: new Date(now.getTime() + 5 * DAY),
  });
  if (spec.skills.length)
    await ex.insert(profileSkills).values(
      spec.skills.map((s) => ({
        userId,
        skillId: s.id,
        level: s.level,
        source: "manual" as const,
      })),
    );
  for (const [position, p] of (spec.projects ?? []).entries())
    await ex.insert(profileProjects).values({
      userId,
      position,
      title: p.title,
      summary: `Built ${p.title.toLowerCase()}`,
      role: "solo",
      kind: "client",
      skillIds: p.skills,
      source: "manual",
      hidden: p.hidden ?? false,
    });
  for (const [position, r] of (spec.roles ?? []).entries())
    await ex.insert(profileExperience).values({
      userId,
      position,
      title: r.title,
      summary: "Built listing pages and a booking flow",
      organisation: r.organisation ?? null,
      organisationDescription: r.organisationDescription,
      employmentType: "full_time",
      skillIds: r.skills,
      source: "manual",
      hidden: r.hidden ?? false,
    });
  return userId;
}

type Executor = Pick<Database, "insert">;

type PostSpec = Partial<MatchPost> & {
  community?: string;
  title?: string;
  body?: string;
  duplicateOf?: string | null;
  matchStatus?: "pending" | "running" | "done" | "skipped" | null;
  /** false = no analysis row. */
  analysed?: boolean;
  summary?: string;
  applyInstructions?: string | null;
};

async function seedPost(spec: PostSpec = {}): Promise<string> {
  seq++;
  const [row] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_m${seq}`,
      fetchedVia: "rss",
      community: spec.community ?? "forhire",
      url: `https://www.reddit.com/r/forhire/comments/m${seq}/x/`,
      title: spec.title ?? `[Hiring] Gig ${seq}`,
      body: spec.body ?? "Need help with a project.",
      author: `author${seq}`,
      postedAt: spec.postedAt ?? ago(DAY),
      preKind: "hiring",
      analysisStatus: spec.analysed === false ? "pending" : "done",
      duplicateOf: spec.duplicateOf ?? null,
      matchStatus:
        spec.matchStatus === undefined
          ? spec.analysed === false
            ? null
            : "done"
          : spec.matchStatus,
    })
    .returning({ id: jobPosts.id });
  if (spec.analysed !== false) {
    const a: NewPostAnalysis = {
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
      summary: spec.summary ?? `Gig ${seq}`,
      applyInstructions: spec.applyInstructions ?? null,
      model: "gemini-test",
    };
    await db.insert(jobPostAnalyses).values({ jobPostId: row!.id, ...a });
  }
  return row!.id;
}

const POST_A: PostSpec = {
  skillIds: ["nextjs", "payments"],
  categories: ["development"],
  budgetMin: 400,
  budgetMax: 400,
  currency: "USD",
  budgetUnit: "fixed",
  remote: "remote",
};

function newMatch(
  userId: string,
  jobPostId: string,
  over: Partial<NewMatch> = {},
): NewMatch {
  return {
    userId,
    jobPostId,
    ruleScore: 80,
    broad: false,
    features: [{ signal: "core_skill", points: 40, detail: ["nextjs"] }],
    ruleReason: "2 of your core skills (Next.js, Payments integration)",
    aiStatus: "not_needed",
    profileVersion: 1,
    ...over,
  };
}

async function seedMatch(
  userId: string,
  jobPostId: string,
  over: Partial<NewMatch> = {},
): Promise<string> {
  await upsertMatches(db, [newMatch(userId, jobPostId, over)], {
    origin: "post",
  });
  const [m] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      sql`${matches.userId} = ${userId} and ${matches.jobPostId} = ${jobPostId}`,
    );
  return m!.id;
}

const matchRow = async (id: string) =>
  (await db.select().from(matches).where(eq(matches.id, id)))[0]!;

/** Counts NOTIFYs on `channel` while `run` executes. */
async function notifications(
  channel: string,
  run: () => Promise<unknown>,
): Promise<number> {
  const listener = new pg.Client({ connectionString: url });
  await listener.connect();
  let n = 0;
  listener.on("notification", (msg) => {
    if (msg.channel === channel) n++;
  });
  await listener.query(`LISTEN ${channel}`);
  await run();
  await new Promise((r) => setTimeout(r, 200));
  await listener.end();
  return n;
}

/** Separate connections, each its own drizzle instance: truly concurrent callers. */
async function connections(n: number) {
  const clients = await Promise.all(
    Array.from({ length: n }, async () => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      return c;
    }),
  );
  return {
    dbs: clients.map((client) => drizzle({ client, schema })),
    clients,
    end: () => Promise.all(clients.map((c) => c.end())),
  };
}

// ---- Schema ----

describe("schema", () => {
  async function insertMatch(over: Record<string, unknown> = {}) {
    const userId = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const v = {
      rule_score: 50,
      score: 50,
      ai_status: "not_needed",
      status: "new",
      ai_score: null,
      ai_concerns: [] as string[],
      broad: false,
      rule_reason: "ok",
      ...over,
    };
    return db.execute(sql`
      insert into matches (id, user_id, job_post_id, posted_at, rule_score, broad, features,
        rule_reason, ai_status, ai_score, ai_concerns, score, status, profile_version, analysed_at)
      values (gen_random_uuid(), ${userId}, ${postId}, now(), ${v.rule_score}, ${v.broad},
        '[]'::jsonb, ${v.rule_reason}, ${v.ai_status}, ${v.ai_score},
        ${
          v.ai_concerns.length
            ? sql`array[${sql.join(
                v.ai_concerns.map((c) => sql`${c}`),
                sql`, `,
              )}]::text[]`
            : sql`'{}'::text[]`
        },
        ${v.score}, ${v.status}, 1, now())`);
  }

  it("1: refuses out-of-range scores, bad enums, too many concerns and negative usage", async () => {
    await insertMatch(); // the base row is valid
    for (const bad of [
      { rule_score: 101 },
      { rule_score: -1 },
      { score: 120 },
      { ai_score: 101 },
      { ai_status: "broad_pending" },
      { ai_status: "bogus" },
      { status: "archived" },
      { ai_concerns: ["a", "b", "c", "d"] },
      { rule_reason: "x".repeat(161) },
      { broad: true, ai_status: "pending" },
    ])
      await expect(insertMatch(bad)).rejects.toSatisfy(violates("23514"));

    const userId = await seedUser(PRIYA);
    await expect(
      db.insert(rescoreUsage).values({ userId, day: isoDay(now), used: -1 }),
    ).rejects.toSatisfy(violates("23514"));
    await expect(
      db.execute(
        sql`update profiles set plan = 'gold' where user_id = ${userId}`,
      ),
    ).rejects.toSatisfy(violates("23514"));
    await expect(
      db.execute(sql`update job_posts set match_status = 'bogus'`),
    ).rejects.toSatisfy(violates("23514"));
    const m = await seedMatch(userId, await seedPost(POST_A));
    await expect(
      db.execute(
        sql`insert into match_events (id, match_id, user_id, event) values (gen_random_uuid(), ${m}, ${userId}, 'archived')`,
      ),
    ).rejects.toSatisfy(violates("23514"));
  });

  it("2: profiles default to the trial plan, paid work only and version 1", async () => {
    const userId = await seedUser(PRIYA);
    await db.execute(
      sql`update profiles set plan = default, include_unpaid = default where user_id = ${userId}`,
    );
    const [p] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId));
    expect(p!.plan).toBe("trial");
    expect(p!.includeUnpaid).toBe(false);
    expect(p!.profileVersion).toBe(1);
    expect(p!.rematchSince).toBeNull();
  });
});

// ---- The post queue ----

describe("post queue", () => {
  it("5: two claimers never take the same post, and a stale claim can't write", async () => {
    for (let i = 0; i < 20; i++)
      await seedPost({ ...POST_A, matchStatus: "pending" });

    // Deterministic: A holds its rows in an open transaction; B skips them.
    const c = await connections(2);
    try {
      await c.clients[0]!.query("begin");
      const a = await claimPostsForMatching(c.dbs[0]!, 3);
      const b = await claimPostsForMatching(c.dbs[1]!, 20);
      expect(a).toHaveLength(3);
      expect(b).toHaveLength(17);
      expect(a.filter((x) => b.some((y) => y.id === x.id))).toHaveLength(0);
      await c.clients[0]!.query("commit");
    } finally {
      await c.end();
    }

    // A real race on separate connections.
    await db.execute(
      sql`update job_posts set match_status = 'pending', match_locked_at = null`,
    );
    const r = await connections(2);
    try {
      const [x, y] = await Promise.all([
        claimPostsForMatching(r.dbs[0]!, 15),
        claimPostsForMatching(r.dbs[1]!, 15),
      ]);
      const ids = [...x!, ...y!].map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(20);
    } finally {
      await r.end();
    }

    // Fencing: a stale claim loses to the next one.
    await db.execute(sql`update job_posts set match_status = 'done'`);
    const id = await seedPost({ ...POST_A, matchStatus: "pending" });
    const [first] = await claimPostsForMatching(db, 1);
    expect(first).toEqual({ id, claim: 1 });
    expect(await requeueStalePostMatching(db, 0)).toBe(1);
    const [second] = await claimPostsForMatching(db, 1);
    expect(second!.claim).toBe(2);
    expect(await completePostMatching(db, id, first!.claim)).toBe(false);
    expect(await failPostMatching(db, id, first!.claim)).toBe("lost");
    expect(await completePostMatching(db, id, second!.claim)).toBe(true);
    const [row] = await db.select().from(jobPosts).where(eq(jobPosts.id, id));
    expect(row!.matchStatus).toBe("done");
    expect(row!.matchLockedAt).toBeNull();
  });

  it("claims newest first, retries failures, then skips", async () => {
    const older = await seedPost({
      matchStatus: "pending",
      postedAt: ago(2 * DAY),
    });
    const newer = await seedPost({
      matchStatus: "pending",
      postedAt: ago(DAY),
    });
    expect((await claimPostsForMatching(db, 5)).map((p) => p.id)).toEqual([
      newer,
      older,
    ]);
    await db.execute(sql`update job_posts set match_status = 'done'`);
    const id = await seedPost({ matchStatus: "pending" });
    for (let n = 1; n <= 3; n++) {
      const [c] = await claimPostsForMatching(db, 1);
      expect(c!.claim).toBe(n);
      expect(await failPostMatching(db, id, c!.claim)).toBe(
        n < 3 ? "requeued" : "skipped",
      );
    }
    expect(await claimPostsForMatching(db, 1)).toEqual([]);
  });
});

// ---- Candidates ----

describe("candidates", () => {
  it("loads a post in core's shape", async () => {
    const id = await seedPost({ ...POST_A, deadline: "2026-12-01" });
    const post = await loadMatchPost(db, id);
    expect(post).toMatchObject({
      id,
      kind: "hiring",
      skillIds: ["nextjs", "payments"],
      budgetMin: 400,
      budgetMax: 400,
      currency: "USD",
      deadline: "2026-12-01",
    });
    expect(post!.postedAt).toBeInstanceOf(Date);
    expect(
      await loadMatchPost(db, await seedPost({ analysed: false })),
    ).toBeNull();
  });

  it("6: returns Priya for post A with skills, levels and visible work skills", async () => {
    const priya = await seedUser(PRIYA);
    const post = (await loadMatchPost(db, await seedPost(POST_A)))!;
    const got = await candidateUsersForPost(db, post);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      userId: priya,
      plan: "trial",
      profileVersion: 1,
      existingStatus: null,
    });
    expect(got[0]!.trialEndsAt).toBeInstanceOf(Date);
    expect(got[0]!.profile.skills).toEqual([
      { id: "nextjs", level: "core" },
      { id: "payments", level: "core" },
      { id: "postgresql", level: "secondary" },
      { id: "react", level: "core" },
    ]);
    // The hidden project's "rust" is left out.
    expect(got[0]!.profile.workSkillIds).toEqual(["nextjs", "payments"]);
    expect(got[0]!.profile).toMatchObject({
      categories: ["development"],
      minRateMinor: 3000,
      currency: "USD",
      rateType: "either",
      remoteOnly: true,
      includeUnpaid: false,
    });
    expect(await loadMatchUser(db, priya)).toEqual({
      userId: priya,
      plan: got[0]!.plan,
      trialEndsAt: got[0]!.trialEndsAt,
      profileVersion: 1,
      profile: got[0]!.profile,
    });
  });

  it("reports the user's existing match status", async () => {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const m = await seedMatch(priya, postId);
    await setMatchStatus(db, priya, m, "dismissed");
    const post = (await loadMatchPost(db, postId))!;
    expect((await candidateUsersForPost(db, post))[0]!.existingStatus).toBe(
      "dismissed",
    );
  });

  it("7: a post with no skills reaches the designer as a broad candidate", async () => {
    const designer = await seedUser(DESIGNER);
    await seedUser(EDITOR);
    const post = (await loadMatchPost(
      db,
      await seedPost({ skillIds: [], categories: ["design"] }),
    ))!;
    expect(
      (await candidateUsersForPost(db, post)).map((u) => u.userId),
    ).toEqual([designer]);
  });

  it("8: the video editor isn't a candidate for post A", async () => {
    await seedUser(EDITOR);
    const post = (await loadMatchPost(db, await seedPost(POST_A)))!;
    expect(await candidateUsersForPost(db, post)).toEqual([]);
  });

  it("9: a remote-only user never gets an onsite post", async () => {
    await seedUser(PRIYA);
    const post = (await loadMatchPost(
      db,
      await seedPost({ ...POST_A, remote: "onsite" }),
    ))!;
    expect(await candidateUsersForPost(db, post)).toEqual([]);
  });

  it("10: unpaid posts reach only users who include unpaid work", async () => {
    const without = await seedUser(PRIYA);
    const withUnpaid = await seedUser({ ...PRIYA, includeUnpaid: true });
    const post = (await loadMatchPost(
      db,
      await seedPost({ ...POST_A, payType: "unpaid" }),
    ))!;
    const ids = (await candidateUsersForPost(db, post)).map((u) => u.userId);
    expect(ids).toEqual([withUnpaid]);
    expect(ids).not.toContain(without);
  });

  it("11: a blocked user isn't a candidate", async () => {
    const blocked = await seedUser({ ...PRIYA, status: "blocked" });
    const post = (await loadMatchPost(db, await seedPost(POST_A)))!;
    expect(await candidateUsersForPost(db, post)).toEqual([]);
    expect(await loadMatchUser(db, blocked)).toBeNull();
  });

  it("12: SQL agrees with core isCandidate + passesFilters over a matrix", async () => {
    // Six profiles x fourteen posts = 84 pairs. The matcher checks the post-level filters with
    // core before asking SQL for users; the composition must agree with core pair by pair.
    const profilesSpec: ProfileSpec[] = [
      PRIYA,
      DESIGNER,
      EDITOR,
      {
        ...DESIGNER,
        categories: ["development", "design"],
        skills: [{ id: "react", level: "secondary" }],
        includeUnpaid: false,
      },
      {
        ...EDITOR,
        categories: ["writing"],
        skills: [],
        remoteOnly: true,
        includeUnpaid: true,
      },
      {
        ...PRIYA,
        skills: [{ id: "postgresql", level: "core" }],
        includeUnpaid: true,
        projects: [],
      },
    ];
    const postsSpec: PostSpec[] = [
      POST_A,
      { skillIds: ["postgresql"], remote: "unknown" },
      {
        skillIds: [],
        categories: ["design", "development"],
        payType: "unknown",
      },
      { skillIds: ["video-editing"], categories: ["video"] },
      { skillIds: ["react"], remote: "onsite" },
      { skillIds: ["figma"], categories: ["design"], payType: "unpaid" },
      {
        skillIds: [],
        categories: ["writing"],
        remote: "onsite",
        payType: "commission_only",
      },
      { skillIds: ["react"], employmentType: "full_time" },
      { skillIds: ["nextjs"], postedAt: ago(8 * DAY) },
      { skillIds: [], categories: ["development"], deadline: isoDay(ago(DAY)) },
      { skillIds: ["react"], kind: "for_hire" },
      { skillIds: [], categories: [] },
      {
        skillIds: ["postgresql", "figma"],
        categories: ["development", "design"],
        remote: "hybrid",
        payType: "revshare",
      },
      { skillIds: ["rust"], categories: ["development"] },
      {
        skillIds: [],
        categories: ["writing"],
        remote: "remote",
        payType: "unpaid",
        deadline: isoDay(now),
      },
    ];
    const userIds: string[] = [];
    for (const p of profilesSpec) userIds.push(await seedUser(p));
    const posts = [];
    for (const p of postsSpec)
      posts.push(
        (await loadMatchPost(
          db,
          await seedPost({ ...p, matchStatus: "pending" }),
        ))!,
      );

    const expectedProfile = (spec: ProfileSpec): MatchProfile => ({
      categories: spec.categories,
      skills: [...spec.skills].sort((a, b) => a.id.localeCompare(b.id)),
      workSkillIds: [
        ...new Set(
          (spec.projects ?? [])
            .filter((p) => !p.hidden)
            .flatMap((p) => p.skills),
        ),
      ].sort(),
      minRateMinor: spec.minRateMinor,
      currency: spec.currency,
      rateType: spec.rateType,
      remoteOnly: spec.remoteOnly,
      includeUnpaid: spec.includeUnpaid,
    });
    const PERMISSIVE: MatchProfile = {
      ...expectedProfile(EDITOR),
      remoteOnly: false,
      includeUnpaid: true,
    };

    let agreed = 0;
    let included = 0;
    for (const post of posts) {
      const postLevelOk = passesFilters(post, PERMISSIVE, now);
      const got = postLevelOk ? await candidateUsersForPost(db, post) : [];
      for (const [i, spec] of profilesSpec.entries()) {
        const profile = expectedProfile(spec);
        const expected =
          isCandidate(post, profile) !== null &&
          passesFilters(post, profile, now);
        const row = got.find((u) => u.userId === userIds[i]);
        expect({
          post: postsSpec[posts.indexOf(post)],
          user: i,
          in: Boolean(row),
        }).toEqual({
          post: postsSpec[posts.indexOf(post)],
          user: i,
          in: expected,
        });
        if (row) {
          expect(row.profile).toEqual(profile);
          included++;
        }
        agreed++;
      }
    }
    expect(agreed).toBe(profilesSpec.length * postsSpec.length);
    expect(included).toBeGreaterThanOrEqual(8); // the matrix exercises both outcomes

    // The reverse direction (backfill) agrees too; age and deadline stay with core.
    for (const [i, spec] of profilesSpec.entries()) {
      const profile = expectedProfile(spec);
      const got = new Set(
        (await candidatePostsForUser(db, userIds[i]!, ago(30 * DAY))).map(
          (p) => p.id,
        ),
      );
      for (const post of posts) {
        const expected =
          isCandidate(post, profile) !== null &&
          passesFilters(
            { ...post, postedAt: now, deadline: null },
            profile,
            now,
          );
        expect({ user: i, post: post.id, in: got.has(post.id) }).toEqual({
          user: i,
          post: post.id,
          in: expected,
        });
      }
    }
  });

  it("13: loads 50 candidates in one query (no N+1)", async () => {
    // Approach: a separate pool whose query() is wrapped to count every statement drizzle
    // sends. candidateUsersForPost must send one, however many users match.
    for (let i = 0; i < 50; i++)
      await seedUser({
        ...PRIYA,
        projects: [{ title: `Project ${i}`, skills: ["react"] }],
      });
    const post = (await loadMatchPost(db, await seedPost(POST_A)))!;
    const counting = new pg.Pool({ connectionString: url, max: 2 });
    let queries = 0;
    const query = counting.query.bind(counting);
    counting.query = ((...args: Parameters<typeof query>) => {
      queries++;
      return query(...args);
    }) as typeof counting.query;
    try {
      const got = await candidateUsersForPost(
        drizzle({ client: counting, schema }),
        post,
      );
      expect(got).toHaveLength(50);
      expect(got.every((u) => u.profile.skills.length === 4)).toBe(true);
      expect(queries).toBe(1);
    } finally {
      await counting.end();
    }
  });

  it("14: candidatePostsForUser keeps the window, originals and hiring only", async () => {
    const priya = await seedUser(PRIYA);
    const recent = await seedPost({ ...POST_A, postedAt: ago(DAY) });
    const pending = await seedPost({
      ...POST_A,
      postedAt: ago(2 * DAY),
      matchStatus: "pending",
    });
    // Being matched right now: included too (upserts are idempotent).
    const running = await seedPost({
      ...POST_A,
      postedAt: ago(2.5 * DAY),
      matchStatus: "running",
    });
    await seedPost({ ...POST_A, postedAt: ago(5 * DAY) }); // outside the window
    await seedPost({ ...POST_A, postedAt: ago(DAY), duplicateOf: recent });
    await seedPost({ ...POST_A, postedAt: ago(DAY), kind: "for_hire" });
    await seedPost({
      ...POST_A,
      postedAt: ago(DAY),
      employmentType: "full_time",
    });
    await seedPost({ ...POST_A, postedAt: ago(DAY), matchStatus: "skipped" });
    await seedPost({ postedAt: ago(DAY), analysed: false });
    await seedPost({ ...POST_A, skillIds: ["figma"], categories: ["design"] });

    const got = await candidatePostsForUser(db, priya, ago(3 * DAY));
    expect(got.map((p) => p.id)).toEqual([recent, pending, running]);
    expect(got[0]).toMatchObject({
      kind: "hiring",
      skillIds: ["nextjs", "payments"],
    });
    // The analysis time comes along, to the millisecond, for NewMatch.analysedAt.
    const [a] = await db
      .select({ at: jobPostAnalyses.createdAt })
      .from(jobPostAnalyses)
      .where(eq(jobPostAnalyses.jobPostId, recent));
    expect(got[0]!.analysedAt).toEqual(a!.at);
  });
});

// ---- Matches ----

describe("upsertMatches", () => {
  it("15: the same profile version again changes nothing", async () => {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const id = await seedMatch(priya, postId);
    const before = await matchRow(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(
      await upsertMatches(db, [newMatch(priya, postId, { ruleScore: 10 })], {
        origin: "post",
      }),
    ).toBe(0);
    const after = await matchRow(id);
    expect(after).toEqual(before);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.postedAt).toEqual((await loadMatchPost(db, postId))!.postedAt);
  });

  it("16: a new version replaces the rule fields and resets the AI fields", async () => {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const id = await seedMatch(priya, postId, { aiStatus: "pending" });
    await db.execute(sql`
      update matches set ai_status = 'done', ai_score = 91, ai_reason = 'Great fit',
        ai_concerns = array['senior only'], ai_attempts = 2, ai_model = 'm',
        ai_scored_at = now(), ai_finished_at = now(), ai_unit_day = current_date, score = 91
      where id = ${id}`);
    expect(
      await upsertMatches(
        db,
        [
          newMatch(priya, postId, {
            ruleScore: 55,
            ruleReason: "1 core skill",
            features: [{ signal: "core_skill", points: 20 }],
            aiStatus: "pending",
            profileVersion: 2,
          }),
        ],
        { origin: "post" },
      ),
    ).toBe(1);
    const row = await matchRow(id);
    expect(row).toMatchObject({
      ruleScore: 55,
      score: 55,
      ruleReason: "1 core skill",
      features: [{ signal: "core_skill", points: 20 }],
      profileVersion: 2,
      aiStatus: "pending",
      aiScore: null,
      aiReason: null,
      aiConcerns: [],
      aiAttempts: 0,
      aiModel: null,
      aiScoredAt: null,
      aiFinishedAt: null,
      aiUnitDay: null,
      bestProjectId: null,
      status: "new",
    });
  });

  it("17: a dismissed match stays dismissed and needs no AI", async () => {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const id = await seedMatch(priya, postId);
    await setMatchStatus(db, priya, id, "dismissed");
    await upsertMatches(
      db,
      [newMatch(priya, postId, { aiStatus: "pending", profileVersion: 2 })],
      { origin: "post" },
    );
    expect(await matchRow(id)).toMatchObject({
      status: "dismissed",
      aiStatus: "not_needed",
      profileVersion: 2,
    });
  });

  it("stores broad matches as not_needed", async () => {
    const designer = await seedUser(DESIGNER);
    const postId = await seedPost({ skillIds: [], categories: ["design"] });
    const id = await seedMatch(designer, postId, {
      broad: true,
      aiStatus: "pending",
      ruleScore: 20,
    });
    expect((await matchRow(id)).aiStatus).toBe("not_needed");
  });

  it("18: wakes the re-scorer only when a written row is pending", async () => {
    const priya = await seedUser(PRIYA);
    const p1 = await seedPost(POST_A);
    const p2 = await seedPost(POST_A);
    expect(
      await notifications(MATCHES_CHANNEL, () =>
        upsertMatches(db, [newMatch(priya, p1), newMatch(priya, p2)], {
          origin: "post",
        }),
      ),
    ).toBe(0);
    const p3 = await seedPost(POST_A);
    expect(
      await notifications(MATCHES_CHANNEL, () =>
        upsertMatches(
          db,
          [
            newMatch(priya, p3, { aiStatus: "pending" }),
            newMatch(priya, p1), // unchanged: not written
          ],
          { origin: "post" },
        ),
      ),
    ).toBe(1);
    // A pending row that isn't written (same version) wakes nobody.
    expect(
      await notifications(MATCHES_CHANNEL, () =>
        upsertMatches(db, [newMatch(priya, p3, { aiStatus: "pending" })], {
          origin: "post",
        }),
      ),
    ).toBe(0);
  });

  it("a new-post insert is waiting for the router; a backfill insert is skipped", async () => {
    const priya = await seedUser(PRIYA);
    const p1 = await seedPost(POST_A);
    const p2 = await seedPost(POST_A);
    await upsertMatches(db, [newMatch(priya, p1)], { origin: "post" });
    await upsertMatches(db, [newMatch(priya, p2)], { origin: "backfill" });
    const rows = await db
      .select({ jobPostId: matches.jobPostId, outcome: matches.alertOutcome })
      .from(matches);
    expect(
      Object.fromEntries(rows.map((r) => [r.jobPostId, r.outcome])),
    ).toEqual({ [p1]: null, [p2]: "skipped_backfill" });
  });

  it("a re-analysis never touches the alert columns", async () => {
    const t1 = ago(DAY);
    const t2 = ago(DAY - 60_000);
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const id = await seedMatch(priya, postId, { analysedAt: t1 });
    await db.execute(sql`
      update matches set alert_outcome = 'sent', alert_routed_at = now(), alerted_at = now(),
        alert_channels = array['telegram'], alert_score = 80, alert_template = 'tg@1',
        telegram_message_id = 4242
      where id = ${id}`);
    const before = await matchRow(id);
    for (const origin of ["post", "backfill"] as const) {
      await upsertMatches(
        db,
        [
          newMatch(priya, postId, {
            ruleScore: origin === "post" ? 60 : 65,
            analysedAt: origin === "post" ? t2 : now,
          }),
        ],
        { origin },
      );
      const after = await matchRow(id);
      expect(after.ruleScore).toBe(origin === "post" ? 60 : 65);
      expect(after).toMatchObject({
        alertOutcome: before.alertOutcome,
        alertRoutedAt: before.alertRoutedAt,
        alertedAt: before.alertedAt,
        alertChannels: ["telegram"],
        alertScore: 80,
        alertTemplate: "tg@1",
        telegramMessageId: 4242,
      });
    }
  });

  it("wakes the router only when a new post inserts a row", async () => {
    const priya = await seedUser(PRIYA);
    const designer = await seedUser(DESIGNER);
    const p1 = await seedPost(POST_A);
    expect(
      await notifications(MATCH_ALERTS_CHANNEL, () =>
        upsertMatches(db, [newMatch(priya, p1), newMatch(designer, p1)], {
          origin: "post",
        }),
      ),
    ).toBe(1);
    // An update of existing rows (a re-analysis) is not a new match.
    expect(
      await notifications(MATCH_ALERTS_CHANNEL, () =>
        upsertMatches(db, [newMatch(priya, p1, { profileVersion: 2 })], {
          origin: "post",
        }),
      ),
    ).toBe(0);
    // A backfill insert never alerts.
    const p2 = await seedPost(POST_A);
    expect(
      await notifications(MATCH_ALERTS_CHANNEL, () =>
        upsertMatches(db, [newMatch(priya, p2)], { origin: "backfill" }),
      ),
    ).toBe(0);
  });

  /** A match already re-scored by AI, as of `analysedAt`. */
  async function aiDoneMatch(analysedAt: Date, profileVersion = 1) {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const id = await seedMatch(priya, postId, {
      aiStatus: "pending",
      analysedAt,
      profileVersion,
    });
    await db.execute(sql`
      update matches set ai_status = 'done', ai_score = 91, ai_reason = 'Great fit',
        ai_attempts = 1, ai_model = 'm', ai_scored_at = now(), score = 91
      where id = ${id}`);
    return { priya, postId, id };
  }

  it("a re-analysis that adds red flags lowers the score and resets AI", async () => {
    const t1 = ago(DAY);
    const t2 = ago(DAY - 60_000);
    const { priya, postId, id } = await aiDoneMatch(t1);
    expect(
      await upsertMatches(
        db,
        [
          newMatch(priya, postId, {
            ruleScore: 50,
            ruleReason: "2 core skills; red flags",
            features: [{ signal: "red_flags", points: -30 }],
            aiStatus: "pending",
            analysedAt: t2,
          }),
        ],
        { origin: "post" },
      ),
    ).toBe(1);
    expect(await matchRow(id)).toMatchObject({
      ruleScore: 50,
      score: 50,
      ruleReason: "2 core skills; red flags",
      analysedAt: t2,
      profileVersion: 1,
      aiStatus: "pending",
      aiScore: null,
      aiReason: null,
      aiAttempts: 0,
      aiScoredAt: null,
    });
  });

  it("an identical analysis with a newer analysed_at still refreshes the row", async () => {
    const t1 = ago(DAY);
    const t2 = ago(DAY - 60_000);
    const { priya, postId, id } = await aiDoneMatch(t1);
    expect(
      await upsertMatches(
        db,
        [newMatch(priya, postId, { aiStatus: "pending", analysedAt: t2 })],
        { origin: "post" },
      ),
    ).toBe(1);
    expect(await matchRow(id)).toMatchObject({
      ruleScore: 80,
      analysedAt: t2,
      aiStatus: "pending",
      aiScore: null,
      score: 80,
    });
  });

  it("ignores an older analysis or an older profile version after a newer one", async () => {
    const t1 = ago(DAY);
    const t2 = ago(DAY - 60_000);
    const t3 = ago(DAY - 120_000);
    const { priya, postId, id } = await aiDoneMatch(t2, 2);
    const before = await matchRow(id);
    // An older analysis on the same version: a slow matcher's stale snapshot.
    expect(
      await upsertMatches(
        db,
        [
          newMatch(priya, postId, {
            ruleScore: 10,
            analysedAt: t1,
            profileVersion: 2,
          }),
        ],
        { origin: "post" },
      ),
    ).toBe(0);
    // An older profile version, even with a later analysis: the version never moves back.
    expect(
      await upsertMatches(
        db,
        [
          newMatch(priya, postId, {
            ruleScore: 10,
            analysedAt: t3,
            profileVersion: 1,
          }),
        ],
        { origin: "post" },
      ),
    ).toBe(0);
    expect(await matchRow(id)).toEqual(before);
    // A newer version with the same analysis goes through.
    expect(
      await upsertMatches(
        db,
        [
          newMatch(priya, postId, {
            ruleScore: 30,
            analysedAt: t2,
            profileVersion: 3,
          }),
        ],
        { origin: "post" },
      ),
    ).toBe(1);
    expect(await matchRow(id)).toMatchObject({
      ruleScore: 30,
      profileVersion: 3,
      analysedAt: t2,
    });
  });

  it("a newer row brings a withdrawn match back", async () => {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const id = await seedMatch(priya, postId, { analysedAt: ago(DAY) });
    await db.execute(
      sql`update matches set withdrawn_at = now() where id = ${id}`,
    );
    await upsertMatches(
      db,
      [newMatch(priya, postId, { analysedAt: ago(DAY - 1000) })],
      { origin: "post" },
    );
    expect((await matchRow(id)).withdrawnAt).toBeNull();
  });
});

// ---- Withdrawing ----

describe("withdrawing matches", () => {
  const T = ago(DAY);

  /** One row per status for `postId`, each for a different Priya-like user. */
  async function rowsInEveryState(postId: string, analysedAt = T) {
    const ids: Record<string, string> = {};
    for (const state of [
      "new",
      "seen",
      "saved",
      "replied",
      "dismissed",
      "running",
    ]) {
      const u = await seedUser(PRIYA);
      ids[state] = await seedMatch(u, postId, {
        aiStatus: "pending",
        analysedAt,
      });
      if (state === "running")
        await db.execute(
          sql`update matches set ai_status = 'running' where id = ${ids[state]}`,
        );
      else if (state !== "new")
        await db.execute(
          sql`update matches set status = ${state}, ai_status = 'pending' where id = ${ids[state]}`,
        );
    }
    return ids;
  }

  it("withdraws every live match of a post that no longer qualifies; history stays", async () => {
    const postId = await seedPost(POST_A);
    const ids = await rowsInEveryState(postId);
    expect(await withdrawPostMatches(db, postId, T, null)).toBe(3);
    const row = async (k: string) => matchRow(ids[k]!);
    expect(await row("new")).toMatchObject({ aiStatus: "not_needed" });
    expect((await row("new")).withdrawnAt).not.toBeNull();
    expect((await row("seen")).withdrawnAt).not.toBeNull();
    // A running re-score isn't cut off; the row is still withdrawn.
    expect(await row("running")).toMatchObject({ aiStatus: "running" });
    expect((await row("running")).withdrawnAt).not.toBeNull();
    for (const k of ["saved", "replied", "dismissed"])
      expect((await row(k)).withdrawnAt).toBeNull();
    // Withdrawn rows leave the AI queue: only the history rows are claimed...
    const claimed = await claimPairsForRescore(db, 10);
    expect(claimed.map((c) => c.matchId).sort()).toEqual(
      [ids.saved, ids.replied, ids.dismissed].sort(),
    );
    // ...and the withdrawn running pair, requeued by a retryable failure, isn't claimed again.
    expect(
      await failRescore(
        db,
        ids.running!,
        { attempts: 0, profileVersion: 1 },
        { code: "TIMEOUT", retryable: true, countAttempt: false },
      ),
    ).toBe("requeued");
    await db.execute(
      sql`update matches set ai_run_after = now() where id = ${ids.running}`,
    );
    expect(await claimPairsForRescore(db, 10)).toEqual([]);
  });

  it("never withdraws a row scored from a later analysis", async () => {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const id = await seedMatch(priya, postId, { analysedAt: T });
    expect(
      await withdrawPostMatches(db, postId, new Date(T.getTime() - 1), null),
    ).toBe(0);
    expect((await matchRow(id)).withdrawnAt).toBeNull();
  });

  it("withdraws users outside the kept set unless they're candidates right now", async () => {
    const postId = await seedPost({ ...POST_A, remote: "onsite" });
    // In the kept set: the matcher just upserted it.
    const kept = await seedMatch(await seedUser(PRIYA), postId, {
      analysedAt: T,
    });
    // Not kept, but a candidate by its current profile (a racing re-match wrote it): stays.
    const raced = await seedMatch(
      await seedUser({ ...PRIYA, remoteOnly: false }),
      postId,
      { analysedAt: T },
    );
    // No shared skill any more: withdrawn.
    const editor = await seedMatch(await seedUser(EDITOR), postId, {
      analysedAt: T,
    });
    // Shares skills, but remote-only and the post is onsite: withdrawn.
    const remoteOnly = await seedMatch(await seedUser(PRIYA), postId, {
      analysedAt: T,
    });
    const keptUser = (await matchRow(kept)).userId;
    expect(await withdrawPostMatches(db, postId, T, [keptUser])).toBe(2);
    expect((await matchRow(kept)).withdrawnAt).toBeNull();
    expect((await matchRow(raced)).withdrawnAt).toBeNull();
    expect((await matchRow(editor)).withdrawnAt).not.toBeNull();
    expect((await matchRow(remoteOnly)).withdrawnAt).not.toBeNull();
  });

  it("withdraws a user's older-version matches inside the re-match window only", async () => {
    const priya = await seedUser(PRIYA);
    const inside = await seedMatch(
      priya,
      await seedPost({ ...POST_A, postedAt: ago(2 * DAY) }),
      { aiStatus: "pending" },
    );
    const outside = await seedMatch(
      priya,
      await seedPost({ ...POST_A, postedAt: ago(9 * DAY) }),
    );
    const current = await seedMatch(
      priya,
      await seedPost({ ...POST_A, postedAt: ago(DAY) }),
      { profileVersion: 2 },
    );
    const saved = await seedMatch(
      priya,
      await seedPost({ ...POST_A, postedAt: ago(DAY) }),
    );
    await setMatchStatus(db, priya, saved, "saved");
    const other = await seedMatch(
      await seedUser(PRIYA),
      await seedPost({ ...POST_A, postedAt: ago(DAY) }),
    );
    expect(await withdrawStaleUserMatches(db, priya, ago(7 * DAY), 2)).toBe(1);
    expect(await matchRow(inside)).toMatchObject({ aiStatus: "not_needed" });
    expect((await matchRow(inside)).withdrawnAt).not.toBeNull();
    for (const id of [outside, current, saved, other])
      expect((await matchRow(id)).withdrawnAt).toBeNull();
  });

  it("completePostAnalysis queues a post with live matches even when it no longer qualifies", async () => {
    const reanalyseAs = async (postId: string, kind: "for_hire" | "hiring") => {
      const [r] = await db
        .update(jobPosts)
        .set({
          analysisStatus: "running",
          analysisAttempts: sql`${jobPosts.analysisAttempts} + 1`,
        })
        .where(eq(jobPosts.id, postId))
        .returning({ attempts: jobPosts.analysisAttempts });
      const [a] = await db
        .select()
        .from(jobPostAnalyses)
        .where(eq(jobPostAnalyses.jobPostId, postId));
      const { jobPostId: _, createdAt: __, ...analysis } = a!;
      expect(
        await completePostAnalysis(db, postId, r!.attempts, {
          ...analysis,
          kind,
        }),
      ).toBe(true);
      return (
        await db.select().from(jobPosts).where(eq(jobPosts.id, postId))
      )[0]!.matchStatus;
    };
    const priya = await seedUser(PRIYA);
    const live = await seedPost(POST_A);
    await seedMatch(priya, live);
    expect(await reanalyseAs(live, "for_hire")).toBe("pending");

    // No matches, or only history (dismissed) or withdrawn ones: nothing to withdraw.
    expect(await reanalyseAs(await seedPost(POST_A), "for_hire")).toBe(
      "skipped",
    );
    const dismissed = await seedPost(POST_A);
    await setMatchStatus(
      db,
      priya,
      await seedMatch(priya, dismissed),
      "dismissed",
    );
    expect(await reanalyseAs(dismissed, "for_hire")).toBe("skipped");
    const withdrawn = await seedPost(POST_A);
    await seedMatch(priya, withdrawn);
    await withdrawPostMatches(db, withdrawn, new Date(), null);
    expect(await reanalyseAs(withdrawn, "for_hire")).toBe("skipped");
  });

  it("the feed leaves withdrawn matches out", async () => {
    const priya = await seedUser(PRIYA);
    const kept = await seedMatch(priya, await seedPost(POST_A));
    const postId = await seedPost(POST_A);
    await seedMatch(priya, postId);
    await withdrawPostMatches(db, postId, new Date(), null);
    for (const view of ["best", "all"] as const)
      expect(
        (await feedPage(db, priya, { view, limit: 20 })).items.map(
          (i) => i.matchId,
        ),
      ).toEqual([kept]);
  });
});

// ---- Re-match requests ----

describe("re-match requests", () => {
  const sinceOf = async (userId: string) =>
    (
      await db
        .select({ s: profiles.rematchSince })
        .from(profiles)
        .where(eq(profiles.userId, userId))
    )[0]!.s;

  it("19: requests merge to the earliest since", async () => {
    const priya = await seedUser(PRIYA);
    await requestRematch(db, priya, ago(3 * DAY));
    await requestRematch(db, priya, ago(7 * DAY));
    expect(await sinceOf(priya)).toEqual(ago(7 * DAY));
    await requestRematch(db, priya, ago(DAY));
    expect(await sinceOf(priya)).toEqual(ago(7 * DAY));
  });

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

  it("20: concurrent claims lease a request once; completing clears it", async () => {
    const priya = await seedUser(PRIYA);
    await requestRematch(db, priya, ago(3 * DAY));
    const c = await connections(2);
    let first: Awaited<ReturnType<typeof claimRematch>>;
    try {
      await c.clients[0]!.query("begin");
      first = await claimRematch(c.dbs[0]!);
      const second = await claimRematch(c.dbs[1]!); // the row is locked: skipped
      await c.clients[0]!.query("commit");
      expect(first).toMatchObject({ userId: priya, since: ago(3 * DAY) });
      expect(first!.claimedAt).toBeInstanceOf(Date);
      expect(second).toBeNull();
    } finally {
      await c.end();
    }
    // The claim is a lease: the request stays until it's completed.
    expect(await requestOf(priya)).toMatchObject({
      since: ago(3 * DAY),
      claimedAt: first!.claimedAt,
      attempts: 1,
    });
    expect(await claimRematch(db)).toBeNull(); // leased
    expect(await completeRematch(db, first!)).toBe(true);
    expect(await requestOf(priya)).toEqual({
      since: null,
      claimedAt: null,
      attempts: 0,
      after: null,
    });

    await requestRematch(db, priya, ago(DAY));
    const r = await connections(2);
    try {
      const got = await Promise.all(r.dbs.map((d) => claimRematch(d)));
      expect(got.filter(Boolean)).toHaveLength(1);
    } finally {
      await r.end();
    }
    expect(await claimRematch(db)).toBeNull();
  });

  it("a crashed claim's lease expires and the request is claimed again", async () => {
    const priya = await seedUser(PRIYA);
    await requestRematch(db, priya, ago(3 * DAY));
    const first = (await claimRematch(db))!;
    // The matcher died: nothing completes or fails the claim.
    expect(await claimRematch(db)).toBeNull();
    await db.execute(sql`
      update profiles set rematch_claimed_at = rematch_claimed_at - interval '6 minutes'
      where user_id = ${priya}`);
    const again = (await claimRematch(db))!;
    expect(again).toMatchObject({ userId: priya, since: ago(3 * DAY) });
    expect((await requestOf(priya)).attempts).toBe(2);
    // The dead claim can't clear or fail the request any more.
    expect(await completeRematch(db, first)).toBe(false);
    expect(await failRematch(db, first)).toBe("lost");
    expect(await completeRematch(db, again)).toBe(true);
  });

  it("a request made while a re-match runs survives its completion", async () => {
    const priya = await seedUser(PRIYA);
    await requestRematch(db, priya, ago(3 * DAY));
    const claim = (await claimRematch(db))!;
    // A narrower request (the since stays) during processing: the profile changed again.
    await requestRematch(db, priya, ago(DAY));
    expect(await completeRematch(db, claim)).toBe(false);
    expect(await requestOf(priya)).toMatchObject({
      since: ago(3 * DAY),
      claimedAt: null,
    });
    const next = (await claimRematch(db))!;
    expect(next.userId).toBe(priya);
    // A wider one survives too.
    await requestRematch(db, priya, ago(5 * DAY));
    expect(await completeRematch(db, next)).toBe(false);
    expect((await requestOf(priya)).since).toEqual(ago(5 * DAY));
  });

  it("a failing request backs off and doesn't block the others", async () => {
    const bad = await seedUser(PRIYA);
    const good = await seedUser(PRIYA);
    await requestRematch(db, bad, ago(7 * DAY)); // the oldest: claimed first
    await requestRematch(db, good, ago(3 * DAY));
    const c1 = (await claimRematch(db))!;
    expect(c1.userId).toBe(bad);
    expect(await failRematch(db, c1)).toBe("retry");
    const r1 = await requestOf(bad);
    expect(r1).toMatchObject({
      since: ago(7 * DAY),
      claimedAt: null,
      attempts: 1,
    });
    const wait1 = r1.after!.getTime() - Date.now();
    expect(wait1).toBeGreaterThan(25_000);
    expect(wait1).toBeLessThan(35_000);
    // Backing off: the other request is next, and then nothing is due.
    expect((await claimRematch(db))!.userId).toBe(good);
    expect(await claimRematch(db)).toBeNull();
    // Due again: the second failure waits twice as long.
    await db.execute(
      sql`update profiles set rematch_after = now() - interval '1 second' where user_id = ${bad}`,
    );
    expect(await failRematch(db, (await claimRematch(db))!)).toBe("retry");
    const wait2 = (await requestOf(bad)).after!.getTime() - Date.now();
    expect(wait2).toBeGreaterThan(55_000);
    expect(wait2).toBeLessThan(65_000);
  });

  it(`drops a request after ${MAX_REMATCH_ATTEMPTS} failed attempts`, async () => {
    const priya = await seedUser(PRIYA);
    await requestRematch(db, priya, ago(3 * DAY));
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_REMATCH_ATTEMPTS; i++) {
      await db.execute(
        sql`update profiles set rematch_after = null where user_id = ${priya}`,
      );
      outcomes.push(await failRematch(db, (await claimRematch(db))!));
    }
    expect(outcomes).toEqual([
      ...Array(MAX_REMATCH_ATTEMPTS - 1).fill("retry"),
      "dropped",
    ]);
    expect(await requestOf(priya)).toEqual({
      since: null,
      claimedAt: null,
      attempts: 0,
      after: null,
    });
    expect(await claimRematch(db)).toBeNull();
  });

  it("a shutdown gives the attempt back with no backoff", async () => {
    const priya = await seedUser(PRIYA);
    await requestRematch(db, priya, ago(3 * DAY));
    const claim = (await claimRematch(db))!;
    expect(await failRematch(db, claim, { countAttempt: false })).toBe("retry");
    expect(await requestOf(priya)).toMatchObject({
      claimedAt: null,
      attempts: 0,
      after: null,
    });
    expect((await claimRematch(db))!.userId).toBe(priya);
  });

  it("drops requests whose last claim crashed, and a new request starts afresh", async () => {
    const priya = await seedUser(PRIYA);
    const live = await seedUser(PRIYA);
    for (const u of [priya, live]) await requestRematch(db, u, ago(3 * DAY));
    await db.execute(sql`
      update profiles set rematch_attempts = ${MAX_REMATCH_ATTEMPTS},
        rematch_claimed_at = now() - interval '6 minutes'
      where user_id = ${priya}`);
    // Leased right now by a live claim: not abandoned.
    await db.execute(sql`
      update profiles set rematch_attempts = ${MAX_REMATCH_ATTEMPTS}, rematch_claimed_at = now()
      where user_id = ${live}`);
    expect(await dropAbandonedRematches(db)).toEqual([priya]);
    expect((await requestOf(priya)).since).toBeNull();
    expect((await requestOf(live)).since).not.toBeNull();
    // A new request resets the lease, backoff and attempts.
    await requestRematch(db, live, ago(DAY));
    expect(await requestOf(live)).toMatchObject({
      since: ago(3 * DAY),
      claimedAt: null,
      attempts: 0,
      after: null,
    });
  });
});

// ---- The AI queue ----

describe("AI re-score queue", () => {
  async function pendingPairs(scores: number[]) {
    const priya = await seedUser(PRIYA);
    const ids: string[] = [];
    for (const ruleScore of scores)
      ids.push(
        await seedMatch(priya, await seedPost(POST_A), {
          ruleScore,
          aiStatus: "pending",
        }),
      );
    return { priya, ids };
  }

  it("22: claims the highest rule score first, then the newest", async () => {
    const { ids } = await pendingPairs([55, 90, 70, 90]);
    const designer = await seedUser(DESIGNER);
    await seedMatch(
      designer,
      await seedPost({ skillIds: [], categories: ["design"] }),
      {
        broad: true,
        ruleScore: 99,
        aiStatus: "not_needed",
      },
    );
    const claimed = await claimPairsForRescore(db, 10);
    // ids[3] and ids[1] tie at 90: the newer (created later) first.
    expect(claimed.map((c) => c.matchId)).toEqual([
      ids[3],
      ids[1],
      ids[2],
      ids[0],
    ]);
    expect(claimed[0]!.claim).toEqual({ attempts: 1, profileVersion: 1 });
    expect((await matchRow(ids[0]!)).aiStatus).toBe("running");
    expect(await claimPairsForRescore(db, 10)).toEqual([]);
  });

  it("only claims pairs that are due", async () => {
    const { ids } = await pendingPairs([80]);
    await db.execute(
      sql`update matches set ai_run_after = now() + interval '1 minute' where id = ${ids[0]}`,
    );
    expect(await claimPairsForRescore(db, 10)).toEqual([]);
  });

  /** Pending pairs for one user, all claimed: [matchId, claim] in claim order. */
  async function claimedPairs(scores: number[]) {
    const { priya, ids } = await pendingPairs(scores);
    const claimed = await claimPairsForRescore(db, scores.length);
    return { priya, ids, claimed };
  }
  const usedOn = async (userId: string, day: string) =>
    (
      await db
        .select({ used: rescoreUsage.used })
        .from(rescoreUsage)
        .where(
          sql`${rescoreUsage.userId} = ${userId} and ${rescoreUsage.day} = ${day}`,
        )
    )[0]?.used ?? null;
  const dueNow = (id: string) =>
    db.execute(sql`update matches set ai_run_after = now() where id = ${id}`);

  it("23: 25 concurrent takes against a cap of 20 grant exactly 20", async () => {
    const { priya, claimed } = await claimedPairs(
      Array.from({ length: 25 }, (_, i) => 60 + i),
    );
    const day = isoDay(now);
    const c = await connections(25);
    try {
      const got = await Promise.all(
        c.dbs.map((d, i) =>
          takeRescoreUnit(d, claimed[i]!.matchId, claimed[i]!.claim, 20, day),
        ),
      );
      expect(got.filter((g) => g === "taken")).toHaveLength(20);
      expect(got.filter((g) => g === "capped")).toHaveLength(5);
    } finally {
      await c.end();
    }
    expect(await usedOn(priya, day)).toBe(20);
    const rows = await db.select().from(matches);
    expect(rows.filter((r) => r.aiUnitDay === day)).toHaveLength(20);
  });

  it("24: a pair pays once a day; counting starts again on a new day", async () => {
    const { priya, claimed } = await claimedPairs([80, 70]);
    const [a, b] = claimed;
    expect(
      await takeRescoreUnit(db, a!.matchId, a!.claim, 1, "2026-10-17"),
    ).toBe("taken");
    // The same pair again (a retry today) holds its unit: nothing more is taken.
    expect(
      await takeRescoreUnit(db, a!.matchId, a!.claim, 1, "2026-10-17"),
    ).toBe("held");
    expect(
      await takeRescoreUnit(db, b!.matchId, b!.claim, 1, "2026-10-17"),
    ).toBe("capped");
    expect(await usedOn(priya, "2026-10-17")).toBe(1);
    // Tomorrow the pair pays again, and the row now points at tomorrow.
    expect(
      await takeRescoreUnit(db, a!.matchId, a!.claim, 1, "2026-10-18"),
    ).toBe("taken");
    expect((await matchRow(a!.matchId)).aiUnitDay).toBe("2026-10-18");
    expect(await usedOn(priya, "2026-10-18")).toBe(1);
    // A cap of 0 never takes.
    expect(
      await takeRescoreUnit(db, b!.matchId, b!.claim, 0, "2026-10-19"),
    ).toBe("capped");
  });

  it("a take by a claim that no longer owns the row is lost and takes nothing", async () => {
    const { priya, claimed } = await claimedPairs([80]);
    const [c] = claimed;
    const stale = { ...c!.claim, attempts: c!.claim.attempts + 1 };
    expect(await takeRescoreUnit(db, c!.matchId, stale, 5, isoDay(now))).toBe(
      "lost",
    );
    expect(await usedOn(priya, isoDay(now))).toBeNull();
    expect((await matchRow(c!.matchId)).aiUnitDay).toBeNull();
  });

  it("25: a give-back refunds the unit to its own day, once, and clears it", async () => {
    const { priya, claimed } = await claimedPairs([80]);
    const [c] = claimed;
    const day = "2026-10-17";
    await db.insert(rescoreUsage).values({ userId: priya, day, used: 4 });
    expect(await takeRescoreUnit(db, c!.matchId, c!.claim, 15, day)).toBe(
      "taken",
    );
    expect(await usedOn(priya, day)).toBe(5);
    const fail = {
      code: "LLM_RATE_LIMITED",
      retryable: true,
      countAttempt: false,
    };
    expect(await failRescore(db, c!.matchId, c!.claim, fail)).toBe("requeued");
    expect(await usedOn(priya, day)).toBe(4);
    expect((await matchRow(c!.matchId)).aiUnitDay).toBeNull();
    // The same (now stale) claim again: fenced, nothing refunded twice.
    expect(await failRescore(db, c!.matchId, c!.claim, fail)).toBe("lost");
    expect(await usedOn(priya, day)).toBe(4);
  });

  it("a refund never goes below 0, and a pair with no unit refunds nothing", async () => {
    const { priya, claimed } = await claimedPairs([80, 70]);
    const [a, b] = claimed;
    const day = isoDay(now);
    expect(await takeRescoreUnit(db, a!.matchId, a!.claim, 15, day)).toBe(
      "taken",
    );
    await db.update(rescoreUsage).set({ used: 0 });
    const fail = { code: "SHUTDOWN", retryable: true, countAttempt: false };
    expect(await failRescore(db, a!.matchId, a!.claim, fail)).toBe("requeued");
    expect(await usedOn(priya, day)).toBe(0);
    await db.update(rescoreUsage).set({ used: 3 });
    expect(await failRescore(db, b!.matchId, b!.claim, fail)).toBe("requeued");
    expect(await usedOn(priya, day)).toBe(3);
  });

  it("26: completing sets the AI score as the score and the finish time; the unit stays spent", async () => {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const id = await seedMatch(priya, postId, { aiStatus: "pending" });
    const [project] = await db
      .select({ id: profileProjects.id })
      .from(profileProjects)
      .where(eq(profileProjects.title, "Bakery ordering site"));
    const [c] = await claimPairsForRescore(db, 1);
    expect(await takeRescoreUnit(db, id, c!.claim, 15, isoDay(now))).toBe(
      "taken",
    );
    const result = {
      aiScore: 92,
      aiReason: "You built a Next.js ordering site with payments.",
      concerns: ["tight deadline"],
      bestProjectId: project!.id,
      bestRoleId: null,
      model: "gemini-test",
    };
    expect(await completeRescore(db, id, c!.claim, result)).toBe(true);
    expect(await completeRescore(db, id, c!.claim, result)).toBe(false);
    const row = await matchRow(id);
    expect(row).toMatchObject({
      aiStatus: "done",
      aiScore: 92,
      score: 92,
      ruleScore: 80,
      aiConcerns: ["tight deadline"],
      bestProjectId: project!.id,
      aiModel: "gemini-test",
      aiLockedAt: null,
      aiUnitDay: isoDay(now),
    });
    expect(row.aiScoredAt).toBeInstanceOf(Date);
    expect(row.aiFinishedAt).toBeInstanceOf(Date);
    expect(await usedOn(priya, isoDay(now))).toBe(1);
  });

  it("completing saves null for a best project or role deleted since the context was loaded", async () => {
    const priya = await seedUser({
      ...PRIYA,
      roles: [
        {
          title: "Frontend developer",
          organisation: "Acme Realty",
          organisationDescription: "a real-estate agency",
          skills: ["react"],
        },
      ],
    });
    const other = await seedUser({
      ...PRIYA,
      projects: [{ title: "Someone else's", skills: ["nextjs"] }],
    });
    await db.insert(profileProjects).values({
      userId: priya,
      position: 5,
      title: "Second site",
      summary: "Built a second site",
      role: "solo",
      kind: "client",
      skillIds: ["nextjs"],
      source: "manual",
    });
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        await seedMatch(priya, await seedPost(POST_A), {
          aiStatus: "pending",
          ruleScore: 90 - i,
        }),
      );
    const claimed = await claimPairsForRescore(db, 3);
    const ctx = (await loadRescoreContext(db, claimed[0]!.matchId))!;
    const projectId = ctx.projects[0]!.id;
    const roleId = ctx.roles[0]!.id;
    const [foreign] = await db
      .select({ id: profileProjects.id })
      .from(profileProjects)
      .where(eq(profileProjects.userId, other));
    // The user deletes the project and the role between load and complete.
    await db.delete(profileProjects).where(eq(profileProjects.id, projectId));
    await db.delete(profileExperience).where(eq(profileExperience.id, roleId));
    const result = (
      bestProjectId: string | null,
      bestRoleId: string | null,
    ) => ({
      aiScore: 88,
      aiReason: "You built a Next.js ordering site.",
      concerns: [],
      bestProjectId,
      bestRoleId,
      model: "gemini-test",
    });
    const [a, b, c] = claimed;
    expect(
      await completeRescore(
        db,
        a!.matchId,
        a!.claim,
        result(projectId, roleId),
      ),
    ).toBe(true);
    expect(await matchRow(a!.matchId)).toMatchObject({
      aiStatus: "done",
      score: 88,
      bestProjectId: null,
      bestRoleId: null,
    });
    // Another user's project is never saved as this user's best project.
    expect(
      await completeRescore(
        db,
        b!.matchId,
        b!.claim,
        result(foreign!.id, null),
      ),
    ).toBe(true);
    expect((await matchRow(b!.matchId)).bestProjectId).toBeNull();
    // Still there: saved as given.
    const kept = (await loadRescoreContext(db, c!.matchId))!.projects[0]!.id;
    expect(
      await completeRescore(db, c!.matchId, c!.claim, result(kept, null)),
    ).toBe(true);
    expect((await matchRow(c!.matchId)).bestProjectId).toBe(kept);
  });

  it("a claim from before a profile change can't write", async () => {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost(POST_A);
    const id = await seedMatch(priya, postId, { aiStatus: "pending" });
    const [old] = await claimPairsForRescore(db, 1);
    await upsertMatches(
      db,
      [newMatch(priya, postId, { aiStatus: "pending", profileVersion: 2 })],
      { origin: "post" },
    );
    const [fresh] = await claimPairsForRescore(db, 1);
    expect(fresh!.claim).toEqual({ attempts: 1, profileVersion: 2 });
    const result = {
      aiScore: 10,
      aiReason: "stale",
      concerns: [],
      bestProjectId: null,
      bestRoleId: null,
      model: "m",
    };
    expect(await completeRescore(db, id, old!.claim, result)).toBe(false);
    expect(await markCapped(db, id, old!.claim)).toBe(false);
    expect(await completeRescore(db, id, fresh!.claim, result)).toBe(true);
  });

  it("27: retryable failures back off, keep the unit, then fail with the rule score", async () => {
    const { priya, ids } = await pendingPairs([75]);
    const id = ids[0]!;
    const day = isoDay(now);
    for (let n = 1; n <= 3; n++) {
      await dueNow(id);
      const [c] = await claimPairsForRescore(db, 1);
      expect(c!.claim.attempts).toBe(n);
      // Only the first attempt pays; the retries hold the same unit.
      expect(await takeRescoreUnit(db, id, c!.claim, 15, day)).toBe(
        n === 1 ? "taken" : "held",
      );
      const out = await failRescore(db, id, c!.claim, {
        code: "INVALID_OUTPUT",
        retryable: true,
      });
      const row = await matchRow(id);
      expect(row.aiUnitDay).toBe(day);
      if (n < 3) {
        expect(out).toBe("requeued");
        expect(row.aiStatus).toBe("pending");
        expect(row.aiRunAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
        expect(row.aiFinishedAt).toBeNull();
      } else {
        expect(out).toBe("failed");
        expect(row).toMatchObject({
          aiStatus: "failed",
          aiError: "INVALID_OUTPUT",
          score: 75,
        });
        expect(row.aiFinishedAt).toBeInstanceOf(Date);
      }
    }
    expect(await usedOn(priya, day)).toBe(1);
  });

  it("gives the attempt back for provider errors, due after 5 s, and fails non-retryable ones", async () => {
    const { ids } = await pendingPairs([75, 70]);
    const [c] = await claimPairsForRescore(db, 1);
    const before = await db.execute<{ t: string }>(sql`select now() as t`);
    expect(
      await failRescore(db, ids[0]!, c!.claim, {
        code: "RATE_LIMITED",
        retryable: true,
        countAttempt: false,
      }),
    ).toBe("requeued");
    const row = await matchRow(ids[0]!);
    expect(row.aiAttempts).toBe(0);
    // Due after the give-back delay (GIVE_BACK_DELAY_MS = 5 s) from the statement's now().
    const t0 = new Date(before.rows[0]!.t).getTime();
    const delay = row.aiRunAfter.getTime() - t0;
    expect(delay).toBeGreaterThanOrEqual(4_000);
    expect(delay).toBeLessThanOrEqual(6_000);
    expect(GIVE_BACK_DELAY_MS).toBe(5_000);
    expect(row.aiFinishedAt).toBeNull();
    // Not due yet, so move it back (no sleeping) to make it claimable.
    await db.execute(
      sql`update matches set ai_run_after = now() where id = ${ids[0]!}`,
    );
    // Claimable again once due, and first again (highest rule score).
    const claimed = await claimPairsForRescore(db, 2);
    expect(claimed.map((x) => x.matchId)).toEqual([ids[0], ids[1]]);
    const other = claimed.find((x) => x.matchId === ids[1])!;
    expect(
      await failRescore(db, ids[1]!, other.claim, {
        code: "BAD_REQUEST",
        retryable: false,
      }),
    ).toBe("failed");
  });

  it("countRepeats: the same give-back code twice in a row counts, so it ends in failed", async () => {
    const { priya, ids } = await pendingPairs([75]);
    const id = ids[0]!;
    const day = isoDay(now);
    const fail = {
      code: "INTERNAL",
      retryable: true,
      countAttempt: false,
      countRepeats: true,
    };
    const outcomes: string[] = [];
    for (let n = 0; n < 6 && (await matchRow(id)).aiStatus === "pending"; n++) {
      await dueNow(id);
      const [c] = await claimPairsForRescore(db, 1);
      await takeRescoreUnit(db, id, c!.claim, 15, day);
      outcomes.push(await failRescore(db, id, c!.claim, fail));
    }
    // The first gives back (attempt and unit); the next three count; the third count fails.
    expect(outcomes).toEqual(["requeued", "requeued", "requeued", "failed"]);
    expect(await matchRow(id)).toMatchObject({
      aiStatus: "failed",
      aiAttempts: 3,
      aiError: "INTERNAL",
      score: 75,
      aiUnitDay: day,
    });
    // The first unit was refunded, the second is kept: one spent in all.
    expect(await usedOn(priya, day)).toBe(1);
  });

  it("countRepeats: a different code in between gives the attempt back again", async () => {
    const { ids } = await pendingPairs([75]);
    const id = ids[0]!;
    const run = async (code: string, countRepeats = true) => {
      await dueNow(id);
      const [c] = await claimPairsForRescore(db, 1);
      await failRescore(db, id, c!.claim, {
        code,
        retryable: true,
        countAttempt: false,
        countRepeats,
      });
      return (await matchRow(id)).aiAttempts;
    };
    expect(await run("INTERNAL")).toBe(0);
    expect(await run("LLM_RATE_LIMITED", false)).toBe(0);
    expect(await run("INTERNAL")).toBe(0);
    expect(await run("INTERNAL")).toBe(1);
  });

  it("marks a pair capped, with an optional code and the finish time", async () => {
    const { ids } = await pendingPairs([75]);
    const [c] = await claimPairsForRescore(db, 1);
    expect(await markCapped(db, ids[0]!, c!.claim, "NOT_ALLOWED")).toBe(true);
    const row = await matchRow(ids[0]!);
    expect(row).toMatchObject({
      aiStatus: "capped",
      aiError: "NOT_ALLOWED",
      score: 75,
    });
    expect(row.aiFinishedAt).toBeInstanceOf(Date);
  });

  it("28: a stale running pair is requeued with its unit refunded; one out of attempts fails", async () => {
    const { priya, ids } = await pendingPairs([75, 70, 65]);
    const day = isoDay(now);
    const claimed = await claimPairsForRescore(db, 3);
    for (const c of claimed)
      expect(await takeRescoreUnit(db, c.matchId, c.claim, 15, day)).toBe(
        "taken",
      );
    expect(await usedOn(priya, day)).toBe(3);
    expect(await requeueStaleRescores(db, 60_000)).toBe(0);
    // ids[2] is out of attempts: it fails and keeps its unit.
    await db.execute(
      sql`update matches set ai_attempts = 3 where id = ${ids[2]}`,
    );
    expect(await requeueStaleRescores(db, 0)).toBe(3);
    for (const id of ids.slice(0, 2))
      expect(await matchRow(id)).toMatchObject({
        aiStatus: "pending",
        aiUnitDay: null,
        aiFinishedAt: null,
      });
    const failed = await matchRow(ids[2]!);
    expect(failed).toMatchObject({
      aiStatus: "failed",
      aiError: "TIMEOUT",
      score: 65,
      aiUnitDay: day,
    });
    expect(failed.aiFinishedAt).toBeInstanceOf(Date);
    // Both requeued pairs' units (same user, same day) went back together.
    expect(await usedOn(priya, day)).toBe(1);
    await db.execute(
      sql`update matches set ai_status = 'running', ai_locked_at = now() - interval '1 hour' where id = ${ids[0]}`,
    );
    expect(await requeueStaleRescores(db)).toBe(1);
    expect(await usedOn(priya, day)).toBe(1);
  });
});

describe("loadRescoreContext", () => {
  async function seedContext() {
    const userId = await seedUser({
      ...PRIYA,
      projects: [
        { title: "Bakery ordering site", skills: ["nextjs", "payments"] },
        { title: "Secret side project", skills: ["react"], hidden: true },
      ],
      roles: [
        {
          title: "Frontend developer",
          organisation: "Acme Realty",
          organisationDescription: "a real-estate agency",
          skills: ["react"],
        },
        {
          title: "Hidden role",
          organisationDescription: "a bank",
          skills: [],
          hidden: true,
        },
      ],
    });
    const postId = await seedPost({
      ...POST_A,
      title: "Need a Next.js dev",
      body: "x".repeat(5000),
    });
    const id = await seedMatch(userId, postId, { aiStatus: "pending" });
    return { userId, postId, id };
  }

  it("29: never contains the organisation's name", async () => {
    const { id, userId, postId } = await seedContext();
    const ctx = (await loadRescoreContext(db, id))!;
    expect(ctx.roles).toEqual([
      {
        id: expect.any(String),
        title: "Frontend developer",
        organisationDescription: "a real-estate agency",
        summary: "Built listing pages and a booking flow",
      },
    ]);
    expect(JSON.stringify(ctx)).not.toContain("Acme Realty");
    expect(JSON.stringify(ctx)).not.toContain("Acme");
    expect(ctx).toMatchObject({
      matchId: id,
      userId,
      plan: "trial",
      profileVersion: 1,
      ruleScore: 80,
      post: {
        id: postId,
        title: "Need a Next.js dev",
        skillIds: ["nextjs", "payments"],
        budgetMax: 400,
      },
      profile: {
        categories: ["development"],
        minRateMinor: 3000,
        currency: "USD",
        rateType: "either",
        remoteOnly: true,
      },
    });
    expect(ctx.post.body).toHaveLength(3000);
    expect(ctx.trialEndsAt).toBeInstanceOf(Date);
    expect(ctx.profile.skills).toEqual([
      { name: "Next.js", level: "core" },
      { name: "Payments integration", level: "core" },
      { name: "React", level: "core" },
      { name: "PostgreSQL", level: "secondary" },
    ]);
  });

  it("scrubs every organisation's name out of titles, summaries and descriptions", async () => {
    const userId = await seedUser({ ...PRIYA, projects: [] });
    const roles = [
      {
        title: "Senior dev at Acme Realty",
        organisation: "Acme Realty",
        organisationDescription: "a real-estate agency",
        summary: "Rebuilt ACME  realty's listings; Acme Realty, mostly.",
        hidden: false,
      },
      {
        title: "Designer",
        organisation: "Bright Studio Ltd",
        organisationDescription: "",
        summary: "Ran the Bright Studio blog",
        hidden: false,
      },
      {
        title: "Analyst",
        organisation: "Northwind Bank",
        organisationDescription: "Northwind Bank's lending arm",
        summary: "Reporting",
        hidden: false,
      },
      {
        title: "Old job",
        organisation: "Globex Corporation",
        organisationDescription: "an energy company",
        summary: "Hidden",
        hidden: true,
      },
    ];
    for (const [position, r] of roles.entries())
      await db.insert(profileExperience).values({
        userId,
        position,
        title: r.title,
        summary: r.summary,
        organisation: r.organisation,
        organisationDescription: r.organisationDescription,
        employmentType: "full_time",
        skillIds: [],
        source: "manual",
        hidden: r.hidden,
      });
    await db.insert(profileProjects).values({
      userId,
      position: 0,
      title: "Globex Corporation billing portal",
      summary: "Built for acme realty and Northwind Bank",
      role: "solo",
      kind: "client",
      skillIds: ["nextjs"],
      source: "manual",
    });
    const id = await seedMatch(userId, await seedPost(POST_A), {
      aiStatus: "pending",
    });
    const ctx = (await loadRescoreContext(db, id))!;
    expect(ctx.roles).toEqual([
      {
        id: expect.any(String),
        title: "Senior dev at a real-estate agency",
        organisationDescription: "a real-estate agency",
        summary:
          "Rebuilt a real-estate agency's listings; a real-estate agency, mostly.",
      },
      {
        id: expect.any(String),
        title: "Designer",
        organisationDescription: "",
        summary: "Ran the the company blog",
      },
      {
        id: expect.any(String),
        title: "Analyst",
        organisationDescription: "the company's lending arm",
        summary: "Reporting",
      },
    ]);
    // A hidden role's employer is scrubbed from visible work too.
    expect(ctx.projects).toEqual([
      {
        id: expect.any(String),
        title: "an energy company billing portal",
        summary: "Built for a real-estate agency and the company",
      },
    ]);
    const all = JSON.stringify(ctx).toLowerCase();
    for (const name of ["acme", "bright studio", "northwind", "globex"])
      expect(all).not.toContain(name);
  });

  it("30: leaves hidden projects and roles out", async () => {
    const { id } = await seedContext();
    const ctx = (await loadRescoreContext(db, id))!;
    expect(ctx.projects.map((p) => p.title)).toEqual(["Bakery ordering site"]);
    expect(ctx.roles.map((r) => r.title)).toEqual(["Frontend developer"]);
    expect(
      await loadRescoreContext(db, "00000000-0000-7000-8000-000000000000"),
    ).toBeNull();
  });
});

// ---- Feed ----

describe("feedPage", () => {
  it("31: best keeps score >= 60, all keeps everything, newest post first", async () => {
    const priya = await seedUser(PRIYA);
    const m85 = await seedMatch(
      priya,
      await seedPost({ ...POST_A, postedAt: ago(3 * DAY) }),
      { ruleScore: 85 },
    );
    const m62 = await seedMatch(
      priya,
      await seedPost({ ...POST_A, postedAt: ago(2 * DAY) }),
      { ruleScore: 62 },
    );
    const m40 = await seedMatch(
      priya,
      await seedPost({ ...POST_A, postedAt: ago(DAY) }),
      { ruleScore: 40 },
    );
    const best = await feedPage(db, priya, { view: "best", limit: 20 });
    expect(best.items.map((i) => i.matchId)).toEqual([m62, m85]);
    expect(best.next).toBeNull();
    const all = await feedPage(db, priya, { view: "all", limit: 20 });
    expect(all.items.map((i) => i.matchId)).toEqual([m40, m62, m85]);
    // Another user's feed is separate.
    expect(
      (await feedPage(db, await seedUser(DESIGNER), { view: "all", limit: 20 }))
        .items,
    ).toEqual([]);
  });

  it("apply instructions: the feed item carries them, and null for old rows", async () => {
    const priya = await seedUser(PRIYA);
    const withIns = await seedMatch(
      priya,
      await seedPost({
        ...POST_A,
        postedAt: ago(DAY),
        applyInstructions: "DM only, include your rate",
      }),
    );
    const without = await seedMatch(
      priya,
      await seedPost({ ...POST_A, postedAt: ago(2 * DAY) }),
    );
    const { items } = await feedPage(db, priya, { view: "all", limit: 20 });
    const by = (id: string) => items.find((i) => i.matchId === id)!;
    expect(by(withIns).post.applyInstructions).toBe(
      "DM only, include your rate",
    );
    expect(by(without).post.applyInstructions).toBeNull();
  });

  it("32: keyset pages have no overlap or gap, even when a newer match arrives", async () => {
    const priya = await seedUser(PRIYA);
    const ids: string[] = [];
    // Two posts share a posted_at, so the match id breaks the tie.
    const times = [
      ago(DAY),
      ago(2 * DAY),
      ago(2 * DAY),
      ago(3 * DAY),
      ago(4 * DAY),
    ];
    for (const postedAt of times)
      ids.push(await seedMatch(priya, await seedPost({ ...POST_A, postedAt })));
    const all = (
      await feedPage(db, priya, { view: "all", limit: 20 })
    ).items.map((i) => i.matchId);
    expect(all).toHaveLength(5);

    const page1 = await feedPage(db, priya, { view: "all", limit: 2 });
    await seedMatch(priya, await seedPost({ ...POST_A, postedAt: now }));
    const page2 = await feedPage(db, priya, {
      view: "all",
      limit: 2,
      cursor: page1.next!,
    });
    const page3 = await feedPage(db, priya, {
      view: "all",
      limit: 2,
      cursor: page2.next!,
    });
    expect(page3.next).toBeNull();
    expect(
      [...page1.items, ...page2.items, ...page3.items].map((i) => i.matchId),
    ).toEqual(all);
  });

  it("33: leaves dismissed matches out", async () => {
    const priya = await seedUser(PRIYA);
    const kept = await seedMatch(priya, await seedPost(POST_A));
    const gone = await seedMatch(priya, await seedPost(POST_A));
    await setMatchStatus(db, priya, gone, "dismissed");
    for (const view of ["best", "all"] as const)
      expect(
        (await feedPage(db, priya, { view, limit: 20 })).items.map(
          (i) => i.matchId,
        ),
      ).toEqual([kept]);
  });

  it("34: lists the communities the gig was also posted in", async () => {
    const priya = await seedUser(PRIYA);
    const original = await seedPost({ ...POST_A, community: "forhire" });
    for (const community of ["slavelabour", "hiring", "forhire", "hiring"])
      await seedPost({
        community,
        duplicateOf: original,
        matchStatus: "skipped",
        analysed: false,
      });
    await seedMatch(priya, original);
    const [item] = (await feedPage(db, priya, { view: "all", limit: 20 }))
      .items;
    expect(item!.post.alsoPostedIn).toEqual(["hiring", "slavelabour"]);
  });

  it("35: filters by job type and pay", async () => {
    const dev = await seedUser({
      ...PRIYA,
      categories: ["development", "design"],
      includeUnpaid: true,
    });
    const devPaid = await seedMatch(
      dev,
      await seedPost({ ...POST_A, postedAt: ago(DAY) }),
    );
    const design = await seedMatch(
      dev,
      await seedPost({
        ...POST_A,
        categories: ["design"],
        postedAt: ago(2 * DAY),
      }),
    );
    const unknownPay = await seedMatch(
      dev,
      await seedPost({ ...POST_A, payType: "unknown", postedAt: ago(3 * DAY) }),
    );
    const page = (o: Parameters<typeof feedPage>[2]) =>
      feedPage(db, dev, o).then((p) => p.items.map((i) => i.matchId));
    expect(
      await page({ view: "all", limit: 20, categories: ["design"] }),
    ).toEqual([design]);
    expect(await page({ view: "all", limit: 20, pay: "paid" })).toEqual([
      devPaid,
      design,
    ]);
    expect(await page({ view: "all", limit: 20, pay: "any" })).toEqual([
      devPaid,
      design,
      unknownPay,
    ]);
    expect(
      await page({
        view: "all",
        limit: 20,
        pay: "paid",
        categories: ["development"],
      }),
    ).toEqual([devPaid]);
  });

  it("returns every field the API needs, with the AI reason once done", async () => {
    const priya = await seedUser(PRIYA);
    const postId = await seedPost({
      ...POST_A,
      community: "forhire",
      title: "Bakery site",
      summary: "Next.js bakery site",
      deadline: "2026-12-01",
      redFlags: ["upfront_fee"],
    });
    const id = await seedMatch(priya, postId, { aiStatus: "pending" });
    const [project] = await db
      .select()
      .from(profileProjects)
      .where(eq(profileProjects.title, "Bakery ordering site"));
    const [c] = await claimPairsForRescore(db, 1);
    await completeRescore(db, id, c!.claim, {
      aiScore: 88,
      aiReason: "You built a bakery site.",
      concerns: [],
      bestProjectId: project!.id,
      bestRoleId: null,
      model: "m",
    });
    const noAi = await seedMatch(
      priya,
      await seedPost({ ...POST_A, postedAt: ago(5 * DAY) }),
    );
    const { items } = await feedPage(db, priya, { view: "all", limit: 20 });
    expect(items[0]).toEqual({
      matchId: id,
      score: 88,
      reason: "You built a bakery site.",
      broad: false,
      status: "new",
      aiStatus: "done",
      bestProject: { id: project!.id, title: "Bakery ordering site" },
      bestRole: null,
      post: {
        id: postId,
        title: "Bakery site",
        community: "forhire",
        url: expect.stringContaining("reddit.com"),
        postedAt: expect.any(Date),
        summary: "Next.js bakery site",
        categories: ["development"],
        budget: { min: 400, max: 400, currency: "USD", unit: "fixed" },
        payType: "paid",
        remote: "remote",
        deadline: "2026-12-01",
        redFlags: ["upfront_fee"],
        applyInstructions: null,
        alsoPostedIn: [],
      },
    });
    expect(items[1]).toMatchObject({
      matchId: noAi,
      reason: "2 of your core skills (Next.js, Payments integration)",
      aiStatus: "not_needed",
      bestProject: null,
    });
  });
});

// ---- Status ----

describe("setMatchStatus", () => {
  const events = () => db.select().from(matchEvents);

  it("36: updates the user's own match and logs one event", async () => {
    const priya = await seedUser(PRIYA);
    const id = await seedMatch(priya, await seedPost(POST_A));
    expect(await setMatchStatus(db, priya, id, "saved")).toEqual({
      status: "saved",
    });
    expect((await matchRow(id)).status).toBe("saved");
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ matchId: id, userId: priya, event: "saved" });
  });

  it("37: the same status twice logs no second event", async () => {
    const priya = await seedUser(PRIYA);
    const id = await seedMatch(priya, await seedPost(POST_A));
    await setMatchStatus(db, priya, id, "seen");
    expect(await setMatchStatus(db, priya, id, "seen")).toEqual({
      status: "seen",
    });
    expect(await events()).toHaveLength(1);
  });

  it("38: another user's match gives null and writes nothing", async () => {
    const priya = await seedUser(PRIYA);
    const other = await seedUser(DESIGNER);
    const id = await seedMatch(priya, await seedPost(POST_A));
    const before = await matchRow(id);
    expect(await setMatchStatus(db, other, id, "dismissed")).toBeNull();
    expect(await matchRow(id)).toEqual(before);
    expect(await events()).toHaveLength(0);
  });

  it("dismissing a pair still waiting for AI cancels the re-score", async () => {
    const priya = await seedUser(PRIYA);
    const id = await seedMatch(priya, await seedPost(POST_A), {
      aiStatus: "pending",
    });
    await setMatchStatus(db, priya, id, "dismissed");
    expect((await matchRow(id)).aiStatus).toBe("not_needed");
    expect(await claimPairsForRescore(db, 5)).toEqual([]);
  });

  it("un-dismissing leaves the cancelled re-score cancelled", async () => {
    const priya = await seedUser(PRIYA);
    const id = await seedMatch(priya, await seedPost(POST_A), {
      aiStatus: "pending",
    });
    await setMatchStatus(db, priya, id, "dismissed");
    await setMatchStatus(db, priya, id, "saved");
    expect(await matchRow(id)).toMatchObject({
      status: "saved",
      aiStatus: "not_needed",
      score: 80,
    });
    expect(await claimPairsForRescore(db, 5)).toEqual([]);
  });

  it("dismissing while the re-score runs doesn't cancel it", async () => {
    const priya = await seedUser(PRIYA);
    const id = await seedMatch(priya, await seedPost(POST_A), {
      aiStatus: "pending",
    });
    const [pair] = await claimPairsForRescore(db, 1);
    await setMatchStatus(db, priya, id, "dismissed");
    expect(await matchRow(id)).toMatchObject({
      status: "dismissed",
      aiStatus: "running",
    });
    expect(
      await completeRescore(db, id, pair!.claim, {
        aiScore: 70,
        aiReason: "Fits",
        concerns: [],
        bestProjectId: null,
        bestRoleId: null,
        model: "m",
      }),
    ).toBe(true);
    expect(await matchRow(id)).toMatchObject({
      status: "dismissed",
      aiStatus: "done",
      score: 70,
    });
  });
});
