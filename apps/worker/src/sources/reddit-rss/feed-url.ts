// Reddit RSS URLs (checked 2026-09-30): `limit` caps at 100, `after=t3_…` pages to older posts,
// `/r/a+b+c/` combines subreddits, `/search.rss` searches all of Reddit.

export const REDDIT_ORIGIN = "https://www.reddit.com";
export const PAGE_SIZE = 100;

export type FeedTarget =
  | { kind: "subreddits"; subreddits: readonly string[] }
  | { kind: "search"; query: string };

export function feedUrl(target: FeedTarget, after?: string | null): string {
  const params = new URLSearchParams();
  let path: string;
  if (target.kind === "subreddits") {
    if (target.subreddits.length === 0) throw new Error("empty subreddit feed");
    for (const s of target.subreddits)
      if (!/^[a-z0-9_]{2,21}$/.test(s)) throw new Error(`bad subreddit: ${s}`);
    path = `/r/${target.subreddits.join("+")}/new/.rss`;
  } else {
    path = "/search.rss";
    params.set("q", target.query);
    params.set("sort", "new");
    params.set("type", "link");
  }
  params.set("limit", String(PAGE_SIZE));
  if (after) {
    if (!/^t3_[a-z0-9]{1,16}$/.test(after))
      throw new Error(`bad after: ${after}`);
    params.set("after", after);
  }
  return `${REDDIT_ORIGIN}${path}?${params}`;
}
