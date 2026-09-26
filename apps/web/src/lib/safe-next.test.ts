import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/dashboard/settings?tab=alerts", "/dashboard/settings?tab=alerts"],
  ])("keeps the on-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["dashboard"],
    ["https://evil.example/phish"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["/%5Cevil.example"],
    ["javascript:alert(1)"],
    ["/.//evil.com"],
    ["/..//evil.com"],
    ["/a/..//evil.com"],
    ["/%2e//evil.com"],
    ["/%2E%2E//evil.com"],
  ])("falls back to /dashboard for %s", (input) => {
    expect(safeNextPath(input)).toBe("/dashboard");
  });
});
