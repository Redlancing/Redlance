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

export function createRedis(url: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(url, { ...REDIS_OPTIONS, ...overrides });
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
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      redis.off("ready", onReady);
      reject(new Error(`Redis not ready after ${timeoutMs} ms`));
    }, timeoutMs);
    redis.once("ready", onReady);
  });
}

export async function closeRedis(): Promise<void> {
  const client = store.__redlanceRedis;
  store.__redlanceRedis = undefined;
  client?.disconnect();
}
