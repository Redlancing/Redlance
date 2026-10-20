import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingCta } from "@/components/app/onboarding-cta";
import { AccountSection } from "@/components/settings/account-section";
import { AlertSettingsPanel } from "@/components/settings/alert-settings";
import { getCurrentUser } from "@/server/current-user";
import { creditsSummary } from "@/server/drafts";
import { getOnboardingState } from "@/server/onboarding/service";

export const metadata: Metadata = { title: "Settings" };

function isPast(iso: string | null): boolean {
  return iso !== null && new Date(iso).getTime() <= Date.now();
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");
  const state = await getOnboardingState(user.userId);
  const credits =
    state.onboardedAt !== null ? await creditsSummary(user) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Settings
      </h1>

      {credits ? (
        <div className="mt-6">
          <AlertSettingsPanel />
          <AccountSection
            account={{
              email: user.email,
              ...credits,
              ended: isPast(credits.periodEnd),
            }}
          />
        </div>
      ) : (
        <OnboardingCta state={state} className="mt-8" />
      )}
    </div>
  );
}
