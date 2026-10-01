import {
  preKindFromTitle,
  type JobPost,
  type SubredditStatus,
} from "@redlance/core";
import {
  recordFeedPoll,
  saveJobPosts,
  type Database,
  type Feed,
  type NewJobPost,
} from "@redlance/db";
import { entryToJobPost } from "../sources/reddit-rss/adapter";
import { fetchFeed, type FetchResult } from "../sources/reddit-rss/client";
import {
  PAGE_SIZE,
  feedUrl,
  type FeedTarget,
} from "../sources/reddit-rss/feed-url";
import { FeedParseError, parseAtomFeed } from "../sources/reddit-rss/parse";

// One request, end to end: fetch → parse → JobPost → filter → save → gap check → schedule.

/** Catch-up pages after a gap: at most this many, and never past this age. */
export const MAX_CATCH_UP_PAGES = 5;
export const MAX_CATCH_UP_AGE_MS = 48 * 60 * 60_000;
/** A page this full may have more behind it (listings can come back a few posts short). */
export const FULL_PAGE = Math.floor(PAGE_SIZE * 0.9);
/** Clock and posting-delay slack when comparing a page's oldest post with the last poll. */
const GAP_SLACK_MS = 5 * 60_000;

class PollError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
/** Failing feeds back off: interval × 2^errors, capped. */
const MAX_ERROR_BACKOFF_MS = 60 * 60_000;

export type Catalogue = Map<string, SubredditStatus>;

export type PollDeps = {
  db: Database;
  userAgent: string;
  /** Subreddit name → status, for filtering search results. */
  catalogue: () => Promise<Catalogue>;
  /** When these subreddits were last covered by a successful poll (gap detection). */
  lastPolledAt: (subreddits: string[]) => Promise<Date | null>;
  /** Unexpected errors after the fetch (logged by the poller; the poll still records). */
  onError?: (err: unknown) => void;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
};

export type PollOutcome = {
  /** The request's result; errorCode also covers failures after the fetch (PARSE, SAVE_FAILED…). */
  fetch: Pick<FetchResult, "ok" | "rateLimit"> & {
    errorCode: string | null;
    status: number | null;
  };
  /** The feed's error count after this poll. */
  consecutiveErrors: number;
  page: number;
  entries: number;
  newPosts: number;
  malformed: number;
  /** Entries posted on user profiles (u/name), skipped. */
  profilePosts: number;
  catchUpPagesLeft: number;
};

export function feedTarget(feed: Feed): FeedTarget {
  return feed.kind === "search"
    ? { kind: "search", query: feed.query! }
    : { kind: "subreddits", subreddits: feed.subreddits! };
}

/**
 * What to keep from a page. Subreddit feeds keep their own subreddits. Search feeds keep posts
 * from active catalogue subreddits and from subreddits we don't know (discovery), and drop
 * subreddits we excluded or found dead. For-hire posts are stored but not analysed; posts from
 * unknown subreddits are analysed only when the title says they're hiring (search noise).
 */
export function selectPosts(
  feed: Feed,
  posts: JobPost[],
  catalogue: Catalogue,
): NewJobPost[] {
  const own = new Set(feed.subreddits ?? []);
  const out: NewJobPost[] = [];
  for (const p of posts) {
    const status = catalogue.get(p.community);
    if (
      feed.kind === "subreddits"
        ? !own.has(p.community)
        : status && status !== "active"
    )
      continue;
    const preKind = preKindFromTitle(p.title);
    // Our own subreddits: everything but tagged for-hire posts goes to the model (flair-only
    // boards like r/PhotoshopRequest have no title tag). Search results from subreddits we
    // don't list only when the title says hiring.
    const ours = feed.kind === "subreddits" || status === "active";
    const analyse = preKind !== "for_hire" && (ours || preKind === "hiring");
    out.push({ ...p, preKind, analyse });
  }
  return out;
}

