import type { FeedItemResponse } from "@/server/feed";

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
  | { type: "refreshed"; items: FeedItemResponse[] }
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
      // (a score or status may have changed).
      const fresh = new Map(action.items.map((i) => [i.matchId, i]));
      const items = state.items.map((i) => fresh.get(i.matchId) ?? i);
      const seen = new Set(state.incoming.map((i) => i.matchId));
      const incoming = [
        ...state.incoming,
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
