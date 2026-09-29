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
): Promise<Listener> {
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
      await c.query(`LISTEN ${IMPORT_JOBS_CHANNEL}`);
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
