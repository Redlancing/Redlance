import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";
import { SESSION_COOKIE } from "./server/session-cookie";

const request = (path: string, cookie?: string) =>
  new NextRequest(
    `http://localhost:3000${path}`,
    cookie ? { headers: { cookie } } : undefined,
  );

describe("proxy", () => {
  it("sends signed-out visitors of app pages to /login with a next path", () => {
    const res = proxy(request("/dashboard?tab=1"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard?tab=1");
  });

  it("lets a request with a session cookie through (the page verifies it)", () => {
    const res = proxy(request("/dashboard", `${SESSION_COOKIE}=anything`));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
