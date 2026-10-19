import type { Plan } from "../matching/plans";

/**
 * What a draft task costs us decides its credits: credits per task = its AI cost / $0.0007,
 * rounded (a Flash draft ~$0.005 is 7, a Flash-Lite rewrite ~$0.0007 is 1). If model prices
 * change, change these numbers (or the plan amounts), not the code.
 */
export const DRAFT_TASKS = ["draft", "rewrite_flash", "rewrite_lite"] as const;
export type DraftTask = (typeof DRAFT_TASKS)[number];

export const TASK_CREDITS: Record<DraftTask, number> = {
  draft: 7,
  rewrite_flash: 7,
  rewrite_lite: 1,
};

export const REWRITE_OPTIONS = [
  "shorter",
  "casual",
  "formal",
  "different_project",
  "custom",
] as const;
export type RewriteOption = (typeof REWRITE_OPTIONS)[number];

/** Picking another project needs the stronger model; a change of tone doesn't. */
export function taskForRewrite(
  option: RewriteOption,
): "rewrite_flash" | "rewrite_lite" {
  return option === "different_project" ? "rewrite_flash" : "rewrite_lite";
}

/** Credits granted per plan period. Unused credits don't roll over. */
export const PLAN_CREDITS: Record<Plan, number> = {
  trial: 210,
  standard: 2100,
  max: 5600,
};

export const DAILY_CREDIT_CAP: Record<Plan, number> = {
  trial: 105,
  standard: 210,
  max: 560,
};

/** Daily AI cost per user in millionths of a dollar: a guard against bugs, not a plan limit. */
export const DAILY_COST_CAP_MICROS: Record<Plan, number> = {
  trial: 200_000,
  standard: 400_000,
  max: 1_000_000,
};

/** Versions of one draft: v1 plus four rewrites. */
export const MAX_VERSIONS = 5;
export const INSTRUCTION_MAX = 200;
export const SENT_TEXT_MAX = 10_000;
/** Drafts in one hour before a "slow down" warning. */
export const HOURLY_WARNING = 10;

// Voice learning: first update after 3 sends, then every 5; a rewrite option picked
// 3 times in a row counts as a pattern; at most 2 updates a day.
export const VOICE_FIRST_AFTER = 3;
export const VOICE_EVERY = 5;
export const VOICE_SAME_OPTION_STREAK = 3;
export const VOICE_MAX_PER_DAY = 2;

/** An edit ratio above this marks a draft as heavily edited. */
export const HEAVY_EDIT_RATIO = 0.6;

/** How many first drafts the balance still covers. */
export function repliesLeft(balance: number): number {
  return Math.floor(balance / TASK_CREDITS.draft);
}
