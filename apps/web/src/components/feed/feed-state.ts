import type { FeedItemResponse } from "@/server/feed";
import { localIsNewer, type KnownStatus } from "./match-status";

export type MatchStatus = FeedItemResponse["status"];

// The match list's state, kept pure so it can be tested without a DOM. The list never moves
// under the cursor: newer matches found by a refresh wait in `incoming` until the user
// inserts them.

export type FeedState = {
  items: FeedItemResponse[];
  nextCursor: string | null;
  phase: "loading" | "ready" | "error";
  error: string | null;
  loadingMore: boolean;
  /** Newer matches found by a refresh, not shown yet. */
  incoming: FeedItemResponse[];
};

export type FeedAction =
  | { type: "reset" }
  | { type: "loaded"; items: FeedItemResponse[]; nextCursor: string | null }
  | { type: "failed"; error: string }
  | { type: "loadingMore" }
  | { type: "appended"; items: FeedItemResponse[]; nextCursor: string | null }
  | { type: "moreFailed"; error: string }
  | {
      type: "refreshed";
      items: FeedItemResponse[];
      /** The fresh first page's cursor: null means it is the whole list. */
      nextCursor: string | null;
    }
  | { type: "insertIncoming" }
  | {
      type: "status";
      matchId: string;
      status: MatchStatus;
      /** Only apply while the row still has this status (a rollback that a later change beat). */
      ifStatus?: MatchStatus;
    }
  | { type: "insert"; item: FeedItemResponse }
  | { type: "remove"; matchId: string }
  | { type: "restore"; item: FeedItemResponse; index: number };

export const initialFeedState: FeedState = {
  items: [],
  nextCursor: null,
  phase: "loading",
  error: null,
  loadingMore: false,
  incoming: [],
};

/** Newest first, the same order as the API: posted time, then match id. */
function newerFirst(a: FeedItemResponse, b: FeedItemResponse): number {
  if (a.post.postedAt !== b.post.postedAt)
    return a.post.postedAt < b.post.postedAt ? 1 : -1;
  return a.matchId < b.matchId ? 1 : a.matchId > b.matchId ? -1 : 0;
}

/** Items in `fresh` that the list doesn't have and that sort before its first item. */
export function newerThan(
  list: FeedItemResponse[],
  fresh: FeedItemResponse[],
): FeedItemResponse[] {
  const have = new Set(list.map((i) => i.matchId));
  const first = list[0];
  return fresh.filter(
    (i) => !have.has(i.matchId) && (!first || newerFirst(i, first) < 0),
  );
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "reset":
      return initialFeedState;
    case "loaded":
      return {
        ...initialFeedState,
        phase: "ready",
        items: action.items,
        nextCursor: action.nextCursor,
      };
    case "failed":
      return { ...state, phase: "error", error: action.error };
    case "loadingMore":
      return { ...state, loadingMore: true, error: null };
    case "appended": {
      // A page can overlap rows the list already has (e.g. after an undo): skip those.
      const have = new Set(state.items.map((i) => i.matchId));
      return {
        ...state,
        loadingMore: false,
        items: [
          ...state.items,
          ...action.items.filter((i) => !have.has(i.matchId)),
        ],
        nextCursor: action.nextCursor,
      };
    }
    case "moreFailed":
      return { ...state, loadingMore: false, error: action.error };
    case "refreshed": {
      // Newer matches wait in `incoming`; rows the list already shows take the fresh copy
      // (a score or status may have changed). Rows the fresh page should hold but doesn't
      // (dismissed in another tab, withdrawn, or put back by an old cached page) go: those
      // sorting at or before its last item, or every row when it is the whole list. Rows past
      // it belong to later pages and stay; nothing is added or reordered, so the list only
      // closes the gaps.
      const fresh = new Map(action.items.map((i) => [i.matchId, i]));
      const last = action.items[action.items.length - 1];
      const inRange = (i: FeedItemResponse) =>
        action.nextCursor === null ||
        (last !== undefined && newerFirst(i, last) <= 0);
      const keep = (i: FeedItemResponse) => fresh.has(i.matchId) || !inRange(i);
      const items = state.items
        .filter(keep)
        .map((i) => fresh.get(i.matchId) ?? i);
      const seen = new Set(state.incoming.map((i) => i.matchId));
      const incoming = [
        ...state.incoming.filter(keep),
        ...newerThan(state.items, action.items).filter(
          (i) => !seen.has(i.matchId),
        ),
      ].sort(newerFirst);
      return { ...state, items, incoming };
    }
    case "insertIncoming":
      return {
        ...state,
        items: [...state.incoming, ...state.items].sort(newerFirst),
        incoming: [],
      };
    case "status":
      return {
        ...state,
        items: state.items.map((i) =>
          i.matchId === action.matchId &&
          (action.ifStatus === undefined || i.status === action.ifStatus)
            ? { ...i, status: action.status }
            : i,
        ),
      };
    case "insert": {
      // A match restored elsewhere: back into its sorted place, if it falls within the loaded
      // range (an older one belongs to a page not loaded yet).
      if (state.items.some((i) => i.matchId === action.item.matchId))
        return state;
      const last = state.items[state.items.length - 1];
      if (last && state.nextCursor && newerFirst(action.item, last) > 0)
        return state;
      return {
        ...state,
        items: [...state.items, action.item].sort(newerFirst),
      };
    }
    case "remove":
      return {
        ...state,
        items: state.items.filter((i) => i.matchId !== action.matchId),
        incoming: state.incoming.filter((i) => i.matchId !== action.matchId),
      };
    case "restore": {
      if (state.items.some((i) => i.matchId === action.item.matchId))
        return state;
      const items = [...state.items];
      items.splice(
        Math.min(Math.max(action.index, 0), items.length),
        0,
        action.item,
      );
      return { ...state, items };
    }
  }
}

