import type { FetchResult } from "../sources/reddit-rss/client";

// The one request slot for the whole system. Signed-out RSS allows 1 request a minute per IP
// (fixed windows); a request seconds after a window reset still got 429s in testing, so the
// floor is 65 s between requests, and the reset header can only push the next one later.
// The slot is reserved before a request goes out, so a crash after sending can't shorten the
// gap, and after a restart the governor is seeded from the poll log.

export const MIN_SPACING_MS = 65_000;
const MAX_RATE_BACKOFF_MS = 10 * 60_000;
const BLOCK_BACKOFF_MS = 30 * 60_000;
const MAX_BLOCK_BACKOFF_MS = 2 * 60 * 60_000;

export type GovernorState = {
  nextAllowedAt: number;
  rateLimitedStreak: number;
  blockedStreak: number;
};

export type GovernorResult = Pick<FetchResult, "ok" | "rateLimit"> & {
  errorCode?: string | null;
};

const isBlock = (code?: string | null) =>
  code === "BLOCKED" || code === "NOT_A_FEED";

export class RequestGovernor {
  private nextAt = 0;
  private rateLimited = 0;
  private blocked = 0;
  private lastBlockedFeed: string | null = null;

  constructor(
    private readonly minSpacingMs = MIN_SPACING_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Epoch ms when the next request may go out. */
  nextAllowedAt(): number {
    return this.nextAt;
  }

  state(): GovernorState {
    return {
      nextAllowedAt: this.nextAt,
      rateLimitedStreak: this.rateLimited,
      blockedStreak: this.blocked,
    };
  }

  /** Call right before sending: holds the slot even if we crash before onResult. */
  reserve(): void {
    this.nextAt = Math.max(this.nextAt, this.now() + this.minSpacingMs);
  }

  /**
   * Call after every request. One feed's 403 is that feed's problem (a private or banned
   * subreddit); refusals from two different feeds in a row look like an IP block, so the whole
   * system backs off.
   */
  onResult(
    result: GovernorResult,
    feedId: string | null = null,
    at = this.now(),
  ): void {
    let next = at + this.minSpacingMs;
    const reset = result.rateLimit.resetSeconds;
    if (reset !== null && (result.rateLimit.remaining ?? 0) <= 0)
      next = Math.max(next, at + (reset + 2) * 1000);

    if (result.ok) {
      this.rateLimited = 0;
      this.blocked = 0;
      this.lastBlockedFeed = null;
    } else if (result.errorCode === "RATE_LIMITED") {
      this.rateLimited++;
      const backoff = Math.min(
        60_000 * 2 ** (this.rateLimited - 1),
        MAX_RATE_BACKOFF_MS,
      );
      next = Math.max(next, at + backoff, at + ((reset ?? 0) + 5) * 1000);
    } else if (isBlock(result.errorCode)) {
      const sameFeed = feedId !== null && feedId === this.lastBlockedFeed;
      if (this.lastBlockedFeed !== null && !sameFeed) {
        this.blocked++;
        next = Math.max(
          next,
          at +
            Math.min(
              BLOCK_BACKOFF_MS * 2 ** (this.blocked - 1),
              MAX_BLOCK_BACKOFF_MS,
            ),
        );
      }
      this.lastBlockedFeed = feedId ?? "?";
    } else if (
      result.errorCode === "TIMEOUT" ||
      result.errorCode === "NETWORK" ||
      result.errorCode === "HTTP_ERROR"
    ) {
      next = Math.max(next, at + 2 * this.minSpacingMs);
    }
    this.nextAt = next; // a result always comes after its own reservation, so this never shortens it
  }

  /**
   * Rebuilds the state from the poll log (newest first) after a restart or a lock handover,
   * so the first request still respects the spacing and any backoff in progress.
   */
  seed(
    polls: {
      feedId: string | null;
      startedAt: Date;
      durationMs: number;
      errorCode: string | null;
      rateLimitRemaining: number | null;
      rateLimitReset: number | null;
    }[],
  ): void {
    for (const p of [...polls].reverse())
      this.onResult(
        {
          ok: p.errorCode === null,
          errorCode: p.errorCode,
          rateLimit: {
            remaining: p.rateLimitRemaining,
            resetSeconds: p.rateLimitReset,
          },
        },
        p.feedId,
        p.startedAt.getTime() + p.durationMs,
      );
  }
}
