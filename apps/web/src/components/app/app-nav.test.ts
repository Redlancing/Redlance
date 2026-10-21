import { describe, expect, it } from "vitest";
import { appNav, appTabs, isActiveHref } from "./app-nav";

describe("isActiveHref", () => {
  it("matches the page itself and its sub-paths", () => {
    expect(isActiveHref("/feed", "/feed")).toBe(true);
    expect(isActiveHref("/feed/abc", "/feed")).toBe(true);
  });

  it("does not match a sibling that shares a prefix", () => {
    expect(isActiveHref("/feedback", "/feed")).toBe(false);
    expect(isActiveHref("/tracker", "/feed")).toBe(false);
  });
});

describe("appNav", () => {
  it("has Profile live, in the sidebar and the tab bar", () => {
    const profile = appNav.find((i) => i.title === "Profile");
    expect(profile).toEqual(expect.objectContaining({ href: "/profile" }));
    expect(profile?.soon).toBeUndefined();
  });

  it("lists Insights after Tracker in the sidebar", () => {
    expect(appNav.map((i) => i.href)).toEqual([
      "/dashboard",
      "/feed",
      "/tracker",
      "/insights",
      "/profile",
      "/settings",
    ]);
  });

  it("keeps the phone tab bar to five items, Settings moved to the top bar", () => {
    expect(appTabs.map((i) => i.title)).toEqual([
      "Overview",
      "Matches",
      "Tracker",
      "Insights",
      "Profile",
    ]);
  });

  it("marks Insights active on a subreddit page", () => {
    expect(isActiveHref("/insights/forhire", "/insights")).toBe(true);
  });
});
