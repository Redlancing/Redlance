import {
  activeFeeds,
  applyFeedPlan,
  pruneAlerts,
  pruneFeedPolls,
  refreshSubredditStats,
  requeueOutdatedAnalyses,
  requeueRetryableFailures,
  subreddits,
  uncataloguedCommunities,
  type Database,
} from "@redlance/db";
import { eq } from "drizzle-orm";
import type { Logger } from "../logger";
import { PIPELINE_VERSION } from "./analyse-post";
import { PROVIDER_ERROR_CODES } from "./analyser";
import { planFeeds, requestsPerDay, type PlannerOptions } from "./planner";

// Daily upkeep (docs/ingestion/plan.md, Phase 4), run by whichever worker holds the poller
// lock: our own volume numbers → dormancy → a fresh feed plan (keeping groups that still fit)
// → re-queue posts that failed through no fault of their own → prune the poll log and old alerts → the
// discovery report. Each step runs on its own: one failing doesn't skip the rest.

export const UPKEEP_INTERVAL_MS = 24 * 60 * 60_000;

export async function planAndApplyFeeds(
  db: Database,
  options: Partial<PlannerOptions> = {},
) {
  const rows = await db
    .select({
      name: subreddits.name,
      postsPerDay: subreddits.postsPerDay,
      dormantSince: subreddits.dormantSince,
      unreachableSince: subreddits.unreachableSince,
    })
    .from(subreddits)
    .where(eq(subreddits.status, "active"));
  const current = (await activeFeeds(db))
    .filter(
      (f) =>
        f.kind === "subreddits" && f.subreddits && f.intervalSeconds < 6 * 3600,
    )
    .map((f) => f.subreddits!);
  const plan = planFeeds(
    rows.map((r) => ({
      name: r.name,
      postsPerDay: r.postsPerDay,
      dormant: r.dormantSince !== null,
      unreachable: r.unreachableSince !== null,
    })),
    { current, ...options },
  );
  const applied = await applyFeedPlan(db, plan);
  return {
    feeds: plan.length,
    subreddits: rows.length,
    requestsPerDay: Math.round(requestsPerDay(plan)),
    ...applied,
  };
}

export async function runUpkeep(
  db: Database,
  log: Logger,
  options: Partial<PlannerOptions> = {},
): Promise<void> {
  const failed: string[] = [];
  const step = async <T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      failed.push(name);
      log.error(
        { step: name, err: (err as Error).message },
        "upkeep step failed",
      );
      return null;
    }
  };
  const stats = await step("stats", () => refreshSubredditStats(db));
  const plan = await step("plan", () => planAndApplyFeeds(db, options));
  const retried = await step("requeue", async () => ({
    failures: await requeueRetryableFailures(db, PROVIDER_ERROR_CODES),
    outdated: await requeueOutdatedAnalyses(db, PIPELINE_VERSION),
  }));
  const pruned = await step("prune", () => pruneFeedPolls(db));
  const prunedAlerts = await step("prune-alerts", () =>
    pruneAlerts(db, new Date()),
  );
  const discovery = await step("discovery", () =>
    uncataloguedCommunities(db, 7, 15),
  );
  log.info(
    { statsUpdated: stats, ...plan, requeued: retried, prunedPolls: pruned },
    "ingestion upkeep done",
  );
  if (prunedAlerts && (prunedAlerts.deliveries > 0 || prunedAlerts.tokens > 0))
    log.info(prunedAlerts, "pruned old alert deliveries and link tokens");
  if (discovery?.some((d) => d.hiring > 0))
    log.info(
      { subreddits: discovery.filter((d) => d.hiring > 0) },
      "hiring posts seen in subreddits outside the catalogue (review and add the good ones)",
    );
  if (failed.length)
    throw new Error(`upkeep steps failed: ${failed.join(", ")}`);
}
