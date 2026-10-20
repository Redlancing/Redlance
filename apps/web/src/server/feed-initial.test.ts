import { users } from "@redlance/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db";
import { clearPosts, seedMatch, seedPost } from "../../test/feed-fixtures";
import { closeAll, cookieFor, resetState } from "../../test/helpers";
import {
  ROUTER_STATE_TREE_HEADER,
  clientHasLayout,
  loadInitialFeed,
} from "./feed-initial";
import { REQUEST_PATH_HEADER } from "./request-path";

/** The router state tree header as Next's client router encodes it. */
const tree = (t: unknown) => encodeURIComponent(JSON.stringify(t));
const FEED_MATCH_TREE = [
  "",
  {
    children: [
      "(app)",
      {
        children: [
          "feed",
          {
            children: [["matchId", "abc", "d"], { children: ["__PAGE__", {}] }],
          },
          null,
          "refetch",
        ],
      },
    ],
  },
];
const DASHBOARD_TREE = [
  "",
  {
    children: [
      "(app)",
      { children: ["dashboard", { children: ["__PAGE__", {}] }] },
    ],
  },
];
const FEED = ["", "(app)", "feed"] as const;

describe("clientHasLayout (is the feed layout already in the browser?)", () => {
  it("true for a router request whose tree holds the feed layout (a prefetch from the feed)", () => {
    expect(clientHasLayout(tree(FEED_MATCH_TREE), FEED)).toBe(true);
  });

  it("false for a document request, a navigation from elsewhere, or anything odd", () => {
    for (const v of [
      null,
      "",
      tree(DASHBOARD_TREE),
      tree(["", {}]),
      tree({ not: "a tree" }),
      "%E0%A4%A",
      "not json",
      tree(["x", { children: ["(app)", { children: ["feed", {}] }] }]),
    ])
      expect(clientHasLayout(v, FEED)).toBe(false);
  });
});

describe("loadInitialFeed (the feed layout's first page)", () => {
  beforeEach(async () => {
    await resetState();
    await clearPosts();
  });
  afterAll(closeAll);

  const page = { items: [], next: null };
  const headersWith = (h: Record<string, string>) => new Headers(h);

  it("reads the filters only from the proxy's path header", async () => {
    const read = vi.fn().mockResolvedValue(page);
    const out = await loadInitialFeed({
      userId: "u1",
      categories: ["design", "development"],
      headers: headersWith({
        [REQUEST_PATH_HEADER]: "/feed/abc?view=all&type=design,nope&pay=paid",
      }),
      read,
      now: () => 42,
    });
    expect(read).toHaveBeenCalledWith(expect.anything(), "u1", {
      view: "all",
      categories: ["design"],
      pay: "paid",
      limit: 25,
    });
    expect(out).toEqual({
      filters: { view: "all", types: ["design"], paidOnly: true },
      items: [],
      nextCursor: null,
      loadedAt: 42,
    });
  });

  it("without the header the defaults are used", async () => {
    const read = vi.fn().mockResolvedValue(page);
    const out = await loadInitialFeed({
      userId: "u1",
      categories: ["design"],
      headers: headersWith({}),
      read,
    });
    expect(read).toHaveBeenCalledWith(expect.anything(), "u1", {
      view: "best",
      categories: undefined,
      pay: "any",
      limit: 25,
    });
    expect(out?.filters).toEqual({ view: "best", types: [], paidOnly: false });
  });

  it("skips the read when the browser already has the feed layout (a prefetch)", async () => {
    const read = vi.fn().mockResolvedValue(page);
    const out = await loadInitialFeed({
      userId: "u1",
      categories: [],
      headers: headersWith({
        [REQUEST_PATH_HEADER]: "/feed/abc",
        [ROUTER_STATE_TREE_HEADER]: tree(FEED_MATCH_TREE),
      }),
      read,
    });
    expect(out).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("a failed read is logged and gives no data (the list fetches itself)", async () => {
    const err = new Error("db down");
    const log = { error: vi.fn() };
    const out = await loadInitialFeed({
      userId: "u1",
      categories: [],
      headers: headersWith({}),
      read: vi.fn().mockRejectedValue(err),
      log,
    });
    expect(out).toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      { err, userId: "u1" },
      expect.any(String),
    );
  });

  it("reads the real first page with the feed API's code", async () => {
    await cookieFor("dev@example.com");
    const [u] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "dev@example.com"));
    const id = await seedMatch(u!.id, await seedPost());
    const out = await loadInitialFeed({
      userId: u!.id,
      categories: ["development"],
      headers: headersWith({ [REQUEST_PATH_HEADER]: "/feed?view=all" }),
    });
    expect(out?.items.map((i) => i.matchId)).toEqual([id]);
    expect(out?.nextCursor).toBeNull();
  });
});
