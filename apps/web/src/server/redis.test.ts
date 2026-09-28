import { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_ENV } from "../../test/test-env";
import {
  REDIS_OPTIONS,
  awaitFirstConnection,
  createRedis,
  retryDelay,
} from "./redis";

const clients: Redis[] = [];
const keep = <T extends Redis>(client: T): T => {
  client.on("error", () => {});
  clients.push(client);
  return client;
};
const fakeLog = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() });

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
});

describe("retryDelay (reconnect backoff)", () => {
  const base = (attempt: number) => Math.min(2 ** (attempt - 1) * 50, 5000);

  it("backs off exponentially, caps at 5 s and adds up to 200 ms of jitter", () => {
    for (const attempt of [1, 2, 3, 5, 8, 20, 100]) {
      const delay = retryDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(base(attempt));
      expect(delay).toBeLessThan(base(attempt) + 200);
    }
  });

  it("varies between calls so restarted servers don't reconnect in lockstep", () => {
    const delays = new Set(Array.from({ length: 30 }, () => retryDelay(10)));
    expect(delays.size).toBeGreaterThan(1);
  });

  it("is the strategy every client uses", () => {
    expect(REDIS_OPTIONS.retryStrategy).toBe(retryDelay);
  });
});

describe("awaitFirstConnection for clients not made by createRedis", () => {
  it("waits for the first connection of an untracked client", async () => {
    const raw = keep(new Redis(TEST_ENV.REDIS_URL, REDIS_OPTIONS));
    await awaitFirstConnection(raw);
    expect(raw.status).toBe("ready");
  });

  it("starts a lazyConnect client instead of waiting for a connection nobody started", async () => {
    const lazy = keep(
      new Redis(TEST_ENV.REDIS_URL, { ...REDIS_OPTIONS, lazyConnect: true }),
    );
    await awaitFirstConnection(lazy);
    expect(lazy.status).toBe("ready");
  });

  it("does not wait for an untracked client that is already in an outage", async () => {
    const raw = keep(new Redis("redis://127.0.0.1:6397", REDIS_OPTIONS));
    await vi.waitFor(() => expect(raw.status).toBe("reconnecting"), {
      timeout: 2000,
    });
    const started = Date.now();
    await awaitFirstConnection(raw);
    expect(Date.now() - started).toBeLessThan(50);
  });
});

describe("authentication failures", () => {
  it("stop retrying and log one clear error", async () => {
    const log = fakeLog();
    const client = keep(
      createRedis("redis://nobody:wrong-password@127.0.0.1:6379/15", {}, log),
    );
    await vi.waitFor(() => expect(client.status).toBe("end"), {
      timeout: 3000,
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0]![1])).toMatch(
      /authentication failed/i,
    );
  });
});

describe("outage logging", () => {
  it("logs one warning when an outage starts and one line when it recovers", async () => {
    const log = fakeLog();
    const client = keep(createRedis("redis://127.0.0.1:6396", {}, log));
    await new Promise((r) => setTimeout(r, 800)); // several failed reconnect attempts
    expect(log.warn).toHaveBeenCalledTimes(1);

    client.emit("ready"); // recovery
    expect(log.info).toHaveBeenCalledTimes(1);

    client.emit("error", new Error("connection lost again")); // next outage
    client.emit("error", new Error("still down"));
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("does not log recovery for a normal first connection", async () => {
    const log = fakeLog();
    const client = keep(createRedis(TEST_ENV.REDIS_URL, {}, log));
    await awaitFirstConnection(client);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
