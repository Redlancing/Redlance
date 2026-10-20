import type { FeedItemResponse } from "@/server/feed";
import { setBounded } from "@/lib/bounded-map";
import type { MatchStatus } from "./feed-state";
import type { KnownStatus } from "./match-status";

export type { KnownStatus };

// The match page and the list are separate trees under the feed layout; a status change in one
// (save, dismiss, sent) is announced here so the other updates without a refetch.

const EVENT = "redlance:match-status";

export type MatchStatusEvent = {
  matchId: string;
  status: MatchStatus;
  /** The whole match, so a list that had dropped it (dismissed, then restored) can put it back. */
  item?: FeedItemResponse;
};

// The last status this tab set or learned per match, and when (browser clock). A match page or
// the list's first page can come from Next's client cache (a prefetch, back/forward) with data
// older than that: they show this one when it is newer than their data (`localIsNewer`), instead
// of marking a saved gig "seen" again or showing a dismissed one. Capped, oldest first; the open
// match is never evicted.
const MAX_KNOWN = 200;
const lastStatus = new Map<string, KnownStatus>();
let openMatch: string | null = null;

/** The status this tab last set for a match (after the server accepted it), if any. */
export function knownStatus(matchId: string): KnownStatus | undefined {
  return lastStatus.get(matchId);
}

/** The match page records which match is open, so its entry is never evicted. */
export function setOpenMatch(matchId: string): () => void {
  openMatch = matchId;
  return () => {
    if (openMatch === matchId) openMatch = null;
  };
}

export function announceMatchStatus(detail: MatchStatusEvent): void {
  setBounded(
    lastStatus,
    detail.matchId,
    { status: detail.status, at: Date.now() },
    MAX_KNOWN,
    (id) => id === openMatch,
  );
  window.dispatchEvent(new CustomEvent<MatchStatusEvent>(EVENT, { detail }));
}

/** Returns the unsubscribe function. */
export function onMatchStatus(
  handler: (detail: MatchStatusEvent) => void,
): () => void {
  const listener = (e: Event) =>
    handler((e as CustomEvent<MatchStatusEvent>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
