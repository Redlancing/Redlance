import { IMPORT_JOBS_CHANNEL } from "@redlance/db";
import pg from "pg";
import type { Logger } from "./logger";

export type Listener = {
  onNotify(cb: () => void): void;
  close(): Promise<void>;
};

/**
 * LISTEN on a dedicated connection (a pooled one would be recycled and lose the subscription).
 * Reconnects with backoff 1 s -> 30 s. Notifications are only a wake-up hint; polling is the safety net.
 */
export async function createPgListener(
  url: string,
  log: Logger,
  channel: string = IMPORT_JOBS_CHANNEL,
): Promise<Listener> {
  if (!/^[a-z_]+$/.test(channel)) throw new Error(`bad channel: ${channel}`);
  const callbacks: Array<() => void> = [];
  let closed = false;
  let client: pg.Client | null = null;
  let delay = 1000;
  let timer: NodeJS.Timeout | null = null;

  const scheduleReconnect = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
    delay = Math.min(delay * 2, 30_000);
  };

  const connect = async () => {
    if (closed) return;
    const c = new pg.Client({ connectionString: url, keepAlive: true });
    client = c;
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      log.warn({ err: err.message }, "listener connection lost");
      c.removeAllListeners();
      c.on("error", () => {});
      void c.end().catch(() => {});
      if (client === c) client = null;
      scheduleReconnect();
    };
    c.on("error", fail);
    c.on("end", () => fail(new Error("connection ended")));
    c.on("notification", () => {
      for (const cb of callbacks) cb();
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${channel}`);
      delay = 1000;
      // Jobs may have arrived while we were disconnected.
      for (const cb of callbacks) cb();
    } catch (err) {
      fail(err as Error);
    }
  };

  await connect();

  return {
    onNotify(cb) {
      callbacks.push(cb);
    },
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      const c = client;
      client = null;
      if (c) {
        c.removeAllListeners();
        c.on("error", () => {});
        await c.end().catch(() => {});
      }
    },
  };
}

/**
 * A Postgres session advisory lock on its own connection: held until release() or until the
 * connection drops (then `lost` resolves and another worker can take over). Null if taken.
 */
export async function acquireSessionLock(
  url: string,
  key: string,
  log: Logger,
): Promise<{ lost: Promise<void>; release(): Promise<void> } | null> {
  const c = new pg.Client({ connectionString: url, keepAlive: true });
  let markLost!: () => void;
  const lost = new Promise<void>((r) => (markLost = r));
  c.on("error", (err) => {
    log.warn({ err: err.message }, "lock connection lost");
    markLost();
  });
  c.on("end", () => markLost());
  await c.connect();
  try {
    const res = await c.query<{ ok: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as ok",
      [key],
    );
    if (!res.rows[0]?.ok) {
      await c.end().catch(() => {});
      return null;
    }
  } catch (err) {
    await c.end().catch(() => {});
    throw err;
  }
  return {
    lost,
    async release() {
      await c
        .query("select pg_advisory_unlock(hashtext($1))", [key])
        .catch(() => {});
      await c.end().catch(() => {});
    },
  };
}
