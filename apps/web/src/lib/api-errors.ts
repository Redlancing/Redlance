export type ApiErrorInfo = {
  code: string;
  message?: string;
  retryAfter?: number;
};

const FALLBACK = "Something went wrong. Please try again.";

// User-facing text per API error code (server/errors.ts). `{n}` is the Retry-After seconds.
const MESSAGES: Record<string, string> = {
  NETWORK: "Can't reach Redlance. Check your connection.",
  UNAUTHENTICATED: "Your session ended. Please sign in again.",
  BAD_ORIGIN: "That request was blocked. Reload the page and try again.",
  FORBIDDEN: "You don't have access to that.",
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  INVALID_INPUT:
    "Something in that request isn't valid. Check it and try again.",
  RATE_LIMITED: "Too many requests. Try again in {n} seconds.",
  QUOTA_EXCEEDED: "You've hit today's limit for this. Try again tomorrow.",
  VERSION_CONFLICT:
    "This changed somewhere else. Reload to see the latest version.",
  ALREADY_ONBOARDED: "Your profile is already set up.",
  INSUFFICIENT_CREDITS: "You're out of credits for this.",
  DAILY_LIMIT: "You've reached today's draft limit. It resets at midnight UTC.",
  PLAN_EXPIRED: "Your trial has ended.",
  MAX_VERSIONS: "This reply already has the most versions allowed.",
  DRAFT_NOT_READY: "That draft is still being written. Give it a moment.",
  IDEMPOTENCY_CONFLICT: "That request was already sent. Reload and try again.",
  MATCH_WITHDRAWN:
    "This post no longer fits your profile, so it can't be drafted.",
  NO_OTHER_PROJECT: "There's no other project to cite for this gig.",
  PROFILE_EDIT_LIMIT:
    "You've used all 5 profile changes for this week. Older changes free up 7 days after they were made.",
  UNAVAILABLE: "This isn't available right now. Please try again in a minute.",
  TELEGRAM_UNAVAILABLE: "Telegram alerts aren't available right now.",
  INTERNAL: FALLBACK,
};

/** User-facing message for an API error: the code's table entry, else the server's, else a generic one. */
export function errorMessage(err: ApiErrorInfo): string {
  const template = MESSAGES[err.code];
  if (template) {
    if (!template.includes("{n}")) return template;
    // Without a Retry-After there is no number to show; say it without one.
    return err.retryAfter && err.retryAfter > 0
      ? template.replace(
          "{n} seconds",
          `${err.retryAfter} ${err.retryAfter === 1 ? "second" : "seconds"}`,
        )
      : template.replace("in {n} seconds", "in a moment");
  }
  return err.message?.trim() || FALLBACK;
}
