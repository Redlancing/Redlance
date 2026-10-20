import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingCta } from "@/components/app/onboarding-cta";
import { TrackerList } from "@/components/tracker/tracker-list";
import { parseFilter } from "@/components/tracker/tracker-state";
import { TrackerTabs } from "@/components/tracker/tracker-tabs";
import { getCurrentUser } from "@/server/current-user";
import { getOnboardingState } from "@/server/onboarding/service";

export const metadata: Metadata = { title: "Tracker" };

export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/tracker");
  const state = await getOnboardingState(user.userId);
  const filter = parseFilter((await searchParams).status);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Tracker
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The replies you sent, and which ones turned into work.
      </p>
      {state.onboardedAt === null ? (
        <OnboardingCta state={state} className="mt-8" />
      ) : (
        <>
          <TrackerTabs active={filter} />
          <TrackerList key={filter} filter={filter} />
        </>
      )}
    </div>
  );
}
