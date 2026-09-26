import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export function createDb(
  url: string,
  options: { max?: number } = {},
): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}
