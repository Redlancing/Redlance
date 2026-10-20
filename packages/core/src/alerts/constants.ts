// Telegram alerts (docs/alerts/README.md). The db schema mirrors these lists.

/** What the router decided for a match; null on the row means not routed yet. */
export const ALERT_OUTCOMES = [
  "queued",
  "sent",
  "failed",
  "below_threshold",
  "skipped_backfill",
  "skipped_stale",
  "skipped_trial",
  "skipped_cap",
  "skipped_no_channel",
  "skipped_withdrawn",
] as const;
export type AlertOutcome = (typeof ALERT_OUTCOMES)[number];

/** Outcomes that count toward the user's daily cap. */
export const CAPPED_OUTCOMES = ["queued", "sent", "failed"] as const;

export const DELIVERY_CHANNELS = ["telegram"] as const; // "email" later
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export const DELIVERY_STATUSES = ["pending", "sending", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
/** Why a channel was turned off: the bot was blocked, or the user sent /stop or unlinked. */
export const CHANNEL_DISABLED_REASONS = ["blocked", "user_stop"] as const;
export type ChannelDisabledReason = (typeof CHANNEL_DISABLED_REASONS)[number];

export const ALERT_MIN_SCORE_DEFAULT = 70;
export const ALERTS_DAILY_CAP_DEFAULT = 20;
export const ALERT_MAX_AGE_HOURS_DEFAULT = 24;
export const MAX_DELIVERY_ATTEMPTS = 5;
export const TELEGRAM_MATCHES_PER_MESSAGE = 5;
/** Stored on the match when sent, so we know which wording a user saw. */
export const TEMPLATE_VERSIONS = { telegram: "tg@1" } as const;
