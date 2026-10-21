import { apiRoute } from "@/server/api-route";
import { startTelegramLink } from "@/server/alerts";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { ApiError } from "@/server/errors";
import { json } from "@/server/http";

export const POST = apiRoute({
  rateLimit: { bucket: "alerts-link" },
  handler: async ({ user }) => {
    const bot = getEnv().TELEGRAM_BOT_USERNAME;
    if (!bot)
      throw new ApiError(
        "TELEGRAM_UNAVAILABLE",
        "Telegram alerts aren't available right now.",
      );
    return json(200, await startTelegramLink(getDb(), user.userId, bot));
  },
});
