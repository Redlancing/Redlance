import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { saveFeedback } from "@/server/drafts";
import { json } from "@/server/http";

export const POST = apiRoute({
  params: z.object({ id: z.uuid() }),
  input: z.object({ reason: z.string().trim().max(300).optional() }),
  handler: async ({ user, input, params }) => {
    await saveFeedback(user, params.id, input.reason || null);
    return json(201, { ok: true });
  },
});
