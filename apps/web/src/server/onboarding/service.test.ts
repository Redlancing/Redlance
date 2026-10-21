import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { VALID } from "../../../test/onboarding-fixtures";
import { closeAll, resetState } from "../../../test/helpers";
import { signInDevUser } from "../session";
import { BACKFILL_DAYS, STEP_IDS } from "@redlance/core";
import {
  alertChannels,
  creditBalances,
  creditLedger,
  skills as skillsTable,
  onboardingSteps,
  syncReferenceData,
  profileExperience,
  profileProjects,
  profileSkills,
  profiles,
  userSubreddits,
} from "@redlance/db";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { resetForReimport } from "./imports";
import { finishOnboarding, getOnboardingState, saveStep } from "./service";

beforeEach(resetState);
afterAll(closeAll);

const complete = (
  userId: string,
  step: keyof typeof VALID,
  expectedVersion = 0,
) =>
  saveStep(userId, step, {
    mode: "complete",
    data: VALID[step],
    expectedVersion,
  });

async function user() {
  return (await signInDevUser(`u${Math.random()}@example.com`)).userId;
}

describe("getOnboardingState", () => {
  it("starts empty at the import step", async () => {
    const state = await getOnboardingState(await user());
    expect(state).toMatchObject({
      steps: [],
      resumeAt: "import",
      onboardedAt: null,
    });
  });
});

