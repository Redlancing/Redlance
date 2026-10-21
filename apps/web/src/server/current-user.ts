import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { getSessionFromToken, type Session } from "./session";
import { SESSION_COOKIE } from "./session-cookie";

/**
 * The signed-in user for a server-rendered page, or null. Wrapped in `cache()` so the
 * layouts and the page of one render share a single lookup (each new request still checks).
 */
export const getCurrentUser = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  return getSessionFromToken(store.get(SESSION_COOKIE)?.value);
});
