import "server-only";
import { Redis, type RedisOptions } from "ioredis";
import { getEnv } from "./env";
import { getLogger } from "./logger";

export const REDIS_OPTIONS: RedisOptions = {
  protocol: 2, // RESP2: works the same on Valkey, Upstash and ElastiCache
  enableOfflineQueue: false, // fail fast instead of queueing while disconnected
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  commandTimeout: 1000,
};

// With the offline queue disabled, commands sent before a client's first connection
// fail instantly. Each client gets ONE shared "first attempt" promise that settles on the
// first ready / error / end (or a timeout); callers wait on it once, and a later outage
// (or one that started before boot) fails fast instead of adding latency to every call.
const FIRST_ATTEMPT_TIMEOUT_MS = 2500;
const firstAttempt = new WeakMap<Redis, Promise<void>>();

function trackFirstAttempt(client: Redis): void {
  firstAttempt.set(
    client,
    new Promise<void>((resolve) => {
      const settle = () => {
        clearTimeout(timer);
        client.off("ready", settle);
        client.off("error", settle);
        client.off("end", settle);
        resolve();
      };
      const timer = setTimeout(settle, FIRST_ATTEMPT_TIMEOUT_MS);
      timer.unref?.();
      client.once("ready", settle);
      client.once("error", settle);
      client.once("end", settle);
    }),
  );
}

export function createRedis(url: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(url, { ...REDIS_OPTIONS, ...overrides });
  client.on("error", () => {
    // Connection errors surface as rejected commands; callers decide fail-open/closed.
  });
  trackFirstAttempt(client);
  return client;
}

const store = globalThis as unknown as { __redlanceRedis?: Redis };

export function getRedis(): Redis {
  if (!store.__redlanceRedis) {
    const client = createRedis(getEnv().REDIS_URL);
    client.on("error", (err) =>
      getLogger().warn({ err }, "redis connection error"),
    );
    store.__redlanceRedis = client;
  }
  return store.__redlanceRedis;
}

export async function redisReady(
  redis: Redis,
  timeoutMs = 3000,
): Promise<void> {
  if (redis.status === "ready") return;
  if (redis.status === "end") throw new Error("Redis connection has ended");
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      redis.off("ready", onReady);
      redis.off("end", onEnd);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("Redis connection has ended"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis not ready after ${timeoutMs} ms`));
    }, timeoutMs);
    redis.once("ready", onReady);
    redis.once("end", onEnd);
  });
}

/**
 * Waits for a new client's first connection attempt (a few ms after boot) so the first
 * requests don't fail spuriously. Resolves immediately once that attempt has settled.
 */
export async function awaitFirstConnection(redis: Redis): Promise<void> {
  await firstAttempt.get(redis);
}
export async function closeRedis(): Promise<void> {
  const client = store.__redlanceRedis;
  store.__redlanceRedis = undefined;
  client?.disconnect();
}
