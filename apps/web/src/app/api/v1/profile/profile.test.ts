import { STEP_IDS } from "@redlance/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeAll,
  cookieFor,
  req,
  resetState,
} from "../../../../../test/helpers";
import { VALID } from "../../../../../test/onboarding-fixtures";
import { TEST_ENV } from "../../../../../test/test-env";
import { finishOnboarding, saveStep } from "@/server/onboarding/service";
import { signInDevUser } from "@/server/session";
import { PUT } from "./[section]/route";
import { GET } from "./route";

beforeEach(resetState);
afterAll(closeAll);

async function onboardedCookie(email = "pro@example.com") {
  const { userId } = await signInDevUser(email);
  for (const step of STEP_IDS)
    await saveStep(userId, step, {
      mode: "complete",
      data: VALID[step],
      expectedVersion: 0,
    });
  await finishOnboarding(userId);
  return cookieFor(email);
}

const get = (cookie?: string) =>
  GET(req("/api/v1/profile", { headers: cookie ? { cookie } : {} }));

const put = (
  cookie: string,
  section: string,
  body: unknown,
  origin: string = TEST_ENV.APP_ORIGIN,
) =>
  PUT(
    req(`/api/v1/profile/${section}`, {
      method: "PUT",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ section }) },
  );

const headline = (cookie: string, text: string, expectedVersion: number) =>
  put(cookie, "basics", {
    data: { ...VALID.basics, headline: text },
    expectedVersion,
  });

describe("profile routes", () => {
  it("401s without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it("GET 404s before onboarding", async () => {
    const res = await get(await cookieFor("new@example.com"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("GET returns the sections, version and allowance", async () => {
    const res = await get(await onboardedCookie());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      version: 1,
      timeZone: "Asia/Kolkata",
      allowance: { limit: 5, used: 0, remaining: 5, nextFreeAt: null },
      sections: { basics: VALID.basics, github: VALID.import },
    });
    expect(Object.keys(body.sections).sort()).toEqual([
      "basics",
      "github",
      "rates",
      "skills",
      "work",
    ]);
  });

  it("PUT saves a section and answers with the new version and allowance", async () => {
    const cookie = await onboardedCookie();
    const res = await headline(cookie, "Editor for creators", 1);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      changed: true,
      version: 2,
      data: { headline: "Editor for creators" },
      allowance: { used: 1, remaining: 4 },
    });
    const same = await headline(cookie, "Editor for creators", 2);
    expect(await same.json()).toMatchObject({ changed: false, version: 2 });
  });

  it("429s the 6th change with PROFILE_EDIT_LIMIT and Retry-After", async () => {
    const cookie = await onboardedCookie();
    for (let i = 1; i <= 5; i++)
      expect((await headline(cookie, `H${i}`, i)).status).toBe(200);
    const res = await headline(cookie, "H6", 6);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const { error } = await res.json();
    expect(error).toMatchObject({
      code: "PROFILE_EDIT_LIMIT",
      details: { limit: 5, nextFreeAt: expect.any(String) },
    });
  });

  it("maps validation, version and section errors", async () => {
    const cookie = await onboardedCookie();
    const bad = await put(cookie, "rates", {
      data: { ...VALID.rates, minRate: -1 },
      expectedVersion: 1,
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.details).toEqual([
      expect.objectContaining({ path: "data.minRate" }),
    ]);
    expect((await put(cookie, "rates", { data: VALID.rates })).status).toBe(
      400,
    );
    expect((await headline(cookie, "x", 7)).status).toBe(409);
    expect(
      (await put(cookie, "portfolio", { data: {}, expectedVersion: 1 })).status,
    ).toBe(404);
  });

  it("refuses a cross-site PUT", async () => {
    const cookie = await onboardedCookie();
    const res = await put(
      cookie,
      "basics",
      { data: VALID.basics, expectedVersion: 1 },
      "https://evil.example",
    );
    expect(res.status).toBe(403);
  });

  it("PUT 404s for a user without a profile", async () => {
    const res = await put(await cookieFor("new@example.com"), "basics", {
      data: VALID.basics,
      expectedVersion: 1,
    });
    expect(res.status).toBe(404);
  });
});
