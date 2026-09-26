import { sql } from "drizzle-orm";
import { apiRoute } from "@/server/api-route";
import { getDb } from "@/server/db";
import { json } from "@/server/http";
import { awaitFirstConnection, getRedis } from "@/server/redis";

async function check(probe: () => Promise<unknown>): Promise<"ok" | "down"> {
  try {
    await probe();
    return "ok";
  } catch {
    return "down";
  }
}

const deepCheck = apiRoute({
  auth: false,
  rateLimit: { bucket: "health" },
  handler: async () => {
    const [db, cache] = await Promise.all([
      check(() => getDb().execute(sql`select 1`)),
      check(async () => {
        const redis = getRedis();
        await awaitFirstConnection(redis);
        return redis.ping();
      }),
    ]);
    const ok = db === "ok" && cache === "ok";
    return json(ok ? 200 : 503, { status: ok ? "ok" : "degraded", db, cache });
  },
});

// Liveness (default) touches nothing: servers probe it every few seconds and
// Upstash bills per command. ?deep=1 is for deploys and occasional monitoring.
export async function GET(request: Request): Promise<Response> {
  if (new URL(request.url).searchParams.get("deep") === "1") return deepCheck(request);
  return json(200, { status: "ok" });
}
