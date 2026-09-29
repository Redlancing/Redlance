import {
  PAGE_IDS,
  PAGE_TITLES,
  canOpen,
  pageIndex,
  type PageId,
} from "@redlance/core";
import { cn } from "cn";
import Link from "next/link";

export function Progress({
  current,
  resumeAt,
}: {
  current: PageId;
  resumeAt: PageId;
}) {
  const index = pageIndex(current);
  return (
    <nav aria-label="Setup progress" className="mb-6">
      <p className="text-sm font-medium text-stone">
        Step {index + 1} of {PAGE_IDS.length}
        <span className="text-muted-foreground"> · {PAGE_TITLES[current]}</span>
      </p>
      <ol className="mt-3 flex gap-1.5">
        {PAGE_IDS.map((page, i) => {
          const bar = (
            <span
              aria-hidden="true"
              className={cn(
                "block h-1.5 rounded-full",
                i <= index ? "bg-ink" : "bg-feed",
              )}
            />
          );
          const label = (
            <span className="mt-2 hidden text-xs text-muted-foreground sm:block">
              {PAGE_TITLES[page]}
            </span>
          );
          return (
            <li key={page} className="flex-1">
              {page !== current && canOpen(page, resumeAt) ? (
                <Link
                  href={`/onboarding/${page}`}
                  className="block rounded py-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {bar}
                  {label}
                  <span className="sr-only sm:hidden">{PAGE_TITLES[page]}</span>
                </Link>
              ) : (
                <span
                  className="block py-2"
                  aria-current={page === current ? "step" : undefined}
                >
                  {bar}
                  {label}
                  <span className="sr-only sm:hidden">{PAGE_TITLES[page]}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
