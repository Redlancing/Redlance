import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { loadDraftContext } from "./drafts";
import {
  jobPostAnalyses,
  jobPosts,
  matches,
  profileExperience,
  profileProjects,
  profiles,
  profileSkills,
  users,
} from "./schema";
import { runMigrations } from "./migrate";
import { syncReferenceData } from "./reference";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 3 });

const reset = async () => {
  await db.execute(sql`truncate table users cascade`);
  await db.execute(sql`truncate table job_posts cascade`);
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
async function seedUser(): Promise<string> {
  seq++;
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|dc${seq}-${Math.random()}`,
      email: `dc${seq}@example.com`,
      emailNormalized: `dc${seq}-${Math.random()}@example.com`,
    })
    .returning({ id: users.id });
  const userId = u!.id;
  await db.insert(profiles).values({
    userId,
    displayName: "Priya",
    categories: ["development"],
    experienceLevel: "experienced",
    country: "GB",
    timeZone: "Europe/London",
    githubUsername: "priya",
    minRateMinor: 3000,
    currency: "USD",
    rateType: "either",
    remoteOnly: false,
    mentionEmployers: true,
    onboardedAt: new Date(),
    trialEndsAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(profileSkills).values([
    { userId, skillId: "nextjs", level: "core", source: "manual" },
    { userId, skillId: "postgresql", level: "secondary", source: "manual" },
  ]);
  for (const [position, hidden] of [false, true].entries()) {
    await db.insert(profileProjects).values({
      userId,
      position,
      title: hidden ? "Hidden project" : "Bakery site",
      summary: "s",
      role: "solo",
      kind: "client",
      skillIds: ["nextjs"],
      outcomes: ["Orders up 30%"],
      links: ["https://bakery.example.com"],
      year: 2025,
      source: "manual",
      hidden,
    });
    await db.insert(profileExperience).values({
      userId,
      position,
      title: hidden ? "Hidden role" : "Developer",
      summary: "s",
      organisation: "Acme Realty",
      organisationDescription: "a real estate agency",
      employmentType: "full_time",
      skillIds: ["nextjs"],
      highlights: ["Led a team"],
      startYear: 2021,
      endYear: 2023,
      source: "manual",
      hidden,
    });
  }
  return userId;
}

async function seedMatch(userId: string, over: { withdrawn?: boolean } = {}) {
  seq++;
  const [p] = await db
    .insert(jobPosts)
    .values({
      source: "reddit",
      externalId: `t3_dc${seq}-${Math.random()}`,
      fetchedVia: "rss",
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/dc${seq}/x/`,
      title: "[Hiring] Next.js dev",
      body: "Need a checkout page.",
      postedAt: new Date(),
      preKind: "hiring",
    })
    .returning();
  await db.insert(jobPosts).values({
    source: "reddit",
    externalId: `t3_dd${seq}-${Math.random()}`,
    fetchedVia: "rss",
    community: "slavelabour",
    url: `https://www.reddit.com/r/slavelabour/comments/dd${seq}/x/`,
    title: "[Hiring] Next.js dev",
    body: "Need a checkout page.",
    postedAt: new Date(),
    preKind: "hiring",
    duplicateOf: p!.id,
  });
  await db.insert(jobPostAnalyses).values({
    jobPostId: p!.id,
    pipelineVersion: "t",
    kind: "hiring",
    employmentType: "freelance",
    payType: "paid",
    categories: ["development"],
    skillIds: ["nextjs"],
    budgetMin: 300,
    budgetMax: 400,
    currency: "USD",
    budgetUnit: "fixed",
    remote: "remote",
    redFlags: [],
    summary: "Checkout page",
    model: "test",
    applyInstructions: "DM your portfolio",
  });
  const [m] = await db
    .insert(matches)
    .values({
      userId,
      jobPostId: p!.id,
      postedAt: new Date(),
      ruleScore: 60,
      broad: false,
      features: [{ signal: "core_skill", points: 20, detail: ["nextjs"] }],
      ruleReason: "Next.js",
      aiStatus: "not_needed",
      score: 60,
      profileVersion: 1,
      analysedAt: new Date(),
      withdrawnAt: over.withdrawn ? new Date() : null,
    })
    .returning();
  return m!.id;
}

describe("loadDraftContext", () => {
  it("20: returns the match, post, analysis, profile, projects and roles", async () => {
    const userId = await seedUser();
    const matchId = await seedMatch(userId);
    const c = await loadDraftContext(db, { userId, matchId });
    expect(c).not.toBeNull();
    expect(c!.match.id).toBe(matchId);
    expect(c!.match.features[0]!.detail).toEqual(["nextjs"]);
    expect(c!.post.title).toBe("[Hiring] Next.js dev");
    expect(c!.post.alsoPostedIn).toEqual(["slavelabour"]);
    expect(c!.analysis.applyInstructions).toBe("DM your portfolio");
    expect(c!.analysis.budgetMax).toBe(400);
    expect(c!.analysis.deadline).toBeNull();
    expect(c!.profile.githubUsername).toBe("priya");
    expect(c!.profile.mentionEmployers).toBe(true);
    expect(c!.profile.skills).toEqual(
      expect.arrayContaining([
        { id: "nextjs", level: "core" },
        { id: "postgresql", level: "secondary" },
      ]),
    );
    expect(c!.projects[0]!.links).toEqual(["https://bakery.example.com"]);
    expect(c!.roles[0]!.organisation).toBe("Acme Realty");
  });
  it("21: another user's match gives null", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const matchId = await seedMatch(owner);
    expect(await loadDraftContext(db, { userId: other, matchId })).toBeNull();
  });
  it("22: a withdrawn match gives null", async () => {
    const userId = await seedUser();
    const matchId = await seedMatch(userId, { withdrawn: true });
    expect(await loadDraftContext(db, { userId, matchId })).toBeNull();
    await db
      .update(matches)
      .set({ withdrawnAt: null })
      .where(eq(matches.id, matchId));
    expect(await loadDraftContext(db, { userId, matchId })).not.toBeNull();
  });
  it("23: hidden projects and roles are not returned", async () => {
    const userId = await seedUser();
    const matchId = await seedMatch(userId);
    const c = await loadDraftContext(db, { userId, matchId });
    expect(c!.projects.map((p) => p.title)).toEqual(["Bakery site"]);
    expect(c!.roles.map((r) => r.title)).toEqual(["Developer"]);
  });
  it("M1: organisations of hidden roles are returned for scrubbing only", async () => {
    const userId = await seedUser();
    await db
      .update(profileExperience)
      .set({ organisation: "Secret Bank", organisationDescription: "a bank" })
      .where(
        and(
          eq(profileExperience.userId, userId),
          eq(profileExperience.hidden, true),
        ),
      );
    const matchId = await seedMatch(userId);
    const c = await loadDraftContext(db, { userId, matchId });
    expect(c!.roles.map((r) => r.organisation)).toEqual(["Acme Realty"]);
    expect(c!.allOrganisations).toEqual(
      expect.arrayContaining([
        {
          organisation: "Acme Realty",
          organisationDescription: "a real estate agency",
        },
        { organisation: "Secret Bank", organisationDescription: "a bank" },
      ]),
    );
    expect(c!.allOrganisations).toHaveLength(2);
  });
  it("a missing match id gives null", async () => {
    const userId = await seedUser();
    expect(
      await loadDraftContext(db, {
        userId,
        matchId: "00000000-0000-7000-8000-000000000000",
      }),
    ).toBeNull();
  });
});
