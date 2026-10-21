import type {
  BudgetGroup,
  Insight,
  InsightsListRow,
  SubredditInsightsResponse,
} from "@redlance/core";
import { timeAgo } from "./format";

// Pure view helpers for the insights pages (docs/insights/design.md "The pages"). The server has
// already applied rule 8: an insight is either a number ("ok") or a reason there's none yet.
// Wording rule: "posted budgets", never "market rate".

export type InsightsTab = "yours" | "all";

export function parseTab(value: string | string[] | undefined): InsightsTab {
  return value === "all" ? "all" : "yours";
}

export function tabHref(tab: InsightsTab): string {
  return tab === "all" ? "/insights?tab=all" : "/insights";
}

export function subredditHref(name: string): string {
  return `/insights/${encodeURIComponent(name)}`;
}

/** The detail route's param: lowercase, Reddit's name rules, else null (404). */
export function parseSubredditParam(raw: string): string | null {
  let name: string;
  try {
    name = decodeURIComponent(raw).toLowerCase();
  } catch {
    return null;
  }
  return /^[a-z0-9_]{2,21}$/.test(name) ? name : null;
}

/** The quiet line shown in place of a number, or null when the insight has one. */
export function quietText(i: Insight<object>): string | null {
  if (i.status === "not_enough")
    return `Not enough data yet (${i.have} of ${i.need})`;
  if (i.status === "building")
    return `Building history (${i.days} ${i.days === 1 ? "day" : "days"})`;
  return null;
}

// ---------- money ----------

const MONEY: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  INR: "₹",
};

const UNIT_LONG: Record<string, string> = {
  fixed: "fixed price",
  hour: "per hour",
  day: "per day",
  week: "per week",
  month: "per month",
  per_item: "per item",
};

const UNIT_SHORT: Record<string, string> = {
  fixed: " fixed",
  hour: "/hour",
  day: "/day",
  week: "/week",
  month: "/month",
  per_item: "/item",
};

function amount(v: number, currency: string): string {
  const n = Math.round(v).toLocaleString("en-US");
  const sym = MONEY[currency];
  return sym ? `${sym}${n}` : `${n} ${currency}`;
}

/** "$15–35" (the middle half of posted budgets); one value when both ends round alike. */
export function budgetRange(g: BudgetGroup): string {
  const lo = Math.round(g.p25);
  const hi = Math.round(g.p75);
  if (lo === hi) return amount(lo, g.currency);
  const sym = MONEY[g.currency];
  return sym
    ? `${sym}${lo.toLocaleString("en-US")}–${hi.toLocaleString("en-US")}`
    : `${lo.toLocaleString("en-US")}–${hi.toLocaleString("en-US")} ${g.currency}`;
}

export function budgetMiddle(g: BudgetGroup): string {
  return amount(g.median, g.currency);
}

/** "USD per hour", "GBP fixed price". */
export function budgetGroupLabel(g: BudgetGroup): string {
  return `${g.currency} ${UNIT_LONG[g.unit] ?? g.unit}`;
}

/** The list's compact form: "$15–35/hour", "£300–800 fixed". */
export function budgetShort(g: BudgetGroup): string {
  return `${budgetRange(g)}${UNIT_SHORT[g.unit] ?? ` ${g.unit}`}`;
}

// ---------- hours ----------

