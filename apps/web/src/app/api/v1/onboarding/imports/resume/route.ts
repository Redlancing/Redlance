import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { startResumeImport } from "@/server/onboarding/imports";

export const POST = apiRoute({
  handler: async ({ user, request }) =>
    json(202, await startResumeImport(user.userId, request)),
});
