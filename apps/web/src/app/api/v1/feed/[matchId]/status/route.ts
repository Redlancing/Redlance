import { MATCH_STATUSES } from "@redlance/core";
import { setMatchStatus } from "@redlance/db";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { getDb } from "@/server/db";
import { ApiError } from "@/server/errors";
import { json } from "@/server/http";

export const POST = apiRoute({
  params: z.object({ matchId: z.uuid() }),
  // "new" is the starting state, not something a user sets.
  input: z.object({
    status: z.enum(
      MATCH_STATUSES.filter((s) => s !== "new") as [
        Exclude<(typeof MATCH_STATUSES)[number], "new">,
        ...Exclude<(typeof MATCH_STATUSES)[number], "new">[],
      ],
    ),
  }),
  handler: async ({ user, input, params }) => {
    const result = await setMatchStatus(
      getDb(),
      user.userId,
      params.matchId,
      input.status,
    );
    if (!result) throw new ApiError("NOT_FOUND", "Match not found.");
    return json(200, { status: result.status });
  },
});
