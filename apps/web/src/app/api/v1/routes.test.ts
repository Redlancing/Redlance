import { users } from "@redlance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, cookieFor, req, resetState } from "../../../../test/helpers";
import { TEST_ENV } from "../../../../test/test-env";
import { getDb } from "@/server/db";
import { closeRedis, getRedis } from "@/server/redis";
import { DEV_SESSION_COOKIE } from "@/server/session";
import { GET as health } from "./health/route";
import { GET as me } from "./me/route";
import { DELETE as signOut, POST as signIn } from "./dev/session/route";

beforeEach(resetState);
afterAll(closeAll);

const signInRequest = (email: string) =>
  req("/api/v1/dev/session", {
    method: "POST",
    headers: {
      origin: TEST_ENV.APP_ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

describe("GET /api/v1/health", () => {
  it("answers liveness without touching Redis", async () => {
    const spy = vi.spyOn(getRedis(), "sendCommand");
    const res = await health(req("/api/v1/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reports Redis as ok right after a fresh connection is created (no boot race)", async () => {
    await closeRedis();
    const res = await health(req("/api/v1/health?deep=1"));
    expect(await res.json()).toEqual({ status: "ok", db: "ok", cache: "ok" });
  });

  it("checks Postgres and Redis with ?deep=1", async () => {
    const res = await health(req("/api/v1/health?deep=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok", cache: "ok" });
  });
});

describe("POST /api/v1/dev/session", () => {
  it("creates the user and sets an httpOnly session cookie", async () => {
    const res = await signIn(signInRequest("New@Example.com"));
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe("New@Example.com");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${DEV_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
  });

  it("400s an invalid email", async () => {
    expect((await signIn(signInRequest("not-an-email"))).status).toBe(400);
  });

  it("handles concurrent POSTs for one email", async () => {
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => signIn(signInRequest("dup@example.com"))),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await getDb().select().from(users)).toHaveLength(1);
  });

  it("DELETE clears the cookie", async () => {
    const res = await signOut(
      req("/api/v1/dev/session", {
        method: "DELETE",
        headers: { origin: TEST_ENV.APP_ORIGIN },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("GET /api/v1/me", () => {
  it("401s when signed out", async () => {
    expect((await me(req("/api/v1/me"))).status).toBe(401);
  });

  it("returns the signed-in user", async () => {
    const res = await me(
      req("/api/v1/me", {
        headers: { cookie: await cookieFor("me@example.com") },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe("me@example.com");
  });
});
