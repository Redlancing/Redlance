/**
 * Rough rates as of 2026-10, for "is the budget above the user's minimum", not for money.
 * Update by hand now and then.
 */
export const FX_TO_USD: Record<"USD" | "GBP" | "EUR" | "INR", number> = {
  USD: 1,
  GBP: 1.3,
  EUR: 1.1,
  INR: 0.012,
};

/** null if either currency is unknown. */
export function convert(
  amount: number,
  from: string,
  to: string,
): number | null {
  if (!Object.hasOwn(FX_TO_USD, from) || !Object.hasOwn(FX_TO_USD, to)) {
    return null;
  }
  const f = FX_TO_USD[from as keyof typeof FX_TO_USD];
  const t = FX_TO_USD[to as keyof typeof FX_TO_USD];
  return from === to ? amount : (amount * f) / t;
}
