import { PAGE_IDS, pageIndex } from "@redlance/core";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { OnboardingState } from "@/server/onboarding/service";

/** Shown in place of a page until onboarding is finished. */
export function OnboardingCta({
  state,
  className,
}: {
  state: Pick<OnboardingState, "steps" | "resumeAt">;
  className?: string;
}) {
  const started = state.steps.length > 0;
  return (
    <section
      aria-labelledby="setup-heading"
      className={`overflow-hidden rounded-2xl border border-flare-100 bg-flare-50 ${className ?? ""}`}
    >
      <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            id="setup-heading"
            className="text-base font-semibold text-foreground"
          >
            Set up your profile
          </h2>
          <p className="mt-1 max-w-xl text-sm text-stone">
            Add your job types and skills so Redlance can match gigs to you.
            Your 5-day trial starts when you finish.
          </p>
        </div>
        <Link
          href="/onboarding"
          className={
            buttonVariants({ size: "lg" }) + " shrink-0 self-start sm:self-auto"
          }
        >
          {started
            ? `Continue setup · step ${pageIndex(state.resumeAt) + 1} of ${PAGE_IDS.length}`
            : "Start setup"}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
