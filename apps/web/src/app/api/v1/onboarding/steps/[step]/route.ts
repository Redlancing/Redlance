import { STEP_IDS } from "@redlance/core";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { saveStep } from "@/server/onboarding/service";

export const PUT = apiRoute({
  params: z.object({ step: z.enum(STEP_IDS) }),
  input: z.object({
    mode: z.enum(["draft", "complete"]),
    data: z.unknown(),
    expectedVersion: z.number().int().min(0).max(1_000_000),
  }),
  handler: async ({ user, params, input }) =>
    json(200, await saveStep(user.userId, params.step, input)),
});
