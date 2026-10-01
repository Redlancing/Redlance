import { SUBREDDIT_CATALOGUE } from "./subreddit-catalogue";
import type { CategoryId } from "./taxonomy";

/**
 * The subreddit catalogue: every subreddit we poll, and every one we decided not to (with the
 * reason), so nothing gets re-added by accident. Built from the study in
 * docs/ingestion/research/ (data: `research/data/catalogue.json`). Users are not connected to
 * subreddits: everyone's feed comes from all active ones, filtered by what each post asks for.
 */

export const SUBREDDIT_TIERS = ["core", "low", "regional", "custom"] as const;
/** core = freelance boards; low = mostly freelancers advertising; regional = local job boards; custom = added by a paying user (later). */
export type SubredditTier = (typeof SUBREDDIT_TIERS)[number];

export const SUBREDDIT_STATUSES = [
  "active",
  "excluded",
  "dead",
  "gone",
] as const;
/** Only `active` subreddits are polled. dead = no posts in 30+ days; gone = banned, private or renamed. */
export type SubredditStatus = (typeof SUBREDDIT_STATUSES)[number];

export type SeedSubreddit = {
  /** Lowercase, no "r/": the key. */
  name: string;
  /** Casing as Reddit shows it. */
  displayName: string;
  /** Job types it mostly carries; [] = a general board. */
  categories: readonly CategoryId[];
  tier: SubredditTier;
  status: SubredditStatus;
  /** How clients mark hiring posts there, or why it isn't polled. */
  note?: string;
  /** Measured in the study; seeds the first feed plan until the worker has its own counts. */
  postsPerDay?: number;
};

export const SUBREDDIT_NAME_RE = /^[a-z0-9_]{2,21}$/;

export const SUBREDDITS: readonly SeedSubreddit[] = SUBREDDIT_CATALOGUE;

export const ACTIVE_SUBREDDITS = SUBREDDITS.filter(
  (s) => s.status === "active",
);
