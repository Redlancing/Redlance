// Subreddit insights (docs/insights/design.md). Rule 8: no number under ~20 data points.
export const INSIGHT_MIN_POINTS = 20;
export const INSIGHT_WINDOW_DAYS = 28; // "this month"; the trend compares it with the 28 days before
export const REPEAT_LOOKBACK_DAYS = 180; // an earlier hiring post by the same author counts as a repeat client
export const SKILL_MIN_MENTIONS = 3; // a skill needs this many mentions to be listed
export const INSIGHT_SUBREDDITS_DAYS = 30; // "your subreddits" = a match in this many days
/** Half-hour slots in a week, Monday 00:00 UTC = 0. */
export const HOUR_SLOTS = 336;
