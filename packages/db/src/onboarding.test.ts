import {
  CURRENCIES,
  EXPERIENCE_LEVELS,
  RATE_TYPES,
  SKILLS,
  SKILL_LEVELS,
  SOURCES,
  STEP_IDS,
  SUBREDDITS,
} from "@redlance/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ONBOARDING_STEP_IDS,
  PROFILE_CURRENCIES,
  PROFILE_EXPERIENCE_LEVELS,
  PROFILE_RATE_TYPES,
  SKILL_LEVEL_VALUES,
  SKILL_SOURCE_VALUES,
  createDb,
  customSkills,
  onboardingSteps,
  pgErrorCode,
  profileSkills,
  skills,
  subreddits,
  users,
} from "./index";
import { runMigrations } from "./migrate";
import { syncReferenceData } from "./reference";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 2 });

beforeAll(async () => {
  await runMigrations(url);
  await syncReferenceData(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await pool.end();
});

async function newUser() {
  const [u] = await db
    .insert(users)
    .values({ authSub: `dev|${Math.random()}`, email: "a@example.com", emailNormalized: `${Math.random()}@example.com` })
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
});

describe("onboarding_steps", () => {
  it("rejects unknown steps and statuses", async () => {
    const userId = await newUser();
    await expect(
      db.execute(sql`insert into onboarding_steps (user_id, step, status, data) values (${userId}, 'voice', 'draft', '{}')`),
    ).rejects.toSatisfy(code("23514"));
    await expect(
      db.execute(sql`insert into onboarding_steps (user_id, step, status, data) values (${userId}, 'basics', 'done', '{}')`),
    ).rejects.toSatisfy(code("23514"));
  });

  it("rejects data over 64 KB", async () => {
    const userId = await newUser();
    const big = { blob: "x".repeat(70_000) };
    await expect(
      db.insert(onboardingSteps).values({ userId, step: "basics", status: "draft", data: big }),
    ).rejects.toSatisfy(code("23514"));
  });

  it("is deleted with its user", async () => {
    const userId = await newUser();
    await db.insert(onboardingSteps).values({ userId, step: "import", status: "completed", data: { githubUsername: null } });
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(onboardingSteps)).toHaveLength(0);
  });
});

describe("skills reference data", () => {
  it("loads every taxonomy skill and seed subreddit", async () => {
    expect(await db.$count(skills)).toBe(SKILLS.length);
    expect(await db.$count(subreddits)).toBe(SUBREDDITS.length);
  });

  it("sync is idempotent and never deletes: it retires and deactivates instead", async () => {
    await db.insert(skills).values({ id: "zz-old", name: "Old", category: "development" }).onConflictDoNothing();
    await db.insert(subreddits).values({ name: "zz_old", categories: [] }).onConflictDoNothing();
    await syncReferenceData(db);
    await syncReferenceData(db);
    const [old] = await db.select().from(skills).where(eq(skills.id, "zz-old"));
    expect(old!.retired).toBe(true);
    const [oldSub] = await db.select().from(subreddits).where(eq(subreddits.name, "zz_old"));
    expect(oldSub!.active).toBe(false);
    expect(await db.$count(skills, eq(skills.retired, false))).toBe(SKILLS.filter((s) => !s.retired).length);
  });

  it("profile_skills only accepts known skill ids", async () => {
    const userId = await newUser();
    await expect(
      db.insert(profileSkills).values({ userId, skillId: "not-a-skill", level: "core", source: "manual" }),
    ).rejects.toSatisfy(code("23503"));
  });

  it("gives new rows UUIDv7 ids and refuses a duplicate custom skill per user", async () => {
    const userId = await newUser();
    const [row] = await db
      .insert(customSkills)
      .values({ userId, name: "Three.js", nameNormalized: "three.js", level: "secondary", source: "manual" })
      .returning();
    expect(row!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    await expect(
      db.insert(customSkills).values({ userId, name: "three.js", nameNormalized: "three.js", level: "core", source: "manual" }),
    ).rejects.toSatisfy(code("23505"));
  });
});
