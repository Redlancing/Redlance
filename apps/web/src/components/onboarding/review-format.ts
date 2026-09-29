/** Minimum budget as text; 0 means the user accepts any budget. */
export function formatMoney(amount: number, currency: string): string {
  if (amount === 0) return "Any budget";
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);
}
