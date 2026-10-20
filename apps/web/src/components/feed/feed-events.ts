import type { FeedItemResponse } from "@/server/feed";
import type { MatchStatus } from "./feed-state";

// The match page and the list are separate trees under the feed layout; a status change in one
// (save, dismiss, sent) is announced here so the other updates without a refetch.

const EVENT = "redlance:match-status";

export type MatchStatusEvent = {
  matchId: string;
  status: MatchStatus;
  /** The whole match, so a list that had dropped it (dismissed, then restored) can put it back. */
  item?: FeedItemResponse;
};

export function announceMatchStatus(detail: MatchStatusEvent): void {
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
