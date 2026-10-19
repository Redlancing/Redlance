// Subscription prices, set by hand (profiles.plan) until billing exists:
// Standard is about $8-10 a month, Max is $20 a month. Agency comes later.
export const PLANS = ["trial", "standard", "max"] as const;
export type Plan = (typeof PLANS)[number];

/** AI re-scores a user may get per day. */
export const RESCORE_DAILY_CAP: Record<Plan, number> = {
  trial: 15,
  standard: 15,
  max: 50,
};

/** May this user get AI re-scores right now? Paid plans always; trial only before it ends. */
export function aiAllowed(plan: Plan, trialEndsAt: Date, now: Date): boolean {
  if (plan === "trial") return now.getTime() < trialEndsAt.getTime();
  return true;
}
