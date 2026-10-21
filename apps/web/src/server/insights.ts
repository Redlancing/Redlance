import "server-only";
import {
  INSIGHT_MIN_POINTS,
  INSIGHT_WINDOW_DAYS,
  SKILL_BY_ID,
  SKILL_MIN_MENTIONS,
  busiestStretch,
  gate,
  insightsAllowed,
  perPostText,
  ratioText,
  slotsToLocalHours,
  weekPattern,
  type BudgetGroup,
  type Insight,
  type InsightsListResponse,
  type InsightsListRow,
  type SkillShare,
  type SubredditInsightsResponse,
} from "@redlance/core";
import {
  insightRows,
  latestMatchesIn,
  profiles,
  subreddits,
  userFitCounts,
  userInsightSubreddits,
  type SubredditInsightsRow,
} from "@redlance/db";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { ApiError } from "./errors";

// Turns subreddit_insights rows into API responses (docs/insights/design.md). The rows hold raw
// counts; this is where rule 8 is applied: a number under INSIGHT_MIN_POINTS is replaced by
// `{ status: "not_enough", have, need }` here, so it never reaches the browser. Rule 7: only
// percentages for repeat clients, and no usernames anywhere (the table has none).

const DAY_MS = 86_400_000;
const WEEKS = INSIGHT_WINDOW_DAYS / 7;
const MAX_BUDGET_GROUPS = 3;
const MAX_SKILLS = 5;
const LATEST_MATCHES = 5;

export type InsightsViewer = {
  userId: string;
  timeZone: string;
  onboardedAt: Date;
};

type Fit = { bestMatches: number; hiringPosts: number };

/** Whole-number percent; a real share never rounds to 0 or 100. */
function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  let n = Math.round((part / whole) * 100);
  if (n === 0 && part > 0) n = 1;
  if (n === 100 && part < whole) n = 99;
  return n;
}

function notEnough(have: number): Insight<never> {
  return { status: "not_enough", have, need: INSIGHT_MIN_POINTS };
}

/** Run `build` only when `n` data points reach the threshold. */
function gated<T>(n: number, build: () => T): Insight<T> {
  return gate(n, INSIGHT_MIN_POINTS).ok
    ? ({ status: "ok", ...build() } as Insight<T>)
    : notEnough(n);
}

function historyDays(row: SubredditInsightsRow): number {
  if (!row.historyStart) return 0;
  return Math.max(
    0,
    Math.floor(
      (row.computedAt.getTime() - row.historyStart.getTime()) / DAY_MS,
    ),
  );
}

/** The db holds the previous window too (history ≥ 56 days), so a trend is meaningful. */
function hasTrendHistory(row: SubredditInsightsRow): boolean {
  return (
    row.historyStart !== null &&
    row.historyStart.getTime() <=
      row.windowStart.getTime() - INSIGHT_WINDOW_DAYS * DAY_MS
  );
}

function perWeek(row: SubredditInsightsRow) {
  return gated(row.hiringPosts, () => {
    const trend =
      row.hiringPostsPrev >= INSIGHT_MIN_POINTS && hasTrendHistory(row);
    return {
      perWeek: Math.round(row.hiringPosts / WEEKS),
      prevPerWeek: trend ? Math.round(row.hiringPostsPrev / WEEKS) : null,
    };
  });
}

function usableBudgets(row: SubredditInsightsRow): BudgetGroup[] {
  return row.budgets
    .filter((g) => g.n >= INSIGHT_MIN_POINTS)
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_BUDGET_GROUPS)
    .map((g) => ({
      currency: g.currency,
      unit: g.unit as BudgetGroup["unit"],
      n: g.n,
      p25: g.p25,
      median: g.median,
      p75: g.p75,
    }));
}

function budgets(row: SubredditInsightsRow) {
  const groups = usableBudgets(row);
  if (groups.length > 0) return { status: "ok" as const, groups };
  return notEnough(row.budgets.reduce((m, g) => Math.max(m, g.n), 0));
}

function skills(row: SubredditInsightsRow) {
  return gated(row.hiringPosts, () => {
    const list: SkillShare[] = [];
    for (const s of row.skillCounts) {
      const skill = SKILL_BY_ID.get(s.skillId);
      if (!skill || s.n < SKILL_MIN_MENTIONS) continue;
      list.push({
        skillId: s.skillId,
        name: skill.name,
        mentions: s.n,
        percent: pct(s.n, row.hiringPosts),
      });
      if (list.length === MAX_SKILLS) break;
    }
    return { skills: list };
  });
}

const FLAG_LABELS: Record<string, string> = {
  asks_for_free_work: "free work",
  off_platform_payment: "payment off-platform",
  upfront_fee: "upfront fees",
  vague_pay: "vague pay",
  unrealistic_pay: "unrealistic pay",
  personal_info_request: "personal info requests",
  adult_content: "adult content",
  academic_dishonesty: "academic dishonesty",
};

