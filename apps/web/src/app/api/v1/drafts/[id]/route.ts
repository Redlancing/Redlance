import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { getDraft } from "@/server/drafts";
import { json } from "@/server/http";

export const GET = apiRoute({
  params: z.object({ id: z.uuid() }),
  handler: async ({ user, params }) =>
    json(200, await getDraft(user, params.id)),
});