export type FeedFilters = {
  view: "best" | "all";
  types: string[];
  paidOnly: boolean;
};

/** Filters from the page's search params; anything unexpected falls back to the default. */
export function filtersFrom(
  params: URLSearchParams,
  allowedTypes: readonly string[],
): FeedFilters {
  const types = (params.get("type") ?? "")
    .split(",")
    .filter((t) => allowedTypes.includes(t))
    .slice(0, 3);
  return {
    view: params.get("view") === "all" ? "all" : "best",
    types: [...new Set(types)],
    paidOnly: params.get("pay") === "paid",
  };
}

/** The search params for filters, defaults left out so the URL stays short. */
export function filtersToParams(f: FeedFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.view === "all") p.set("view", "all");
  if (f.types.length) p.set("type", f.types.join(","));
  if (f.paidOnly) p.set("pay", "paid");
  return p;
}

export function filtersEqual(a: FeedFilters, b: FeedFilters): boolean {
  return (
    a.view === b.view &&
    a.paidOnly === b.paidOnly &&
    a.types.length === b.types.length &&
    a.types.every((t, i) => t === b.types[i])
  );
}

/** Items per page, for the server-rendered first page and the client's own requests alike. */
export const FEED_PAGE_SIZE = 25;

/** The first page as the feed layout loaded it on the server. */
export type InitialFeed = {
  filters: FeedFilters;
  items: FeedItemResponse[];
  nextCursor: string | null;
  /** When the server read it (epoch ms), to spot a copy kept in Next's client cache. */
  loadedAt: number;
};

/**
 * The list's first state. The server's page counts only for the filters it was loaded with:
 * the layout is shared and isn't rendered again when only the URL's filters change, so after a
 * client-side filter change (or a back/forward) the data is for another view.
 *
 * Back/forward can also bring the layout's page from Next's cache, older than what this tab did
 * since: `known` (the statuses this tab set, see feed-events.ts) wins when it is newer than the
 * page, and rows this tab dismissed since are dropped.
 */
export function startState(
  initial: InitialFeed | undefined,
  filters: FeedFilters,
  known: (matchId: string) => KnownStatus | undefined = () => undefined,
): FeedState {
  if (!initial || !filtersEqual(initial.filters, filters))
    return initialFeedState;
  const items: FeedItemResponse[] = [];
  for (const i of initial.items) {
    const local = known(i.matchId);
    if (!localIsNewer(local, initial.loadedAt)) items.push(i);
    else if (local.status !== "dismissed")
      items.push(
        local.status === i.status ? i : { ...i, status: local.status },
      );
  }
  return {
    ...initialFeedState,
    phase: "ready",
    items,
    nextCursor: initial.nextCursor,
  };
}

/** The feed API query for filters and an optional cursor. */
export function feedQuery(f: FeedFilters, cursor?: string | null): string {
  const p = filtersToParams(f);
  p.set("view", f.view);
  if (cursor) p.set("cursor", cursor);
  return `/api/v1/feed?${p.toString()}`;
}

/** The status to put back when a dismiss is undone: a new match comes back as seen. */
export function undoStatus(previous: MatchStatus): MatchStatus {
  return previous === "new" || previous === "dismissed" ? "seen" : previous;
}
