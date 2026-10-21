"use client";

import { CATEGORIES } from "@redlance/core";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeedFilters as Filters } from "./feed-state";

const NAMES = new Map<string, string>(CATEGORIES.map((c) => [c.id, c.name]));

const toggle =
  "inline-flex h-7 items-center rounded-md border px-2.5 text-[13px] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function FeedFilters({
  filters,
  categories,
  refreshing,
  onChange,
  onRefresh,
}: {
  filters: Filters;
  /** The profile's job types; the type filter only shows when there are two or more. */
  categories: string[];
  refreshing: boolean;
  onChange: (next: Filters) => void;
  onRefresh: () => void;
}) {
  const setType = (id: string) => {
    const on = filters.types.includes(id);
    const types = on
      ? filters.types.filter((t) => t !== id)
      : [...filters.types, id].slice(-3);
    onChange({ ...filters, types });
  };
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Which matches"
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {(
            [
              ["best", "Best"],
              ["all", "All"],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              type="button"
              role="radio"
              aria-checked={filters.view === view}
              onClick={() => onChange({ ...filters, view })}
              className={cn(
                "h-6 rounded-[5px] px-2.5 text-[13px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                filters.view === view
                  ? "bg-ink text-bone"
                  : "text-stone hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={filters.paidOnly}
          onClick={() => onChange({ ...filters, paidOnly: !filters.paidOnly })}
          className={cn(
            toggle,
            filters.paidOnly
              ? "border-ink bg-ink text-bone"
              : "border-border text-stone hover:text-foreground",
          )}
        >
          Paid only
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Check for new matches"
          title="Check for new matches"
          className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-stone hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        >
          <RotateCw
            className={cn(
              "size-4",
              refreshing && "animate-spin motion-reduce:animate-none",
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      {categories.length > 1 && (
        <div
          role="group"
          aria-label="Job types"
          className="flex flex-wrap gap-1.5"
        >
          {categories.map((id) => {
            const on = filters.types.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => setType(id)}
                className={cn(
                  toggle,
                  on
                    ? "border-flare-100 bg-flare-50 text-flare-700"
                    : "border-border text-stone hover:text-foreground",
                )}
              >
                {NAMES.get(id) ?? id}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
