import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { VALID } from "../../../test/onboarding-fixtures";
import { closeAll, resetState } from "../../../test/helpers";
import { signInDevUser } from "../session";
import { getOnboardingState, saveStep } from "./service";

beforeEach(resetState);
afterAll(closeAll);

const complete = (userId: string, step: keyof typeof VALID, expectedVersion = 0) =>
  saveStep(userId, step, { mode: "complete", data: VALID[step], expectedVersion });

async function user() {
  return (await signInDevUser(`u${Math.random()}@example.com`)).userId;
}

describe("getOnboardingState", () => {
  it("starts empty at the import step", async () => {
    const state = await getOnboardingState(await user());
    expect(state).toMatchObject({ steps: [], resumeAt: "import", onboardedAt: null });
  });
});

describe("saveStep", () => {
  it("completes steps in order and moves resumeAt", async () => {
    const id = await user();
    expect(await complete(id, "import")).toEqual({ status: "completed", version: 1, next: "basics" });
    expect(await complete(id, "basics")).toMatchObject({ next: "skills" });
    expect((await getOnboardingState(id)).resumeAt).toBe("skills");
  });

  it("saves a draft, keeps resumeAt on it, and bumps the version", async () => {
    const id = await user();
    await complete(id, "import");
    const first = await saveStep(id, "basics", { mode: "draft", data: { displayName: "A" }, expectedVersion: 0 });
    expect(first).toEqual({ status: "draft", version: 1, next: "basics" });
    const second = await saveStep(id, "basics", { mode: "draft", data: { displayName: "As" }, expectedVersion: 1 });
    expect(second.version).toBe(2);
    const state = await getOnboardingState(id);
    expect(state.resumeAt).toBe("basics");
    expect(state.steps[1]!.data).toMatchObject({ displayName: "As", categories: [] });
  });

  it("refuses a step after resumeAt (STEP_ORDER), for drafts too", async () => {
    const id = await user();
    await expect(complete(id, "basics")).rejects.toMatchObject({ code: "STEP_ORDER" });
    await expect(
      saveStep(id, "rates", { mode: "draft", data: {}, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "STEP_ORDER" });
  });

  it("version conflict: a stale expectedVersion never overwrites", async () => {
    const id = await user();
    await complete(id, "import");
    await saveStep(id, "basics", { mode: "draft", data: { displayName: "Tab A" }, expectedVersion: 0 });
    await expect(
      saveStep(id, "basics", { mode: "draft", data: { displayName: "Tab B" }, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const results = await Promise.allSettled([
      saveStep(id, "basics", { mode: "draft", data: { displayName: "C" }, expectedVersion: 1 }),
      saveStep(id, "basics", { mode: "draft", data: { displayName: "D" }, expectedVersion: 1 }),
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
    expect(err.details).toEqual([expect.objectContaining({ path: "data.displayName" })]);
  });
});
