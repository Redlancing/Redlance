import * as core from "@redlance/core";
import {
  CURRENCIES,
  EXPERIENCE_LEVELS,
  RATE_TYPES,
  WORK_LIMITS,
  SKILLS,
  SKILL_LEVELS,
  SOURCES,
  STEP_IDS,
  SUBREDDITS,
} from "@redlance/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ENTRY_SOURCES,
  ONBOARDING_STEP_IDS,
  PROJECT_KINDS,
  PROJECT_ROLES,
  ROLE_EMPLOYMENT_TYPES,
  PROFILE_CURRENCIES,
  PROFILE_EXPERIENCE_LEVELS,
  PROFILE_RATE_TYPES,
  SKILL_LEVEL_VALUES,
  SKILL_SOURCE_VALUES,
  createDb,
  customSkills,
  onboardingSteps,
  pgErrorCode,
  profileExperience,
  profileProjects,
  profileSkills,
  profiles,
  skills,
  subreddits,
  users,
} from "./index";
import { runMigrations } from "./migrate";
import { syncReferenceData } from "./reference";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 2 });

async function removeFixtures() {
  await db.delete(skills).where(eq(skills.id, "zz-old"));
  await db.delete(subreddits).where(eq(subreddits.name, "zz_old"));
}

beforeAll(async () => {
  await runMigrations(url);
  await removeFixtures(); // leftovers from an interrupted earlier run
  await syncReferenceData(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await removeFixtures();
  await pool.end();
});

async function newUser() {
  const [u] = await db
    .insert(users)
    .values({
      authSub: `dev|${Math.random()}`,
      email: "a@example.com",
      emailNormalized: `${Math.random()}@example.com`,
    })
    .returning();
  return u!.id;
}

const code = (code: string) => (err: unknown) => pgErrorCode(err) === code;

describe("value lists match @redlance/core", () => {
  it("uses the same literals as the step schemas", () => {
    expect(ONBOARDING_STEP_IDS).toEqual(STEP_IDS);
    expect(PROFILE_EXPERIENCE_LEVELS).toEqual(EXPERIENCE_LEVELS);
    expect(PROFILE_CURRENCIES).toEqual(CURRENCIES);
    expect(PROFILE_RATE_TYPES).toEqual(RATE_TYPES);
    expect(SKILL_LEVEL_VALUES).toEqual(SKILL_LEVELS);
    expect(SKILL_SOURCE_VALUES).toEqual(SOURCES);
  });

  it("new value lists mirror core", () => {
    expect(PROJECT_ROLES).toEqual(core.PROJECT_ROLES);
    expect(PROJECT_KINDS).toEqual(core.PROJECT_KINDS);
    expect(ROLE_EMPLOYMENT_TYPES).toEqual(core.ROLE_EMPLOYMENT_TYPES);
    expect(ENTRY_SOURCES).toEqual(core.ENTRY_SOURCES);
  });
});

describe("onboarding_steps", () => {
  it("rejects unknown steps and statuses", async () => {
    const userId = await newUser();
    await expect(
      db.execute(
        sql`insert into onboarding_steps (user_id, step, status, data) values (${userId}, 'voice', 'draft', '{}')`,
      ),
    ).rejects.toSatisfy(code("23514"));
    await expect(
      db.execute(
        sql`insert into onboarding_steps (user_id, step, status, data) values (${userId}, 'basics', 'done', '{}')`,
      ),
    ).rejects.toSatisfy(code("23514"));
  });

  it("accepts the work step", async () => {
    const userId = await newUser();
    await db.insert(onboardingSteps).values({
      userId,
      step: "work",
      status: "draft",
      data: { projects: [], experience: [], mentionEmployers: false },
    });
    expect(await db.$count(onboardingSteps)).toBe(1);
  });

  it("rejects data over 64 KB", async () => {
    const userId = await newUser();
    const big = { blob: "x".repeat(70_000) };
    await expect(
      db
        .insert(onboardingSteps)
        .values({ userId, step: "basics", status: "draft", data: big }),
    ).rejects.toSatisfy(code("23514"));
  });

  it("is deleted with its user", async () => {
    const userId = await newUser();
    await db.insert(onboardingSteps).values({
      userId,
      step: "import",
      status: "completed",
      data: { githubUsername: null },
    });
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(onboardingSteps)).toHaveLength(0);
  });
});

