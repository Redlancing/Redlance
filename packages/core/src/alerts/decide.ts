import type { MatchStatus } from "../matching/constants";
import { aiAllowed, type Plan } from "../matching/plans";
import type { AlertOutcome, DeliveryChannel } from "./constants";

export interface AlertInput {
  match: {
    score: number;
    postedAt: Date;
    withdrawn: boolean;
    status: MatchStatus;
  };
  user: {
    plan: Plan;
    trialEndsAt: Date;
    alertMinScore: number;
    dailyCap: number;
    /** Alerts already queued, sent or failed today (the user's local day). */
    routedToday: number;
  };
  /** The user's Telegram channel, or null when they never linked one. */
  telegram: { enabled: boolean; verified: boolean } | null;
  /** False when the worker has no bot token. */
  telegramAvailable: boolean;
  maxAgeHours: number;
}

export interface AlertDecision {
  outcome: AlertOutcome;
  channels: DeliveryChannel[];
}

const skip = (outcome: AlertOutcome): AlertDecision => ({
  outcome,
  channels: [],
});

/** Every alert rule, in order; the first that applies wins. Pure: no db, no clock. */
export function decideAlert(input: AlertInput, now: Date): AlertDecision {
  const { match, user, telegram } = input;
  if (match.withdrawn || match.status === "dismissed") {
    return skip("skipped_withdrawn");
  }
  if (match.score < user.alertMinScore) return skip("below_threshold");
  const ageMs = now.getTime() - match.postedAt.getTime();
  if (ageMs > input.maxAgeHours * 3_600_000) return skip("skipped_stale");
  if (!aiAllowed(user.plan, user.trialEndsAt, now))
    return skip("skipped_trial");
  if (user.routedToday >= user.dailyCap) return skip("skipped_cap");
  if (
    !input.telegramAvailable ||
    !telegram ||
    !telegram.enabled ||
    !telegram.verified
  ) {
    return skip("skipped_no_channel");
  }
  return { outcome: "queued", channels: ["telegram"] };
}
