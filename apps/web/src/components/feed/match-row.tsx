"use client";

import { Bookmark, BookmarkCheck, Flag, X } from "lucide-react";
import Link from "next/link";
import { ScoreChip } from "@/components/app/score-chip";
import { budgetText, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FeedItemResponse } from "@/server/feed";

const REMOTE_LABEL: Record<string, string | null> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unknown: null,
};

const PAY_LABEL: Record<string, string | null> = {
  paid: null,
  commission_only: "Commission only",
  revshare: "Rev share",
  unpaid: "Unpaid",
  unknown: null,
};

/** The facts line under a title: community, age, budget, remote, unusual pay. */
export function metaParts(item: FeedItemResponse, now?: Date): string[] {
  return [
    `r/${item.post.community}`,
    timeAgo(item.post.postedAt, now),
    budgetText(item.post.budget),
    REMOTE_LABEL[item.post.remote] ?? null,
    PAY_LABEL[item.post.payType] ?? null,
  ].filter((p): p is string => Boolean(p));
}

export function MatchRow({
  item,
  href,
  active,
  onOpen,
  onSave,
  onDismiss,
}: {
  item: FeedItemResponse;
  href: string;
  active: boolean;
  onOpen: () => void;
  onSave: () => void;
  onDismiss: () => void;
}) {
  const saved = item.status === "saved";
  const flags = item.post.redFlags.length;
  return (
    <li
      className={cn(
        "group relative border-b border-border transition-colors duration-150",
        active ? "bg-bone" : "hover:bg-bone/50",
      )}
    >
      <Link
        href={href}
        onClick={onOpen}
        data-match-id={item.matchId}
        aria-current={active ? "page" : undefined}
        className="flex gap-3 px-4 py-3 outline-none focus-visible:bg-bone focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
      >
        <ScoreChip score={item.score} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            {item.status === "new" && (
              <span
                className="mt-[7px] size-2 shrink-0 rounded-full bg-flare-500"
                role="img"
                aria-label="New"
              />
            )}
            <span
              className={cn(
                "line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug break-words text-foreground",
                item.status === "new" ? "font-semibold" : "font-medium",
              )}
            >
              {item.post.title}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-stone tabular-nums">
            {metaParts(item).join(" · ")}
          </span>
          <span className="mt-1 block truncate text-[13px] text-muted-foreground">
            {item.reason}
          </span>
          {(flags > 0 ||
            item.post.alsoPostedIn.length > 0 ||
            saved ||
            item.status === "replied") && (
            <span className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
              {flags > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-danger">
                  <Flag className="size-3" aria-hidden="true" />
                  {flags === 1 ? "1 red flag" : `${flags} red flags`}
                </span>
              )}
              {item.post.alsoPostedIn.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-stone">
                  Also in {item.post.alsoPostedIn.length}{" "}
                  {item.post.alsoPostedIn.length === 1
                    ? "community"
                    : "communities"}
                </span>
              )}
              {saved && (
                <span className="rounded-full bg-flare-50 px-2 py-0.5 text-flare-700">
                  Saved
                </span>
              )}
              {item.status === "replied" && (
                <span className="rounded-full bg-success-soft px-2 py-0.5 text-success">
                  Replied
                </span>
              )}
            </span>
          )}
        </span>
      </Link>
      {/* Quick actions: shown on hover or keyboard focus (desktop); the match page has them too. */}
      <span className="absolute top-2.5 right-3 hidden gap-1 group-focus-within:flex group-hover:flex">
        <button
          type="button"
          onClick={onSave}
          aria-label={saved ? "Unsave" : "Save"}
          title={saved ? "Unsave (s)" : "Save (s)"}
          className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-stone hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {saved ? (
            <BookmarkCheck className="size-4" aria-hidden="true" />
          ) : (
            <Bookmark className="size-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss (d)"
          className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-stone hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}

export function MatchRowSkeleton() {
  return (
    <li className="flex gap-3 border-b border-border px-4 py-3 sm:px-5">
      <span className="h-7 w-10 animate-pulse rounded-md bg-muted" />
      <span className="flex-1 space-y-2 py-0.5">
        <span className="block h-4 w-4/5 animate-pulse rounded bg-muted" />
        <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
        <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
      </span>
    </li>
  );
}
