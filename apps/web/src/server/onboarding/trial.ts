const DAY_MS = 86_400_000;

/** Whole days left in the trial, rounded up (kept out of components: render must stay pure). */
export function trialDaysLeft(trialEndsAt: Date, now = new Date()): number {
  return Math.max(
    0,
    Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS),
  );
}
