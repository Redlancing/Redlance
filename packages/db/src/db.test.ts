import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, pgErrorCode, users } from "./index";
import { runMigrations } from "./migrate";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 2 });

beforeAll(async () => {
  await runMigrations(url);
});

beforeEach(async () => {
  await db.execute(sql`truncate table users cascade`);
});

afterAll(async () => {
  await pool.end();
});

describe("migrations", () => {
  it("can run twice without failing", async () => {
    await expect(runMigrations(url)).resolves.toBeUndefined();
  });

  it("enables the vector extension", async () => {
    const result = await db.execute(
      sql`select extname from pg_extension where extname = 'vector'`,
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe("users table", () => {
  it("fills defaults on insert", async () => {
    const [user] = await db
      .insert(users)
      .values({
        authSub: "dev|a@example.com",
        email: "A@example.com",
        emailNormalized: "a@example.com",
      })
      .returning();
    expect(user!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user!.status).toBe("active");
    expect(user!.createdAt).toBeInstanceOf(Date);
    expect(user!.lastLoginAt).toBeNull();
  });

  it("rejects a duplicate normalized email with a unique violation", async () => {
    await db
      .insert(users)
      .values({
        authSub: "dev|a",
        email: "a@example.com",
        emailNormalized: "a@example.com",
      });
    const attempt = db
      .insert(users)
      .values({
        authSub: "dev|b",
        email: "A@example.com",
        emailNormalized: "a@example.com",
      });
    await expect(attempt).rejects.toSatisfy(
      (err: unknown) => pgErrorCode(err) === "23505",
    );
  });

  it("rejects an unknown status at the database level", async () => {
    const attempt = db.execute(
      sql`insert into users (auth_sub, email, email_normalized, status) values ('dev|x', 'x@example.com', 'x@example.com', 'deleted')`,
    );
    await expect(attempt).rejects.toSatisfy(
      (err: unknown) => pgErrorCode(err) === "23514",
    );
  });
});
