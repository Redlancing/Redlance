import { budgetLabel } from "@redlance/core";

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

/** "now", "5m", "2h", "3d", then "Oct 12" (UTC) after a week. Future times read "now". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${MONTHS[then.getUTCMonth()]} ${then.getUTCDate()}`;
}

export type Budget = {
  min: number | null;
  max: number | null;
  currency: string | null;
  unit: string | null;
};

/** "$400–600", "£30/hr" or null; the same wording as alerts. */
export function budgetText(budget: Budget | null | undefined): string | null {
  return budget ? budgetLabel(budget) : null;
}

export type ScoreBand = "strong" | "good" | "fair";

export function scoreBand(score: number): ScoreBand {
  if (score >= 85) return "strong";
  if (score >= 70) return "good";
  return "fair";
}

/** The Reddit page for a community name, with or without "r/". */
export function communityUrl(name: string): string {
  const clean = name.trim().replace(/^\/?r\//i, "");
  return `https://www.reddit.com/r/${encodeURIComponent(clean)}/`;
}
