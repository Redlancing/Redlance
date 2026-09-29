import { PAGE_TITLES, canOpen, isPageId } from "@redlance/core";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BasicsStep } from "@/components/onboarding/basics-step";
import { ImportStep } from "@/components/onboarding/import-step";
import { Progress } from "@/components/onboarding/progress";
import { RatesStep } from "@/components/onboarding/rates-step";
import { SkillsStep } from "@/components/onboarding/skills-step";
import { ReviewStep } from "@/components/onboarding/review-step";
import {
  loadOnboardingPage,
  reviewData,
  savedDraft,
  stepInit,
} from "@/server/onboarding/page-data";

export async function generateMetadata(
  props: PageProps<"/onboarding/[step]">,
): Promise<Metadata> {
  const { step } = await props.params;
  return {
    title: isPageId(step)
      ? `${PAGE_TITLES[step]} · Set up your profile`
      : "Set up your profile",
  };
}

export default async function OnboardingStepPage(
  props: PageProps<"/onboarding/[step]">,
) {
  const { step } = await props.params;
  if (!isPageId(step)) notFound();
  const { user, state } = await loadOnboardingPage(`/onboarding/${step}`);
  if (!canOpen(step, state.resumeAt)) redirect(`/onboarding/${state.resumeAt}`);

  const review = step === "review" ? reviewData(state) : null;
  if (review && !review.ok) redirect(`/onboarding/${review.step}`);
  // Keyed by the saved version: when a refresh brings a newer save, the form remounts from it.
  const formKey = `${step}:${state.steps.find((r) => r.step === step)?.version ?? 0}`;

  return (
    <div className="w-full max-w-2xl">
      <Progress current={step} resumeAt={state.resumeAt} />
      <div className="rounded-2xl border border-border bg-background p-5 shadow-xs sm:p-8">
        {step === "import" && (
          <ImportStep
            key={formKey}
            init={stepInit(state, user.userId, "import")}
          />
        )}
        {step === "basics" && (
          <BasicsStep
            key={formKey}
            init={stepInit(state, user.userId, "basics")}
          />
        )}
        {step === "skills" && (
          <SkillsStep
            key={formKey}
            init={stepInit(state, user.userId, "skills")}
            jobTypes={savedDraft(state, "basics")?.categories ?? []}
          />
        )}
        {step === "rates" && (
          <RatesStep
            key={formKey}
            init={stepInit(state, user.userId, "rates")}
          />
        )}
        {review?.ok && <ReviewStep data={review.data} email={user.email} />}
      </div>
    </div>
  );
}