function redFlags(row: SubredditInsightsRow) {
  return gated(row.hiringPosts, () => {
    const top = Object.entries(row.redFlagCounts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([flag, count]) => ({ flag: FLAG_LABELS[flag] ?? flag, count }));
    const flagged = row.redFlagPosts;
    let text: string;
    if (flagged === 0) text = "No red flags in this month's hiring posts";
    else {
      const ratio = ratioText(flagged, row.hiringPosts);
      const lead = ratio === "All" ? "Every post has" : `${ratio} has`;
      text = `${lead} a red flag${top[0] ? `, mostly ${top[0].flag}` : ""}`;
    }
    return { percent: pct(flagged, row.hiringPosts), text, top };
  });
}

function fitInsight(fit: Fit) {
  return gated(fit.hiringPosts, () => {
    const ratio = ratioText(fit.bestMatches, fit.hiringPosts);
    const text =
      ratio === "None"
        ? "No strong fits yet"
        : ratio === "All"
          ? "All are strong fits"
          : `${ratio} ${ratio.startsWith("1 in") ? "is a strong fit" : "are strong fits"}`;
    return { best: fit.bestMatches, hiring: fit.hiringPosts, text };
  });
}

/** Everything but the user's latest matches. */
function shapeBody(
  row: SubredditInsightsRow,
  viewer: InsightsViewer,
  fit: Fit,
  now: Date,
): Omit<
  SubredditInsightsResponse,
  "subreddit" | "displayName" | "latestMatches"
> {
  const n = row.hiringPosts;
  const pay = row.payCounts;
  const payPct = (k: string) => pct(pay[k] ?? 0, n);
  return {
    computedAt: row.computedAt.toISOString(),
    postsPerWeek: perWeek(row),
    fit: fitInsight(fit),
    budgets: budgets(row),
    hours: gated(n, () => {
      const hours = slotsToLocalHours(row.hourSlots, viewer.timeZone, now);
      return {
        timeZone: viewer.timeZone,
        hours,
        busiestStartHour: busiestStretch(hours).startHour,
        pattern: weekPattern(row.hourSlots, viewer.timeZone, now).pattern,
      };
    }),
    skills: skills(row),
    paid: gated(n, () => {
      const paid = payPct("paid");
      const revShare = payPct("revshare");
      const unpaid = payPct("unpaid");
      return {
        paid,
        revShare,
        unpaid,
        other: Math.max(0, 100 - paid - revShare - unpaid),
      };
    }),
    redFlags: redFlags(row),
    crowded: gated(n, () => ({
      perHiringPost: perPostText(row.forHirePosts, n),
    })),
    budgetStated: gated(n, () => ({ percent: pct(row.budgetStated, n) })),
    remote: gated(n, () => ({ percent: pct(row.remoteCounts.remote ?? 0, n) })),
    repeatClients: !hasTrendHistory(row)
      ? { status: "building", days: historyDays(row) }
      : gated(row.knownAuthorPosts, () => ({
          percent: pct(row.repeatAuthorPosts, row.knownAuthorPosts),
        })),
  };
}

export function shapeSubredditInsights(
  row: SubredditInsightsRow,
  displayName: string,
  viewer: InsightsViewer,
  fit: Fit,
  latestMatches: SubredditInsightsResponse["latestMatches"],
  now: Date,
): SubredditInsightsResponse {
  return {
    subreddit: row.subreddit,
    displayName,
    ...shapeBody(row, viewer, fit, now),
    latestMatches,
  };
}

export function shapeListRow(
  row: SubredditInsightsRow,
  displayName: string,
  fit: Fit | null,
  matches?: number,
): InsightsListRow {
  const groups = usableBudgets(row);
  const redFlag = redFlags(row);
  const f = fit ? fitInsight(fit) : null;
  return {
    subreddit: row.subreddit,
    displayName,
    perWeek: perWeek(row),
    fit:
      f === null
        ? null
        : f.status === "ok"
          ? { status: "ok", text: f.text }
          : f,
    mainBudget: groups[0]
      ? { status: "ok", group: groups[0] }
      : notEnough(row.budgets.reduce((m, g) => Math.max(m, g.n), 0)),
    redFlagPercent:
      redFlag.status === "ok"
        ? { status: "ok", percent: redFlag.percent }
        : redFlag,
    ...(matches === undefined ? {} : { matches }),
  };
}

const MONEY: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  INR: "₹",
};
const UNIT_LABEL: Record<string, string> = {
  fixed: "fixed",
  hour: "/hour",
  day: "/day",
  week: "/week",
  month: "/month",
  per_item: "/item",
};

/** "USD/hour $15–35" for the match page line and anywhere a budget group needs one string. */
export function budgetText(g: BudgetGroup): string {
  const sym = MONEY[g.currency] ?? "";
  const fmt = (v: number) => `${sym}${Math.round(v).toLocaleString("en-US")}`;
  const lo = Math.round(g.p25);
  const hi = Math.round(g.p75);
  const range =
    lo === hi ? fmt(lo) : `${fmt(lo)}–${hi.toLocaleString("en-US")}`;
  const unit = UNIT_LABEL[g.unit] ?? g.unit;
  return `${g.currency}${unit.startsWith("/") ? unit : ` ${unit}`} ${range}`;
}

