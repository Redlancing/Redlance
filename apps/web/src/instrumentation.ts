// Runs once when the server starts: crash immediately if settings are missing or invalid,
// then open the Redis connection so the first requests don't race it.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./server/env");
    getEnv();
    const { awaitFirstConnection, getRedis } = await import("./server/redis");
    await awaitFirstConnection(getRedis(), 3000);
  }
}
