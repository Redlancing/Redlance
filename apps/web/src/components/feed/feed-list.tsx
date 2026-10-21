"use client";

import { ArrowUp } from "lucide-react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { isStale } from "@/lib/freshness";
import { errorMessage } from "@/lib/api-errors";
import type { FeedItemResponse, FeedResponse } from "@/server/feed";
import { FeedFilters } from "./feed-filters";
import { announceMatchStatus, knownStatus, onMatchStatus } from "./feed-events";
import {
  FEED_PAGE_SIZE,
  feedQuery,
  feedReducer,
  filtersFrom,
  filtersToParams,
  startState,
  undoStatus,
  type FeedFilters as Filters,
  type InitialFeed,
  type MatchStatus,
} from "./feed-state";
import { MatchRow, MatchRowSkeleton } from "./match-row";
import { rememberPreviews } from "./match-preview-store";
import { usePrefetchIntent } from "./use-prefetch-intent";

/** True when a key press belongs to a text field or a menu, not to the list shortcuts. */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("[role=dialog],[role=menu],[role=alertdialog]") !== null
  );
}

export function FeedList({
  categories,
  initial,
}: {
  categories: string[];
  /** The first page, loaded by the layout for the URL's filters at request time. */
  initial?: InitialFeed;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ matchId?: string }>();
  const activeId = params.matchId ?? null;

  const filters = useMemo(
    () => filtersFrom(new URLSearchParams(searchParams.toString()), categories),
    [searchParams, categories],
  );
  const query = feedQuery(filters);
  const qs = filtersToParams(filters).toString();
  const suffix = qs ? `?${qs}` : "";

  // `knownStatus`: a layout from Next's cache (back/forward) can hold a page older than what this
  // tab did since; rows dismissed since stay out, newer statuses show.
  const [state, dispatch] = useReducer(feedReducer, undefined, () =>
    startState(initial, filters, knownStatus),
  );
  // The query the server-rendered page answers, until the list leaves it: the first-page
  // effect skips that one query, and any other (or coming back to it later) fetches.
  const serverQuery = useRef<string | null>(
    initial && state.phase === "ready" ? query : null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  // Every row the list has shown, for the match page's instant preview while it loads.
  useEffect(() => {
    rememberPreviews(state.items);
    rememberPreviews(state.incoming);
  }, [state.items, state.incoming]);
  const prefetch = usePrefetchIntent();
  // The row a j/k selection last landed on, whose prefetch waits for the selection to stay.
  const selected = useRef<string | null>(null);

  // Bumped whenever the list starts over (new filters, retry): responses for an older
  // generation are dropped, so a slow page from the old view can't land in the new one.
  const generation = useRef(0);

  // First page whenever the filters change.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (serverQuery.current === query && attempt === 0) return;
    serverQuery.current = null;
    const mine = ++generation.current;
    dispatch({ type: "reset" });
    void apiFetch<FeedResponse>(`${query}&limit=${FEED_PAGE_SIZE}`).then(
      (r) => {
        if (mine !== generation.current) return;
        if (r.ok)
          dispatch({
            type: "loaded",
            items: r.data.items,
            nextCursor: r.data.nextCursor,
          });
        else dispatch({ type: "failed", error: errorMessage(r) });
      },
    );
  }, [query, attempt]);

  const loadMore = useCallback(async () => {
    if (!state.nextCursor || state.loadingMore) return;
    const mine = generation.current;
    dispatch({ type: "loadingMore" });
    const r = await apiFetch<FeedResponse>(
      `${feedQuery(filters, state.nextCursor)}&limit=${FEED_PAGE_SIZE}`,
    );
    if (mine !== generation.current) return;
    if (r.ok)
      dispatch({
        type: "appended",
        items: r.data.items,
        nextCursor: r.data.nextCursor,
      });
    else dispatch({ type: "moreFailed", error: errorMessage(r) });
  }, [filters, state.nextCursor, state.loadingMore]);

  // Infinite scroll, with the "Load more" button as the fallback.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !state.nextCursor || state.error) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, state.nextCursor, state.error]);

  /** Fetches the first page again; newer matches wait behind the "new gigs" bar. */
  const refresh = useCallback(async () => {
    // Only a loaded list can hold matches back; a loading or failed one starts over anyway.
    if (stateRef.current.phase !== "ready") return;
    const mine = generation.current;
    setRefreshing(true);
    const r = await apiFetch<FeedResponse>(`${query}&limit=${FEED_PAGE_SIZE}`);
    setRefreshing(false);
    if (mine !== generation.current) return;
    if (r.ok)
      dispatch({
        type: "refreshed",
        items: r.data.items,
        nextCursor: r.data.nextCursor,
      });
    else toast.error(errorMessage(r));
  }, [query]);

  // A layout kept in Next's client cache can hold a list that is minutes old: look for newer
  // gigs once on mount (they wait behind the "new gigs" bar, the list doesn't move).
  const checkedInitial = useRef(false);
  useEffect(() => {
    if (checkedInitial.current) return;
    checkedInitial.current = true;
    if (
      serverQuery.current === query &&
      initial &&
      isStale(initial.loadedAt, Date.now())
    )
      void refresh();
  }, [initial, query, refresh]);

  // Coming back to the tab is the natural time to look for new gigs.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  // Status changes made on the match page.
  useEffect(
    () =>
      onMatchStatus(({ matchId, status, item }) => {
        if (status === "dismissed") dispatch({ type: "remove", matchId });
        else {
          // Restored on the match page after the list dropped it: put it back.
          if (item) dispatch({ type: "insert", item: { ...item, status } });
          dispatch({ type: "status", matchId, status });
        }
      }),
    [],
  );

  const setStatus = useCallback(
    async (item: FeedItemResponse, status: MatchStatus) => {
      const before = item.status;
      if (before === status) return;
      dispatch({ type: "status", matchId: item.matchId, status });
      const r = await apiFetch(`/api/v1/feed/${item.matchId}/status`, {
        method: "POST",
        json: { status },
      });
      if (r.ok) announceMatchStatus({ matchId: item.matchId, status });
      else {
        dispatch({
          type: "status",
          matchId: item.matchId,
          status: before,
          ifStatus: status,
        });
        toast.error(errorMessage(r));
      }
    },
    [],
  );

  const dismiss = useCallback(async (item: FeedItemResponse) => {
    const index = stateRef.current.items.findIndex(
      (i) => i.matchId === item.matchId,
    );
    dispatch({ type: "remove", matchId: item.matchId });
    const r = await apiFetch(`/api/v1/feed/${item.matchId}/status`, {
      method: "POST",
      json: { status: "dismissed" },
    });
    if (!r.ok) {
      dispatch({ type: "restore", item, index });
      toast.error(errorMessage(r));
      return;
    }
    announceMatchStatus({ matchId: item.matchId, status: "dismissed" });
    toast("Dismissed", {
      description: item.post.title,
      action: {
        label: "Undo",
        onClick: async () => {
          const status = undoStatus(item.status);
          const u = await apiFetch(`/api/v1/feed/${item.matchId}/status`, {
            method: "POST",
            json: { status },
          });
          if (!u.ok) {
            toast.error(errorMessage(u));
            return;
          }
          dispatch({ type: "restore", item: { ...item, status }, index });
          announceMatchStatus({ matchId: item.matchId, status });
        },
      },
    });
  }, []);

  // Opening a row: the match page records "seen" (also for alert links); the dot goes at once.
  const open = useCallback((item: FeedItemResponse) => {
    if (item.status === "new")
      dispatch({ type: "status", matchId: item.matchId, status: "seen" });
  }, []);

  // Filters only change the query string: the native history API updates the URL and
  // `useSearchParams` (Next syncs with it) without a server round trip, so an open match page
  // isn't fetched and rendered again. The list's filters, its query and generation follow.
  const changeFilters = (next: Filters) => {
    const p = filtersToParams(next).toString();
    window.history.replaceState(null, "", `${pathname}${p ? `?${p}` : ""}`);
  };

  // Keyboard: j/k move, s save, d dismiss, o open the post on Reddit. Enter follows the link.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typingInto(e.target)) return;
      if (!["j", "k", "s", "d", "o"].includes(e.key)) return;
      const links = Array.from(
        listRef.current?.querySelectorAll<HTMLAnchorElement>(
          "a[data-match-id]",
        ) ?? [],
      );
      if (links.length === 0) return;
      const focused = links.findIndex((l) => l === document.activeElement);
      const current =
        focused >= 0
          ? focused
          : links.findIndex((l) => l.dataset.matchId === activeId);
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next =
          current < 0
            ? 0
            : Math.min(
                Math.max(current + (e.key === "j" ? 1 : -1), 0),
                links.length - 1,
              );
        links[next]!.focus();
        links[next]!.scrollIntoView({ block: "nearest" });
        // Selecting a row is intent, like resting the mouse on it.
        const href = links[next]!.getAttribute("href");
        if (selected.current && selected.current !== href)
          prefetch.cancel(selected.current);
        selected.current = href;
        if (href && links[next]!.dataset.matchId !== activeId)
          prefetch.intend(href);
        return;
      }
      const id = current >= 0 ? links[current]!.dataset.matchId : undefined;
      const item = stateRef.current.items.find((i) => i.matchId === id);
      if (!item) return;
      e.preventDefault();
      if (e.key === "s")
        void setStatus(item, item.status === "saved" ? "seen" : "saved");
      else if (e.key === "d") {
        links[current + 1]?.focus();
        void dismiss(item);
      } else if (e.key === "o")
        window.open(item.post.url, "_blank", "noopener");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, dismiss, setStatus, prefetch]);

  // A j/k selection's prefetch still waiting when the list goes away is dropped with it.
  useEffect(
    () => () => {
      if (selected.current) prefetch.cancel(selected.current);
    },
    [prefetch],
  );

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-4 pt-6 pb-3 sm:px-5 md:pt-5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Matches
        </h1>
        <div className="mt-3">
          <FeedFilters
            filters={filters}
            categories={categories}
            refreshing={refreshing}
            onChange={changeFilters}
            onRefresh={() => void refresh()}
          />
        </div>
      </header>

      {state.incoming.length > 0 && (
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "insertIncoming" });
            listRef.current?.scrollIntoView({ block: "start" });
          }}
          className="flex items-center justify-center gap-1.5 border-b border-flare-100 bg-flare-50 py-2 text-[13px] font-medium text-flare-700 hover:bg-flare-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
        >
          <ArrowUp className="size-3.5" aria-hidden="true" />
          {state.incoming.length === 1
            ? "1 new gig"
            : `${state.incoming.length} new gigs`}
        </button>
      )}

      {state.phase === "loading" && (
        <ul aria-busy="true" aria-label="Loading matches">
          {Array.from({ length: 6 }, (_, i) => (
            <MatchRowSkeleton key={i} />
          ))}
        </ul>
      )}

      {state.phase === "error" && (
        <div className="px-5 py-10 text-sm">
          <p className="text-foreground">{state.error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setAttempt((a) => a + 1)}
          >
            Try again
          </Button>
        </div>
      )}

      {state.phase === "ready" && state.items.length === 0 && (
        <div className="px-5 py-10 text-sm text-stone">
          {filters.view === "best" &&
          !filters.types.length &&
          !filters.paidOnly ? (
            <>
              <p className="text-foreground">No strong matches yet.</p>
              <p className="mt-1 max-w-sm">
                New gigs that fit your skills appear here, usually within a few
                minutes of being posted. Switch to{" "}
                <span className="font-medium">All</span> to see weaker fits too.
              </p>
            </>
          ) : (
            <p>Nothing matches these filters right now.</p>
          )}
        </div>
      )}

      {state.phase === "ready" && state.items.length > 0 && (
        <>
          <ul ref={listRef} aria-label="Matches">
            {state.items.map((item) => (
              <MatchRow
                key={item.matchId}
                item={item}
                href={`/feed/${item.matchId}${suffix}`}
                active={item.matchId === activeId}
                onOpen={() => open(item)}
                onSave={() =>
                  void setStatus(
                    item,
                    item.status === "saved" ? "seen" : "saved",
                  )
                }
                onDismiss={() => void dismiss(item)}
              />
            ))}
          </ul>
          <div ref={sentinelRef} className="px-5 py-4 text-center">
            {state.error ? (
              <>
                <p className="text-sm text-foreground">{state.error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void loadMore()}
                >
                  Try again
                </Button>
              </>
            ) : state.nextCursor ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={state.loadingMore}
                onClick={() => void loadMore()}
              >
                {state.loadingMore ? "Loading…" : "Load more"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                That&apos;s everything for now.
              </p>
            )}
          </div>
          <p className="hidden px-5 pb-5 text-xs text-muted-foreground md:block">
            Keys: <kbd className="font-sans">j</kbd>/
            <kbd className="font-sans">k</kbd> move ·{" "}
            <kbd className="font-sans">s</kbd> save ·{" "}
            <kbd className="font-sans">d</kbd> dismiss ·{" "}
            <kbd className="font-sans">o</kbd> open post
          </p>
        </>
      )}
    </div>
  );
}
