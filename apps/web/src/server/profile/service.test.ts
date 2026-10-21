import { STEP_IDS } from "@redlance/core";
import {
  profileChanges,
  profileExperience,
  profileProjects,
  profileSkills,
  profiles,
} from "@redlance/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, resetState } from "../../../test/helpers";
import { VALID } from "../../../test/onboarding-fixtures";
import { getDb } from "../db";
import { finishOnboarding, saveStep } from "../onboarding/service";
import { signInDevUser } from "../session";
import {
  getProfileForEdit,
  planEntries,
  saveProfileSection,
  type ProfileEditState,
} from "./service";

beforeEach(resetState);
afterAll(closeAll);

async function user() {
  return (await signInDevUser(`u${Math.random()}@example.com`)).userId;
}

/** A user through Finish, with Finish's backfill request cleared so edits can be checked. */
async function onboarded() {
  const id = await user();
  for (const step of STEP_IDS)
    await saveStep(id, step, {
      mode: "complete",
      data: VALID[step],
      expectedVersion: 0,
    });
  await finishOnboarding(id);
  await getDb()
    .update(profiles)
    .set({ rematchSince: null })
    .where(eq(profiles.userId, id));
  return id;
}

async function state(id: string): Promise<ProfileEditState> {
  return (await getProfileForEdit(id))!;
}

const profileRow = async (id: string) =>
  (await getDb().select().from(profiles).where(eq(profiles.userId, id)))[0]!;
const changeRows = (id: string) =>
  getDb()
    .select()
    .from(profileChanges)
    .where(eq(profileChanges.userId, id))
    .orderBy(asc(profileChanges.createdAt));

/** Saves basics with a new headline: always a real change. */
let n = 0;
async function change(id: string, version?: number) {
  const s = await state(id);
  return saveProfileSection(id, "basics", {
    data: { ...s.sections.basics, headline: `Headline ${++n}` },
    expectedVersion: version ?? s.version,
  });
}

describe("getProfileForEdit", () => {
  it("is null before onboarding", async () => {
    expect(await getProfileForEdit(await user())).toBeNull();
  });

  it("reads every section back as onboarding saved it", async () => {
    const id = await onboarded();
    const s = await state(id);
    expect(s.version).toBe(1);
    expect(s.timeZone).toBe("Asia/Kolkata");
    expect(s.allowance).toEqual({
      limit: 5,
      used: 0,
      remaining: 5,
      nextFreeAt: null,
    });
    expect(s.sections.basics).toEqual(VALID.basics);
    expect(s.sections.rates).toEqual(VALID.rates);
    expect(s.sections.github).toEqual(VALID.import);
    expect(s.sections.skills.skills).toEqual(
      expect.arrayContaining([
        { id: "video-editing", level: "core", source: "manual" },
        { id: "premiere-pro", level: "secondary", source: "manual" },
      ]),
    );
    expect(s.sections.work.projects.map((p) => p.title)).toEqual([
      "Wedding film",
      "Channel trailer",
    ]);
    expect(s.sections.work.experience[0]).toMatchObject({
      title: "Video editor",
      organisation: "Acme Media",
      start: { year: 2021, month: 3 },
      end: null,
      current: true,
    });
  });
});

