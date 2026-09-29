import { pageIndex } from "@redlance/core";
import { ArrowRight, Inbox, Send, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/server/current-user";
import { getOnboardingState } from "@/server/onboarding/service";
import { trialDaysLeft } from "@/server/onboarding/trial";

export const metadata: Metadata = { title: "Dashboard" };

const stats = [
  { label: "New matches", icon: Inbox, hint: "Gigs that fit your skills" },
  { label: "Replies sent", icon: Send, hint: "Comments and first DMs" },
  { label: "Gigs won", icon: Trophy, hint: "Marked as won in the tracker" },
];

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");
  const state = await getOnboardingState(user.userId);
  const onboarded = state.onboardedAt !== null;
  const daysLeft = state.trialEndsAt ? trialDaysLeft(state.trialEndsAt) : 0;
  const started = state.steps.length > 0;

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
          {daysLeft > 0 ? `Your trial: ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.` : "Your trial has ended."}
        </p>
      )}

      {!onboarded && (
      <section
          aria-labelledby="setup-heading"
          className="mt-8 overflow-hidden rounded-2xl border border-flare-100 bg-flare-50"
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
              className={buttonVariants({ size: "lg" }) + " shrink-0 self-start sm:self-auto"}
            >
              {started ? `Continue setup · step ${pageIndex(state.resumeAt) + 1} of 5` : "Start setup"}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}

      <section
        aria-label="Your numbers"
        className="mt-6 grid gap-4 sm:grid-cols-3"
      >
        {stats.map(({ label, icon: Icon, hint }) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-background p-5"
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              0
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
        ))}
      </section>

      <section
        aria-labelledby="matches-heading"
        className="mt-6 rounded-2xl border border-dashed border-feed bg-bone/60 px-6 py-12 text-center"
      >
        <Inbox className="mx-auto size-6 text-stone" aria-hidden="true" />
        <h2
          id="matches-heading"
          className="mt-3 text-base font-semibold text-foreground"
        >
          No matches yet
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Once your profile is set up, new hiring posts that fit your skills
          show up here within minutes, each with a score and the reason it
          matched.
        </p>
      </section>
    </div>
  );
}
