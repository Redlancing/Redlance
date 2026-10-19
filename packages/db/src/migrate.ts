import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";
import { syncReferenceData } from "./reference";

export const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

/** Migrations, then reference data. Used by `npm run db:migrate` and test setup. */
export async function prepareDatabase(url: string): Promise<void> {
  await runMigrations(url);
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await syncReferenceData(db);
  } finally {
    await pool.end();
  }
}
