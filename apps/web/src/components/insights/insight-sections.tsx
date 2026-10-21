import type { BudgetGroup, InsightMatch, SkillShare } from "@redlance/core";
import Link from "next/link";
import { ScoreChip } from "@/components/app/score-chip";
import { timeAgo } from "@/lib/format";
import {
  budgetGroupLabel,
  budgetMiddle,
  budgetRange,
  type Fact,
} from "@/lib/insights-view";
import { cn } from "@/lib/utils";

// The detail page's sections. Every insight is "number first, then one plain sentence";
// an insight without enough data shows its quiet line in the number's place.

export function Section({
  id,
  title,
  note,
  children,
  className,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("mt-10", className)}>
      <h2 id={id} className="text-base font-semibold text-foreground">
        {title}
      </h2>
      {note && <p className="mt-0.5 text-[13px] text-stone">{note}</p>}
      {children}
    </section>
  );
}

export function Quiet({ text }: { text: string }) {
  return <p className="mt-3 text-[13px] text-muted-foreground">{text}</p>;
}

/** A column of facts: label left, number and sentence right; rows split by hairlines. */
export function FactLedger({ facts }: { facts: Fact[] }) {
  return (
    <dl className="mt-3 divide-y divide-border border-y border-border">
      {facts.map((f) => (
        <div
          key={f.key}
          className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-4 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]"
        >
          <dt className="text-[13px] text-stone">{f.label}</dt>
          <dd className="min-w-0">
            {"quiet" in f ? (
              <span className="text-[13px] text-muted-foreground">
                {f.quiet}
              </span>
            ) : (
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    f.tone === "danger" ? "text-danger" : "text-foreground",
                  )}
                >
                  {f.value}
                </span>
                <span className="text-[13px] text-stone">{f.sentence}</span>
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Posted budgets per currency and unit, never converted. "Usually" is the middle half. */
export function BudgetTable({ groups }: { groups: BudgetGroup[] }) {
  return (
    <table className="mt-3 w-full text-left text-sm tabular-nums">
      <thead>
        <tr className="border-b border-border text-xs text-stone">
          <th scope="col" className="pb-2 font-medium">
            Currency
          </th>
          <th scope="col" className="pb-2 text-right font-medium">
            Usually
          </th>
          <th scope="col" className="pb-2 text-right font-medium">
            Middle
          </th>
          <th scope="col" className="pb-2 text-right font-medium">
            Posts
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border border-b border-border">
        {groups.map((g) => (
          <tr key={`${g.currency}-${g.unit}`}>
            <th scope="row" className="py-2.5 font-normal text-stone">
              {budgetGroupLabel(g)}
            </th>
            <td className="py-2.5 text-right text-base font-semibold text-foreground">
              {budgetRange(g)}
            </td>
            <td className="py-2.5 text-right text-foreground">
              {budgetMiddle(g)}
            </td>
            <td className="py-2.5 text-right text-stone">{g.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Most-asked skills with a thin share bar (one hue; the number carries the value). */
export function SkillList({ skills }: { skills: SkillShare[] }) {
  if (skills.length === 0)
    return (
      <Quiet text="No skill was asked for in 3 or more hiring posts yet." />
    );
  return (
    <ul className="mt-3 divide-y divide-border border-y border-border">
      {skills.map((s) => (
        <li
          key={s.skillId}
          className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-4 py-2"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm text-foreground">
              {s.name}
            </span>
            <span
              aria-hidden="true"
              className="mt-1.5 block h-1 rounded-full bg-bone"
            >
              <span
                className="block h-full rounded-full bg-feed"
                style={{ width: `${s.percent}%` }}
              />
            </span>
          </span>
          <span className="text-right text-sm font-medium text-foreground tabular-nums">
            {s.percent}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LatestMatches({
  matches,
  subreddit,
}: {
  matches: InsightMatch[];
  subreddit: string;
}) {
  if (matches.length === 0)
    return (
      <p className="mt-3 text-[13px] text-stone">
        No matches from r/{subreddit} yet. Gigs that fit you appear in Matches
        as they are posted.
      </p>
    );
  return (
    <ul className="mt-3 divide-y divide-border border-y border-border">
      {matches.map((m) => (
        <li key={m.matchId}>
          {/* The match page loads a post, a draft and credits: no viewport prefetch. */}
          <Link
            href={`/feed/${m.matchId}`}
            prefetch={false}
            className="flex items-center gap-3 py-2.5 outline-none hover:bg-bone/50 focus-visible:bg-bone focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <ScoreChip score={m.score} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {m.title}
            </span>
            <span className="shrink-0 text-[13px] text-stone tabular-nums">
              {timeAgo(m.postedAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
