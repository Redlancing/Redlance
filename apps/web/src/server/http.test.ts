import { describe, expect, it } from "vitest";
import { clientIp, readCookie } from "./http";

const withHeaders = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/x", { headers });

describe("readCookie", () => {
  it("finds a cookie among several", () => {
    expect(readCookie(withHeaders({ cookie: "a=1; rl_dev_session=abc.def; b=2" }), "rl_dev_session")).toBe("abc.def");
  });
  it("returns undefined when missing or when there is no cookie header", () => {
    expect(readCookie(withHeaders({ cookie: "a=1" }), "rl_dev_session")).toBeUndefined();
    expect(readCookie(withHeaders({}), "rl_dev_session")).toBeUndefined();
  });
  it("returns undefined for a malformed encoded value instead of throwing", () => {
    expect(readCookie(withHeaders({ cookie: "rl_dev_session=%E0%A4%A" }), "rl_dev_session")).toBeUndefined();
  });
});

describe("clientIp", () => {
  it("uses the first X-Forwarded-For entry", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("falls back to unknown", () => {
    expect(clientIp(withHeaders({}))).toBe("unknown");
  });
});
