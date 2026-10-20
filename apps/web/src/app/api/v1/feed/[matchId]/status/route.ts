import { MATCH_STATUSES } from "@redlance/core";
import { markMatchSeen, setMatchStatus } from "@redlance/db";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { getDb } from "@/server/db";
import { ApiError } from "@/server/errors";
import { json } from "@/server/http";

export const POST = apiRoute({
  params: z.object({ matchId: z.uuid() }),
  // "new" is the starting state, not something a user sets.
  input: z
    .object({
      status: z.enum(
        MATCH_STATUSES.filter((s) => s !== "new") as [
          Exclude<(typeof MATCH_STATUSES)[number], "new">,
          ...Exclude<(typeof MATCH_STATUSES)[number], "new">[],
        ],
      ),
      // Opening a match: "seen" only if it is still "new" (a cached page can say "new" for a
      // match saved or replied to since). The response carries the status it ends up with.
      onlyIfNew: z.boolean().optional(),
    })
    .refine((i) => !i.onlyIfNew || i.status === "seen", {
      message: "onlyIfNew works only with status seen.",
      path: ["onlyIfNew"],
    }),
  handler: async ({ user, input, params }) => {
    const result = input.onlyIfNew
      ? await markMatchSeen(getDb(), user.userId, params.matchId)
      : await setMatchStatus(
          getDb(),
          user.userId,
          params.matchId,
          input.status,
        );
    if (!result) throw new ApiError("NOT_FOUND", "Match not found.");
    return json(200, { status: result.status });
  },
});
