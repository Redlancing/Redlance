import "server-only";
import { feedPage } from "@redlance/db";
import {
  FEED_PAGE_SIZE,
  filtersFrom,
  type InitialFeed,
} from "@/components/feed/feed-state";
import { stampNow } from "@/lib/freshness";
import { getDb } from "./db";
import { toFeedResponse } from "./feed";
import { getLogger } from "./logger";
import {
  REQUEST_PATH_HEADER,
  searchParamsFromRequestPath,
} from "./request-path";

/**
 * The header Next's client router sends on its RSC requests (navigations and prefetches): the
 * route tree it asks about, URI-encoded JSON (`[segment, { slot: child }, url?, marker?]`).
 * Next 16 sends no `Next-Router-Prefetch` header on a full prefetch (`PrefetchKind.FULL`), so this
 * tree is how the server can tell the browser already has a layout.
 */
export const ROUTER_STATE_TREE_HEADER = "next-router-state-tree";

/**
 * True when the router state tree of the request holds the layout at `path` (segments from the
 * root, following the `children` slot). Then the browser already has that layout: a prefetch
 * from inside it (whose tree is the target route), or a navigation or refresh within it. Anything
 * unexpected (no header, a document request, a format change in a Next upgrade) is false, which
 * only costs the work the layout would have done anyway.
 */
export function clientHasLayout(
  stateTree: string | null | undefined,
  path: readonly string[],
): boolean {
  if (!stateTree) return false;
  let node: unknown;
  try {
    node = JSON.parse(decodeURIComponent(stateTree));
  } catch {
    return false;
  }
  for (let i = 0; i < path.length; i++) {
    if (!Array.isArray(node) || node[0] !== path[i]) return false;
    if (i === path.length - 1) return true;
    const slots: unknown = node[1];
    node =
      slots && typeof slots === "object"
        ? (slots as Record<string, unknown>).children
        : undefined;
  }
  return false;
}

/** The feed layout's place in the route tree (`app/(app)/feed/layout.tsx`). */
const FEED_LAYOUT_PATH = ["", "(app)", "feed"] as const;

/**
 * The first page of the list for the feed layout, read with the code behind GET /api/v1/feed.
 * Layouts get no `searchParams`, so the filters come from the URL the proxy puts in a header it
 * overwrites on every request.
 *
 * Undefined (the list then fetches its first page itself) when:
 * - the browser already has the feed layout: its mounted list ignores a new `initial`, and a
 *   full prefetch of a match page renders this layout again once Next's cached copy of it is
 *   old, which would run the query for nothing;
 * - the read fails (logged).
 */
export async function loadInitialFeed({
  userId,
  categories,
  headers,
  read = feedPage,
  now = stampNow,
  log = getLogger(),
}: {
  userId: string;
  categories: string[];
  headers: Headers;
  read?: typeof feedPage;
  now?: () => number;
  log?: Pick<ReturnType<typeof getLogger>, "error">;
}): Promise<InitialFeed | undefined> {
  if (clientHasLayout(headers.get(ROUTER_STATE_TREE_HEADER), FEED_LAYOUT_PATH))
    return undefined;
  const loadedAt = now();
  const filters = filtersFrom(
    searchParamsFromRequestPath(headers.get(REQUEST_PATH_HEADER)),
    categories,
  );
  try {
    const page = toFeedResponse(
      await read(getDb(), userId, {
        view: filters.view,
        categories: filters.types.length ? filters.types : undefined,
        pay: filters.paidOnly ? "paid" : "any",
        limit: FEED_PAGE_SIZE,
      }),
    );
    return { filters, loadedAt, ...page };
  } catch (err) {
    log.error({ err, userId }, "feed layout: first page read failed");
    return undefined;
  }
}
