import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { getAlertSettings, updateAlertSettings } from "@/server/alerts";
import { getDb } from "@/server/db";
import { json } from "@/server/http";

export const GET = apiRoute({
  rateLimit: { bucket: "alerts-settings" },
  handler: async ({ user }) =>
    json(200, await getAlertSettings(getDb(), user.userId)),
});

export const PATCH = apiRoute({
  input: z
    .object({
      minScore: z.number().int().min(0).max(100).optional(),
      dailyCap: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  rateLimit: { bucket: "alerts-settings" },
  handler: async ({ user, input }) =>
    json(200, await updateAlertSettings(getDb(), user.userId, input)),
});
