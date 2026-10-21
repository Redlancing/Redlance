import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { ApiError } from "@/server/errors";
import { json } from "@/server/http";
import { insightsViewer, subredditInsights } from "@/server/insights";

// All eleven insights for one subreddit plus the user's 5 latest matches from it.
export const GET = apiRoute({
  params: z.object({
    subreddit: z
      .string()
      .transform((s) => s.toLowerCase())
      .pipe(z.string().regex(/^[a-z0-9_]{2,21}$/)),
  }),
  handler: async ({ user, params }) => {
    const viewer = await insightsViewer(user.userId);
    const res = await subredditInsights(viewer, params.subreddit);
    if (!res) throw new ApiError("NOT_FOUND", "Subreddit not found.");
    return json(200, res);
  },
});
