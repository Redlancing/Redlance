import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingCta } from "@/components/app/onboarding-cta";
import { BrowseList } from "@/components/insights/browse-list";
import { InsightList } from "@/components/insights/insight-list";
import { InsightsTabs } from "@/components/insights/insights-tabs";
import {
  BuildingNote,
  EmptyAll,
  EmptyYours,
  LockedPanel,
} from "@/components/insights/insights-states";
import { listBuilding, listState, parseTab } from "@/lib/insights-view";
import { getCurrentUser } from "@/server/current-user";
import { listInsights } from "@/server/insights";
import { insightsAccess } from "@/server/insights-page";
import { getOnboardingState } from "@/server/onboarding/service";

export const metadata: Metadata = { title: "Insights" };

// Subreddit insights (docs/insights/design.md). The first view is read on the server, through
// the same functions as GET /api/v1/insights, so numbers under the threshold never get here.
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/insights");
  const tab = parseTab((await searchParams).tab);
  const gate = await insightsAccess(user.userId);
  const list =
    gate.access === "ok" ? await listInsights(gate.viewer, tab) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Insights
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How each subreddit hires, from the last 28 days of posts.
      </p>
      {gate.access === "not_onboarded" ? (
        <OnboardingCta
          state={await getOnboardingState(user.userId)}
          className="mt-8"
        />
      ) : gate.access === "locked" ? (
        <LockedPanel className="mt-8" />
      ) : (
        list && (
          <>
            <InsightsTabs active={tab} />
            <InsightsBody tab={list.tab} rows={list.rows} />
          </>
        )
      )}
    </div>
  );
}

function InsightsBody({ tab, rows }: Awaited<ReturnType<typeof listInsights>>) {
  const state = listState(tab, rows);
  if (state === "empty-yours") return <EmptyYours />;
  if (state === "empty-all") return <EmptyAll />;
  return (
    <>
      {listBuilding(rows) && (
        <BuildingNote>
          Still collecting posts. A subreddit&apos;s numbers show once it has 20
          hiring posts in the last 28 days; until then its row shows a dash.
        </BuildingNote>
      )}
      {tab === "yours" ? (
        <>
          <p className="mt-4 text-[13px] text-stone">
            Subreddits that sent you a match in the last 30 days, most matches
            first.
          </p>
          <InsightList rows={rows} personal />
        </>
      ) : (
        <BrowseList rows={rows} />
      )}
    </>
  );
}
