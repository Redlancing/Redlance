import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { startGithubImport } from "@/server/onboarding/imports";

export const POST = apiRoute({
  input: z.object({ username: z.string().max(300) }),
  handler: async ({ user, input }) =>
    json(202, await startGithubImport(user.userId, input.username)),
});
