import "server-only";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { ApiError } from "../errors";
import { getLogger } from "../logger";
import { awaitFirstConnection, getRedis } from "../redis";
import { QUOTA_LUA, TOKEN_BUCKET_LUA } from "./scripts";

export type BucketConfig = { capacity: number; refillPerSec: number };

export const BUCKETS = {
  api: { capacity: 30, refillPerSec: 2 },
  health: { capacity: 10, refillPerSec: 0.2 },
} satisfies Record<string, BucketConfig>;

export type LimitResult = { allowed: boolean; remaining: number; retryAfterMs: number };
export type QuotaResult = { allowed: boolean; remaining: number; resetAt: Date };

type ScriptedRedis = Redis & {
  rlTakeToken(key: string, capacity: number, refillPerMs: number, cost: number): Promise<[number, number, number]>;
  rlQuota(key: string, limit: number, ttlSec: number): Promise<[number, number]>;
};

function withScripts(redis: Redis): ScriptedRedis {
  const scripted = redis as ScriptedRedis;
  if (typeof scripted.rlTakeToken !== "function") {
    redis.defineCommand("rlTakeToken", { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA });
    redis.defineCommand("rlQuota", { numberOfKeys: 1, lua: QUOTA_LUA });
  }
  return scripted;
}

const QUOTA_TTL_SEC = 2 * 24 * 60 * 60;

export function createRateLimiter(redis: Redis, log: Pick<Logger, "error">) {
  const r = withScripts(redis);

  return {
    /** Token bucket for every API call. Fails open: a Redis outage must not take the site down. */
    async consume(subject: string, bucket: string, config: BucketConfig): Promise<LimitResult> {
      try {
        await awaitFirstConnection(redis);
        const [allowed, remaining, retryAfterMs] = await r.rlTakeToken(
          `rl:{${subject}}:${bucket}`,
          config.capacity,
          config.refillPerSec / 1000,
          1,
        );
        return { allowed: allowed === 1, remaining, retryAfterMs };
      } catch (err) {
        log.error({ err, subject, bucket }, "rate limiter unavailable; allowing request");
        return { allowed: true, remaining: config.capacity, retryAfterMs: 0 };
      }
    },

    /** Per-UTC-day quota for expensive actions. Fails closed: never risk unlimited LLM spend. */
    async consumeQuota(subject: string, name: string, limit: number, now = new Date()): Promise<QuotaResult> {
      const day = now.toISOString().slice(0, 10).replaceAll("-", "");
      const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      let result: [number, number];
      try {
        await awaitFirstConnection(redis);
        result = await r.rlQuota(`q:{${subject}}:${name}:${day}`, limit, QUOTA_TTL_SEC);
      } catch (err) {
        log.error({ err, subject, name }, "quota check unavailable; denying request");
        throw new ApiError("UNAVAILABLE", "This action is temporarily unavailable. Please try again shortly.");
      }
      const [allowed, count] = result;
      return { allowed: allowed === 1, remaining: Math.max(0, limit - count), resetAt };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

let shared: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  shared ??= createRateLimiter(getRedis(), getLogger());
  return shared;
}