/** "12 am", "6 am", "12 pm", "6 pm". */
export function hourLabel(h: number): string {
  const hour = ((h % 24) + 24) % 24;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${hour < 12 ? "am" : "pm"}`;
}

/** A span of hours: "6–10 pm", "10 pm–2 am", "10 am–2 pm". */
export function hourSpan(start: number, length: number): string {
  const a = ((start % 24) + 24) % 24;
  const b = (a + length) % 24;
  const [an, am] = hourLabel(a).split(" ");
  const [bn, bm] = hourLabel(b).split(" ");
  return am === bm && a < b ? `${an}–${bn} ${bm}` : `${an} ${am}–${bn} ${bm}`;
}

/** Is local hour `h` inside the busiest 4-hour stretch (which may wrap past midnight)? */
export function inStretch(h: number, start: number, length = 4): boolean {
  return (((h - start) % 24) + 24) % 24 < length;
}

const PATTERN_TEXT = {
  weekdays: "mostly on weekdays",
  weekends: "mostly at weekends",
  "all week": "spread across the week",
} as const;

export function hoursSentence(
  start: number,
  pattern: keyof typeof PATTERN_TEXT,
): string {
  return `Most posts arrive ${hourSpan(start, 4)} your time, ${PATTERN_TEXT[pattern]}.`;
}

/** "Asia/Kolkata" → "Kolkata"; "UTC" stays. */
export function zoneName(timeZone: string): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

// ---------- the detail page's facts ----------

export type Fact =
  | {
      key: string;
      label: string;
      value: string;
      sentence: string;
      tone?: "danger";
    }
  | { key: string; label: string; quiet: string };

/** At or above this red-flag share the number is shown in the danger colour. */
export const RED_FLAG_WARN_PERCENT = 20;

function fact<T extends object>(
  key: string,
  label: string,
  i: Insight<T>,
  build: (v: T) => { value: string; sentence: string; tone?: "danger" },
): Fact {
  if (i.status !== "ok") return { key, label, quiet: quietText(i)! };
  return { key, label, ...build(i as unknown as T) };
}

export function weekSentence(perWeek: number, prev: number | null): string {
  if (prev === null) return "hiring posts a week";
  if (perWeek > prev) return `hiring posts a week, up from ${prev}`;
  if (perWeek < prev) return `hiring posts a week, down from ${prev}`;
  return "hiring posts a week, same as the month before";
}

export function trendOf(
  perWeek: number,
  prev: number | null,
): "up" | "down" | null {
  if (prev === null || perWeek === prev) return null;
  return perWeek > prev ? "up" : "down";
}

function pctOf(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  let n = Math.round((part / whole) * 100);
  if (n === 0 && part > 0) n = 1;
  if (n === 100 && part < whole) n = 99;
  return `${n}%`;
}

function paidSentence(p: {
  revShare: number;
  unpaid: number;
  other: number;
}): string {
  const rest = [
    p.revShare > 0 ? `${p.revShare}% offer a revenue share` : null,
    p.unpaid > 0 ? `${p.unpaid}% are unpaid` : null,
    p.other > 0 ? `${p.other}% don't say` : null,
  ].filter(Boolean);
  return rest.length > 0 ? `are paid; ${rest.join(", ")}` : "are paid";
}

/** "This month": volume, fit and terms. */
export function hiringFacts(r: SubredditInsightsResponse): Fact[] {
  return [
    fact("perWeek", "Hiring posts", r.postsPerWeek, (v) => ({
      value: `~${v.perWeek}`,
      sentence: weekSentence(v.perWeek, v.prevPerWeek),
    })),
    fact("fit", "Fits you", r.fit, (v) => ({
      value: pctOf(v.best, v.hiring),
      sentence: `${v.best} of ${v.hiring} hiring posts fit your skills`,
    })),
    fact("paid", "Paid", r.paid, (v) => ({
      value: `${v.paid}%`,
      sentence: paidSentence(v),
    })),
    fact("budgetStated", "Budget stated", r.budgetStated, (v) => ({
      value: `${v.percent}%`,
      sentence: "of hiring posts state a budget",
    })),
    fact("remote", "Remote", r.remote, (v) => ({
      value: `${v.percent}%`,
      sentence: "of hiring posts are remote",
    })),
  ];
}

