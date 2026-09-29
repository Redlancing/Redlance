import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { getImport } from "@/server/onboarding/imports";

export const GET = apiRoute({
  params: z.object({ id: z.uuid() }),
  handler: async ({ user, params }) =>
    json(200, await getImport(user.userId, params.id)),
});
