import { REPLY_KINDS, REPLY_STATUSES, SENT_TEXT_MAX } from "@redlance/core";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { listReplies, markSent } from "@/server/replies";

export const POST = apiRoute({
  input: z.object({
    draftId: z.uuid(),
    kind: z.enum(REPLY_KINDS),
    sentText: z.string().min(1).max(SENT_TEXT_MAX),
  }),
  handler: async ({ user, input }) => {
    const { reply, created } = await markSent(user, input);
    return json(created ? 201 : 200, reply);
  },
});

export const GET = apiRoute({
  input: z.object({
    status: z.enum(REPLY_STATUSES).optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  handler: async ({ user, input }) => json(200, await listReplies(user, input)),
});
