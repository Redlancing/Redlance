import "server-only";
import { Redis, type RedisOptions } from "ioredis";
import type { Logger } from "pino";
import { getEnv } from "./env";
import { getLogger } from "./logger";

/**
 * Reconnect backoff: 50 ms, 100 ms, 200 ms… capped at 5 s, plus 0–200 ms of jitter.
 * A dead Redis gets one attempt every ~5 s per server, and restarted servers don't
 * reconnect in lockstep. Written out (it matches ioredis 6's default) so an ioredis
 * upgrade can't silently change it — older majors used linear backoff without jitter.
 */
export function retryDelay(attempt: number): number {
  const backoff = Math.min(2 ** (attempt - 1) * 50, 5000);
  return backoff + Math.floor(Math.random() * 200);
}

export const REDIS_OPTIONS: RedisOptions = {
  protocol: 2, // RESP2: works the same on Valkey, Upstash and ElastiCache
  enableOfflineQueue: false, // fail fast instead of queueing while disconnected
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  commandTimeout: 1000,
  retryStrategy: retryDelay,
};

export type ConnectionLog = Pick<Logger, "warn" | "error" | "info">;

const silentLog: ConnectionLog = {
  warn: () => {},
  error: () => {},
  info: () => {},
} as unknown as ConnectionLog;

// A wrong password or ACL user never fixes itself: retrying forever only hides the
// misconfiguration (the rate limiter fails open). Stop and say so once.
const AUTH_ERROR =
  /\b(WRONGPASS|NOAUTH)\b|invalid password|invalid username-password/i;

/**
 * Connection-state logging: one warning when an outage starts and one info line when
 * it recovers, instead of a line per reconnect attempt. Auth failures disconnect.
 */
function watchConnection(client: Redis, log: ConnectionLog): void {
  let everReady = false;
  let down = false;
  client.on("ready", () => {
    if (down) log.info("redis connection restored");
    down = false;
    everReady = true;
  });
  client.on("error", (err: Error) => {
    if (AUTH_ERROR.test(err.message)) {
      if (client.status !== "end") {
        log.error(
          { err },
          "redis authentication failed; not retrying — check REDIS_URL credentials",
        );
        client.disconnect();
      }
      return;
    }
    if (!down) {
      down = true;
      log.warn(
        { err, hadConnected: everReady },
        "redis unavailable; retrying in the background",
      );
    }
  });
}

// With the offline queue disabled, commands sent before a client's first connection
// fail instantly. Each client gets ONE shared "first attempt" promise that settles on the
// first ready / error / end (or a timeout); callers wait on it once, and a later outage
// (or one that started before boot) fails fast instead of adding latency to every call.
const FIRST_ATTEMPT_TIMEOUT_MS = 2500;
const firstAttempt = new WeakMap<Redis, Promise<void>>();

function trackFirstAttempt(client: Redis): Promise<void> {
  return new Promise<void>((resolve) => {
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
  });
}

/** The first-attempt promise for any client, starting to track it if nobody has. */
function firstAttemptFor(client: Redis): Promise<void> {
  let attempt = firstAttempt.get(client);
  if (!attempt) {
    switch (client.status) {
      case "ready": // already connected
      case "reconnecting": // connected or failed before: an outage, stay fail-fast
      case "close":
      case "end": // shut down: commands fail and fail-open/closed rules apply
        attempt = Promise.resolve();
        break;
      case "wait": // lazyConnect client nobody started yet
        attempt = trackFirstAttempt(client);
        client.connect().catch(() => {});
        break;
      default: // "connecting" / "connect": first connection in progress
        attempt = trackFirstAttempt(client);
    }
    firstAttempt.set(client, attempt);
  }
  return attempt;
}

export function createRedis(
  url: string,
  overrides: RedisOptions = {},
  log: ConnectionLog = silentLog,
): Redis {
  const client = new Redis(url, { ...REDIS_OPTIONS, ...overrides });
  // Always at least one "error" listener: connection errors surface as rejected
  // commands, and callers decide fail-open/closed.
  watchConnection(client, log);
  firstAttempt.set(client, trackFirstAttempt(client));
  return client;
}

const store = globalThis as unknown as { __redlanceRedis?: Redis };

export function getRedis(): Redis {
  store.__redlanceRedis ??= createRedis(getEnv().REDIS_URL, {}, getLogger());
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
 * Waits for a client's first connection attempt (a few ms after boot) so the first
 * requests don't fail spuriously. Works for any client, including ones not made by
 * createRedis. Resolves immediately once that attempt has settled.
 */
export async function awaitFirstConnection(redis: Redis): Promise<void> {
  await firstAttemptFor(redis);
}

export async function closeRedis(): Promise<void> {
  const client = store.__redlanceRedis;
  store.__redlanceRedis = undefined;
  client?.disconnect();
}
