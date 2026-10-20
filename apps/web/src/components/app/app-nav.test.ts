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
  it("keeps Profile as coming soon and out of the tab bar", () => {
    const profile = appNav.find((i) => i.title === "Profile");
    expect(profile).toMatchObject({ href: "/profile", soon: true });
    expect(appTabs.map((i) => i.href)).toEqual([
      "/dashboard",
      "/feed",
      "/tracker",
      "/settings",
    ]);
  });
});
