import { describe, expect, it } from "vitest";
import { buildCountryOptions } from "./browser-intl";

describe("buildCountryOptions", () => {
  it("names each code and sorts by name, falling back to the code", () => {
    const names = { of: (c: string) => ({ TR: "Türkiye", IN: "India" })[c] };
    expect(buildCountryOptions(["TR", "ZZ", "IN"], names)).toEqual([
      { code: "IN", name: "India" },
      { code: "TR", name: "Türkiye" },
      { code: "ZZ", name: "ZZ" },
    ]);
  });
});
