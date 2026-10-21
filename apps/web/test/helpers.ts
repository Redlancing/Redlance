import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db";
import { closeRedis, getRedis, redisReady } from "@/server/redis";
import {
  DEV_SESSION_COOKIE,
  encodeDevSession,
  signInDevUser,
} from "@/server/session";
import { TEST_ENV } from "./test-env";

export async function resetState(): Promise<void> {
  await getDb().execute(sql`truncate table users cascade`);
  await redisReady(getRedis());
  await getRedis().flushdb();
}

export async function cookieFor(email = "dev@example.com"): Promise<string> {
  const session = await signInDevUser(email);
  return `${DEV_SESSION_COOKIE}=${encodeDevSession(session.userId, TEST_ENV.DEV_SESSION_SECRET)}`;
}

export function req(path: string, init?: RequestInit): Request {
  return new Request(`${TEST_ENV.APP_ORIGIN}${path}`, init);
}

export async function closeAll(): Promise<void> {
  await closeDb();
  await closeRedis();
}
