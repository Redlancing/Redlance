import "server-only";
import { cookies } from "next/headers";
import { getSessionFromToken, type Session } from "./session";
import { SESSION_COOKIE } from "./session-cookie";

/** The signed-in user for a server-rendered page, or null. */
export async function getCurrentUser(): Promise<Session | null> {
  const store = await cookies();
  return getSessionFromToken(store.get(SESSION_COOKIE)?.value);
}
