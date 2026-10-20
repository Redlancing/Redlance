import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { insightsViewer, listInsights } from "@/server/insights";

// The subreddit insights list: "yours" (subreddits that gave this user a match lately) or
// "all" (every active catalogue subreddit). Numbers under 20 data points are never sent.
export const GET = apiRoute({
  input: z.object({ tab: z.enum(["yours", "all"]).default("yours") }),
  handler: async ({ user, input }) => {
    const viewer = await insightsViewer(user.userId);
    return json(200, await listInsights(viewer, input.tab));
  },
});
