"use client";

import { CATEGORIES, RED_FLAG_TEXT } from "@redlance/core";
import { ArrowLeft, Flag } from "lucide-react";
import Link from "next/link";
import { ScoreChip } from "@/components/app/score-chip";
import { communityUrl } from "@/lib/format";
import type { FeedItemResponse } from "@/server/feed";
import { metaParts } from "./match-row";

// The top of a match page, shared by the page itself (MatchDetail) and its loading state, which
// fills it from the list's copy of the match (match-preview-store.ts). Everything here comes
// from a feed item; the post text and the composer arrive with the page.

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

/** Back to the list, on phones (the list and the match are separate screens there). */
export function BackToMatches({ href }: { href: string }) {
  return (
    <Link
      href={href}
      // The list is a sibling page under the same layout; nothing worth fetching ahead.
      prefetch={false}
      className="mb-4 inline-flex items-center gap-1 text-sm text-stone hover:text-foreground md:hidden"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Matches
    </Link>
  );
}

/** Score, title, the facts line (community, age, budget, remote, deadline, job types) and cross-posts. */
export function MatchHeader({ item }: { item: FeedItemResponse }) {
  const post = item.post;
  const facts = [
    post.deadline ? `Due ${DEADLINE.format(new Date(post.deadline))}` : null,
    ...post.categories.map((c) => CATEGORY_NAMES.get(c) ?? c),
  ].filter(Boolean);
  return (
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
  );
}

/** Red flags, what the post asks applicants to do, and why it matched. */
export function MatchNotes({ item }: { item: FeedItemResponse }) {
  const post = item.post;
  return (
    <>
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
    </>
  );
}
