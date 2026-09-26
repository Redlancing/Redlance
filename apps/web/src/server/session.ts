import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { users } from "@redlance/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { normalizeEmail } from "./email";
import { getEnv } from "./env";
import { ApiError } from "./errors";
import { readCookie } from "./http";

export const DEV_SESSION_COOKIE = "rl_dev_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Session = { userId: string; email: string };

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function encodeDevSession(userId: string, secret: string): string {
  return `${userId}.${sign(userId, secret)}`;
}

export function decodeDevSession(token: string, secret: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(userId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return UUID_RE.test(userId) ? userId : null;
}

function devSecret(): string {
  const env = getEnv();
  if (env.AUTH_MODE !== "dev" || !env.DEV_SESSION_SECRET) {
    throw new Error("Dev sessions are only available when AUTH_MODE=dev.");
  }
  return env.DEV_SESSION_SECRET;
}

export async function signInDevUser(email: string): Promise<Session> {
  const normalized = normalizeEmail(email);
  const now = new Date();
  const [user] = await getDb()
    .insert(users)
    .values({ authSub: `dev|${normalized}`, email: email.trim(), emailNormalized: normalized, lastLoginAt: now })
    .onConflictDoUpdate({ target: users.authSub, set: { lastLoginAt: now } })
    .returning({ id: users.id, email: users.email, status: users.status });
  if (!user || user.status !== "active") {
    throw new ApiError("FORBIDDEN", "This account is blocked.");
  }
  return { userId: user.id, email: user.email };
}

export function devSessionCookie(userId: string): string {
  const secure = getEnv().APP_ORIGIN.startsWith("https://") ? "; Secure" : "";
  return `${DEV_SESSION_COOKIE}=${encodeDevSession(userId, devSecret())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

export function clearDevSessionCookie(): string {
  return `${DEV_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getSession(request: Request): Promise<Session | null> {
  if (getEnv().AUTH_MODE === "cognito") {
    throw new Error("AUTH_MODE=cognito is not implemented yet; it arrives with the login spec.");
  }
  const token = readCookie(request, DEV_SESSION_COOKIE);
  if (!token) return null;
  const userId = decodeDevSession(token, devSecret());
  if (!userId) return null;
  const [user] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "active")))
    .limit(1);
  return user ? { userId: user.id, email: user.email } : null;
}
