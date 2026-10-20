import { z } from "zod";
import { PROFILE_SECTIONS } from "@/lib/profile-edit";
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { saveProfileSection } from "@/server/profile/service";

/** Saves one section. A save that changes something is one of the 5 changes a week. */
export const PUT = apiRoute({
  params: z.object({ section: z.enum(PROFILE_SECTIONS) }),
  input: z.object({
    data: z.unknown(),
    expectedVersion: z.number().int().min(1).max(1_000_000_000),
  }),
  handler: async ({ user, params, input }) =>
    json(200, await saveProfileSection(user.userId, params.section, input)),
});
