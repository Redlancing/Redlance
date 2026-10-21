import type { FeedItemResponse } from "@/server/feed";

// What the list already knows about each match, so the match page's loading state can show the
// title, score and facts the moment a row is opened (see feed/[matchId]/loading.tsx). Browser
// memory only: a reload, an alert link or a link from the overview finds nothing here and shows
// a plain skeleton.

/** Plenty for a long scroll; the oldest stored drop out first. */
export const PREVIEW_LIMIT = 500;

const items = new Map<string, FeedItemResponse>();
const listeners = new Set<() => void>();

/** Stores the list's copy of these matches (initial, appended, refreshed or inserted rows). */
export function rememberPreviews(list: readonly FeedItemResponse[]): void {
  let changed = false;
  for (const item of list) {
    if (items.get(item.matchId) === item) continue;
    // Re-inserted, so a match the list keeps showing stays among the newest.
    items.delete(item.matchId);
    items.set(item.matchId, item);
    changed = true;
  }
  for (const key of items.keys()) {
    if (items.size <= PREVIEW_LIMIT) break;
    items.delete(key);
  }
  if (changed) for (const l of listeners) l();
}

/** The list's copy of a match, or undefined. The same object until it changes. */
export function previewFor(matchId: string): FeedItemResponse | undefined {
  return items.get(matchId);
}

/** For `useSyncExternalStore`; returns the unsubscribe function. */
export function subscribePreviews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Empties the store (tests). */
export function forgetPreviews(): void {
  items.clear();
}