describe("skills reference data", () => {
  it("loads every taxonomy skill and seed subreddit", async () => {
    expect(await db.$count(skills)).toBe(SKILLS.length);
    expect(await db.$count(subreddits)).toBe(SUBREDDITS.length);
  });

  it("sync is idempotent and never deletes: it retires and excludes instead", async () => {
    await db
      .insert(skills)
      .values({ id: "zz-old", name: "Old", category: "development" })
      .onConflictDoNothing();
    await db
      .insert(subreddits)
      .values({
        name: "zz_old",
        displayName: "zz_old",
        categories: [],
        tier: "core",
        status: "active",
      })
      .onConflictDoNothing();
    await syncReferenceData(db);
    await syncReferenceData(db);
    const [old] = await db.select().from(skills).where(eq(skills.id, "zz-old"));
    expect(old!.retired).toBe(true);
    const [oldSub] = await db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, "zz_old"));
    expect(oldSub!.status).toBe("excluded");
    expect(await db.$count(skills, eq(skills.retired, false))).toBe(
      SKILLS.filter((s) => !s.retired).length,
    );
  });

  it("sync keeps the worker's stats and custom subreddits", async () => {
    await db
      .update(subreddits)
      .set({ postsPerDay: 33, hiringShare: 0.14 })
      .where(eq(subreddits.name, "forhire"));
    await db
      .insert(subreddits)
      .values({
        name: "zz_custom",
        displayName: "zz_custom",
        categories: [],
        tier: "custom",
        status: "active",
      })
      .onConflictDoNothing();
    await syncReferenceData(db);
    const [forhire] = await db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, "forhire"));
    expect(forhire!.postsPerDay).toBe(33);
    const [custom] = await db
      .select()
      .from(subreddits)
      .where(eq(subreddits.name, "zz_custom"));
    expect(custom!.status).toBe("active");
    await db.delete(subreddits).where(eq(subreddits.name, "zz_custom"));
  });

  it("profile_skills only accepts known skill ids", async () => {
    const userId = await newUser();
    await expect(
      db.insert(profileSkills).values({
        userId,
        skillId: "not-a-skill",
        level: "core",
        source: "manual",
      }),
    ).rejects.toSatisfy(code("23503"));
  });

  it("gives new rows UUIDv7 ids and refuses a duplicate custom skill per user", async () => {
    const userId = await newUser();
    const [row] = await db
      .insert(customSkills)
      .values({
        userId,
        name: "Three.js",
        nameNormalized: "three.js",
        level: "secondary",
        source: "manual",
      })
      .returning();
    expect(row!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    await expect(
      db.insert(customSkills).values({
        userId,
        name: "three.js",
        nameNormalized: "three.js",
        level: "core",
        source: "manual",
      }),
    ).rejects.toSatisfy(code("23505"));
  });
});

describe("profile_projects and profile_experience limits match WORK_LIMITS", () => {
  // Every number in each limit CHECK, in order. drizzle-kit loads schema.ts without core, so
  // the SQL holds literals; this test keeps them in step with @redlance/core.
  const L = WORK_LIMITS;
  const expected: Record<string, number[]> = {
    profile_projects_position_check: [0, L.projects],
    profile_projects_title_check: [1, L.entryTitle],
    profile_projects_summary_check: [L.entrySummary],
    profile_projects_skill_ids_check: [L.entrySkills],
    profile_projects_categories_check: [L.entryCategories],
    profile_projects_domains_check: [L.domains],
    profile_projects_outcomes_check: [L.outcomes],
    profile_projects_links_check: [L.links],
    profile_experience_position_check: [0, L.roles],
    profile_experience_title_check: [1, L.entryTitle],
    profile_experience_summary_check: [L.entrySummary],
    profile_experience_skill_ids_check: [L.entrySkills],
    profile_experience_categories_check: [L.entryCategories],
    profile_experience_domains_check: [L.domains],
    profile_experience_highlights_check: [L.highlights],
    profile_experience_organisation_check: [L.organisation],
    profile_experience_organisation_description_check: [L.orgDescription],
  };
  // Checks on these tables that hold no WORK_LIMITS number (value lists, years, months).
  const notLimits = new Set([
    "profile_projects_source_check",
    "profile_projects_role_check",
    "profile_projects_kind_check",
    "profile_projects_year_check",
    "profile_experience_source_check",
    "profile_experience_employment_type_check",
    "profile_experience_free_organisation_check",
    "profile_experience_start_check",
    "profile_experience_end_check",
    "profile_experience_current_check",
  ]);

  it("uses the same numbers in every CHECK", async () => {
    const { rows } = await pool.query<{ name: string; def: string }>(
      `select conname as name, pg_get_constraintdef(oid) as def
         from pg_constraint
        where contype = 'c'
          and conrelid in ('profile_projects'::regclass, 'profile_experience'::regclass)`,
    );
    const found = Object.fromEntries(
      rows
        .filter((r) => !notLimits.has(r.name))
        .map((r) => [r.name, (r.def.match(/\d+/g) ?? []).map(Number)]),
    );
    expect(found).toEqual(expected);
  });
});

