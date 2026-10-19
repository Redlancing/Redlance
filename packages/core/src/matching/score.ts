import type {
  BudgetUnit,
  EmploymentType,
  PayType,
  PostKind,
  RemoteType,
} from "../job-post";
import type { CURRENCIES, RATE_TYPES } from "../onboarding";
import { BROAD_CAP, MATCH_MAX_AGE_DAYS } from "./constants";
import { convert } from "./fx";
import { ruleReason } from "./reason";

export type MatchPost = {
  postedAt: Date;
  kind: PostKind;
  employmentType: EmploymentType;
  payType: PayType;
  categories: string[];
  skillIds: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
  budgetUnit: BudgetUnit | null;
  remote: RemoteType;
  /** YYYY-MM-DD */
  deadline: string | null;
  redFlags: string[];
};

export type MatchProfile = {
  categories: string[];
  skills: { id: string; level: "core" | "secondary" }[];
  /** Skills of VISIBLE projects and roles (hidden = false). */
  workSkillIds: string[];
  /** e.g. 3000 = 30.00 */
  minRateMinor: number;
  currency: (typeof CURRENCIES)[number];
  rateType: (typeof RATE_TYPES)[number];
  remoteOnly: boolean;
  includeUnpaid: boolean;
};

export type Feature = { signal: string; points: number; detail?: string[] };

export type BudgetFit = "fits" | "below" | "unknown";

export const WEIGHTS = {
  corePerSkill: 20,
  coreMax: 60,
  secondaryPerSkill: 8,
  secondaryMax: 24,
  jobType: 15,
  budgetFits: 10,
  budgetBelow: -25,
  workOverlap: 10,
  remoteFit: 5,
  redFlag: -15,
} as const;
export type Weights = { [K in keyof typeof WEIGHTS]: number };

export function isCandidate(
  post: MatchPost,
  profile: MatchProfile,
): "skill" | "broad" | null {
  const mine = new Set(profile.skills.map((s) => s.id));
  if (post.skillIds.some((id) => mine.has(id))) return "skill";
  if (
    post.skillIds.length === 0 &&
    post.categories.some((c) => profile.categories.includes(c))
  ) {
    return "broad";
  }
  return null;
}

const DAY_MS = 86_400_000;

export function passesFilters(
  post: MatchPost,
  profile: MatchProfile,
  now: Date,
  maxAgeDays: number = MATCH_MAX_AGE_DAYS,
): boolean {
  if (post.kind !== "hiring") return false;
  if (post.employmentType === "full_time") return false;
  if (now.getTime() - post.postedAt.getTime() > maxAgeDays * DAY_MS) {
    return false;
  }
  if (
    post.deadline !== null &&
    post.deadline < now.toISOString().slice(0, 10)
  ) {
    return false;
  }
  if (profile.remoteOnly && post.remote === "onsite") return false;
  if (
    post.payType !== "paid" &&
    post.payType !== "unknown" &&
    !profile.includeUnpaid
  ) {
    return false;
  }
  return true;
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function budgetFit(post: MatchPost, profile: MatchProfile): BudgetFit {
  // A reversed range (min above max) still means the higher figure is on offer.
  const raw =
    post.budgetMin !== null && post.budgetMax !== null
      ? Math.max(post.budgetMin, post.budgetMax)
      : (post.budgetMax ?? post.budgetMin);
  if (raw === null || post.currency === null || post.budgetUnit === null) {
    return "unknown";
  }
  const converted = convert(raw, post.currency, profile.currency);
  if (converted === null) return "unknown";
  // Round to cents first: float error turns 33 USD / 1.1 into 29.999999999999996.
  const amount = roundCents(converted);
  const minRate = roundCents(profile.minRateMinor / 100);
  const hourlyOk = profile.rateType !== "fixed";
  const fixedOk = profile.rateType !== "hourly";
  let needed: number;
  if (post.budgetUnit === "hour" && hourlyOk) needed = minRate;
  else if (post.budgetUnit === "day" && hourlyOk) needed = minRate * 8;
  else if (post.budgetUnit === "fixed" && fixedOk) needed = minRate;
  else return "unknown";
  return amount >= needed ? "fits" : "below";
}

export function ruleScore(
  post: MatchPost,
  profile: MatchProfile,
  weights: Weights = WEIGHTS,
): { score: number; broad: boolean; features: Feature[]; reason: string } {
  const broad = isCandidate(post, profile) === "broad";
  const features: Feature[] = [];
  const postSkills = [...new Set(post.skillIds)];

  if (!broad) {
    const core = postSkills.filter((id) =>
      profile.skills.some((s) => s.id === id && s.level === "core"),
    );
    const secondary = postSkills.filter((id) =>
      profile.skills.some((s) => s.id === id && s.level === "secondary"),
    );
    if (core.length > 0) {
      features.push({
        signal: "core_skill",
        points: Math.min(core.length * weights.corePerSkill, weights.coreMax),
        detail: core,
      });
    }
    if (secondary.length > 0) {
      features.push({
        signal: "secondary_skill",
        points: Math.min(
          secondary.length * weights.secondaryPerSkill,
          weights.secondaryMax,
        ),
        detail: secondary,
      });
    }
  }

  const sharedCategories = post.categories.filter((c) =>
    profile.categories.includes(c),
  );
  if (sharedCategories.length > 0) {
    features.push({
      signal: "job_type",
      points: weights.jobType,
      detail: sharedCategories,
    });
  }

  const fit = budgetFit(post, profile);
  if (fit === "fits") {
    features.push({ signal: "budget_fits", points: weights.budgetFits });
  } else if (fit === "below") {
    features.push({ signal: "budget_below", points: weights.budgetBelow });
  }

  if (!broad) {
    const overlap = postSkills.filter((id) =>
      profile.workSkillIds.includes(id),
    );
    if (overlap.length > 0) {
      features.push({
        signal: "work_overlap",
        points: weights.workOverlap,
        detail: overlap,
      });
    }
  }

  if (post.remote === "remote" && profile.remoteOnly) {
    features.push({ signal: "remote_fit", points: weights.remoteFit });
  }

  if (post.redFlags.length > 0) {
    features.push({
      signal: "red_flag",
      points: post.redFlags.length * weights.redFlag,
      detail: post.redFlags,
    });
  }

  const nonZero = features.filter((f) => f.points !== 0);
  const raw = nonZero.reduce((sum, f) => sum + f.points, 0);
  const capped = broad ? Math.min(raw, BROAD_CAP) : raw;
  const score = Math.max(0, Math.min(100, Math.round(capped)));
  return {
    score,
    broad,
    features: nonZero,
    reason: ruleReason(nonZero, undefined, broad),
  };
}
