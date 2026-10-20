import { feedItem } from "@redlance/db";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { getDb } from "@/server/db";
import { ApiError } from "@/server/errors";
import { toFeedItemDetailResponse } from "@/server/feed";
import { json } from "@/server/http";

// One match with the post's text, for the match page. Dismissed and withdrawn matches still
// open (alert links point here); `withdrawn` tells the page not to offer a draft.
export const GET = apiRoute({
  params: z.object({ matchId: z.uuid() }),
  handler: async ({ user, params }) => {
    const item = await feedItem(getDb(), user.userId, params.matchId);
    if (!item) throw new ApiError("NOT_FOUND", "Match not found.");
    return json(200, toFeedItemDetailResponse(item));
  },
});
