import { describe, expect, it, vi } from "vitest";
import type { ImportJob } from "@redlance/db";
import { suggestionsSchema } from "@redlance/core";
import { makeGithubHandler } from "./github";
import type { JobContext } from "./types";

const body = (u: unknown) => new Response(JSON.stringify(u));

describe("githubHandler", () => {
  it("sets stages, fetches and returns valid suggestions", async () => {
    const stages: string[] = [];
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return url.endsWith("/octocat")
        ? body({ login: "octocat", name: null })
        : body([
            {
              name: "a",
              fork: false,
              archived: false,
              language: "Python",
              topics: [],
              stargazers_count: 1,
              pushed_at: "2026-01-01T00:00:00Z",
              description: null,
            },
          ]);
    }) as typeof fetch;
    const handler = makeGithubHandler(fetchFn);
    const ctx = {
      env: { GITHUB_TOKEN: "t" },
      setStage: vi.fn(async (s: string) => void stages.push(s)),
    } as unknown as JobContext;
    const out = await handler(
      { input: { username: "octocat" } } as unknown as ImportJob,
      ctx,
    );
    expect(stages).toEqual(["reading", "checking"]);
    expect(calls).toHaveLength(2);
    expect(suggestionsSchema.safeParse(out.result).success).toBe(true);
  });

  it("fails without fetching for a bad username input", async () => {
    const fetchFn = vi.fn();
    const handler = makeGithubHandler(fetchFn as unknown as typeof fetch);
    const ctx = { env: {}, setStage: vi.fn() } as unknown as JobContext;
    await expect(
      handler({ input: { username: "a/../b" } } as unknown as ImportJob, ctx),
    ).rejects.toMatchObject({ code: "GITHUB_NOT_FOUND", retryable: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  const repo = {
    name: "a",
    fork: false,
    archived: false,
    language: "Python",
    topics: [],
    stargazers_count: 1,
    pushed_at: "2026-01-01T00:00:00Z",
    description: null,
  };

  it("uses the validated input username, not the API login", async () => {
    const fetchFn = (async (url: string) =>
      url.endsWith("/octocat")
        ? body({ login: "oct--cat", name: null })
        : body([repo])) as typeof fetch;
    const handler = makeGithubHandler(fetchFn);
    const ctx = { env: {}, setStage: vi.fn() } as unknown as JobContext;
    const out = await handler(
      { input: { username: "octocat" } } as unknown as ImportJob,
      ctx,
    );
    const parsed = suggestionsSchema.safeParse(out.result);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.githubUsername).toBe("octocat");
  });

  it("fails as SHUTDOWN when the job signal aborts mid-fetch", async () => {
    const ac = new AbortController();
    const fetchFn = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
        setTimeout(() => ac.abort(), 10);
      })) as typeof fetch;
    const handler = makeGithubHandler(fetchFn);
    const ctx = {
      env: {},
      setStage: vi.fn(),
      signal: ac.signal,
    } as unknown as JobContext;
    await expect(
      handler({ input: { username: "octocat" } } as unknown as ImportJob, ctx),
    ).rejects.toMatchObject({ code: "SHUTDOWN", retryable: true });
  });
});
