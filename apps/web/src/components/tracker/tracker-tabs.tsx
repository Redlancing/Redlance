import Link from "next/link";
import { cn } from "cn";
import { FILTERS, filterHref, type StatusFilter } from "./tracker-state";

export function TrackerTabs({ active }: { active: StatusFilter }) {
  return (
    <nav aria-label="Filter by status" className="-mx-1 mt-6 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {FILTERS.map(({ value, label }) => {
          const current = value === active;
          return (
            <li key={value}>
              <Link
                href={filterHref(value)}
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
