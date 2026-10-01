import pino from "pino";
import { describe, expect, it } from "vitest";
import { acquireSessionLock } from "./db";

const url = process.env.TEST_DATABASE_URL!;
const log = pino({ level: "silent" });

describe("acquireSessionLock", () => {
  it("lets only one worker hold the poller lock, and hands it over on release", async () => {
    const key = `redlance:test-lock:${Date.now()}`;
    const first = await acquireSessionLock(url, key, log);
    expect(first).not.toBeNull();
    expect(await acquireSessionLock(url, key, log)).toBeNull();
    await first!.release();
    const second = await acquireSessionLock(url, key, log);
    expect(second).not.toBeNull();
    await second!.release();
  });

  it("reports a lost connection", async () => {
    const key = `redlance:test-lock-lost:${Date.now()}`;
    const lock = await acquireSessionLock(url, key, log);
    let lost = false;
    void lock!.lost.then(() => (lost = true));
    await lock!.release(); // ends the connection
    await new Promise((r) => setTimeout(r, 50));
    expect(lost).toBe(true);
  });
});
