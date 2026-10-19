import { apiRoute } from "@/server/api-route";
import { creditsSummary } from "@/server/drafts";
import { json } from "@/server/http";

export const GET = apiRoute({
  handler: async ({ user }) => json(200, await creditsSummary(user)),
});
