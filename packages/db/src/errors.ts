/** Postgres error code (e.g. "23505" unique violation), looking through Drizzle's wrapper errors. */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (typeof current === "object" && "code" in current && typeof current.code === "string") {
      return current.code;
    }
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return undefined;
}
