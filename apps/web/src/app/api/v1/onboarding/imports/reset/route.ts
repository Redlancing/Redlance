import { IMPORT_KINDS } from "@redlance/db";
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { resetForReimport } from "@/server/onboarding/imports";

export const POST = apiRoute({
  // The kinds whose import was accepted. Projects & experience is cleared only for a
  // resume; without kinds only Basics and Skills are.
  input: z.object({
    kinds: z.array(z.enum(IMPORT_KINDS)).max(IMPORT_KINDS.length).default([]),
  }),
  handler: async ({ user, input }) => {
    await resetForReimport(user.userId, input.kinds);
    return new Response(null, { status: 204 });
  },
});
