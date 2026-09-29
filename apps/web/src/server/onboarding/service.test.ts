import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { VALID } from "../../../test/onboarding-fixtures";
import { closeAll, resetState } from "../../../test/helpers";
import { signInDevUser } from "../session";
import { subredditsFor } from "@redlance/core";
import {
  alertChannels,
  customSkills,
  profileSkills,
  profiles,
  userSubreddits,
} from "@redlance/db";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
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
  for (const step of ["import", "basics", "skills", "rates"] as const)
    await complete(id, step);
}

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
    const [custom] = await db
      .select()
      .from(customSkills)
      .where(eq(customSkills.userId, id));
    expect(custom).toMatchObject({
      name: "Descript",
      nameNormalized: "descript",
    });

    const subs = await db
      .select()
      .from(userSubreddits)
      .where(eq(userSubreddits.userId, id));
    expect(subs.map((s) => s.subreddit).sort()).toEqual(
      [...subredditsFor(["video"])].sort(),
    );
    expect(subs.every((s) => s.source === "auto")).toBe(true);

    const [alert] = await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, id));
    expect(alert).toMatchObject({ kind: "email", enabled: true });

    expect((await getOnboardingState(id)).onboardedAt).toEqual(
      profile!.onboardedAt,
    );
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
