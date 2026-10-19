export const RESCORE_THRESHOLD_DEFAULT = 50; // rule score needed for AI (worker env can override)
export const BEST_MIN_SCORE = 60; // the feed's "best" view
export const BROAD_CAP = 45; // safety cap; today's weights already keep broad <= 30
export const MATCH_MAX_AGE_DAYS = 7;
export const BACKFILL_DAYS = 3; // a new user's feed
export const REMATCH_DAYS = 7; // after a profile change

export const MATCH_STATUSES = [
  "new",
  "seen",
  "saved",
  "dismissed",
  "replied",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const AI_STATUSES = [
  "not_needed",
  "pending",
  "running",
  "done",
  "failed",
  "capped",
] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

/** Every status change is an event. */
export const MATCH_EVENTS = MATCH_STATUSES;
