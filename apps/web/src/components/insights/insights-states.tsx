import { ArrowRight, Hourglass, Lock } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { tabHref } from "@/lib/insights-view";

// The non-list states of the insights pages. No numbers are drawn behind the locked state
// (no blurred preview): the server never sent any.

export function LockedPanel({ className }: { className?: string }) {
  return (
    <section
      aria-labelledby="locked-heading"
      className={`rounded-[10px] border border-border ${className ?? ""}`}
    >
      <div className="flex gap-3 p-5 sm:p-6">
        <Lock
          className="mt-0.5 size-4 shrink-0 text-stone"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div>
          <h2
            id="locked-heading"
            className="text-base font-semibold text-foreground"
          >
            Your trial has ended
          </h2>
          <p className="mt-1 max-w-lg text-sm text-stone">
            Subreddit insights come with a paid plan: hiring posts a week,
            posted budgets, the busiest hours and red-flag rates for each
            subreddit you get matches from.
          </p>
          <Link
            href="/settings"
            className={buttonVariants({ variant: "outline" }) + " mt-4"}
          >
            See your plan in Settings
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/** First days of data: nothing has reached 20 data points yet. */
export function BuildingNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 flex gap-2 rounded-md bg-bone px-3 py-2.5 text-[13px] text-stone">
      <Hourglass
        className="mt-px size-4 shrink-0"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span>{children}</span>
    </p>
  );
}

export function EmptyYours() {
  return (
    <div className="mt-6 max-w-lg">
      <p className="text-sm text-foreground">
        No subreddit sent you a match in the last 30 days.
      </p>
      <p className="mt-1 text-sm text-stone">
        Your subreddits show up here once Redlance finds gigs for you in them.
        Until then, see how every subreddit we watch is hiring.
      </p>
      <Link
        href={tabHref("all")}
        prefetch={false}
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
      >
        Browse all subreddits
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function EmptyAll() {
  return (
    <p className="mt-6 max-w-lg text-sm text-stone">
      No subreddit numbers yet. They are worked out every hour from new posts,
      so check back soon.
    </p>
  );
}
