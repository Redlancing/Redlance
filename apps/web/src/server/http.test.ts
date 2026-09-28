import { describe, expect, it } from "vitest";
import { clientIp, readCookie } from "./http";

const withHeaders = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/x", { headers });

describe("readCookie", () => {
  it("finds a cookie among several", () => {
    expect(
      readCookie(
        withHeaders({ cookie: "a=1; rl_dev_session=abc.def; b=2" }),
        "rl_dev_session",
      ),
    ).toBe("abc.def");
  });
  it("returns undefined when missing or when there is no cookie header", () => {
    expect(
      readCookie(withHeaders({ cookie: "a=1" }), "rl_dev_session"),
    ).toBeUndefined();
    expect(readCookie(withHeaders({}), "rl_dev_session")).toBeUndefined();
  });
  it("returns undefined for a malformed encoded value instead of throwing", () => {
    expect(
      readCookie(
        withHeaders({ cookie: "rl_dev_session=%E0%A4%A" }),
        "rl_dev_session",
      ),
    ).toBeUndefined();
  });
});

describe("clientIp", () => {
  it("prefers CloudFront-Viewer-Address and strips the port", () => {
    expect(
      clientIp(
        withHeaders({
          "cloudfront-viewer-address": "198.51.100.10:46532",
          "x-forwarded-for": "1.1.1.1",
        }),
      ),
    ).toBe("198.51.100.10");
    expect(
      clientIp(withHeaders({ "cloudfront-viewer-address": "2001:db8::1:443" })),
    ).toBe("2001:db8::1");
  });
  it("uses the LAST X-Forwarded-For entry, because clients control the earlier ones", () => {
    expect(
      clientIp(withHeaders({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" })),
    ).toBe("203.0.113.7");
  });
  it("ignores values that are not IP addresses", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "x".repeat(500) }))).toBe(
      "unknown",
    );
    expect(
      clientIp(withHeaders({ "cloudfront-viewer-address": "not-an-ip" })),
    ).toBe("unknown");
  });
  it("falls back to unknown", () => {
    expect(clientIp(withHeaders({}))).toBe("unknown");
  });
});