/** Risk and competition. Repeat clients is a percentage only (rule 7). */
export function riskFacts(r: SubredditInsightsResponse): Fact[] {
  return [
    fact("redFlags", "Red flags", r.redFlags, (v) => ({
      value: `${v.percent}%`,
      sentence: v.text,
      tone: v.percent >= RED_FLAG_WARN_PERCENT ? "danger" : undefined,
    })),
    fact("crowded", "Competition", r.crowded, (v) => ({
      value: v.perHiringPost,
      sentence: "freelancers advertise for every hiring post",
    })),
    fact("repeat", "Repeat clients", r.repeatClients, (v) => ({
      value: `${v.percent}%`,
      sentence: "of hiring posts come from people who hired before",
    })),
  ];
}

/** True when not one of the eleven insights has a number yet (first days of data). */
export function nothingYet(r: SubredditInsightsResponse): boolean {
  return [
    r.postsPerWeek,
    r.fit,
    r.budgets,
    r.hours,
    r.skills,
    r.paid,
    r.redFlags,
    r.crowded,
    r.budgetStated,
    r.remote,
    r.repeatClients,
  ].every((i) => i.status !== "ok");
}

// ---------- the list ----------

export type Cell<T> = { ok: true; value: T } | { ok: false; quiet: string };

function cell<T, V extends object>(i: Insight<V>, pick: (v: V) => T): Cell<T> {
  return i.status === "ok"
    ? { ok: true, value: pick(i as unknown as V) }
    : { ok: false, quiet: quietText(i)! };
}

export type ListRowView = {
  name: string;
  displayName: string;
  href: string;
  perWeek: Cell<{
    text: string;
    trend: "up" | "down" | null;
    prev: number | null;
  }>;
  fit: Cell<string> | null;
  budget: Cell<string>;
  redFlags: Cell<{ text: string; danger: boolean }>;
  matches: number | null;
};

export function listRowView(row: InsightsListRow): ListRowView {
  return {
    name: row.subreddit,
    displayName: row.displayName,
    href: subredditHref(row.subreddit),
    perWeek: cell(row.perWeek, (v) => ({
      text: `~${v.perWeek}`,
      trend: trendOf(v.perWeek, v.prevPerWeek),
      prev: v.prevPerWeek,
    })),
    fit: row.fit === null ? null : cell(row.fit, (v) => v.text),
    budget: cell(row.mainBudget, (v) => budgetShort(v.group)),
    redFlags: cell(row.redFlagPercent, (v) => ({
      text: `${v.percent}%`,
      danger: v.percent >= RED_FLAG_WARN_PERCENT,
    })),
    matches: row.matches ?? null,
  };
}

/** No row has a weekly number yet: the first days after insights start. */
export function listBuilding(rows: InsightsListRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.perWeek.status !== "ok");
}

/** Browse all's filter box: matches the name (with or without "r/") or the display name. */
export function filterRows<
  T extends { subreddit: string; displayName: string },
>(rows: T[], query: string): T[] {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/^\/?r\//, "");
  if (q === "") return rows;
  return rows.filter(
    (r) =>
      r.subreddit.toLowerCase().includes(q) ||
      r.displayName.toLowerCase().includes(q),
  );
}

/** What the page shows instead of (or above) its list. */
export type ListState = "rows" | "empty-yours" | "empty-all";

export function listState(tab: InsightsTab, rows: unknown[]): ListState {
  if (rows.length > 0) return "rows";
  return tab === "yours" ? "empty-yours" : "empty-all";
}

/** How the page reads the viewer check's outcome (`insightsViewer` throws coded errors). */
export type Access = "ok" | "locked" | "not_onboarded";

export function accessFromCode(code: string | undefined): Access | null {
  if (code === "INSIGHTS_LOCKED") return "locked";
  if (code === "NOT_FOUND") return "not_onboarded";
  return null;
}

/** "Updated 12m ago", "Updated just now", "Updated Oct 12". */
export function updatedText(iso: string, now: Date = new Date()): string {
  const ago = timeAgo(iso, now);
  if (ago === "") return "";
  if (ago === "now") return "Updated just now";
  return /^\d/.test(ago) ? `Updated ${ago} ago` : `Updated ${ago}`;
}
