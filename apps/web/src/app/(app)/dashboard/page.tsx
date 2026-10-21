import { dashboardStats, feedPage } from "@redlance/db";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingCta } from "@/components/app/onboarding-cta";
import {
  checklistComplete,
  creditsLine,
  setupChecklist,
} from "@/components/dashboard/overview";
import { NumbersStrip } from "@/components/dashboard/numbers-strip";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { TopMatches } from "@/components/dashboard/top-matches";
import { getCurrentUser } from "@/server/current-user";
import { getDb } from "@/server/db";
import { creditsSummary } from "@/server/drafts";
import { getOnboardingState } from "@/server/onboarding/service";
import { trialDaysLeft } from "@/server/onboarding/trial";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");
  const state = await getOnboardingState(user.userId);
  const onboarded = state.onboardedAt !== null;
  const daysLeft = state.trialEndsAt ? trialDaysLeft(state.trialEndsAt) : 0;

  const db = getDb();
  const [stats, best, creditData] = onboarded
    ? await Promise.all([
        dashboardStats(db, user.userId),
        feedPage(db, user.userId, { view: "best", limit: 5 }),
        creditsSummary(user),
      ])
    : [
        {
          newToday: 0,
          sentThisWeek: 0,
          sentEver: 0,
          won: 0,
          telegramOn: false,
        },
        { items: [] },
        null,
      ];
  const checklist = setupChecklist({
    onboarded,
    telegramOn: stats.telegramOn,
    sentEver: stats.sentEver,
  });
  const matches = best.items.map((i) => ({
    matchId: i.matchId,
    score: i.score,
    title: i.post.title,
    community: i.post.community,
    postedAt: i.post.postedAt.toISOString(),
    budget: i.post.budget,
  }));
  const credits = creditData ? creditsLine(creditData) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        Welcome to Redlance
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Signed in as {user.email}
      </p>
      {onboarded && (
        <p className="mt-1 text-sm text-muted-foreground">
          {daysLeft > 0
            ? `Your trial: ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.`
            : "Your trial has ended."}
        </p>
      )}

      {!onboarded && <OnboardingCta state={state} className="mt-8" />}

      {onboarded && (
        <>
          <NumbersStrip
            newToday={stats.newToday}
            sentThisWeek={stats.sentThisWeek}
            won={stats.won}
          />
          {!checklistComplete(checklist) && (
            <SetupChecklist items={checklist} />
          )}
          <TopMatches matches={matches} />
          {credits && (
            <p className="mt-6 text-sm text-stone tabular-nums">
              <Link href="/settings" className="hover:text-foreground">
                {credits}
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
