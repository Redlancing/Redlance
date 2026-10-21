import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OnboardingCta } from "@/components/app/onboarding-cta";
import { HoursChart } from "@/components/insights/hours-chart";
import {
  BudgetTable,
  FactLedger,
  LatestMatches,
  Quiet,
  Section,
  SkillList,
} from "@/components/insights/insight-sections";
import {
  BuildingNote,
  LockedPanel,
} from "@/components/insights/insights-states";
import { communityUrl } from "@/lib/format";
import {
  hiringFacts,
  nothingYet,
  parseSubredditParam,
  quietText,
  riskFacts,
  updatedText,
} from "@/lib/insights-view";
import { getCurrentUser } from "@/server/current-user";
import { subredditInsights } from "@/server/insights";
import { insightsAccess } from "@/server/insights-page";
import { getOnboardingState } from "@/server/onboarding/service";

type Params = { params: Promise<{ subreddit: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const name = parseSubredditParam((await params).subreddit);
  return { title: name ? `r/${name} insights` : "Insights" };
}

function BackLink() {
  return (
    <Link
      href="/insights"
      prefetch={false}
      className="inline-flex items-center gap-1 text-[13px] text-stone hover:text-foreground"
    >
      <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
      Insights
    </Link>
  );
}

export default async function SubredditInsightsPage({ params }: Params) {
  const raw = (await params).subreddit;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/insights/${encodeURIComponent(raw)}`);
  const name = parseSubredditParam(raw);
  if (!name) notFound();
  const gate = await insightsAccess(user.userId);

  if (gate.access !== "ok") {
    return (
      <div className="mx-auto max-w-5xl">
        <BackLink />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          r/{name}
        </h1>
        {gate.access === "locked" ? (
          <LockedPanel className="mt-8" />
        ) : (
          <OnboardingCta
            state={await getOnboardingState(user.userId)}
            className="mt-8"
          />
        )}
      </div>
    );
  }

  const r = await subredditInsights(gate.viewer, name);
  if (!r) notFound();
  const showDisplay = r.displayName.toLowerCase() !== r.subreddit;

  return (
    <div className="mx-auto max-w-5xl">
      <BackLink />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words text-foreground sm:text-3xl">
            r/{r.subreddit}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[showDisplay ? r.displayName : null, updatedText(r.computedAt)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <a
          href={communityUrl(r.subreddit)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-bone focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Open r/{r.subreddit}
          <ExternalLink
            className="size-4"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>

      {nothingYet(r) && (
        <BuildingNote>
          Still collecting posts for r/{r.subreddit}. Each number shows once it
          has 20 data points from the last 28 days.
        </BuildingNote>
      )}

      <div className="grid gap-x-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <Section
            id="month-heading"
            title="This month"
            note="Hiring posts from the last 28 days."
            className="mt-8"
          >
            <FactLedger facts={hiringFacts(r)} />
          </Section>

          <Section id="hours-heading" title="When posts arrive">
            {r.hours.status === "ok" ? (
              <div className="mt-3">
                <HoursChart
                  hours={r.hours.hours}
                  busiestStartHour={r.hours.busiestStartHour}
                  pattern={r.hours.pattern}
                  timeZone={r.hours.timeZone}
                />
              </div>
            ) : (
              <Quiet text={quietText(r.hours)!} />
            )}
          </Section>

          <Section
            id="budgets-heading"
            title="Posted budgets"
            note="What clients posted, in their own currency. “Usually” is the middle half."
          >
            {r.budgets.status === "ok" ? (
              <BudgetTable groups={r.budgets.groups} />
            ) : (
              <Quiet text={quietText(r.budgets)!} />
            )}
          </Section>
        </div>

        <div>
          <Section
            id="risk-heading"
            title="Risk and competition"
            className="lg:mt-8"
          >
            <FactLedger facts={riskFacts(r)} />
          </Section>

          <Section id="skills-heading" title="Most-asked skills">
            {r.skills.status === "ok" ? (
              <SkillList skills={r.skills.skills} />
            ) : (
              <Quiet text={quietText(r.skills)!} />
            )}
          </Section>

          <Section id="matches-heading" title="Your latest matches here">
            <LatestMatches matches={r.latestMatches} subreddit={r.subreddit} />
          </Section>
        </div>
      </div>
    </div>
  );
}