describe("saveProfileSection", () => {
  it("writes a change, bumps profile_version and records it", async () => {
    const id = await onboarded();
    const s = await state(id);
    const res = await saveProfileSection(id, "basics", {
      data: {
        ...s.sections.basics,
        displayName: "Asha K",
        categories: ["video", "design"],
      },
      expectedVersion: 1,
    });
    expect(res).toMatchObject({
      changed: true,
      version: 2,
      allowance: { used: 1, remaining: 4 },
    });
    const row = await profileRow(id);
    expect(row).toMatchObject({
      displayName: "Asha K",
      categories: ["video", "design"],
      profileVersion: 2,
    });
    expect(await changeRows(id)).toEqual([
      expect.objectContaining({ section: "basics", profileVersion: 2 }),
    ]);
  });

  it("doesn't count a save that changes nothing, in any section", async () => {
    const id = await onboarded();
    const s = await state(id);
    for (const section of [
      "basics",
      "skills",
      "work",
      "rates",
      "github",
    ] as const) {
      const res = await saveProfileSection(id, section, {
        data: s.sections[section],
        expectedVersion: 1,
      });
      expect(res, section).toMatchObject({ changed: false, version: 1 });
    }
    // The raw onboarding data (other order, defaults left out, links as typed) is the same too.
    for (const [section, step] of [
      ["skills", "skills"],
      ["work", "work"],
      ["github", "import"],
    ] as const) {
      const data =
        section === "skills"
          ? { ...VALID.skills, skills: [...VALID.skills.skills].reverse() }
          : VALID[step];
      const res = await saveProfileSection(id, section, {
        data,
        expectedVersion: 1,
      });
      expect(res.changed, section).toBe(false);
    }
    expect(await changeRows(id)).toEqual([]);
    expect((await profileRow(id)).profileVersion).toBe(1);
  });

  it("refuses the 6th change in 7 days, but still accepts a no-op", async () => {
    const id = await onboarded();
    for (let i = 0; i < 5; i++) await change(id);
    const s = await state(id);
    expect(s.allowance).toMatchObject({ used: 5, remaining: 0 });

    const err = await change(id).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "PROFILE_EDIT_LIMIT",
      status: 429,
      details: { limit: 5, nextFreeAt: s.allowance.nextFreeAt },
    });
    expect(
      Number(
        (err as { headers: Record<string, string> }).headers["Retry-After"],
      ),
    ).toBeGreaterThan(6 * 86_400);
    expect((await profileRow(id)).profileVersion).toBe(6);
    expect(await changeRows(id)).toHaveLength(5);

    const noop = await saveProfileSection(id, "rates", {
      data: s.sections.rates,
      expectedVersion: 6,
    });
    expect(noop.changed).toBe(false);
  });

  it("frees a change once the oldest is 7 days old (rolling window)", async () => {
    const id = await onboarded();
    for (let i = 0; i < 5; i++) await change(id);
    const rows = await changeRows(id);
    const db = getDb();
    // Spread the five over the past week; the oldest is just inside the window.
    for (const [i, row] of rows.entries())
      await db
        .update(profileChanges)
        .set({
          createdAt: sql`now() - make_interval(days => ${6 - i}, hours => 23)`,
        })
        .where(eq(profileChanges.id, row.id));
    await expect(change(id)).rejects.toMatchObject({
      code: "PROFILE_EDIT_LIMIT",
    });

    // Push the oldest past 7 days: exactly one change is free again.
    await db
      .update(profileChanges)
      .set({ createdAt: sql`now() - interval '7 days 1 minute'` })
      .where(eq(profileChanges.id, rows[0]!.id));
    expect((await state(id)).allowance).toMatchObject({
      used: 4,
      remaining: 1,
    });
    expect((await change(id)).allowance.remaining).toBe(0);
    await expect(change(id)).rejects.toMatchObject({
      code: "PROFILE_EDIT_LIMIT",
    });
  });

  it("never requests a re-match", async () => {
    const id = await onboarded();
    const s = await state(id);
    await change(id);
    await saveProfileSection(id, "skills", {
      data: {
        skills: [{ id: "after-effects", level: "core" }],
      },
      expectedVersion: 2,
    });
    await saveProfileSection(id, "rates", {
      data: { ...s.sections.rates, minRate: 40 },
      expectedVersion: 3,
    });
    const row = await profileRow(id);
    expect(row.profileVersion).toBe(4);
    expect(row.rematchSince).toBeNull();
    expect(row.rematchAttempts).toBe(0);
  });

  it("refuses a stale version without writing or counting", async () => {
    const id = await onboarded();
    await change(id);
    await expect(change(id, 1)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      details: { version: 2 },
    });
    expect(await changeRows(id)).toHaveLength(1);
  });

  it("refuses invalid data with field errors, without counting", async () => {
    const id = await onboarded();
    const s = await state(id);
    await expect(
      saveProfileSection(id, "basics", {
        data: { ...s.sections.basics, categories: [] },
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: [expect.objectContaining({ path: "data.categories" })],
    });
    await expect(
      saveProfileSection(id, "skills", {
        data: { skills: [{ id: "video-editing", level: "secondary" }] },
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      saveProfileSection(id, "github", {
        data: { githubUsername: "settings" },
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await changeRows(id)).toEqual([]);
  });

  it("only touches the signed-in user's profile", async () => {
    const a = await onboarded();
    const b = await onboarded();
    await change(a);
    expect((await profileRow(b)).profileVersion).toBe(1);
    expect((await state(b)).allowance.used).toBe(0);
    expect((await state(b)).sections.basics.headline).toBe("Video editor");
    await expect(
      saveProfileSection(await user(), "basics", {
        data: VALID.basics,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("replaces skills, rates and GitHub", async () => {
    const id = await onboarded();
    await saveProfileSection(id, "skills", {
      data: {
        skills: [{ id: "after-effects", level: "core" }],
      },
      expectedVersion: 1,
    });
    await saveProfileSection(id, "rates", {
      data: {
        minRate: 12.5,
        currency: "GBP",
        rateType: "fixed",
        remoteOnly: false,
      },
      expectedVersion: 2,
    });
    await saveProfileSection(id, "github", {
      data: { githubUsername: null },
      expectedVersion: 3,
    });
    const db = getDb();
    expect(
      await db
        .select({ id: profileSkills.skillId })
        .from(profileSkills)
        .where(eq(profileSkills.userId, id)),
    ).toEqual([{ id: "after-effects" }]);
    expect(await profileRow(id)).toMatchObject({
      minRateMinor: 1250,
      currency: "GBP",
      rateType: "fixed",
      remoteOnly: false,
      githubUsername: null,
      profileVersion: 4,
    });
    expect((await changeRows(id)).map((r) => r.section)).toEqual([
      "skills",
      "rates",
      "github",
    ]);
  });

  it("keeps the rows of unchanged projects and roles (their ids survive)", async () => {
    const id = await onboarded();
    const db = getDb();
    const before = await db
      .select()
      .from(profileProjects)
      .where(eq(profileProjects.userId, id))
      .orderBy(asc(profileProjects.position));
    const [role] = await db
      .select()
      .from(profileExperience)
      .where(eq(profileExperience.userId, id));
    const s = await state(id);
    const [wedding, trailer] = s.sections.work.projects;

    // Swap the order, edit the trailer, add one, and turn employer names off.
    const res = await saveProfileSection(id, "work", {
      data: {
        ...s.sections.work,
        projects: [
          { ...trailer!, summary: "A 45-second trailer." },
          wedding!,
          { title: "Ad spot", summary: "A 15-second ad.", kind: "client" },
        ],
        mentionEmployers: false,
      },
      expectedVersion: 1,
    });
    expect(res.changed).toBe(true);
    const after = await db
      .select()
      .from(profileProjects)
      .where(eq(profileProjects.userId, id))
      .orderBy(asc(profileProjects.position));
    expect(after.map((p) => [p.title, p.position])).toEqual([
      ["Channel trailer", 0],
      ["Wedding film", 1],
      ["Ad spot", 2],
    ]);
    expect(after[1]!.id).toBe(before[0]!.id); // unchanged: same row, moved
    expect(after[0]!.id).not.toBe(before[1]!.id); // edited: a new row
    const [roleAfter] = await db
      .select()
      .from(profileExperience)
      .where(eq(profileExperience.userId, id));
    expect(roleAfter!.id).toBe(role!.id);
    expect((await profileRow(id)).mentionEmployers).toBe(false);
  });
});

describe("planEntries", () => {
  const rows = [
    { id: "a", position: 0, k: "x" },
    { id: "b", position: 1, k: "y" },
    { id: "c", position: 2, k: "x" },
  ];
  const key = (r: (typeof rows)[number]) => JSON.stringify({ k: r.k });

  it("reuses each row once, moves, inserts and removes", () => {
    expect(
      planEntries(rows, key, [{ k: "x" }, { k: "z" }, { k: "x" }, { k: "x" }]),
    ).toEqual({
      keep: [
        { id: "a", position: 0, moved: false },
        { id: "c", position: 2, moved: false },
      ],
      insert: [{ index: 1 }, { index: 3 }],
      remove: ["b"],
    });
  });

  it("ignores namesRemoved when matching", () => {
    expect(
      planEntries(rows.slice(1), key, [{ k: "y", namesRemoved: true }]).keep,
    ).toEqual([{ id: "b", position: 0, moved: true }]);
  });
});
