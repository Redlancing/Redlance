import { redirect } from "next/navigation";
import { loadOnboardingPage } from "@/server/onboarding/page-data";

export default async function OnboardingIndexPage() {
  const { state } = await loadOnboardingPage("/onboarding");
  redirect(`/onboarding/${state.resumeAt}`);
}
