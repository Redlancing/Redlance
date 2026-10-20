import { describe, expect, it } from "vitest";
import type { FeedItemResponse } from "@/server/feed";
import {
  feedQuery,
  feedReducer,
  filtersFrom,
  filtersToParams,
  initialFeedState,
  newerThan,
  undoStatus,
  type FeedState,
} from "./feed-state";

function item(
  id: string,
  postedAt: string,
  over: Partial<FeedItemResponse> = {},
): FeedItemResponse {
  return {
    matchId: id,
    score: 80,
    reason: "Fits",
    broad: false,
    status: "new",
    aiStatus: "not_needed",
    bestProject: null,
    bestRole: null,
    post: {
      id: `p${id}`,
      title: `Gig ${id}`,
      community: "forhire",
      url: `https://www.reddit.com/r/forhire/comments/${id}/`,
      postedAt,
      summary: "",
      categories: ["development"],
      budget: null,
      payType: "paid",
      remote: "remote",
      deadline: null,
      redFlags: [],
      applyInstructions: null,
      alsoPostedIn: [],
    },
    ...over,
  };
}

const T = (h: number) => `2026-10-20T${String(h).padStart(2, "0")}:00:00.000Z`;
const ready = (
  items: FeedItemResponse[],
  nextCursor: string | null = null,
): FeedState =>
  feedReducer(initialFeedState, { type: "loaded", items, nextCursor });
const ids = (s: FeedState) => s.items.map((i) => i.matchId);

describe("feedReducer", () => {
  it("loads, appends without duplicates, and keeps the cursor", () => {
    let s = ready([item("c", T(12)), item("b", T(11))], "cur1");
    expect(s.phase).toBe("ready");
    s = feedReducer(s, { type: "loadingMore" });
    expect(s.loadingMore).toBe(true);
    s = feedReducer(s, {
      type: "appended",
      items: [item("b", T(11)), item("a", T(10))],
      nextCursor: null,
    });
    expect(ids(s)).toEqual(["c", "b", "a"]);
    expect(s.nextCursor).toBeNull();
    expect(s.loadingMore).toBe(false);
  });

  it("a refresh holds newer matches back and updates the ones shown", () => {
    let s = ready([item("b", T(11)), item("a", T(10))]);
    s = feedReducer(s, {
      type: "refreshed",
      items: [
        item("c", T(12)),
        item("b", T(11), { score: 91 }),
        item("a", T(10)),
      ],
    });
    expect(ids(s)).toEqual(["b", "a"]);
    expect(s.items[0]!.score).toBe(91);
    expect(s.incoming.map((i) => i.matchId)).toEqual(["c"]);
    // A second refresh doesn't double-count.
    s = feedReducer(s, {
      type: "refreshed",
      items: [item("d", T(13)), item("c", T(12))],
    });
    expect(s.incoming.map((i) => i.matchId)).toEqual(["d", "c"]);
    s = feedReducer(s, { type: "insertIncoming" });
    expect(ids(s)).toEqual(["d", "c", "b", "a"]);
    expect(s.incoming).toEqual([]);
  });

  it("an older match missing from the list is not 'new' (it belongs to a later page)", () => {
    const list = [item("b", T(11))];
    expect(newerThan(list, [item("x", T(9))])).toEqual([]);
    expect(newerThan([], [item("x", T(9))]).map((i) => i.matchId)).toEqual([
      "x",
    ]);
  });

  it("same posted time sorts by match id, newest first", () => {
    const list = [item("m5", T(11))];
    expect(
      newerThan(list, [item("m9", T(11)), item("m1", T(11))]).map(
        (i) => i.matchId,
      ),
    ).toEqual(["m9"]);
  });

  it("status, remove and restore at the old place", () => {
    let s = ready([item("c", T(12)), item("b", T(11)), item("a", T(10))]);
    s = feedReducer(s, { type: "status", matchId: "b", status: "saved" });
    expect(s.items[1]!.status).toBe("saved");
    const removed = s.items[1]!;
    s = feedReducer(s, { type: "remove", matchId: "b" });
    expect(ids(s)).toEqual(["c", "a"]);
    s = feedReducer(s, { type: "restore", item: removed, index: 1 });
    expect(ids(s)).toEqual(["c", "b", "a"]);
    // Restoring twice is a no-op.
    expect(feedReducer(s, { type: "restore", item: removed, index: 0 })).toBe(
      s,
    );
  });

  it("a failed first load is an error; a failed next page keeps the list", () => {
    expect(
      feedReducer(initialFeedState, { type: "failed", error: "x" }).phase,
    ).toBe("error");
    const s = feedReducer(ready([item("a", T(10))], "c"), {
      type: "moreFailed",
      error: "y",
    });
    expect(s.phase).toBe("ready");
    expect(s.error).toBe("y");
    expect(ids(s)).toEqual(["a"]);
  });
});

describe("rollback and restore from the match page", () => {
  it("a rollback only applies while the row still has the optimistic status", () => {
    let s = ready([item("a", T(10))]);
    s = feedReducer(s, { type: "status", matchId: "a", status: "saved" });
    s = feedReducer(s, { type: "status", matchId: "a", status: "seen" });
    // The first request (to saved) failed after the second succeeded: no rollback.
    s = feedReducer(s, {
      type: "status",
      matchId: "a",
      status: "new",
      ifStatus: "saved",
    });
    expect(s.items[0]!.status).toBe("seen");
  });

  it("insert puts a restored match back in order, unless it's beyond the loaded pages", () => {
    let s = ready([item("c", T(12)), item("a", T(10))], "cursor");
    s = feedReducer(s, { type: "insert", item: item("b", T(11)) });
    expect(ids(s)).toEqual(["c", "b", "a"]);
    expect(feedReducer(s, { type: "insert", item: item("b", T(11)) })).toBe(s);
    // Older than the last loaded row while more pages exist: it'll come with its page.
    expect(feedReducer(s, { type: "insert", item: item("z", T(1)) })).toBe(s);
    const all = ready([item("c", T(12))], null);
    expect(
      ids(feedReducer(all, { type: "insert", item: item("z", T(1)) })),
    ).toEqual(["c", "z"]);
  });
});

describe("filters", () => {
  const allowed = ["development", "design"];

  it("reads the URL, dropping unknown or extra types", () => {
    expect(filtersFrom(new URLSearchParams(""), allowed)).toEqual({
      view: "best",
      types: [],
      paidOnly: false,
    });
    expect(
      filtersFrom(
        new URLSearchParams("view=all&type=design,video,design&pay=paid"),
        allowed,
      ),
    ).toEqual({ view: "all", types: ["design"], paidOnly: true });
    expect(filtersFrom(new URLSearchParams("view=weird"), allowed).view).toBe(
      "best",
    );
  });

  it("writes short URLs and full API queries", () => {
    expect(
      filtersToParams({ view: "best", types: [], paidOnly: false }).toString(),
    ).toBe("");
    expect(
      filtersToParams({
        view: "all",
        types: ["design"],
        paidOnly: true,
      }).toString(),
    ).toBe("view=all&type=design&pay=paid");
    expect(feedQuery({ view: "best", types: [], paidOnly: false }, "abc")).toBe(
      "/api/v1/feed?view=best&cursor=abc",
    );
  });

  it("undo brings a new match back as seen", () => {
    expect(undoStatus("new")).toBe("seen");
    expect(undoStatus("saved")).toBe("saved");
  });
});
