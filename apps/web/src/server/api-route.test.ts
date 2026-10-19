import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeAll, cookieFor, req, resetState } from "../../test/helpers";
import { TEST_ENV } from "../../test/test-env";
import { apiRoute } from "./api-route";
import { ApiError } from "./errors";
import { json } from "./http";

beforeEach(resetState);
afterAll(closeAll);

const origin = { origin: TEST_ENV.APP_ORIGIN };

const echo = apiRoute({
  input: z.object({ name: z.string().min(1) }),
  handler: async ({ user, input }) =>
    json(200, { userId: user.userId, name: input.name }),
});

const search = apiRoute({
  input: z.object({ q: z.string() }),
  handler: async ({ input }) => json(200, { q: input.q }),
});

const tight = apiRoute({
  rateLimit: { bucket: "tight", config: { capacity: 2, refillPerSec: 0.001 } },
  handler: async () => json(200, { ok: true }),
});

const boom = apiRoute({
  handler: async () => {
    throw new Error("secret connection string postgres://admin:pw@db");
  },
});

const notFound = apiRoute({
  handler: async () => {
    throw new ApiError("NOT_FOUND", "No such thing.");
  },
});

const post = (
  cookie: string,
  body: string,
  headers: Record<string, string> = origin,
) =>
  req("/api/v1/x", {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...headers },
    body,
  });

describe("apiRoute", () => {
  it("401s without a session and returns the standard error shape", async () => {
    const res = await echo(
      req("/api/v1/x", { method: "POST", headers: origin, body: "{}" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("403s a POST with a missing origin", async () => {
    const res = await echo(
      post(await cookieFor(), JSON.stringify({ name: "a" }), {}),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("BAD_ORIGIN");
  });

  it("403s a POST from another origin", async () => {
    const res = await echo(
      post(await cookieFor(), JSON.stringify({ name: "a" }), {
        origin: "https://evil.example",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("400s an invalid JSON body", async () => {
    const res = await echo(post(await cookieFor(), "{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("400s an empty body", async () => {
    const res = await echo(post(await cookieFor(), ""));
    expect(res.status).toBe(400);
  });

  it("400s schema failures with field details", async () => {
    const res = await echo(
      post(await cookieFor(), JSON.stringify({ name: 42 })),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details[0].path).toBe("name");
  });

  it("passes the user and parsed input to the handler and echoes x-request-id", async () => {
    const res = await echo(
      post(await cookieFor("a@example.com"), JSON.stringify({ name: "Ada" }), {
        ...origin,
        "x-request-id": "abc-123",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("abc-123");
    const body = await res.json();
    expect(body.name).toBe("Ada");
    expect(body.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("parses GET input from the query string", async () => {
    const res = await search(
      req("/api/v1/x?q=react", { headers: { cookie: await cookieFor() } }),
    );
    expect(await res.json()).toEqual({ q: "react" });
  });

  it("429s with Retry-After once the bucket is empty", async () => {
    const cookie = await cookieFor();
    const call = () => tight(req("/api/v1/x", { headers: { cookie } }));
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
  });

  it("maps ApiError to its status", async () => {
    const res = await notFound(
      req("/api/v1/x", { headers: { cookie: await cookieFor() } }),
    );
    expect(res.status).toBe(404);
  });

  it("hides unexpected error details behind a 500", async () => {
    const res = await boom(
      req("/api/v1/x", { headers: { cookie: await cookieFor() } }),
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("INTERNAL");
    expect(text).not.toContain("secret");
  });
});

const withParams = apiRoute({
  params: z.object({ step: z.enum(["basics", "skills"]) }),
  handler: async ({ params }) => json(200, { step: params.step }),
});

describe("apiRoute params and body size", () => {
  it("passes validated route params to the handler", async () => {
    const cookie = await cookieFor();
    const res = await withParams(
      req("/api/v1/x/basics", { headers: { cookie } }),
      { params: Promise.resolve({ step: "basics" }) },
    );
    expect(await res.json()).toEqual({ step: "basics" });
  });

  it("404s params that fail the schema", async () => {
    const cookie = await cookieFor();
    const res = await withParams(
      req("/api/v1/x/nope", { headers: { cookie } }),
      { params: Promise.resolve({ step: "nope" }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("413s a JSON body over 256 KB", async () => {
    const cookie = await cookieFor();
    const res = await echo(
      post(cookie, JSON.stringify({ name: "x".repeat(300_000) })),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
