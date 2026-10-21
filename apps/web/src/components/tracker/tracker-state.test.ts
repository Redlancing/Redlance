import { describe, expect, it } from "vitest";
import {
  appendPage,
  buildPatchBody,
  filterHref,
  majorToMinor,
  parseFilter,
  patchItem,
  setPage,
  type ReplyItem,
} from "./tracker-state";

function item(id: string, status: ReplyItem["status"] = "sent"): ReplyItem {
  return {
    id,
    draftId: null,
    matchId: null,
    kind: "comment",
    sentText: "hi",
    editRatio: null,
    sentAt: "2026-10-20T10:00:00.000Z",
    status,
    updatedAt: "2026-10-20T10:00:00.000Z",
    post: { id: "p" + id, title: "t", community: "forhire", url: "https://x" },
  };
}

describe("parseFilter / filterHref", () => {
  it("accepts known statuses and falls back to all", () => {
    expect(parseFilter("hired")).toBe("hired");
    expect(parseFilter(["no_reply", "x"])).toBe("no_reply");
    expect(parseFilter("bogus")).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
  });
  it("builds hrefs", () => {
    expect(filterHref("all")).toBe("/tracker");
    expect(filterHref("lost")).toBe("/tracker?status=lost");
  });
});

describe("majorToMinor", () => {
  it("converts to minor units", () => {
    expect(majorToMinor("450")).toBe(45000);
    expect(majorToMinor("450.5")).toBe(45050);
    expect(majorToMinor("1,250.05")).toBe(125005);
    expect(majorToMinor("0")).toBe(0);
  });
  it("rejects bad input", () => {
    expect(majorToMinor("")).toBeNull();
    expect(majorToMinor("-5")).toBeNull();
    expect(majorToMinor("1.234")).toBeNull();
    expect(majorToMinor("abc")).toBeNull();
  });
});

describe("buildPatchBody", () => {
  it("sends only the status for non-hired", () => {
    expect(buildPatchBody("lost")).toEqual({
      ok: true,
      body: { status: "lost" },
    });
    expect(
      buildPatchBody("lost", { rate: "5", currency: "USD", unpaid: true }),
    ).toEqual({ ok: true, body: { status: "lost" } });
  });
  it("sends neither rate nor currency when the rate is blank", () => {
    expect(
      buildPatchBody("hired", { rate: " ", currency: "USD", unpaid: false }),
    ).toEqual({ ok: true, body: { status: "hired" } });
  });
  it("sends rate and currency together", () => {
    expect(
      buildPatchBody("hired", { rate: "450", currency: "usd", unpaid: false }),
    ).toEqual({
      ok: true,
      body: { status: "hired", agreedRateMinor: 45000, currency: "USD" },
    });
  });
  it("unpaid wins over a rate", () => {
    expect(
      buildPatchBody("hired", { rate: "450", currency: "USD", unpaid: true }),
    ).toEqual({ ok: true, body: { status: "hired", unpaid: true } });
  });
  it("rejects bad rates and currencies", () => {
    expect(
      buildPatchBody("hired", { rate: "x", currency: "USD", unpaid: false }).ok,
    ).toBe(false);
    expect(
      buildPatchBody("hired", { rate: "450", currency: "US", unpaid: false })
        .ok,
    ).toBe(false);
    expect(
      buildPatchBody("hired", {
        rate: "1000001",
        currency: "USD",
        unpaid: false,
      }).ok,
    ).toBe(false);
  });
});

describe("list reducers", () => {
  it("appends without duplicates", () => {
    const s = appendPage(
      setPage([item("1"), item("2")], "c1"),
      [item("2"), item("3")],
      null,
    );
    expect(s.items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(s.nextCursor).toBeNull();
  });
  it("patches one row and keeps the others", () => {
    const s = setPage([item("1"), item("2")], null);
    const next = patchItem(s, "2", { status: "hired" });
    expect(next.items[1].status).toBe("hired");
    expect(next.items[0]).toBe(s.items[0]);
  });
});
