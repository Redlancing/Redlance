import { createDb, enqueueImportJob, users } from "@redlance/db";
import { runMigrations } from "@redlance/db/migrate";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgListener } from "./db";
import { createLogger } from "./logger";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 2 });
beforeAll(() => runMigrations(url));
afterAll(() => pool.end());

it("delivers NOTIFY from enqueueImportJob to the listener", async () => {
  await db.execute(sql`truncate table users cascade`);
  const [u] = await db
    .insert(users)
    .values({ authSub: "dev|l", email: "l@example.com", emailNormalized: "l@example.com" })
    .returning();
  const listener = await createPgListener(url, createLogger("silent"));
  const got = new Promise<void>((resolve) => listener.onNotify(resolve));
  await enqueueImportJob(db, { userId: u!.id, kind: "github", input: {} });
  await got;
  await listener.close();
  expect(true).toBe(true);
});
