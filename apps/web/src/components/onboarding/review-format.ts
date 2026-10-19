/** Minimum budget as text; 0 means the user accepts any budget. */
export function formatMoney(amount: number, currency: string): string {
  if (amount === 0) return "Any budget";
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    amount,
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "2 projects · 3 roles · employer names off", or "None added" when both lists are empty. */
export function workSummary(work: {
  projects: readonly unknown[];
  experience: readonly unknown[];
  mentionEmployers: boolean;
}): string {
  if (work.projects.length === 0 && work.experience.length === 0)
    return "None added";
  return [
    plural(work.projects.length, "project"),
    plural(work.experience.length, "role"),
    `employer names ${work.mentionEmployers ? "on" : "off"}`,
  ].join(" · ");
}
