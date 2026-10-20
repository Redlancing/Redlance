import { describe, expect, it, vi } from "vitest";
import type { FeedItemResponse } from "@/server/feed";
import {
  PREVIEW_LIMIT,
  forgetPreviews,
  previewFor,
  rememberPreviews,
  subscribePreviews,
} from "./match-preview-store";

function item(matchId: string, title = `Gig ${matchId}`): FeedItemResponse {
  return {
    matchId,
    score: 80,
    reason: "Needs React",
    broad: false,
    status: "new",
    aiStatus: "not_needed",
    bestProject: null,
    bestRole: null,
    post: {
      id: `p-${matchId}`,
      title,
      community: "forhire",
      url: "https://www.reddit.com/r/forhire/comments/x",
      postedAt: "2026-10-21T09:00:00.000Z",
      summary: "",
      categories: [],
      budget: null,
      payType: "paid",
      remote: "remote",
      deadline: null,
      redFlags: [],
      applyInstructions: null,
      alsoPostedIn: [],
    },
  };
}

describe("match preview store", () => {
  it("keeps the newest copy of each match the list has shown", () => {
    forgetPreviews();
    rememberPreviews([item("a"), item("b")]);
    rememberPreviews([item("a", "Edited title")]);
    expect(previewFor("a")?.post.title).toBe("Edited title");
    expect(previewFor("b")?.post.title).toBe("Gig b");
    expect(previewFor("c")).toBeUndefined();
  });

  it("returns the same object until it changes (a stable snapshot)", () => {
    forgetPreviews();
    const a = item("a");
    rememberPreviews([a]);
    expect(previewFor("a")).toBe(previewFor("a"));
    rememberPreviews([a]);
    expect(previewFor("a")).toBe(a);
  });

  it("tells subscribers only when something changed", () => {
    forgetPreviews();
    const listener = vi.fn();
    const off = subscribePreviews(listener);
    const a = item("a");
    rememberPreviews([a]);
    rememberPreviews([a]);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    rememberPreviews([item("b")]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("holds at most PREVIEW_LIMIT matches, dropping the least recently stored", () => {
    forgetPreviews();
    rememberPreviews(
      Array.from({ length: PREVIEW_LIMIT + 5 }, (_, i) => item(`m${i}`)),
    );
    expect(previewFor("m0")).toBeUndefined();
    expect(previewFor("m4")).toBeUndefined();
    expect(previewFor("m5")).toBeDefined();
    expect(previewFor(`m${PREVIEW_LIMIT + 4}`)).toBeDefined();
  });
});