describe("profile_projects and profile_experience", () => {
  const project = (userId: string) => ({
    userId,
    position: 0,
    title: "Shop rebuild",
    summary: "Rebuilt a Shopify store.",
    role: "solo" as const,
    kind: "client" as const,
    source: "manual" as const,
  });
  const role = (userId: string) => ({
    userId,
    position: 0,
    title: "Frontend developer",
    organisation: "Acme",
    organisationDescription: "a fintech payments company",
    employmentType: "full_time" as const,
    summary: "",
    source: "resume" as const,
  });

  it("accept a valid row with defaults and a UUIDv7 id", async () => {
    const userId = await newUser();
    const [p] = await db
      .insert(profileProjects)
      .values(project(userId))
      .returning();
    expect(p).toMatchObject({
      skillIds: [],
      categories: [],
      domains: [],
      outcomes: [],
      links: [],
      year: null,
      hidden: false,
    });
    expect(p!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    const [r] = await db
      .insert(profileExperience)
      .values({
        ...role(userId),
        startYear: 2021,
        startMonth: 1,
        isCurrent: true,
      })
      .returning();
    expect(r).toMatchObject({ highlights: [], isCurrent: true, endYear: null });
  });

  it.each([
    ["a bad kind", { kind: "side" }],
    ["a bad role", { role: "boss" }],
    ["a bad source", { source: "github" }],
    ["a position of 8", { position: 8 }],
    ["a negative position", { position: -1 }],
    ["an empty title", { title: "" }],
    ["an 81-character title", { title: "x".repeat(81) }],
    ["a 161-character summary", { summary: "x".repeat(161) }],
    [
      "11 skill ids",
      { skillIds: Array.from({ length: 11 }, (_, i) => `s${i}`) },
    ],
    ["3 categories", { categories: ["a", "b", "c"] }],
    ["5 domains", { domains: ["a", "b", "c", "d", "e"] }],
    ["4 outcomes", { outcomes: ["a", "b", "c", "d"] }],
    ["4 links", { links: ["a", "b", "c", "d"] }],
    ["the year 1949", { year: 1949 }],
    ["the year 2101", { year: 2101 }],
  ])("profile_projects refuses %s", async (_name, patch) => {
    const userId = await newUser();
    await expect(
      db
        .insert(profileProjects)
        .values({ ...project(userId), ...patch } as never),
    ).rejects.toSatisfy(code("23514"));
  });

  it.each([
    ["an organisation on a freelance role", { employmentType: "freelance" }],
    ["a contract role with an organisation", { employmentType: "contract" }],
    ["a bad employment type", { employmentType: "gig" }],
    ["month 13", { startYear: 2020, startMonth: 13 }],
    ["end month 0", { endYear: 2020, endMonth: 0 }],
    ["a month without a year", { startMonth: 3 }],
    ["a start year of 1949", { startYear: 1949 }],
    ["a current role with an end", { isCurrent: true, endYear: 2022 }],
    ["a position of 6", { position: 6 }],
    ["an 81-character organisation", { organisation: "x".repeat(81) }],
    ["a 61-character description", { organisationDescription: "x".repeat(61) }],
    ["an empty title", { title: "" }],
    ["a 161-character summary", { summary: "x".repeat(161) }],
    ["5 highlights", { highlights: ["a", "b", "c", "d", "e"] }],
    [
      "11 skill ids",
      { skillIds: Array.from({ length: 11 }, (_, i) => `s${i}`) },
    ],
    ["3 categories", { categories: ["a", "b", "c"] }],
    ["5 domains", { domains: ["a", "b", "c", "d", "e"] }],
    ["a bad source", { source: "github" }],
  ])("profile_experience refuses %s", async (_name, patch) => {
    const userId = await newUser();
    await expect(
      db
        .insert(profileExperience)
        .values({ ...role(userId), ...patch } as never),
    ).rejects.toSatisfy(code("23514"));
  });

  it("profile_experience accepts a freelance role without an organisation", async () => {
    const userId = await newUser();
    await db.insert(profileExperience).values({
      ...role(userId),
      employmentType: "freelance",
      organisation: null,
    });
    expect(await db.$count(profileExperience)).toBe(1);
  });

  it("deleting a user deletes their projects and experience", async () => {
    const userId = await newUser();
    await db.insert(profileProjects).values(project(userId));
    await db.insert(profileExperience).values(role(userId));
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.$count(profileProjects)).toBe(0);
    expect(await db.$count(profileExperience)).toBe(0);
  });

  it("profiles.mention_employers defaults to false", async () => {
    const userId = await newUser();
    const [p] = await db
      .insert(profiles)
      .values({
        userId,
        displayName: "Asha",
        categories: ["video"],
        experienceLevel: "intermediate",
        country: "IN",
        timeZone: "Asia/Kolkata",
        minRateMinor: 0,
        currency: "USD",
        rateType: "hourly",
        remoteOnly: false,
        onboardedAt: new Date(),
        trialEndsAt: new Date(),
      })
      .returning();
    expect(p!.mentionEmployers).toBe(false);
  });
});
