/** The number a Minimum budget box means. "" and a lone "." (the start of ".5") mean none yet. */
export function parseRateText(text: string): number | null {
  return text === "" || text === "." ? null : Number(text);
}

/**
 * What the box shows: the typed text while it still means the form's number (so "12." and "."
 * can be typed), otherwise the form's number (a restore or discard changed it).
 */
export function rateTextToShow(typed: string, minRate: number | null): string {
  if (Object.is(parseRateText(typed), minRate)) return typed;
  return minRate === null ? "" : String(minRate);
}
