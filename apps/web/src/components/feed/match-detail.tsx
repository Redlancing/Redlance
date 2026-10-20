"use client";

import { CATEGORIES, RED_FLAG_TEXT } from "@redlance/core";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  Flag,
  PenLine,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ScoreChip } from "@/components/app/score-chip";
import {
  DraftComposer,
  type Credits,
} from "@/components/drafts/draft-composer";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-errors";
import { communityUrl } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FeedItemDetailResponse } from "@/server/feed";
import { announceMatchStatus, onMatchStatus } from "./feed-events";
import { undoStatus, type MatchStatus } from "./feed-state";
import { metaParts } from "./match-row";

const CATEGORY_NAMES = new Map<string, string>(
  CATEGORIES.map((c) => [c.id, c.name]),
);

/** "vague_pay" → "Vague pay". */
function flagLabel(code: string): string {
  const text = RED_FLAG_TEXT[code] ?? code.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DEADLINE = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function MatchDetail({
  item,
  credits,
  sentKinds,
}: {
  item: FeedItemDetailResponse;
  credits: Credits | null;
  /** Reply kinds already marked as sent for this post. */
  sentKinds: ("comment" | "dm")[];
}) {
  const searchParams = useSearchParams();
  const backHref = `/feed${searchParams.size ? `?${searchParams.toString()}` : ""}`;
  const [status, setStatus] = useState<MatchStatus>(item.status);
  const [expanded, setExpanded] = useState(false);
  const post = item.post;

  // Opening a new match marks it seen (also when it was opened from an alert link).
  useEffect(() => {
    if (item.status !== "new") return;
    void apiFetch(`/api/v1/feed/${item.matchId}/status`, {
      method: "POST",
      json: { status: "seen" },
    }).then((r) => {
      if (r.ok) announceMatchStatus({ matchId: item.matchId, status: "seen" });
    });
  }, [item.matchId, item.status]);

  // Changes made from the list (keyboard shortcuts) show here too.
  useEffect(
    () =>
      onMatchStatus(({ matchId, status: s }) => {
        if (matchId === item.matchId) setStatus(s);
      }),
    [item.matchId],
  );

  // The latest status, for rollbacks and undo that run after later changes.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  });

  async function change(next: MatchStatus, undoable = false) {
    const before = statusRef.current;
    if (before === next) return;
    setStatus(next);
    const r = await apiFetch(`/api/v1/feed/${item.matchId}/status`, {
      method: "POST",
      json: { status: next },
    });
    if (!r.ok) {
      // Roll back only if nothing changed it since.
      setStatus((s) => (s === next ? before : s));
      return toast.error(errorMessage(r));
    }
    // The whole match goes along, so a list that dropped it on dismiss can put it back.
    announceMatchStatus({ matchId: item.matchId, status: next, item });
    if (undoable)
      toast("Dismissed", {
        action: {
          label: "Undo",
          onClick: () => void change(undoStatus(before)),
        },
      });
  }

  const saved = status === "saved";
  const dismissed = status === "dismissed";
  const facts = [
    post.deadline ? `Due ${DEADLINE.format(new Date(post.deadline))}` : null,
    ...post.categories.map((c) => CATEGORY_NAMES.get(c) ?? c),
  ].filter(Boolean);

  return (
    <article className="mx-auto max-w-3xl px-4 pt-4 pb-10 sm:px-8 md:pt-8">
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone hover:text-foreground md:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Matches
      </Link>

      {(dismissed || item.withdrawn) && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[10px] bg-muted px-4 py-2.5 text-sm text-stone">
          <span>
            {item.withdrawn
              ? "This post no longer fits your profile (it was re-checked after it changed)."
              : "You dismissed this gig."}
          </span>
          {dismissed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void change("seen")}
            >
              <Undo2 aria-hidden="true" />
              Restore
            </Button>
          )}
        </div>
      )}

      <header>
        <div className="flex items-start gap-3">
          <ScoreChip score={item.score} className="mt-0.5" />
          <h1 className="min-w-0 flex-1 text-xl leading-snug font-semibold tracking-tight text-foreground">
            {post.title}
          </h1>
        </div>
        {/* "5m" can tick to "6m" between the server render and hydration. */}
        <p className="mt-2 text-sm text-stone tabular-nums">
          {metaParts(item).map((part, i) =>
            i === 0 ? (
              <a
                key="community"
                href={communityUrl(post.community)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground hover:underline"
              >
                {part}
              </a>
            ) : (
              <span key={i} suppressHydrationWarning>
                {" "}
                · {part}
              </span>
            ),
          )}
          {facts.map((f) => (
            <span key={f}> · {f}</span>
          ))}
        </p>
        {post.alsoPostedIn.length > 0 && (
          <p className="mt-1 text-sm text-stone">
            Also posted in{" "}
            {post.alsoPostedIn.map((c, i) => (
              <span key={c}>
                {i > 0 && ", "}
                <a
                  href={communityUrl(c)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground hover:underline"
                >
                  r/{c}
                </a>
              </span>
            ))}
          </p>
        )}
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {!item.withdrawn && (
          <a href="#reply" className={buttonVariants()}>
            <PenLine aria-hidden="true" />
            Reply
          </a>
        )}
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          <ExternalLink aria-hidden="true" />
          Open post
        </a>
        <Button
          variant="outline"
          aria-pressed={saved}
          onClick={() => void change(saved ? "seen" : "saved")}
          disabled={dismissed}
        >
          {saved ? (
            <BookmarkCheck aria-hidden="true" />
          ) : (
            <Bookmark aria-hidden="true" />
          )}
          {saved ? "Saved" : "Save"}
        </Button>
        {!dismissed && (
          <Button
            variant="ghost"
            onClick={() => void change("dismissed", true)}
          >
            <X aria-hidden="true" />
            Dismiss
          </Button>
        )}
      </div>

      {post.redFlags.length > 0 && (
        <section
          aria-label="Red flags"
          className="mt-6 rounded-[10px] bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <Flag className="size-4" aria-hidden="true" />
            Worth checking before you reply
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {post.redFlags.map((f) => (
              <li key={f}>{flagLabel(f)}</li>
            ))}
          </ul>
        </section>
      )}

      {post.applyInstructions && (
        <p className="mt-4 rounded-[10px] bg-flare-50 px-4 py-3 text-sm text-flare-700">
          <span className="font-medium">The post asks you to:</span>{" "}
          {post.applyInstructions}
        </p>
      )}

      <section aria-labelledby="why-heading" className="mt-6">
        <h2 id="why-heading" className="text-sm font-semibold text-foreground">
          Why it matched
        </h2>
        <p className="mt-1 text-sm text-stone">{item.reason}</p>
        {(item.bestProject || item.bestRole) && (
          <p className="mt-1 text-sm text-stone">
            Worth citing: {item.bestProject?.title ?? item.bestRole?.title}
          </p>
        )}
      </section>

      <section aria-labelledby="post-heading" className="mt-6">
        <h2 id="post-heading" className="text-sm font-semibold text-foreground">
          The post
        </h2>
        {post.summary && (
          <p className="mt-1 text-sm text-stone">
            <span className="font-medium text-foreground">In short:</span>{" "}
            {post.summary}
          </p>
        )}
        {post.body && (
          <>
            <div
              className={cn(
                "mt-3 text-[15px] leading-relaxed whitespace-pre-wrap text-foreground",
                !expanded && "line-clamp-[12]",
              )}
            >
              {post.body}
            </div>
            {post.body.split("\n").length > 10 || post.body.length > 900 ? (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className="mt-1 text-sm font-medium text-stone hover:text-foreground"
              >
                {expanded ? "Show less" : "Show the whole post"}
              </button>
            ) : null}
          </>
        )}
      </section>

      <div id="reply" className="mt-8 scroll-mt-6">
        <DraftComposer
          key={item.matchId}
          matchId={item.matchId}
          postUrl={post.url}
          withdrawn={item.withdrawn}
          initialCredits={credits}
          initialSent={sentKinds}
          onSent={() => {
            setStatus("replied");
            announceMatchStatus({ matchId: item.matchId, status: "replied" });
          }}
        />
      </div>
    </article>
  );
}