export async function pollFeed(
  feed: Feed,
  opts: { catchUp: boolean },
  deps: PollDeps,
): Promise<PollOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const catchUp =
    opts.catchUp && feed.catchUpPagesLeft > 0 && !!feed.catchUpAfter;
  const page = catchUp ? MAX_CATCH_UP_PAGES - feed.catchUpPagesLeft + 1 : 0;
  const res = await fetchFeed(
    feedUrl(feedTarget(feed), catchUp ? feed.catchUpAfter : null),
    { userAgent: deps.userAgent, fetch: deps.fetch, signal: deps.signal },
  );

  let entries = 0;
  let newPosts = 0;
  let malformed = 0;
  let profilePosts = 0;
  let errorCode: string | null = res.ok ? null : res.errorCode;
  let catchUpAfter = feed.catchUpAfter;
  let catchUpPagesLeft = feed.catchUpPagesLeft;
  let catchUpUntil = feed.catchUpUntil;

  if (res.ok) {
    // Everything after the fetch is guarded: the feed is always rescheduled and logged, so a
    // bad page or a database hiccup can't make one feed hog the request slot.
    try {
      const raw = parseAtomFeed(res.body);
      entries = raw.length;
      const posts: JobPost[] = [];
      for (const e of raw) {
        // Posts on someone's own profile (u/name) aren't in a subreddit; search feeds return
        // them (mostly company ads). Skipped, and not counted as malformed.
        if (e.category?.startsWith("u/") || e.category?.startsWith("u_")) {
          profilePosts++;
          continue;
        }
        const p = entryToJobPost(e);
        if (p) posts.push(p);
        else malformed++;
      }
      // Every entry unreadable means Reddit changed its format: an error, not a quiet page.
      if (malformed > 0 && posts.length === 0)
        throw new PollError("ALL_MALFORMED");
      const keep = selectPosts(feed, posts, await deps.catalogue());
      newPosts = (await saveJobPosts(deps.db, keep, feed.id)).length;

      // Gap: a (nearly) full page whose oldest post is newer than the last time these
      // subreddits were covered means posts in between may have been missed (downtime, or a
      // busier group than planned). Page back until we reach that time. Time-based, so posts
      // another feed already saved and re-planned feeds don't hide a gap.
      const full = entries >= FULL_PAGE;
      const oldest = posts.at(-1) ?? null; // entries come newest first
      const oldestAt = oldest?.postedAt.getTime() ?? NaN;
      const tooOld =
        !Number.isFinite(oldestAt) || started - oldestAt > MAX_CATCH_UP_AGE_MS;
      if (feed.kind === "search") {
        catchUpAfter = null; // search feeds are a catch-all; they don't page back
        catchUpPagesLeft = 0;
        catchUpUntil = null;
      } else if (!catchUp) {
        const since = await deps.lastPolledAt(feed.subreddits ?? []);
        if (
          full &&
          oldest &&
          since &&
          !tooOld &&
          oldestAt > since.getTime() - GAP_SLACK_MS
        ) {
          catchUpAfter = oldest.externalId;
          catchUpPagesLeft = MAX_CATCH_UP_PAGES;
          catchUpUntil = since;
        }
      } else if (
        full &&
        oldest &&
        !tooOld &&
        feed.catchUpUntil &&
        oldestAt > feed.catchUpUntil.getTime() - GAP_SLACK_MS &&
        feed.catchUpPagesLeft > 1
      ) {
        catchUpAfter = oldest.externalId;
        catchUpPagesLeft = feed.catchUpPagesLeft - 1;
      } else {
        catchUpAfter = null;
        catchUpPagesLeft = 0;
        catchUpUntil = null;
      }
    } catch (err) {
      errorCode =
        err instanceof FeedParseError
          ? "PARSE"
          : err instanceof PollError
            ? err.code
            : "SAVE_FAILED";
      if (errorCode === "SAVE_FAILED") deps.onError?.(err);
    }
  }

  // Rate limits and our own shutdown aren't the feed's fault: it stays due, no backoff.
  const notFeedsFault = errorCode === "RATE_LIMITED" || errorCode === "ABORTED";
  const errors = !errorCode
    ? 0
    : notFeedsFault
      ? feed.consecutiveErrors
      : feed.consecutiveErrors + 1;
  const interval = feed.intervalSeconds * 1000;
  let nextPollAt: Date;
  if (catchUp)
    nextPollAt = feed.nextPollAt; // catch-up pages don't move the schedule
  else if (notFeedsFault) nextPollAt = new Date(started);
  else if (errors > 0)
    nextPollAt = new Date(
      started +
        Math.min(
          interval * 2 ** errors,
          Math.max(MAX_ERROR_BACKOFF_MS, interval),
        ),
    );
  else nextPollAt = new Date(started + interval);
  if (catchUp && errorCode && !notFeedsFault) {
    // A failing catch-up gives up rather than retrying forever.
    catchUpAfter = null;
    catchUpPagesLeft = 0;
    catchUpUntil = null;
  }

  await recordFeedPoll(
    deps.db,
    feed.id,
    {
      startedAt: new Date(started),
      durationMs: Math.max(0, Math.round(now() - started)),
      httpStatus: res.status,
      entries,
      newPosts,
      page,
      rateLimitRemaining: res.rateLimit.remaining,
      rateLimitReset: res.rateLimit.resetSeconds,
      errorCode,
    },
    {
      polled: !catchUp && !errorCode,
      nextPollAt,
      consecutiveErrors: errors,
      catchUpAfter,
      catchUpPagesLeft,
      catchUpUntil,
      subreddits: feed.kind === "subreddits" ? feed.subreddits : null,
    },
  );

  return {
    fetch: {
      ok: res.ok,
      status: res.status,
      errorCode,
      rateLimit: res.rateLimit,
    },
    page,
    entries,
    newPosts,
    malformed,
    profilePosts,
    catchUpPagesLeft,
    consecutiveErrors: errors,
  };
}
