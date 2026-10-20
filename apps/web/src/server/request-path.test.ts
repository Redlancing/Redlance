import { describe, expect, it } from "vitest";
import { searchParamsFromRequestPath } from "./request-path";

describe("searchParamsFromRequestPath", () => {
  it("reads the query of the requested path", () => {
    const p = searchParamsFromRequestPath(
      "/feed/abc?view=all&type=web_dev&pay=paid",
    );
    expect(p.get("view")).toBe("all");
    expect(p.get("type")).toBe("web_dev");
    expect(p.get("pay")).toBe("paid");
  });

  it("is empty without a query, a header, or with an odd value", () => {
    for (const v of [
      "/feed",
      null,
      undefined,
      "",
      "https://evil.example/?view=all",
      "//evil.example/?view=all",
      "feed?view=all",
    ])
      expect([...searchParamsFromRequestPath(v)]).toEqual([]);
  });
});
