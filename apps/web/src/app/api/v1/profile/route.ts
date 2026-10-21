import { apiRoute } from "@/server/api-route";
import { ApiError } from "@/server/errors";
import { json } from "@/server/http";
import { getProfileForEdit } from "@/server/profile/service";

/** The finished profile by section, its version and this week's edit allowance. */
export const GET = apiRoute({
  handler: async ({ user }) => {
    const state = await getProfileForEdit(user.userId);
    if (!state) throw new ApiError("NOT_FOUND", "Set up your profile first.");
    return json(200, state);
  },
});
