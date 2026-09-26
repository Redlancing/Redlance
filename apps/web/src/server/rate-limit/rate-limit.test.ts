import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TEST_ENV } from "../../../test/test-env";
import { ApiError } from "../errors";
import { createRedis, redisReady } from "../redis";
import { createRateLimiter } from "./index";

const redis = createRedis(TEST_ENV.REDIS_URL);
const log = { error: vi.fn() };
const limiter = createRateLimiter(redis, log);

beforeAll(async () => {
  await redisReady(redis);
});

beforeEach(async () => {
  await redis.flushdb();
  log.error.mockReset();
});

afterAll(() => {
  redis.disconnect();
});

describe("token bucket", () => {
  it("allows capacity requests, then denies with a retry time", async () => {
    const config = { capacity: 30, refillPerSec: 2 };
    for (let i = 0; i < 30; i++) {
      expect((await limiter.consume("u:1", "api", config)).allowed).toBe(true);
    }
    const denied = await limiter.consume("u:1", "api", config);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(500);
  });

  it("refills over time", async () => {
    const config = { capacity: 2, refillPerSec: 20 };
    await limiter.consume("u:1", "t", config);
    await limiter.consume("u:1", "t", config);
    expect((await limiter.consume("u:1", "t", config)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 120));
    expect((await limiter.consume("u:1", "t", config)).allowed).toBe(true);
  });

  it("never over-spends under concurrency", async () => {
    const config = { capacity: 10, refillPerSec: 0.001 };
    const results = await Promise.all(
      Array.from({ length: 25 }, () => limiter.consume("u:1", "c", config)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("keeps subjects independent and uses hash-tagged keys", async () => {
    const config = { capacity: 1, refillPerSec: 0.001 };
    expect((await limiter.consume("u:1", "api", config)).allowed).toBe(true);
    expect((await limiter.consume("u:2", "api", config)).allowed).toBe(true);
    expect(await redis.exists("rl:{u:1}:api")).toBe(1);
  });
});

describe("daily quota", () => {
  const now = new Date("2026-09-26T10:00:00Z");

  it("allows up to the limit per UTC day", async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        (await limiter.consumeQuota("u:1", "import", 3, now)).allowed,
      ).toBe(true);
    }
    const denied = await limiter.consumeQuota("u:1", "import", 3, now);
    expect(denied).toMatchObject({ allowed: false, remaining: 0 });
    expect(denied.resetAt.toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("starts fresh on the next day and expires its key", async () => {
    for (let i = 0; i < 3; i++)
      await limiter.consumeQuota("u:1", "import", 3, now);
    const nextDay = new Date("2026-09-27T00:00:01Z");
    expect(
      (await limiter.consumeQuota("u:1", "import", 3, nextDay)).allowed,
    ).toBe(true);
    const ttl = await redis.ttl("q:{u:1}:import:20260926");
    expect(ttl).toBeGreaterThan(86_000);
    expect(ttl).toBeLessThanOrEqual(172_800);
  });
});

describe("Redis command cost", () => {
  it("uses exactly one command per consume and per quota check", async () => {
    await limiter.consume("u:1", "api", { capacity: 5, refillPerSec: 1 }); // loads the script
    await limiter.consumeQuota("u:1", "warm", 5); // loads the script
    const spy = vi.spyOn(redis, "sendCommand");
    await limiter.consume("u:1", "api", { capacity: 5, refillPerSec: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await limiter.consumeQuota("u:1", "import", 5);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("right after the client is created", () => {
  it("waits for the first connection instead of failing the first calls", async () => {
    const fresh = createRedis(TEST_ENV.REDIS_URL);
    const freshLimiter = createRateLimiter(fresh, log);
    const quota = await freshLimiter.consumeQuota("u:fresh", "import", 3);
    expect(quota.allowed).toBe(true);
    expect(log.error).not.toHaveBeenCalled();
    fresh.disconnect();
  });
});

describe("when Redis is down", () => {
  const down = createRedis("redis://127.0.0.1:6399", {
    retryStrategy: () => null,
  });
  const downLimiter = createRateLimiter(down, log);
  afterAll(() => down.disconnect());

  it("fails fast: the bucket allows and logs, the quota returns 503", async () => {
    const started = Date.now();
    const result = await downLimiter.consume("u:1", "api", {
      capacity: 30,
      refillPerSec: 2,
    });
    expect(result.allowed).toBe(true);
    expect(log.error).toHaveBeenCalledTimes(1);

    const quota = downLimiter.consumeQuota("u:1", "import", 3);
    await expect(quota).rejects.toBeInstanceOf(ApiError);
    await expect(quota).rejects.toMatchObject({
      code: "UNAVAILABLE",
      status: 503,
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
