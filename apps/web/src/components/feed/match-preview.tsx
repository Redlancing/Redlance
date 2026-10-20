"use client";

import { Bookmark, ExternalLink, PenLine, X } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BackToMatches, MatchHeader, MatchNotes } from "./match-header";
import { previewFor, subscribePreviews } from "./match-preview-store";

/**
 * The match page while it loads: the top of the page from the list's copy of the match (title,
 * score, facts, red flags, why it matched), skeletons for the post text and the composer, and
 * the actions shown but not usable yet. Without a list copy (an alert link, a reload, a link from
 * the overview) it is all skeleton. The real page replaces this whole tree when it arrives, so
 * nothing from the list's copy outlives the loading state.
 */
export function MatchPreview() {
  const params = useParams<{ matchId: string }>();
  const searchParams = useSearchParams();
  const matchId = params.matchId?.toLowerCase() ?? "";
  // The server (and hydration) never has the list's copy; the client reads it after that.
  const item = useSyncExternalStore(
    subscribePreviews,
    () => previewFor(matchId),
    () => undefined,
  );
  const backHref = `/feed${searchParams.size ? `?${searchParams.toString()}` : ""}`;

  return (
    <article
      aria-busy="true"
      className="mx-auto max-w-3xl px-4 pt-4 pb-10 sm:px-8 md:pt-8"
    >
      <p role="status" className="sr-only">
        Loading the match
      </p>
      <BackToMatches href={backHref} />

      {item ? (
        <MatchHeader item={item} />
      ) : (
        <div>
          <div className="flex items-start gap-3">
            <Skeleton className="h-7 w-10" />
            <div className="flex-1 space-y-2 pt-0.5">
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </div>
          <Skeleton className="mt-3 h-4 w-2/3" />
        </div>
      )}

      {/* The page's actions, in place but not usable until it has loaded. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled>
          <PenLine aria-hidden="true" />
          Reply
        </Button>
        <Button variant="outline" disabled>
          <ExternalLink aria-hidden="true" />
          Open post
        </Button>
        <Button variant="outline" disabled>
          <Bookmark aria-hidden="true" />
          Save
        </Button>
        <Button variant="ghost" disabled>
          <X aria-hidden="true" />
          Dismiss
        </Button>
      </div>

      {item && <MatchNotes item={item} />}

      <section aria-label="The post" className="mt-6">
        <p className="text-sm font-semibold text-foreground">The post</p>
        {item?.post.summary && (
          <p className="mt-1 text-sm text-stone">
            <span className="font-medium text-foreground">In short:</span>{" "}
            {item.post.summary}
          </p>
        )}
        <div className="mt-3 space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </section>

      <div className="mt-8 border-t border-border pt-6">
        <p className="text-base font-semibold text-foreground">Your reply</p>
        {/* The same placeholder the composer shows while it checks for drafts. */}
        <Skeleton className="mt-4 h-40 rounded-[10px]" />
      </div>
    </article>
  );
}
