import { REDDIT_ORIGIN } from "./feed-url";

// One GET against Reddit's RSS. Never throws: every outcome comes back as a result the poller
// can log and schedule around. Only www.reddit.com, no redirects, 30 s timeout, 3 MB cap.

export const MAX_FEED_BYTES = 3 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 30_000;

export type RateLimit = {
  /** x-ratelimit-remaining (0 after the one request a minute signed-out RSS allows). */
  remaining: number | null;
  /** x-ratelimit-reset: seconds until the window resets. */
  resetSeconds: number | null;
};

export type FetchResult =
  | { ok: true; status: number; body: string; rateLimit: RateLimit }
  | {
      ok: false;
      status: number | null;
      /** RATE_LIMITED | BLOCKED | NOT_FOUND | HTTP_ERROR | NOT_A_FEED | TOO_LARGE | REDIRECT | TIMEOUT | NETWORK | ABORTED */
      errorCode: string;
      rateLimit: RateLimit;
    };

export type FetchDeps = {
  userAgent: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
};

const num = (v: string | null) => {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function readRateLimit(headers: Headers): RateLimit {
  const reset = num(headers.get("x-ratelimit-reset"));
  return {
    remaining: num(headers.get("x-ratelimit-remaining")),
    resetSeconds: reset === null ? null : Math.max(0, Math.round(reset)),
  };
}

class TooLarge extends Error {}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = num(res.headers.get("content-length"));
  if (declared !== null && declared > maxBytes) throw new TooLarge();
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchFeed(
  url: string,
  deps: FetchDeps,
): Promise<FetchResult> {
  const noLimit: RateLimit = { remaining: null, resetSeconds: null };
  if (!url.startsWith(`${REDDIT_ORIGIN}/`))
    throw new Error(`refusing to fetch outside Reddit: ${url}`);

  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new Error("timeout")),
    deps.timeoutMs ?? FEED_TIMEOUT_MS,
  );
  const onOuter = () => ctrl.abort(deps.signal?.reason);
  deps.signal?.addEventListener("abort", onOuter, { once: true });
  const failed = (errorCode: string, status: number | null, rl = noLimit) =>
    ({ ok: false, status, errorCode, rateLimit: rl }) as const;
  try {
    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(url, {
        headers: {
          "User-Agent": deps.userAgent,
          Accept: "application/atom+xml, application/xml;q=0.9",
        },
        redirect: "error",
        signal: ctrl.signal,
      });
    } catch (err) {
      if (deps.signal?.aborted) return failed("ABORTED", null);
      if (ctrl.signal.aborted) return failed("TIMEOUT", null);
      // fetch rejects redirects when redirect = "error" (a banned subreddit can redirect).
      return failed(
        /redirect/i.test(String((err as Error)?.message))
          ? "REDIRECT"
          : "NETWORK",
        null,
      );
    }
    const rateLimit = readRateLimit(res.headers);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      const code =
        res.status === 429
          ? "RATE_LIMITED"
          : res.status === 403
            ? "BLOCKED"
            : res.status === 404
              ? "NOT_FOUND"
              : "HTTP_ERROR";
      return failed(code, res.status, rateLimit);
    }
    let body: string;
    try {
      body = await readCapped(res, deps.maxBytes ?? MAX_FEED_BYTES);
    } catch (err) {
      if (err instanceof TooLarge)
        return failed("TOO_LARGE", res.status, rateLimit);
      if (deps.signal?.aborted) return failed("ABORTED", res.status, rateLimit);
      if (ctrl.signal.aborted) return failed("TIMEOUT", res.status, rateLimit);
      return failed("NETWORK", res.status, rateLimit);
    }
    // A block page or an interstitial comes back as HTML with a 200.
    if (!/^\s*(<\?xml[^>]*>\s*)?<feed[\s>]/.test(body))
      return failed("NOT_A_FEED", res.status, rateLimit);
    return { ok: true, status: res.status, body, rateLimit };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onOuter);
  }
}
