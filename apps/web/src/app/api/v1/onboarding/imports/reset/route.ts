import { apiRoute } from "@/server/api-route";
import { resetForReimport } from "@/server/onboarding/imports";

export const POST = apiRoute({
  handler: async ({ user }) => {
    await resetForReimport(user.userId);
    return new Response(null, { status: 204 });
  },
});
