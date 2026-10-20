import { CLOCK_SKEW_MS, isStale } from "@/lib/freshness";
import type { FeedItemResponse } from "@/server/feed";

// What status a match page (or the list's first page) shows when its server data may be older
// than something this tab did, kept pure so it can be tested without a DOM.

type MatchStatus = FeedItemResponse["status"];

/** A status this tab set for a match, and when (browser clock, epoch ms). */
export type KnownStatus = { status: MatchStatus; at: number };

/**
 * True when this tab set the status after the server loaded the data at `loadedAt` (server
 * clock), allowing for clock skew in the local status's favour. Without a stamp, what this tab
 * did wins: it can't be older than data whose age is unknown, and the page checks anyway.
 */
export function localIsNewer(
  local: KnownStatus | undefined,
  loadedAt: number | undefined,
): local is KnownStatus {
  if (!local) return false;
  return loadedAt === undefined || local.at > loadedAt - CLOCK_SKEW_MS;
}

export type OpenView = {
  /** The status to show first. */
  status: MatchStatus;
  /** Show the data at once, and check the server in the background. */
  stale: boolean;
  /**
   * Ask the server to mark the match seen (only if it is still "new" there, so it is safe even
   * with old data).
   */
  markSeen: boolean;
};

/** The view a server render gets: the page's own data, never stale. */
export function serverOpenView(pageStatus: MatchStatus): OpenView {
  return { status: pageStatus, stale: false, markSeen: pageStatus === "new" };
}

/**
 * The view a match page starts with in the browser. Data older than `STALE_AFTER_MS` is stale;
 * a status this tab set since the data was loaded is shown instead of the page's and makes the
 * page stale too (the server is asked what it has now).
 */
export function openView(s: {
  pageStatus: MatchStatus;
  loadedAt: number | undefined;
  local?: KnownStatus;
  now: number;
}): OpenView {
  const local = localIsNewer(s.local, s.loadedAt) ? s.local : undefined;
  const status = local?.status ?? s.pageStatus;
  return {
    status,
    stale:
      (s.loadedAt !== undefined && isStale(s.loadedAt, s.now)) ||
      (local !== undefined && local.status !== s.pageStatus),
    markSeen: status === "new",
  };
}

/**
 * What to do when the server answers (a background check, or the conditional "seen"): `server`
 * is its status, or null when the request failed. A change made on this page since (`touched`)
 * always wins; otherwise the server's status is shown, and announced when it differs, so the
 * list row and this tab's memory of statuses follow.
 */
export function serverView(s: {
  shown: MatchStatus;
  server: MatchStatus | null;
  touched: boolean;
}): { status: MatchStatus; announce: boolean } {
  if (s.server === null || s.touched)
    return { status: s.shown, announce: false };
  return { status: s.server, announce: s.server !== s.shown };
}
