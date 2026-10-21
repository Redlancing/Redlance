import type { Plan } from "../matching/plans";

/** May this user see subreddit insights? Paid plans always; trial only before it ends. */
export function insightsAllowed(
  plan: Plan,
  trialEndsAt: Date,
  now: Date,
): boolean {
  if (plan === "trial") return now.getTime() < trialEndsAt.getTime();
  return true;
}
