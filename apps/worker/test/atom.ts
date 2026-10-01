// Builds synthetic Reddit Atom feeds in the exact format Reddit returns (see
// test/fixtures/README.md). Test-only.

export type FakePost = {
  id: string; // without t3_
  /** Subreddit, or "u/name" for a post on a user's profile. */
  sub: string;
  title: string;
  body?: string;
  user?: string;
  publishedAt: Date;
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function atomFeed(posts: FakePost[]): string {
  const entries = posts.map((p) => {
    const user = p.user ?? "test_user";
    const path = p.sub.startsWith("u/") ? `u_${p.sub.slice(2)}` : p.sub;
    const link = `https://www.reddit.com/r/${path}/comments/${p.id}/post/`;
    const inner = `<!-- SC_OFF --><div class="md"><p>${esc(p.body ?? "Body text.")}</p></div><!-- SC_ON --> &#32; submitted by &#32; <a href="https://www.reddit.com/user/${user}"> /u/${user} </a> &#32; to &#32; <a href="https://www.reddit.com/r/${p.sub}/"> r/${p.sub} </a> <br/> <span><a href="${link}">[link]</a></span> &#32; <span><a href="${link}">[comments]</a></span>`;
    const at = p.publishedAt.toISOString().replace(".000Z", "+00:00");
    return `<entry><author><name>/u/${user}</name><uri>https://www.reddit.com/user/${user}</uri></author><category term="${p.sub}" label="r/${p.sub}"/><content type="html">${esc(inner)}</content><id>t3_${p.id}</id><link href="${link}" /><updated>${at}</updated><published>${at}</published><title>${esc(p.title)}</title></entry>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><category term="multi" label="r/multi"/><updated>2026-09-30T07:14:47+00:00</updated><id>/r/multi/new/.rss</id><title>newest submissions : multi</title>${entries.join("")}</feed>`;
}

/** n posts, newest first, one minute apart, ids `${prefix}0`, `${prefix}1`, … */
export function fakePosts(
  n: number,
  opts: {
    prefix: string;
    sub: string;
    newest?: Date;
    title?: (i: number) => string;
  },
): FakePost[] {
  const newest = opts.newest ?? new Date();
  return Array.from({ length: n }, (_, i) => ({
    id: `${opts.prefix}${i}`,
    sub: opts.sub,
    title: opts.title?.(i) ?? `[Hiring] Job ${opts.prefix}${i}`,
    publishedAt: new Date(newest.getTime() - i * 60_000),
  }));
}

export const RATE_HEADERS = {
  "content-type": "application/atom+xml; charset=UTF-8",
  "x-ratelimit-used": "1",
  "x-ratelimit-remaining": "0.0",
  "x-ratelimit-reset": "30",
};

/** A fake fetch that records URLs and answers from a function. */
export function fakeFetch(
  answer: (url: string) => Response,
  calls: string[] = [],
): typeof fetch {
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    return answer(String(url));
  }) as typeof fetch;
}
