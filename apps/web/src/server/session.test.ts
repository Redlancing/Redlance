import { eq, sql } from "drizzle-orm";
import { users } from "@redlance/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, req, resetState } from "../../test/helpers";
import { TEST_ENV } from "../../test/test-env";
import { getDb } from "./db";
import {
  DEV_SESSION_COOKIE,
  decodeDevSession,
  devSessionCookie,
  encodeDevSession,
  getSession,
  signInDevUser,
} from "./session";

const secret = TEST_ENV.DEV_SESSION_SECRET;
const withCookie = (value: string) => req("/api/v1/me", { headers: { cookie: `${DEV_SESSION_COOKIE}=${value}` } });

beforeEach(resetState);
afterAll(closeAll);

describe("dev session tokens", () => {
  it("round-trips a user id", () => {
    const id = "6f1c1f3a-1b2c-4d5e-8f90-123456789abc";
    expect(decodeDevSession(encodeDevSession(id, secret), secret)).toBe(id);
  });

  it("rejects a wrong secret, a tampered id and garbage", () => {
    const id = "6f1c1f3a-1b2c-4d5e-8f90-123456789abc";
    const token = encodeDevSession(id, secret);
    expect(decodeDevSession(token, "another-secret-that-is-32-chars-long!!")).toBeNull();
    expect(decodeDevSession(token.replace("6f1c", "7f1c"), secret)).toBeNull();
    expect(decodeDevSession("garbage", secret)).toBeNull();
    expect(decodeDevSession(".", secret)).toBeNull();
  });
});

describe("signInDevUser", () => {
  it("creates the user once and reuses it for other spellings of the same Gmail", async () => {
    const first = await signInDevUser("A.lex+jobs@Gmail.com");
    const second = await signInDevUser("alex@gmail.com");
    expect(second.userId).toBe(first.userId);
    const rows = await getDb().select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ authSub: "dev|alex@gmail.com", emailNormalized: "alex@gmail.com" });
    expect(rows[0]!.lastLoginAt).toBeInstanceOf(Date);
  });

  it("handles concurrent sign-ins for one email without errors", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => signInDevUser("same@example.com")));
    expect(new Set(results.map((r) => r.userId)).size).toBe(1);
    expect(await getDb().select().from(users)).toHaveLength(1);
  });

  it("refuses a blocked user", async () => {
    const { userId } = await signInDevUser("blocked@example.com");
    await getDb().update(users).set({ status: "blocked" }).where(eq(users.id, userId));
    await expect(signInDevUser("blocked@example.com")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("getSession", () => {
  it("returns the signed-in user", async () => {
    const { userId } = await signInDevUser("me@example.com");
    expect(await getSession(withCookie(encodeDevSession(userId, secret)))).toEqual({
      userId,
      email: "me@example.com",
    });
  });

  it("returns null without a cookie", async () => {
    expect(await getSession(req("/api/v1/me"))).toBeNull();
  });

  it("rejects tampered, garbage, deleted-user and blocked-user cookies", async () => {
    const { userId } = await signInDevUser("me@example.com");
    const good = encodeDevSession(userId, secret);
    expect(await getSession(withCookie(`${good}x`))).toBeNull();
    expect(await getSession(withCookie("not-a-token"))).toBeNull();

    await getDb().update(users).set({ status: "blocked" }).where(eq(users.id, userId));
    expect(await getSession(withCookie(good))).toBeNull();

    await getDb().execute(sql`truncate table users cascade`);
    expect(await getSession(withCookie(good))).toBeNull();
  });
});

describe("devSessionCookie", () => {
  it("is httpOnly, SameSite=Lax, and not Secure on http origins", () => {
    const cookie = devSessionCookie("6f1c1f3a-1b2c-4d5e-8f90-123456789abc");
    expect(cookie).toContain(`${DEV_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
  });
});
