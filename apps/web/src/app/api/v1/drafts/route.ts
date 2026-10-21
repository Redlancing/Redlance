import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { listVersions, startDraft } from "@/server/drafts";
import { json } from "@/server/http";
import { sentKindsForMatch } from "@/server/replies";

export const POST = apiRoute({
  input: z.object({ matchId: z.uuid(), idempotencyKey: z.uuid() }),
  handler: async ({ user, input }) => {
    const r = await startDraft(user, input);
    return json(r.created ? 202 : 200, {
      draftId: r.draftId,
      status: r.status,
      slowDown: r.slowDown,
    });
  },
});

export const GET = apiRoute({
  input: z.object({ matchId: z.uuid() }),
  // `sentKinds` rides along so a cached match page can check both in one call.
  handler: async ({ user, input }) => {
    const [versions, sentKinds] = await Promise.all([
      listVersions(user, input.matchId),
      sentKindsForMatch(user, input.matchId),
    ]);
    return json(200, { versions, sentKinds });
  },
});
