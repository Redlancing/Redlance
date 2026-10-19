import { createDb, enqueueImportJob, users } from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireSessionLock, createPgListener } from "./db";

const url = process.env.TEST_DATABASE_URL!;
const log = pino({ level: "silent" });
const { db, pool } = createDb(url, { max: 2 });
beforeAll(() => runMigrations(url));
afterAll(() => pool.end());

describe("createPgListener", () => {
  it("delivers NOTIFY from enqueueImportJob to the listener", async () => {
    await db.execute(sql`truncate table users cascade`);
    const [u] = await db
      .insert(users)
      .values({ authSub: "dev|l", email: "l@example.com", emailNormalized: "l@example.com" })
      .returning();
    const listener = await createPgListener(url, log);
    const got = new Promise<void>((resolve) => listener.onNotify(resolve));
    await enqueueImportJob(db, { userId: u!.id, kind: "github", input: {} });
    await got;
    await listener.close();
    expect(true).toBe(true);
  });
});

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
