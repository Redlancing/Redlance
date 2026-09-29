import { describe, expect, it } from "vitest";
import { lookupGithubUser } from "./github-lookup";

const fakeFetch = (status: number, body: unknown = {}) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { impl: impl as typeof fetch, calls };
};

describe("lookupGithubUser", () => {
  it("reports a found account", async () => {
    const { impl, calls } = fakeFetch(200, { login: "octocat" });
    expect(await lookupGithubUser("octocat", impl)).toBe("found");
    expect(calls[0]!.url).toBe("https://api.github.com/users/octocat");
    expect(calls[0]!.init).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  });

  it("reports a missing account only on 404", async () => {
    expect(await lookupGithubUser("nobody", fakeFetch(404).impl)).toBe(
      "missing",
    );
  });

  it("stays quiet (unknown) on rate limits, server errors and network failures", async () => {
    expect(await lookupGithubUser("octocat", fakeFetch(403).impl)).toBe(
      "unknown",
    );
    expect(await lookupGithubUser("octocat", fakeFetch(500).impl)).toBe(
      "unknown",
    );
    const failing = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    expect(await lookupGithubUser("octocat", failing)).toBe("unknown");
  });

  it("never looks up something that isn't a valid username", async () => {
    const { impl, calls } = fakeFetch(200);
    expect(await lookupGithubUser("../../admin", impl)).toBe("unknown");
    expect(calls).toHaveLength(0);
  });
});
