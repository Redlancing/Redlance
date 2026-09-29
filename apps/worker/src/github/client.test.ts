import { describe, expect, it } from "vitest";
import { JobError } from "../jobs/types";
import { fetchGithubProfile } from "./client";

type Call = { url: string; init?: RequestInit };

function fakeFetch(
  routes: Record<string, () => Response>,
  calls: Call[] = [],
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const r = routes[u];
    if (!r) throw new Error(`unexpected ${u}`);
    return r();
  }) as typeof fetch;
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), init);

const USER = "https://api.github.com/users/octocat";
const REPOS =
  "https://api.github.com/users/octocat/repos?type=owner&sort=pushed&per_page=100";

const repo = {
  name: "r",
  fork: false,
  archived: false,
  language: "TypeScript",
  topics: ["react"],
  stargazers_count: 3,
  pushed_at: "2026-01-01T00:00:00Z",
  description: null,
  homepage: "https://evil.example/",
};

const ok = {
  [USER]: () => json({ login: "octocat", name: "Octo Cat", extra: 1 }),
  [REPOS]: () => json([repo]),
};

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as JobError;
  }
  throw new Error("did not throw");
};

describe("fetchGithubProfile", () => {
  it("fetches only the two api.github.com URLs with the right options", async () => {
    const calls: Call[] = [];
    const p = await fetchGithubProfile("octocat", {
      token: "tok",
      fetch: fakeFetch(ok, calls),
    });
    expect(p.login).toBe("octocat");
    expect(p.repos).toHaveLength(1);
    expect(calls.map((c) => c.url)).toEqual([USER, REPOS]);
    const init = calls[0].init!;
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["User-Agent"]).toBe("Redlance (+https://redlance.app)");
    expect(h["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(JSON.stringify(p)).not.toContain("evil.example");
  });

  it("omits Authorization without a token", async () => {
    const calls: Call[] = [];
    await fetchGithubProfile("octocat", { fetch: fakeFetch(ok, calls) });
    expect(
      (calls[0].init!.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("never fetches for an invalid username", async () => {
    const calls: Call[] = [];
    for (const bad of ["", "a/b", "-x", "evil.com/x", "login"]) {
      const e = await code(
        fetchGithubProfile(bad, { fetch: fakeFetch({}, calls) }),
      );
      expect(e.code).toBe("GITHUB_NOT_FOUND");
      expect(e.retryable).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("maps 404 to GITHUB_NOT_FOUND (not retryable)", async () => {
    const e = await code(
      fetchGithubProfile("octocat", {
        fetch: fakeFetch({ [USER]: () => new Response("{}", { status: 404 }) }),
      }),
    );
    expect([e.code, e.retryable]).toEqual(["GITHUB_NOT_FOUND", false]);
  });

  it("maps 403 with an exhausted rate limit to retryable GITHUB_RATE_LIMITED", async () => {
    for (const status of [403, 429]) {
      const e = await code(
        fetchGithubProfile("octocat", {
          fetch: fakeFetch({
            [USER]: () =>
              new Response("{}", {
                status,
                headers: { "x-ratelimit-remaining": "0" },
              }),
          }),
        }),
      );
      expect([e.code, e.retryable]).toEqual(["GITHUB_RATE_LIMITED", true]);
    }
  });

  it("maps 5xx and network errors to retryable GITHUB_UNAVAILABLE", async () => {
    const e1 = await code(
      fetchGithubProfile("octocat", {
        fetch: fakeFetch({ [USER]: () => new Response("x", { status: 502 }) }),
      }),
    );
    expect([e1.code, e1.retryable]).toEqual(["GITHUB_UNAVAILABLE", true]);
    const e2 = await code(
      fetchGithubProfile("octocat", {
        fetch: (async () => {
          throw new TypeError("fetch failed");
        }) as typeof fetch,
      }),
    );
    expect([e2.code, e2.retryable]).toEqual(["GITHUB_UNAVAILABLE", true]);
  });

  it("treats a redirect (fetch throws with redirect: error) as an error", async () => {
    const e = await code(
      fetchGithubProfile("octocat", {
        fetch: (async (_u: unknown, init?: RequestInit) => {
          expect(init?.redirect).toBe("error");
          throw new TypeError("redirect mode is set to error");
        }) as typeof fetch,
      }),
    );
    expect(e.code).toBe("GITHUB_UNAVAILABLE");
  });

  it("rejects a 3xx response that slips through", async () => {
    const e = await code(
      fetchGithubProfile("octocat", {
        fetch: fakeFetch({
          [USER]: () =>
            new Response(null, {
              status: 301,
              headers: { location: "https://evil.example" },
            }),
        }),
      }),
    );
    expect(e.code).toBe("GITHUB_UNAVAILABLE");
  });

  it("rejects a 2 MB body as GITHUB_TOO_LARGE", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const e = await code(
      fetchGithubProfile("octocat", {
        fetch: fakeFetch({ [USER]: () => new Response(big) }),
      }),
    );
    expect([e.code, e.retryable]).toEqual(["GITHUB_TOO_LARGE", false]);
  });

  it("rejects a malformed body as GITHUB_UNAVAILABLE", async () => {
    const e = await code(
      fetchGithubProfile("octocat", {
        fetch: fakeFetch({ ...ok, [REPOS]: () => json({ nope: true }) }),
      }),
    );
    expect(e.code).toBe("GITHUB_UNAVAILABLE");
    const e2 = await code(
      fetchGithubProfile("octocat", {
        fetch: fakeFetch({ ...ok, [USER]: () => new Response("<html>") }),
      }),
    );
    expect(e2.code).toBe("GITHUB_UNAVAILABLE");
  });
});