/**
 * One line for the match page: "~35 hiring posts a week · posted budgets USD/hour $15–35".
 * Null when nothing passes the threshold.
 */
export function summaryLine(row: SubredditInsightsRow): string | null {
  const parts: string[] = [];
  const w = perWeek(row);
  if (w.status === "ok") parts.push(`~${w.perWeek} hiring posts a week`);
  const g = usableBudgets(row)[0];
  if (g) parts.push(`posted budgets ${budgetText(g)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The summary line for one subreddit (lowercase name), or null. Not gated on the plan: callers check. */
export async function subredditSummary(
  subreddit: string,
): Promise<string | null> {
  const [row] = await insightRows(getDb(), [subreddit.toLowerCase()]);
  return row ? summaryLine(row) : null;
}

/**
 * The match page's insight line for the post's subreddit, or null when the user can't see
 * insights (not onboarded, trial ended) or nothing passes the threshold. Never fails the page.
 */
export async function matchInsightLine(
  userId: string,
  subreddit: string,
): Promise<string | null> {
  try {
    await insightsViewer(userId);
    return await subredditSummary(subreddit);
  } catch {
    return null;
  }
}

/** Profile fields the insights need; 404 before onboarding, 403 INSIGHTS_LOCKED when not allowed. */
export async function insightsViewer(
  userId: string,
  now: Date = new Date(),
): Promise<InsightsViewer> {
  const [p] = await getDb()
    .select({
      timeZone: profiles.timeZone,
      onboardedAt: profiles.onboardedAt,
      plan: profiles.plan,
      trialEndsAt: profiles.trialEndsAt,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!p) throw new ApiError("NOT_FOUND", "Set up your profile first.");
  if (!insightsAllowed(p.plan, p.trialEndsAt, now))
    throw new ApiError("INSIGHTS_LOCKED", "Subreddit insights are locked.");
  return { userId, timeZone: p.timeZone, onboardedAt: p.onboardedAt };
}

function fitSince(row: SubredditInsightsRow, viewer: InsightsViewer): Date {
  return new Date(
    Math.max(row.windowStart.getTime(), viewer.onboardedAt.getTime()),
  );
}

async function displayNames(names: string[]): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();
  const rows = await getDb()
    .select({ name: subreddits.name, displayName: subreddits.displayName })
    .from(subreddits);
  const wanted = new Set(names);
  return new Map(
    rows.filter((r) => wanted.has(r.name)).map((r) => [r.name, r.displayName]),
  );
}

export async function listInsights(
  viewer: InsightsViewer,
  tab: "yours" | "all",
): Promise<InsightsListResponse> {
  const db = getDb();
  if (tab === "yours") {
    const mine = await userInsightSubreddits(db, viewer.userId);
    const rows = new Map(
      (
        await insightRows(
          db,
          mine.map((m) => m.subreddit),
        )
      ).map((r) => [r.subreddit, r]),
    );
    const names = await displayNames(mine.map((m) => m.subreddit));
    const out = await Promise.all(
      mine
        .filter((m) => rows.has(m.subreddit))
        .map(async (m) => {
          const row = rows.get(m.subreddit)!;
          const fit = await userFitCounts(
            db,
            viewer.userId,
            m.subreddit,
            fitSince(row, viewer),
          );
          return shapeListRow(
            row,
            names.get(m.subreddit) ?? m.subreddit,
            fit,
            m.matches,
          );
        }),
    );
    return { tab, rows: out };
  }
  const active = await db
    .select({ name: subreddits.name, displayName: subreddits.displayName })
    .from(subreddits)
    .where(eq(subreddits.status, "active"));
  const names = new Map(active.map((a) => [a.name, a.displayName]));
  const rows = (await insightRows(db, [...names.keys()])).sort(
    (a, b) =>
      b.hiringPosts - a.hiringPosts || a.subreddit.localeCompare(b.subreddit),
  );
  return {
    tab,
    rows: rows.map((r) => shapeListRow(r, names.get(r.subreddit)!, null)),
  };
}

/** Null when the subreddit has no insight row. */
export async function subredditInsights(
  viewer: InsightsViewer,
  subreddit: string,
  now: Date = new Date(),
): Promise<SubredditInsightsResponse | null> {
  const db = getDb();
  const [row] = await insightRows(db, [subreddit]);
  if (!row) return null;
  const [fit, latest, names] = await Promise.all([
    userFitCounts(db, viewer.userId, subreddit, fitSince(row, viewer)),
    latestMatchesIn(db, viewer.userId, subreddit, LATEST_MATCHES),
    displayNames([subreddit]),
  ]);
  return shapeSubredditInsights(
    row,
    names.get(subreddit) ?? subreddit,
    viewer,
    fit,
    latest.map((m) => ({
      matchId: m.matchId,
      title: m.post.title,
      score: m.score,
      postedAt: m.post.postedAt.toISOString(),
    })),
    now,
  );
}
