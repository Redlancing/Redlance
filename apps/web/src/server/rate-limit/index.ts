import "server-only";
import { HOURLY_WARNING } from "@redlance/core";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { ApiError } from "../errors";
import { getLogger } from "../logger";
import { awaitFirstConnection, getRedis } from "../redis";
import { QUOTA_LUA, TOKEN_BUCKET_LUA } from "./scripts";

export type BucketConfig = { capacity: number; refillPerSec: number };

export const BUCKETS = {
  api: { capacity: 30, refillPerSec: 2 },
  "alerts-settings": { capacity: 20, refillPerSec: 20 / 60 },
  "alerts-link": { capacity: 5, refillPerSec: 5 / 60 },
  health: { capacity: 10, refillPerSec: 0.2 },
} satisfies Record<string, BucketConfig>;

export type LimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};
export type QuotaResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

type ScriptedRedis = Redis & {
  rlTakeToken(
    key: string,
    capacity: number,
    refillPerMs: number,
    cost: number,
  ): Promise<[number, number, number]>;
  rlQuota(
    key: string,
    limit: number,
    ttlSec: number,
  ): Promise<[number, number]>;
  rlCount(key: string, ttlSec: number): Promise<number>;
};

// INCR, and set the expiry on the first hit, in one command (Upstash bills per command).
const WINDOW_COUNT_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

function withScripts(redis: Redis): ScriptedRedis {
  const scripted = redis as ScriptedRedis;
  if (typeof scripted.rlTakeToken !== "function") {
    redis.defineCommand("rlTakeToken", {
      numberOfKeys: 1,
      lua: TOKEN_BUCKET_LUA,
    });
    redis.defineCommand("rlQuota", { numberOfKeys: 1, lua: QUOTA_LUA });
    redis.defineCommand("rlCount", { numberOfKeys: 1, lua: WINDOW_COUNT_LUA });
  }
  return scripted;
}

const QUOTA_TTL_SEC = 2 * 24 * 60 * 60;

export function createRateLimiter(redis: Redis, log: Pick<Logger, "error">) {
  const r = withScripts(redis);

  return {
    /** Token bucket for every API call. Fails open: a Redis outage must not take the site down. */
    async consume(
      subject: string,
      bucket: string,
      config: BucketConfig,
    ): Promise<LimitResult> {
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
        log.error(
          { err, subject, bucket },
          "rate limiter unavailable; allowing request",
        );
        return { allowed: true, remaining: config.capacity, retryAfterMs: 0 };
      }
    },

    /** Per-UTC-day quota for expensive actions. Fails closed: never risk unlimited LLM spend. */
    async consumeQuota(
      subject: string,
      name: string,
      limit: number,
      now = new Date(),
    ): Promise<QuotaResult> {
      const day = now.toISOString().slice(0, 10).replaceAll("-", "");
      const resetAt = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      );
      let result: [number, number];
      try {
        await awaitFirstConnection(redis);
        result = await r.rlQuota(
          `q:{${subject}}:${name}:${day}`,
          limit,
          QUOTA_TTL_SEC,
        );
      } catch (err) {
        log.error(
          { err, subject, name },
          "quota check unavailable; denying request",
        );
        throw new ApiError(
          "UNAVAILABLE",
          "This action is temporarily unavailable. Please try again shortly.",
        );
      }
      const [allowed, count] = result;
      return {
        allowed: allowed === 1,
        remaining: Math.max(0, limit - count),
        resetAt,
      };
    },

    /**
     * Counts this call in a fixed window of `windowSec` (keyed by the window's start).
     * For soft warnings only: fails open, returning null on Redis errors.
     */
    async countInWindow(
      subject: string,
      name: string,
      windowSec: number,
      now = new Date(),
    ): Promise<{ count: number } | null> {
      const nowSec = Math.floor(now.getTime() / 1000);
      const windowStart = nowSec - (nowSec % windowSec);
      try {
        await awaitFirstConnection(redis);
        const count = await r.rlCount(
          `w:{${subject}}:${name}:${windowStart}`,
          windowSec + 60,
        );
        return { count };
      } catch (err) {
        log.error(
          { err, subject, name },
          "window counter unavailable; skipping the warning",
        );
        return null;
      }
    },
  };
}

/** Counts a draft request; more than HOURLY_WARNING in the hour shows "slow down". */
export async function hourlyDraftWarning(
  limiter: Pick<RateLimiter, "countInWindow">,
  userId: string,
  now = new Date(),
): Promise<{ slowDown: boolean }> {
  const counted = await limiter.countInWindow(
    `u:${userId}`,
    "drafts",
    3600,
    now,
  );
  return { slowDown: counted !== null && counted.count > HOURLY_WARNING };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

let shared: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  shared ??= createRateLimiter(getRedis(), getLogger());
  return shared;
}
