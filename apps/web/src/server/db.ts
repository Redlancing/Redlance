import "server-only";
import { createDb, type Database } from "@redlance/db";
import { getEnv } from "./env";
import { getLogger } from "./logger";

type DbHandle = ReturnType<typeof createDb>;

// Kept on globalThis so dev hot reloads reuse one pool instead of leaking connections.
const store = globalThis as unknown as { __redlanceDb?: DbHandle };

export function getDb(): Database {
  store.__redlanceDb ??= createDb(getEnv().DATABASE_URL, {
    max: 10,
    onError: (err) => getLogger().warn({ err }, "postgres idle client error"),
  });
  return store.__redlanceDb.db;
}

export async function closeDb(): Promise<void> {
  const handle = store.__redlanceDb;
  store.__redlanceDb = undefined;
  await handle?.pool.end();
}
