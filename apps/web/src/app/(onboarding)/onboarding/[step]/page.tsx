import { PAGE_TITLES, canOpen, isPageId } from "@redlance/core";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Progress } from "@/components/onboarding/progress";
import { loadOnboardingPage } from "@/server/onboarding/page-data";

export async function generateMetadata(props: PageProps<"/onboarding/[step]">): Promise<Metadata> {
  const { step } = await props.params;
  return { title: isPageId(step) ? `${PAGE_TITLES[step]} · Set up your profile` : "Set up your profile" };
}

export default async function OnboardingStepPage(props: PageProps<"/onboarding/[step]">) {
  const { step } = await props.params;
  if (!isPageId(step)) notFound();
  const { user, state } = await loadOnboardingPage(`/onboarding/${step}`);
  if (!canOpen(step, state.resumeAt)) redirect(`/onboarding/${state.resumeAt}`);

  return (
    <div className="w-full max-w-2xl">
      <Progress current={step} resumeAt={state.resumeAt} />
      <div className="rounded-2xl border border-border bg-background p-5 shadow-xs sm:p-8">
        {/* Task 10–12 replace this with the step forms. */}
        <p className="text-sm text-muted-foreground">{PAGE_TITLES[step]} for {user.email}</p>
      </div>
    </div>
  );
}
