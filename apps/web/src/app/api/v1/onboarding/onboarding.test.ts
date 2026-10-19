import { STEP_IDS } from "@redlance/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeAll,
  cookieFor,
  req,
  resetState,
} from "../../../../../test/helpers";
import { TEST_ENV } from "../../../../../test/test-env";
import { VALID } from "../../../../../test/onboarding-fixtures";
import { POST as finish } from "./finish/route";
import { GET as getState } from "./route";
import { PUT as putStep } from "./steps/[step]/route";

beforeEach(resetState);
afterAll(closeAll);

const put = (cookie: string, step: string, body: unknown) =>
  putStep(
    req(`/api/v1/onboarding/steps/${step}`, {
      method: "PUT",
      headers: {
        cookie,
        origin: TEST_ENV.APP_ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ step }) },
  );

describe("onboarding routes", () => {
  it("401s without a session", async () => {
    expect((await getState(req("/api/v1/onboarding"))).status).toBe(401);
  });

  it("GET returns the empty state", async () => {
    const cookie = await cookieFor();
    const res = await getState(
      req("/api/v1/onboarding", { headers: { cookie } }),
    );
    expect(await res.json()).toEqual({
      steps: [],
      resumeAt: "import",
      onboardedAt: null,
      imports: [],
    });
  });

  it("PUT saves a step and GET shows it", async () => {
    const cookie = await cookieFor();
    const res = await put(cookie, "import", {
      mode: "complete",
      data: VALID.import,
      expectedVersion: 0,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "completed",
      version: 1,
      next: "basics",
    });
    const state = await (
      await getState(req("/api/v1/onboarding", { headers: { cookie } }))
    ).json();
    expect(state.steps[0]).toMatchObject({
      id: "import",
      status: "completed",
      version: 1,
    });
    expect(state.resumeAt).toBe("basics");
  });

  it("maps service errors to status codes", async () => {
    const cookie = await cookieFor();
    expect(
      (
        await put(cookie, "rates", {
          mode: "draft",
          data: {},
          expectedVersion: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await put(cookie, "voice", {
          mode: "draft",
          data: {},
          expectedVersion: 0,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await put(cookie, "import", {
          mode: "maybe",
          data: {},
          expectedVersion: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (await put(cookie, "import", { mode: "draft", expectedVersion: 0 }))
        .status,
    ).toBe(400);
    const bad = await put(cookie, "import", {
      mode: "complete",
      data: { githubUsername: "not a name!" },
      expectedVersion: 0,
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.details[0].path).toBe(
      "data.githubUsername",
    );
  });

  it("refuses a PUT without an allowed Origin", async () => {
    const cookie = await cookieFor();
    const res = await putStep(
      req("/api/v1/onboarding/steps/import", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          mode: "complete",
          data: VALID.import,
          expectedVersion: 0,
        }),
      }),
      { params: Promise.resolve({ step: "import" }) },
    );
    expect(res.status).toBe(403);
  });

  describe("PUT /steps/work", () => {
    async function upToSkills() {
      const cookie = await cookieFor();
      for (const step of ["import", "basics", "skills"] as const)
        await put(cookie, step, {
          mode: "complete",
          data: VALID[step],
          expectedVersion: 0,
        });
      return cookie;
    }
    const project = (over: object = {}) => ({
      ...VALID.work.projects[0],
      ...over,
    });

    it("saves and returns next = rates", async () => {
      const cookie = await upToSkills();
      const res = await put(cookie, "work", {
        mode: "complete",
        data: VALID.work,
        expectedVersion: 0,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        status: "completed",
        next: "rates",
      });
    });

    it("refuses a javascript: link with a field error", async () => {
      const cookie = await upToSkills();
      const res = await put(cookie, "work", {
        mode: "complete",
        data: {
          ...VALID.work,
          projects: [project({ links: ["javascript:alert(1)"] })],
        },
        expectedVersion: 0,
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.details[0].path).toBe(
        "data.projects.0.links.0",
      );
    });

    it("refuses 9 projects", async () => {
      const cookie = await upToSkills();
      const res = await put(cookie, "work", {
        mode: "draft",
        data: {
          ...VALID.work,
          projects: Array.from({ length: 9 }, () => project()),
        },
        expectedVersion: 0,
      });
      expect(res.status).toBe(400);
    });
  });

  it("POST finish works once every step is completed", async () => {
    const cookie = await cookieFor();
    const post = () =>
      finish(
        req("/api/v1/onboarding/finish", {
          method: "POST",
          headers: { cookie, origin: TEST_ENV.APP_ORIGIN },
        }),
      );
    expect((await post()).status).toBe(409);
    for (const step of STEP_IDS)
      await put(cookie, step, {
        mode: "complete",
        data: VALID[step],
        expectedVersion: 0,
      });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: "/dashboard" });
  });
});
