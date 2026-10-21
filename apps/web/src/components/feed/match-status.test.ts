import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS } from "@/lib/freshness";
import {
  localIsNewer,
  openView,
  serverOpenView,
  serverView,
} from "./match-status";

const LOADED = 1_000_000;
const fresh = LOADED + 1_000;
const old = LOADED + STALE_AFTER_MS + 1;

describe("localIsNewer", () => {
  it("counts a status set after the data was loaded, allowing for clock skew", () => {
    expect(localIsNewer({ status: "saved", at: LOADED + 1 }, LOADED)).toBe(
      true,
    );
    expect(localIsNewer({ status: "saved", at: LOADED - 4_000 }, LOADED)).toBe(
      true,
    );
    expect(localIsNewer({ status: "saved", at: LOADED - 6_000 }, LOADED)).toBe(
      false,
    );
    expect(localIsNewer(undefined, LOADED)).toBe(false);
    // No stamp: what this tab did wins.
    expect(localIsNewer({ status: "saved", at: 1 }, undefined)).toBe(true);
  });
});

describe("openView (what the match page starts with)", () => {
  it("fresh page, nothing local: shows the page and marks a new match seen", () => {
    expect(
      openView({ pageStatus: "new", loadedAt: LOADED, now: fresh }),
    ).toEqual({ status: "new", stale: false, markSeen: true });
    expect(
      openView({ pageStatus: "saved", loadedAt: LOADED, now: fresh }),
    ).toEqual({ status: "saved", stale: false, markSeen: false });
  });

  it("stale page: shows the page, checks the server, still marks seen (only if new)", () => {
    expect(openView({ pageStatus: "new", loadedAt: LOADED, now: old })).toEqual(
      { status: "new", stale: true, markSeen: true },
    );
  });

  it("this tab changed it after the page was loaded: shows that and checks", () => {
    expect(
      openView({
        pageStatus: "new",
        loadedAt: LOADED,
        local: { status: "saved", at: LOADED + 500 },
        now: fresh,
      }),
    ).toEqual({ status: "saved", stale: true, markSeen: false });
  });

  it("the same status locally changes nothing", () => {
    expect(
      openView({
        pageStatus: "seen",
        loadedAt: LOADED,
        local: { status: "seen", at: LOADED + 500 },
        now: fresh,
      }),
    ).toEqual({ status: "seen", stale: false, markSeen: false });
  });

  it("a local status older than the page loses to the page", () => {
    expect(
      openView({
        pageStatus: "dismissed",
        loadedAt: LOADED,
        local: { status: "saved", at: LOADED - 60_000 },
        now: fresh,
      }),
    ).toEqual({ status: "dismissed", stale: false, markSeen: false });
  });

  it("the server render is never stale and uses the page's status", () => {
    expect(serverOpenView("new")).toEqual({
      status: "new",
      stale: false,
      markSeen: true,
    });
  });
});

describe("serverView (when the server answers a check or the conditional seen)", () => {
  it("another tab changed it: show the server's and announce it", () => {
    expect(
      serverView({ shown: "seen", server: "saved", touched: false }),
    ).toEqual({ status: "saved", announce: true });
  });

  it("the conditional seen landed: announce it so the list clears the dot", () => {
    expect(
      serverView({ shown: "new", server: "seen", touched: false }),
    ).toEqual({ status: "seen", announce: true });
  });

  it("the server agrees: nothing to do", () => {
    expect(
      serverView({ shown: "saved", server: "saved", touched: false }),
    ).toEqual({ status: "saved", announce: false });
  });

  it("changed on this page since: the page's own status wins", () => {
    expect(
      serverView({ shown: "dismissed", server: "seen", touched: true }),
    ).toEqual({ status: "dismissed", announce: false });
  });

  it("the check failed: keep what is shown", () => {
    expect(serverView({ shown: "new", server: null, touched: false })).toEqual({
      status: "new",
      announce: false,
    });
  });
});
