import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { finishOnboarding } from "@/server/onboarding/service";

export const POST = apiRoute({
  handler: async ({ user }) => json(200, await finishOnboarding(user.userId)),
});
