// Runs once when the server starts: crash immediately if settings are missing or invalid.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./server/env");
    getEnv();
  }
}
