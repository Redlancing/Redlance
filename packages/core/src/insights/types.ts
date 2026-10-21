import type { BudgetUnit } from "../job-post";

/** One insight as the API sends it: numbers only when past the threshold (rule 8). */
export type Insight<T> =
  | ({ status: "ok" } & T)
  | { status: "not_enough"; have: number; need: number }
  | { status: "building"; days: number };

export type BudgetGroup = {
  currency: string;
  unit: BudgetUnit;
  n: number;
  p25: number;
  median: number;
  p75: number;
};

export type SkillShare = {
  skillId: string;
  name: string;
  mentions: number;
  percent: number;
};

export type InsightMatch = {
  matchId: string;
  title: string;
  score: number;
  postedAt: string;
};

/** The eleven insights for one subreddit (docs/insights/design.md). */
export type SubredditInsightsResponse = {
  subreddit: string;
  displayName: string;
  computedAt: string;
  postsPerWeek: Insight<{ perWeek: number; prevPerWeek: number | null }>; // 1
  fit: Insight<{ best: number; hiring: number; text: string }>; // 2
  budgets: Insight<{ groups: BudgetGroup[] }>; // 3
  hours: Insight<{
    timeZone: string;
    hours: number[]; // 24 local hours
    busiestStartHour: number;
    pattern: "weekdays" | "weekends" | "all week";
  }>; // 4
  skills: Insight<{ skills: SkillShare[] }>; // 5
  paid: Insight<{
    paid: number;
    revShare: number;
    commission: number; // commission only
    unpaid: number;
    other: number;
  }>; // 6, percents
  redFlags: Insight<{
    percent: number;
    text: string;
    top: { flag: string; count: number }[];
  }>; // 7
  crowded: Insight<{ perHiringPost: string }>; // 8
  budgetStated: Insight<{ percent: number }>; // 9
  remote: Insight<{ percent: number; unknown: number }>; // 10, unknown = % that don't say
  repeatClients: Insight<{ percent: number }>; // 11 (a percentage only: rule 7)
  latestMatches: InsightMatch[];
};

export type InsightsListRow = {
  subreddit: string;
  displayName: string;
  perWeek: Insight<{ perWeek: number; prevPerWeek: number | null }>;
  fit: Insight<{ text: string }> | null; // null on Browse all
  mainBudget: Insight<{ group: BudgetGroup }>;
  redFlagPercent: Insight<{ percent: number }>;
  matches?: number; // "yours" only
};

export type InsightsListResponse = {
  tab: "yours" | "all";
  rows: InsightsListRow[];
};
