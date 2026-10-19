import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bodyText, cleanPostText, entryToJobPost } from "./adapter";
import { fetchFeed, readRateLimit } from "./client";
import { feedUrl } from "./feed-url";
import { FeedParseError, parseAtomFeed } from "./parse";

const FIXTURE = readFileSync(
  new URL("../../../test/fixtures/reddit-combined.atom.xml", import.meta.url),
  "utf8",
);

describe("feedUrl", () => {
  it("builds combined and search feeds with limit 100", () => {
    expect(
      feedUrl({ kind: "subreddits", subreddits: ["forhire", "hiring"] }),
    ).toBe("https://www.reddit.com/r/forhire+hiring/new/.rss?limit=100");
    expect(
      feedUrl({ kind: "search", query: "title:hiring" }, "t3_abc123"),
    ).toBe(
      "https://www.reddit.com/search.rss?q=title%3Ahiring&sort=new&type=link&limit=100&after=t3_abc123",
    );
  });

  it("refuses names and cursors that could change the path", () => {
    expect(() =>
      feedUrl({ kind: "subreddits", subreddits: ["../../api"] }),
    ).toThrow();
    expect(() => feedUrl({ kind: "subreddits", subreddits: [] })).toThrow();
    expect(() =>
      feedUrl({ kind: "search", query: "x" }, "t3_a&limit=5"),
    ).toThrow();
  });
});

describe("parseAtomFeed", () => {
  it("reads every entry with its fields", () => {
    const entries = parseAtomFeed(FIXTURE);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toMatchObject({
      id: "t3_1aaa001",
      title: "[Hiring] React developer for a small dashboard – $600 budget",
      link: "https://www.reddit.com/r/forhire/comments/1aaa001/hiring_react_developer_for_a_dashboard/",
      author: "/u/test_client_1",
      category: "forhire",
      published: "2026-09-30T07:10:00+00:00",
    });
    expect(entries[0]!.contentHtml).toContain("<!-- SC_OFF -->");
    expect(entries[4]!.author).toBeNull();
  });

  it("handles an empty feed and refuses DOCTYPEs and non-feeds", () => {
    expect(
      parseAtomFeed(
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>x</title></feed>',
      ),
    ).toEqual([]);
    expect(() =>
      parseAtomFeed(
        '<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY a "aaaa">]><feed>&a;</feed>',
      ),
    ).toThrow(FeedParseError);
    expect(() => parseAtomFeed("<html><body>blocked</body></html>")).toThrow(
      FeedParseError,
    );
  });
});

describe("entryToJobPost", () => {
  const entries = parseAtomFeed(FIXTURE);
  const posts = entries.map(entryToJobPost);

  it("maps a text post to the common shape", () => {
    const p = posts[0]!;
    expect(p).toMatchObject({
      source: "reddit",
      externalId: "t3_1aaa001",
      fetchedVia: "rss",
      community: "forhire",
      author: "test_client_1",
      sourceUpdatedAt: null,
    });
    expect(p.postedAt.toISOString()).toBe("2026-09-30T07:10:00.000Z");
    expect(p.body).toContain(
      "React developer to build a small admin dashboard & hook it",
    );
    expect(p.body).toContain("Budget: $600 fixed");
    expect(p.body).toContain("the brief [https://example.com/brief]");
    expect(p.body).not.toMatch(/submitted by|\[comments\]/);
  });

  it("lowercases the subreddit and leaves image posts without a body", () => {
    expect(posts[2]).toMatchObject({ community: "hungryartists", body: "" });
  });

  it("keeps the edit time and handles a deleted author", () => {
    expect(posts[3]!.sourceUpdatedAt!.toISOString()).toBe(
      "2026-09-30T06:45:00.000Z",
    );
    expect(posts[4]).toMatchObject({ community: "designjobs", author: null });
  });

  it("drops malformed entries", () => {
    expect(posts[5]).toBeNull();
    const base = entries[0]!;
    expect(
      entryToJobPost({
        ...base,
        link: "https://evil.example/r/forhire/comments/x/",
      }),
    ).toBeNull();
    expect(entryToJobPost({ ...base, category: "hiring" })).toBeNull();
    expect(entryToJobPost({ ...base, published: "not a date" })).toBeNull();
    expect(entryToJobPost({ ...base, title: "   " })).toBeNull();
  });

  it("cleans and caps text", () => {
    expect(cleanPostText("a​ b  c\n\n\n\nd", 100)).toBe("a b c\n\nd");
    expect(cleanPostText("x".repeat(50), 10)).toHaveLength(10);
    expect(bodyText(null)).toBe("");
  });
});

