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

// Clients that have completed at least one connection. With the offline queue
// disabled, commands sent before the first connection fail instantly, so callers
// wait for that first connection (only) via awaitFirstConnection().
const everReady = new WeakSet<Redis>();

export function createRedis(url: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(url, { ...REDIS_OPTIONS, ...overrides });
  client.on("ready", () => everReady.add(client));
  client.on("error", () => {
    // Connection errors surface as rejected commands; callers decide fail-open/closed.
  });
  return client;
}

const store = globalThis as unknown as { __redlanceRedis?: Redis };

export function getRedis(): Redis {
  if (!store.__redlanceRedis) {
    const client = createRedis(getEnv().REDIS_URL);
    client.on("error", (err) => getLogger().warn({ err }, "redis connection error"));
    store.__redlanceRedis = client;
  }
  return store.__redlanceRedis;
}

export async function redisReady(redis: Redis, timeoutMs = 3000): Promise<void> {
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
 * Waits for a new client's first connection (a few ms after boot). Returns at once
 * for a client that has connected before, so a later outage still fails fast.
 */
export async function awaitFirstConnection(redis: Redis, timeoutMs = 500): Promise<void> {
  if (everReady.has(redis)) return;
  await redisReady(redis, timeoutMs).catch(() => {
    // Not connected in time: the caller's command fails and its fail-open/closed rule applies.
  });
}

export async function closeRedis(): Promise<void> {
  const client = store.__redlanceRedis;
  store.__redlanceRedis = undefined;
  client?.disconnect();
}
