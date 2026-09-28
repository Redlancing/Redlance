import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";
import { getOnboardingState } from "@/server/onboarding/service";

export const GET = apiRoute({
  handler: async ({ user }) => {
    const state = await getOnboardingState(user.userId);
    return json(200, {
      steps: state.steps.map(({ step, ...rest }) => ({ id: step, ...rest })),
      resumeAt: state.resumeAt,
      onboardedAt: state.onboardedAt,
    });
  },
});
