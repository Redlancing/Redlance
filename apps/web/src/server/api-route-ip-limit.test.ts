import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, cookieFor, req, resetState } from "../../test/helpers";
import { apiRoute } from "./api-route";
import { json } from "./http";
import { getRateLimiter } from "./rate-limit";
import * as session from "./session";

vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>();
  return { ...actual, getSession: vi.fn(actual.getSession) };
});

beforeEach(async () => {
  await resetState();
  vi.mocked(session.getSession).mockClear();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await closeAll();
});

const route = apiRoute({
  auth: false,
  rateLimit: false,
  handler: async () => json(200, { ok: true }),
});
const from = (ip: string, path = "/api/v1/x") =>
  req(path, { headers: { "cloudfront-viewer-address": `${ip}:443` } });

/** Drain the IP bucket (capacity 120) so the next call from this IP is refused. */
async function drain(ip: string) {
  const limiter = getRateLimiter();
  for (let i = 0; i < 120; i++)
    await limiter.consume(`ip:${ip}`, "ip", { capacity: 120, refillPerSec: 4 });
}

describe("per-IP pre-limit", () => {
  it("429s an IP over the limit before any session lookup", async () => {
    await drain("203.0.113.1");
    const res = await route(
      req("/api/v1/x", {
        headers: {
          "cloudfront-viewer-address": "203.0.113.1:443",
          cookie: "rl_dev_session=forged",
        },
      }),
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect(session.getSession).not.toHaveBeenCalled();
  });

  it("lets normal traffic through and looks up the session", async () => {
    const res = await route(
      req("/api/v1/x", {
        headers: {
          "cloudfront-viewer-address": "203.0.113.9:443",
          cookie: await cookieFor(),
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(session.getSession).toHaveBeenCalledTimes(1);
  });

  it("keeps IPs independent", async () => {
    await drain("203.0.113.2");
    expect((await route(from("203.0.113.2"))).status).toBe(429);
    expect((await route(from("203.0.113.3"))).status).toBe(200);
  });

  it("skips the check when no IP can be determined", async () => {
    const consume = vi.spyOn(getRateLimiter(), "consume");
    for (let i = 0; i < 3; i++)
      expect((await route(req("/api/v1/x"))).status).toBe(200);
    expect(consume).not.toHaveBeenCalled();
    consume.mockRestore();
  });

  it("fails open when the limiter throws", async () => {
    const consume = vi
      .spyOn(getRateLimiter(), "consume")
      .mockRejectedValue(new Error("redis down"));
    expect((await route(from("203.0.113.4"))).status).toBe(200);
    consume.mockRestore();
  });

  it("does not touch Redis for the health path", async () => {
    await drain("203.0.113.5");
    const consume = vi.spyOn(getRateLimiter(), "consume");
    const res = await route(from("203.0.113.5", "/api/v1/health"));
    expect(res.status).toBe(200);
    expect(consume).not.toHaveBeenCalled();
    consume.mockRestore();
  });
});
