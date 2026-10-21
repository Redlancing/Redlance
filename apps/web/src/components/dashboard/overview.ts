export type ChecklistItem = {
  id: "onboarding" | "telegram" | "first-reply";
  label: string;
  href: string;
  done: boolean;
};

/** The setup steps in order, each with whether it is done. */
export function setupChecklist(input: {
  onboarded: boolean;
  telegramOn: boolean;
  sentEver: number;
}): ChecklistItem[] {
  return [
    {
      id: "onboarding",
      label: "Finish onboarding",
      href: "/onboarding",
      done: input.onboarded,
    },
    {
      id: "telegram",
      label: "Connect Telegram",
      href: "/settings",
      done: input.telegramOn,
    },
    {
      id: "first-reply",
      label: "Draft and send your first reply",
      href: "/feed",
      done: input.sentEver > 0,
    },
  ];
}

export function checklistComplete(items: ChecklistItem[]): boolean {
  return items.every((i) => i.done);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Oct 12" in UTC, or "" for a bad date. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "840 credits · about 120 replies left · resets Nov 3" (trial: "trial ends"). */
export function creditsLine(c: {
  plan: string | null;
  balance: number;
  repliesLeft: number;
  periodEnd: string | null;
}): string | null {
  if (!c.plan) return null;
  const parts = [
    `${c.balance.toLocaleString("en-US")} ${c.balance === 1 ? "credit" : "credits"}`,
    `about ${c.repliesLeft.toLocaleString("en-US")} ${c.repliesLeft === 1 ? "reply" : "replies"} left`,
  ];
  const date = c.periodEnd ? shortDate(c.periodEnd) : "";
  if (date)
    parts.push(`${c.plan === "trial" ? "trial ends" : "resets"} ${date}`);
  return parts.join(" · ");
}
