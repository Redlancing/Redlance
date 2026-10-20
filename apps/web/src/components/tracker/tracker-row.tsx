"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { timeAgo } from "@/lib/format";
import { StatusChip } from "./status-chip";
import {
  SETTABLE_STATUSES,
  STATUS_LABELS,
  type ReplyItem,
  type SettableStatus,
} from "./tracker-state";

export function TrackerRow({
  item,
  onChoose,
}: {
  item: ReplyItem;
  onChoose: (item: ReplyItem, status: SettableStatus) => void;
}) {
  const titleClass =
    "line-clamp-1 text-[15px] font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <li className="flex items-center gap-3 border-b border-border py-3">
      <div className="min-w-0 flex-1">
        {item.matchId ? (
          <Link href={`/feed/${item.matchId}`} className={titleClass}>
            {item.post.title}
          </Link>
        ) : (
          <a
            href={item.post.url}
            target="_blank"
            rel="noopener noreferrer"
            className={titleClass}
          >
            <span className="inline-flex items-center gap-1.5">
              {item.post.title}
              <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">(opens Reddit in a new tab)</span>
            </span>
          </a>
        )}
        <p className="mt-0.5 truncate text-[13px] text-stone">
          r/{item.post.community} · {item.kind === "dm" ? "DM" : "Comment"} ·{" "}
          <time dateTime={item.sentAt} className="tabular-nums">
            {timeAgo(item.sentAt)}
          </time>
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Status: ${STATUS_LABELS[item.status]}. Change status`}
              className="h-8 gap-1 px-1.5"
            />
          }
        >
          <StatusChip status={item.status} />
          <ChevronDown className="size-4 text-stone" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {SETTABLE_STATUSES.map((s) => (
            <DropdownMenuItem
              key={s}
              disabled={s === item.status}
              onClick={() => onChoose(item, s)}
            >
              {s === "hired" ? "Hired…" : STATUS_LABELS[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