describe("saveStep", () => {
  it("completes steps in order and moves resumeAt", async () => {
    const id = await user();
    expect(await complete(id, "import")).toEqual({
      status: "completed",
      version: 1,
      next: "basics",
    });
    expect(await complete(id, "basics")).toMatchObject({ next: "skills" });
    expect((await getOnboardingState(id)).resumeAt).toBe("skills");
  });

  it("saves a draft, keeps resumeAt on it, and bumps the version", async () => {
    const id = await user();
    await complete(id, "import");
    const first = await saveStep(id, "basics", {
      mode: "draft",
      data: { displayName: "A" },
      expectedVersion: 0,
    });
    expect(first).toEqual({ status: "draft", version: 1, next: "basics" });
    const second = await saveStep(id, "basics", {
      mode: "draft",
      data: { displayName: "As" },
      expectedVersion: 1,
    });
    expect(second.version).toBe(2);
    const state = await getOnboardingState(id);
    expect(state.resumeAt).toBe("basics");
    expect(state.steps[1]!.data).toMatchObject({
      displayName: "As",
      categories: [],
    });
  });

  it("refuses a step after resumeAt (STEP_ORDER), for drafts too", async () => {
    const id = await user();
    await expect(complete(id, "basics")).rejects.toMatchObject({
      code: "STEP_ORDER",
    });
    await expect(
      saveStep(id, "rates", { mode: "draft", data: {}, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "STEP_ORDER" });
  });

  it("version conflict: a stale expectedVersion never overwrites", async () => {
    const id = await user();
    await complete(id, "import");
    await saveStep(id, "basics", {
      mode: "draft",
      data: { displayName: "Tab A" },
      expectedVersion: 0,
    });
    await expect(
      saveStep(id, "basics", {
        mode: "draft",
        data: { displayName: "Tab B" },
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const results = await Promise.allSettled([
      saveStep(id, "basics", {
        mode: "draft",
        data: { displayName: "C" },
        expectedVersion: 1,
      }),
      saveStep(id, "basics", {
        mode: "draft",
        data: { displayName: "D" },
        expectedVersion: 1,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("never turns a completed step back into a draft", async () => {
    const id = await user();
    await complete(id, "import");
    await complete(id, "basics");
    await expect(
      saveStep(id, "basics", { mode: "draft", data: {}, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns field errors prefixed with data.", async () => {
    const id = await user();
    await complete(id, "import");
    const err = await saveStep(id, "basics", {
      mode: "complete",
      data: { ...VALID.basics, displayName: "" },
      expectedVersion: 0,
    }).catch((e) => e);
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.details).toEqual([
      expect.objectContaining({ path: "data.displayName" }),
    ]);
  });
});

async function completeAll(id: string) {
  for (const step of STEP_IDS) await complete(id, step);
}

describe("saveStep: work", () => {
  async function throughSkills() {
    const id = await user();
    for (const step of ["import", "basics", "skills"] as const)
      await complete(id, step);
    return id;
  }

  it("saves work as draft and complete", async () => {
    const id = await throughSkills();
    expect(
      await saveStep(id, "work", {
        mode: "draft",
        data: { projects: [{ title: "" }] },
        expectedVersion: 0,
      }),
    ).toEqual({ status: "draft", version: 1, next: "work" });
    expect(await complete(id, "work", 1)).toEqual({
      status: "completed",
      version: 2,
      next: "rates",
    });
    expect((await getOnboardingState(id)).resumeAt).toBe("rates");
  });

  it("refuses work before skills is completed", async () => {
    const id = await user();
    await complete(id, "import");
    await complete(id, "basics");
    await expect(complete(id, "work")).rejects.toMatchObject({
      code: "STEP_ORDER",
    });
  });

  it("refuses rates before work is completed", async () => {
    const id = await throughSkills();
    await expect(complete(id, "rates")).rejects.toMatchObject({
      code: "STEP_ORDER",
      details: { resumeAt: "work" },
    });
  });
});

describe("finishOnboarding", () => {
  it("refuses while a step is missing or a draft", async () => {
    const id = await user();
    await complete(id, "import");
    await expect(finishOnboarding(id)).rejects.toMatchObject({
      code: "STEP_ORDER",
      details: { resumeAt: "basics" },
    });
  });

  it("writes the profile and every child table, and starts a 5-day trial", async () => {
    const id = await user();
    await completeAll(id);
    expect(await finishOnboarding(id)).toEqual({ redirect: "/dashboard" });

    const db = getDb();
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, id));
    expect(profile).toMatchObject({
      displayName: "Asha",
      categories: ["video"],
      githubUsername: "asha-edits",
      minRateMinor: 2500,
      currency: "USD",
      remoteOnly: true,
    });
    expect(
      profile!.trialEndsAt.getTime() - profile!.onboardedAt.getTime(),
    ).toBe(5 * 86_400_000);

    const skillRows = await db
      .select()
      .from(profileSkills)
      .where(eq(profileSkills.userId, id));
    expect(skillRows.map((s) => [s.skillId, s.level, s.source]).sort()).toEqual(
      [
        ["premiere-pro", "secondary", "manual"],
        ["video-editing", "core", "manual"],
      ],
    );
    // Users aren't connected to subreddits: the feed uses the whole catalogue.
    expect(await db.$count(userSubreddits, eq(userSubreddits.userId, id))).toBe(
      0,
    );

    const [alert] = await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, id));
    expect(alert).toMatchObject({ kind: "email", enabled: true });

    expect((await getOnboardingState(id)).onboardedAt).toEqual(
      profile!.onboardedAt,
    );
  });

  it("asks the matcher to backfill the last 3 days of posts", async () => {
    const id = await user();
    await completeAll(id);
    await finishOnboarding(id);
    const [profile] = await getDb()
      .select()
      .from(profiles)
      .where(eq(profiles.userId, id));
    expect(profile).toMatchObject({ plan: "trial", profileVersion: 1 });
    const expected =
      profile!.onboardedAt.getTime() - BACKFILL_DAYS * 86_400_000;
    expect(Math.abs(profile!.rematchSince!.getTime() - expected)).toBeLessThan(
      5_000,
    );
  });

  it("writes projects and experience in order, with source and hidden", async () => {
    const id = await user();
    await completeAll(id);
    await finishOnboarding(id);
    const db = getDb();
    const projects = await db
      .select()
      .from(profileProjects)
      .where(eq(profileProjects.userId, id))
      .orderBy(asc(profileProjects.position));
    expect(projects).toEqual([
      expect.objectContaining({
        position: 0,
        title: "Wedding film",
        summary: "Edited a 10-minute wedding film.",
        role: "solo",
        kind: "client",
        skillIds: ["video-editing"],
        categories: [],
        domains: [],
        outcomes: ["Delivered in 3 days"],
        links: ["https://vimeo.com/123"],
        year: 2024,
        source: "resume",
        hidden: false,
      }),
      expect.objectContaining({
        position: 1,
        title: "Channel trailer",
        role: "unknown",
        kind: "personal",
        year: null,
        source: "manual",
        hidden: true,
      }),
    ]);
    const roles = await db
      .select()
      .from(profileExperience)
      .where(eq(profileExperience.userId, id));
    expect(roles).toEqual([
      expect.objectContaining({
        position: 0,
        title: "Video editor",
        organisation: "Acme Media",
        organisationDescription: "a YouTube production studio",
        employmentType: "full_time",
        startYear: 2021,
        startMonth: 3,
        endYear: null,
        endMonth: null,
        isCurrent: true,
        summary: "",
        highlights: ["Cut 40 videos a month"],
        source: "resume",
        hidden: false,
      }),
    ]);
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, id));
    expect(profile!.mentionEmployers).toBe(true);
  });

  it("with empty work lists writes no rows and succeeds", async () => {
    const id = await user();
    for (const step of STEP_IDS)
      await saveStep(id, step, {
        mode: "complete",
        data: step === "work" ? {} : VALID[step],
        expectedVersion: 0,
      });
    expect(await finishOnboarding(id)).toEqual({ redirect: "/dashboard" });
    const db = getDb();
    expect(
      await db.$count(profileProjects, eq(profileProjects.userId, id)),
    ).toBe(0);
    expect(
      await db.$count(profileExperience, eq(profileExperience.userId, id)),
    ).toBe(0);
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, id));
    expect(profile!.mentionEmployers).toBe(false);
  });

  it("finishes from a skills row saved with the old customSkills key, writing only taxonomy skills", async () => {
    const id = await user();
    await completeAll(id);
    const db = getDb();
    await db
      .update(onboardingSteps)
      .set({
        data: {
          ...VALID.skills,
          customSkills: [
            { name: "Descript", level: "secondary", source: "manual" },
          ],
        },
      })
      .where(
        and(eq(onboardingSteps.userId, id), eq(onboardingSteps.step, "skills")),
      );
    expect(await finishOnboarding(id)).toEqual({ redirect: "/dashboard" });
    expect(await db.$count(profileSkills, eq(profileSkills.userId, id))).toBe(
      2,
    );
  });

  it("sends the user back when work is a draft", async () => {
    const id = await user();
    for (const step of ["import", "basics", "skills"] as const)
      await complete(id, step);
    await saveStep(id, "work", {
      mode: "draft",
      data: {},
      expectedVersion: 0,
    });
    await expect(finishOnboarding(id)).rejects.toMatchObject({
      code: "STEP_ORDER",
      details: { resumeAt: "work" },
    });
  });

  it("is idempotent under concurrency and never restarts the trial", async () => {
    const id = await user();
    await completeAll(id);
    await Promise.all([
      finishOnboarding(id),
      finishOnboarding(id),
      finishOnboarding(id),
    ]);
    const [first] = await getDb()
      .select()
      .from(profiles)
      .where(eq(profiles.userId, id));
    await finishOnboarding(id);
    const rows = await getDb()
      .select()
      .from(profiles)
      .where(eq(profiles.userId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trialEndsAt).toEqual(first!.trialEndsAt);
  });

  it("blocks step saves after finishing", async () => {
    const id = await user();
    await completeAll(id);
    await finishOnboarding(id);
    await expect(complete(id, "rates", 1)).rejects.toMatchObject({
      code: "ALREADY_ONBOARDED",
    });
  });

  it.each([1, 2, 3, 4, 5])(
    "a save racing Finish is refused or lands in the profile (run %i)",
    async () => {
      const id = await user();
      await completeAll(id);
      const results = await Promise.allSettled([
        finishOnboarding(id),
        saveStep(id, "rates", {
          mode: "complete",
          data: { ...VALID.rates, minRate: 99 },
          expectedVersion: 1,
        }),
      ]);
      expect(results[0]!.status).toBe("fulfilled");
      const save = results[1]!;
      const [profile] = await getDb()
        .select()
        .from(profiles)
        .where(eq(profiles.userId, id));
      if (save.status === "rejected")
        expect(save.reason).toMatchObject({ code: "ALREADY_ONBOARDED" });
      else expect(profile!.minRateMinor).toBe(9900);
    },
  );
});

describe("resetForReimport", () => {
  async function filled() {
    const id = await user();
    for (const step of ["import", "basics", "skills", "work"] as const)
      await complete(id, step);
    return id;
  }
  const saved = async (id: string) =>
    (await getOnboardingState(id)).steps.map((r) => r.step);

  it("keeps Projects & experience when only GitHub was imported", async () => {
    const id = await filled();
    await resetForReimport(id, ["github"]);
    expect(await saved(id)).toEqual(["import", "work"]);
  });

  it("clears Projects & experience when a resume was imported", async () => {
    const id = await filled();
    await resetForReimport(id, ["resume", "github"]);
    expect(await saved(id)).toEqual(["import"]);
  });

  it("keeps Projects & experience when no kind is given", async () => {
    const id = await filled();
    await resetForReimport(id, []);
    expect(await saved(id)).toEqual(["import", "work"]);
  });
});

describe("finishOnboarding trial credits", () => {
  it("28: grants 210 credits ending at trialEndsAt, with a grant ledger row", async () => {
    const id = await user();
    await completeAll(id);
    await finishOnboarding(id);
    const db = getDb();
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, id));
    const [bal] = await db
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.userId, id));
    expect(bal).toMatchObject({ plan: "trial", balance: 210 });
    expect(bal!.periodEnd).toEqual(profile!.trialEndsAt);
    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, id));
    expect(ledger.map((l) => [l.reason, l.delta])).toEqual([["grant", 210]]);
  });

  it("a repeated finish does not grant twice", async () => {
    const id = await user();
    await completeAll(id);
    await Promise.all([finishOnboarding(id), finishOnboarding(id)]);
    await finishOnboarding(id);
    const ledger = await getDb()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, id));
    expect(ledger).toHaveLength(1);
  });

  it("29: a failure after the grant rolls the grant back too", async () => {
    const id = await user();
    await completeAll(id);
    const db = getDb();
    // profile_skills has a foreign key to skills: removing one makes Finish fail after the grant.
    await db.delete(skillsTable).where(eq(skillsTable.id, "premiere-pro"));
    try {
      await expect(finishOnboarding(id)).rejects.toBeDefined();
    } finally {
      await syncReferenceData(db);
    }
    expect(
      await db.select().from(profiles).where(eq(profiles.userId, id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(creditBalances)
        .where(eq(creditBalances.userId, id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(creditLedger).where(eq(creditLedger.userId, id)),
    ).toHaveLength(0);
  });
});
