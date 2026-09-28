import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export type CreateDbOptions = {
  max?: number;
  /** Idle-client errors (Postgres restart, failover, network blip). Without a handler, Node exits. */
  onError?: (err: Error) => void;
};

export function createDb(
  url: string,
  options: CreateDbOptions = {},
): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  pool.on(
    "error",
    options.onError ??
      ((err) => console.error("postgres idle client error:", err.message)),
  );
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}
