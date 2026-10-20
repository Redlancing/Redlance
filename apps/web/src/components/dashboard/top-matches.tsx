import Link from "next/link";
import { ScoreChip } from "@/components/app/score-chip";
import { budgetText, timeAgo, type Budget } from "@/lib/format";

export type TopMatch = {
  matchId: string;
  score: number;
  title: string;
  community: string;
  postedAt: string;
  budget: Budget | null;
};

export function TopMatches({ matches }: { matches: TopMatch[] }) {
  return (
    <section aria-labelledby="matches-heading" className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2
          id="matches-heading"
          className="text-base font-semibold text-foreground"
        >
          Newest strong matches
        </h2>
        {/* Never prefetched: the feed layout reads the list on every render. */}
        <Link
          href="/feed"
          prefetch={false}
          className="text-sm text-stone hover:text-foreground"
        >
          See all matches
        </Link>
      </div>
      {matches.length === 0 ? (
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          New gigs that fit your skills appear here, usually within a few
          minutes of being posted.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border border-y border-border">
          {matches.map((m) => {
            const budget = budgetText(m.budget);
            const meta = [
              `r/${m.community.replace(/^\/?r\//i, "")}`,
              timeAgo(m.postedAt),
              budget,
            ].filter(Boolean);
            return (
              <li key={m.matchId}>
                <Link
                  href={`/feed/${m.matchId}`}
                  prefetch={false}
                  className="flex items-center gap-3 py-3 hover:bg-bone/60"
                >
                  <ScoreChip score={m.score} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-foreground">
                      {m.title}
                    </span>
                    <span className="block truncate text-[13px] text-stone tabular-nums">
                      {meta.join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
