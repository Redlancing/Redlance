"use client";

import type { InsightsListRow } from "@redlance/core";
import { Search } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { filterRows } from "@/lib/insights-view";
import { InsightList } from "./insight-list";

/** Browse all: every active subreddit, busiest first, with a filter box. */
export function BrowseList({ rows }: { rows: InsightsListRow[] }) {
  const [query, setQuery] = useState("");
  const shown = filterRows(rows, query);
  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Filter subreddits</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-stone"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter subreddits"
            autoComplete="off"
            spellCheck={false}
            className="h-9 rounded-md pl-8"
          />
        </label>
        <p
          className="text-[13px] text-stone tabular-nums"
          aria-live="polite"
          aria-atomic="true"
        >
          {shown.length === rows.length
            ? `${rows.length} subreddits, most hiring posts first`
            : `${shown.length} of ${rows.length} subreddits`}
        </p>
      </div>
      {shown.length > 0 ? (
        <InsightList rows={shown} personal={false} />
      ) : (
        <p className="mt-6 text-sm text-stone">
          No subreddit matches “{query.trim()}”. Redlance watches the hiring
          subreddits in its catalogue only.
        </p>
      )}
    </div>
  );
}
