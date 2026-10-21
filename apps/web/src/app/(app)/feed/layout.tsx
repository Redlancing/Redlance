import { profiles } from "@redlance/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingCta } from "@/components/app/onboarding-cta";
import { FeedList } from "@/components/feed/feed-list";
import { FeedShell } from "@/components/feed/feed-shell";
import { getCurrentUser } from "@/server/current-user";
import { getDb } from "@/server/db";
import { loadInitialFeed } from "@/server/feed-initial";
import { getOnboardingState } from "@/server/onboarding/service";

export const metadata: Metadata = { title: "Matches" };

// Shared by /feed and /feed/<matchId>, so the list (and its scroll and filters) stays put while
// matches open on the right.
export default async function FeedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/feed");
  const [profile] = await getDb()
    .select({
      categories: profiles.categories,
      onboardedAt: profiles.onboardedAt,
    })
    .from(profiles)
    .where(eq(profiles.userId, user.userId));
  if (!profile?.onboardedAt) {
    const state = await getOnboardingState(user.userId);
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Matches
        </h1>
        <OnboardingCta state={state} className="mt-8" />
      </div>
    );
  }
  // The first page is read here, with the same code as GET /api/v1/feed, so the list paints
  // with the page. The layout is shared, so this is only the first mount's data; FeedList checks
  // that its filters still match. Skipped when the browser already has this layout (a prefetch
  // of a match page from the list): see loadInitialFeed.
  const initial = await loadInitialFeed({
    userId: user.userId,
    categories: profile.categories,
    headers: await headers(),
  });
  return (
    <FeedShell
      list={<FeedList categories={profile.categories} initial={initial} />}
    >
      {children}
    </FeedShell>
  );
}
