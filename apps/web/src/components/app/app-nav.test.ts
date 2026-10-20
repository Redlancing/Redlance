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
    expect(appTabs.map((i) => i.href)).toEqual([
      "/dashboard",
      "/feed",
      "/tracker",
      "/profile",
      "/settings",
    ]);
  });
});
