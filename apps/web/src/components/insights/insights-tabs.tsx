import Link from "next/link";
import { tabHref, type InsightsTab } from "@/lib/insights-view";
import { cn } from "@/lib/utils";

const TABS: { value: InsightsTab; label: string }[] = [
  { value: "yours", label: "Yours" },
  { value: "all", label: "Browse all" },
];

export function InsightsTabs({ active }: { active: InsightsTab }) {
  return (
    <nav aria-label="Which subreddits" className="mt-6">
      <ul className="flex gap-1 border-b border-border">
        {TABS.map(({ value, label }) => {
          const current = value === active;
          return (
            <li key={value}>
              {/* Same page, other tab: no prefetch (it would only fetch the loading state). */}
              <Link
                href={tabHref(value)}
                prefetch={false}
                scroll={false}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-9 items-center border-b-2 px-2.5 text-sm transition-colors duration-120 outline-none focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50",
                  current
                    ? "border-ink font-medium text-foreground"
                    : "border-transparent text-stone hover:text-foreground",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
