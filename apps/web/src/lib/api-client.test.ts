import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, parseRetryAfter, toApiResult } from "./api-client";

afterEach(() => vi.unstubAllGlobals());

describe("parseRetryAfter", () => {
  it("reads seconds and rounds up", () => {
    expect(parseRetryAfter("7")).toBe(7);
    expect(parseRetryAfter("1.2")).toBe(2);
  });
  it("ignores missing or invalid values", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter("-3")).toBeUndefined();
  });
});

describe("toApiResult", () => {
  it("wraps a success body", async () => {
    const res = Response.json({ a: 1 }, { status: 201 });
    expect(await toApiResult(res)).toEqual({
      ok: true,
      status: 201,
      data: { a: 1 },
    });
  });

  it("maps the error envelope and Retry-After", async () => {
    const res = Response.json(
      { error: { code: "RATE_LIMITED", message: "slow", details: { x: 1 } } },
      { status: 429, headers: { "Retry-After": "5" } },
    );
    expect(await toApiResult(res)).toEqual({
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      message: "slow",
      details: { x: 1 },
      retryAfter: 5,
    });
  });

  it("copes with a non-JSON error body", async () => {
    const res = new Response("<html>bad gateway</html>", { status: 502 });
    expect(await toApiResult(res)).toMatchObject({
      ok: false,
      status: 502,
      code: "INTERNAL",
      message: "",
    });
  });
});

describe("apiFetch", () => {
  it("sends JSON with the content-type and no-store", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await apiFetch("/api/v1/x", { method: "POST", json: { a: 1 } });
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/v1/x");
    expect(init.body).toBe('{"a":1}');
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("turns a thrown fetch into a NETWORK error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    expect(await apiFetch("/api/v1/x")).toMatchObject({
      ok: false,
      status: 0,
      code: "NETWORK",
    });
  });

  it("redirects to login on 401", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/feed/abc", search: "?view=all", assign },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "UNAUTHENTICATED", message: "no" } },
          { status: 401 },
        ),
      ),
    );
    const r = await apiFetch("/api/v1/x");
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(assign).toHaveBeenCalledWith(
      "/login?next=%2Ffeed%2Fabc%3Fview%3Dall",
    );
  });
});
