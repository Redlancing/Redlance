import { apiRoute } from "@/server/api-route";
import { unlinkTelegram } from "@/server/alerts";
import { getDb } from "@/server/db";
import { json } from "@/server/http";

export const DELETE = apiRoute({
  rateLimit: { bucket: "alerts-settings" },
  handler: async ({ user }) => {
    await unlinkTelegram(getDb(), user.userId);
    return json(200, { ok: true });
  },
});