describe("fetchFeed", () => {
  const ua = "web:app.redlance.ingest:v1 (+https://redlance.app)";
  const url = "https://www.reddit.com/r/forhire/new/.rss?limit=100";
  const headers = (extra: Record<string, string> = {}) =>
    new Headers({
      "content-type": "application/atom+xml; charset=UTF-8",
      "x-ratelimit-used": "1",
      "x-ratelimit-remaining": "0.0",
      "x-ratelimit-reset": "54",
      ...extra,
    });
  const fake = (
    res: () => Response | Promise<Response>,
    seen: RequestInit[] = [],
  ) =>
    (async (_u: string, init: RequestInit) => {
      seen.push(init);
      return res();
    }) as unknown as typeof fetch;

  it("returns the feed, sends our User-Agent, refuses redirects", async () => {
    const seen: RequestInit[] = [];
    const r = await fetchFeed(url, {
      userAgent: ua,
      fetch: fake(() => new Response(FIXTURE, { headers: headers() }), seen),
    });
    expect(r).toMatchObject({
      ok: true,
      status: 200,
      rateLimit: { remaining: 0, resetSeconds: 54 },
    });
    expect((seen[0]!.headers as Record<string, string>)["User-Agent"]).toBe(ua);
    expect(seen[0]!.redirect).toBe("error");
  });

  it.each([
    [429, "RATE_LIMITED"],
    [403, "BLOCKED"],
    [404, "NOT_FOUND"],
    [500, "HTTP_ERROR"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const r = await fetchFeed(url, {
      userAgent: ua,
      fetch: fake(() => new Response("no", { status, headers: headers() })),
    });
    expect(r).toMatchObject({
      ok: false,
      status,
      errorCode: code,
      rateLimit: { resetSeconds: 54 },
    });
  });

  it("treats an HTML page with a 200 as not a feed", async () => {
    const r = await fetchFeed(url, {
      userAgent: ua,
      fetch: fake(() => new Response("<!doctype html><title>blocked</title>")),
    });
    expect(r).toMatchObject({ ok: false, errorCode: "NOT_A_FEED" });
  });

  it("stops reading past the size cap", async () => {
    const r = await fetchFeed(url, {
      userAgent: ua,
      maxBytes: 100,
      fetch: fake(() => new Response(FIXTURE)),
    });
    expect(r).toMatchObject({ ok: false, errorCode: "TOO_LARGE" });
  });

  it("reports redirects, network errors and timeouts without throwing", async () => {
    const reject = (msg: string) =>
      (async () => {
        throw new TypeError(msg);
      }) as unknown as typeof fetch;
    expect(
      await fetchFeed(url, {
        userAgent: ua,
        fetch: reject("unexpected redirect"),
      }),
    ).toMatchObject({ ok: false, errorCode: "REDIRECT" });
    expect(
      await fetchFeed(url, { userAgent: ua, fetch: reject("fetch failed") }),
    ).toMatchObject({ ok: false, errorCode: "NETWORK" });
    const hang = (async (_u: string, init: RequestInit) =>
      new Promise((_, rej) =>
        init.signal!.addEventListener("abort", () => rej(new Error("aborted"))),
      )) as unknown as typeof fetch;
    expect(
      await fetchFeed(url, { userAgent: ua, fetch: hang, timeoutMs: 20 }),
    ).toMatchObject({ ok: false, errorCode: "TIMEOUT" });
    const ac = new AbortController();
    const p = fetchFeed(url, { userAgent: ua, fetch: hang, signal: ac.signal });
    ac.abort();
    expect(await p).toMatchObject({ ok: false, errorCode: "ABORTED" });
  });

  it("only ever fetches Reddit", async () => {
    await expect(
      fetchFeed("https://example.com/feed", { userAgent: ua }),
    ).rejects.toThrow();
  });

  it("reads rate-limit headers defensively", () => {
    expect(readRateLimit(new Headers())).toEqual({
      remaining: null,
      resetSeconds: null,
    });
    expect(
      readRateLimit(
        new Headers({
          "x-ratelimit-reset": "abc",
          "x-ratelimit-remaining": "3.0",
        }),
      ),
    ).toEqual({ remaining: 3, resetSeconds: null });
  });
});
