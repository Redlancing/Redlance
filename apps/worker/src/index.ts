import { statSync } from "node:fs";
import { basename } from "node:path";
import { JOB_POSTS_CHANNEL, createDb } from "@redlance/db";
import { acquireSessionLock, createPgListener } from "./db";
import { parseWorkerEnv, redditUserAgent } from "./env";
import { createAlertsFromEnv } from "./alerts";
import { createAnalyser } from "./ingest/analyser";
import { createPoller } from "./ingest/poller";
import { UPKEEP_INTERVAL_MS, runUpkeep } from "./ingest/upkeep";
import { handlers } from "./jobs";
import { createLlmFromEnv } from "./llm";
import { createDrafterFromEnv } from "./drafts/drafter";
import { createVoiceUpdaterFromEnv } from "./drafts/voice-job";
import { createLogger } from "./logger";
import { createMatcherFromEnv } from "./match/matcher";
import { createRescorerFromEnv } from "./match/rescorer";
import { createRunner } from "./runner";

async function main() {
  let env;
  try {
    env = parseWorkerEnv(process.env);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const log = createLogger(env.LOG_LEVEL);
  if (!env.GITHUB_TOKEN) {
    log.warn(
      "GITHUB_TOKEN not set; GitHub imports use the low anonymous rate limit",
    );
  }
  if (env.credentials.kind === "service-account-key") {
    // Temporary testing fallback: a long-lived key. Prefer ADC / Workload Identity.
    log.warn(
      { keyFile: basename(env.credentials.path) },
      "Vertex AI is using a service-account key file (temporary, for testing only) — delete the key in Google Cloud when you're done",
    );
    try {
      if (statSync(env.credentials.path).mode & 0o077) {
        log.warn(
          "the key file is readable by other users on this machine; run: chmod 600 <key file>",
        );
      }
    } catch {
      // parseWorkerEnv already checked the file exists; a race here just skips the hint.
    }
  }
  const { db, pool } = createDb(env.DATABASE_URL, {
    // import jobs + post analysis + matching (posts and one re-match) + AI re-scores + the
    // poller and upkeep, plus drafts and voice updates (each holds at most one connection at a time),
    // plus the alert router and sender (the listeners and the bot's lock use their own connections).
    // Alerts get +5, not +2: the sender runs up to 25 groups, each with short claim-check and
    // complete transactions, so a few spare connections keep it from queueing on the pool.
    max: env.WORKER_CONCURRENCY * 4 + env.DRAFT_CONCURRENCY + 11,
    onError: (err) =>
      log.error({ err: err.message }, "postgres idle client error"),
  });
  const llm = createLlmFromEnv(env);
  const runner = createRunner({
    db,
    listen: () => createPgListener(env.DATABASE_URL, log),
    handlers,
    env,
    log,
    llm,
  });

  const poller = env.INGEST_ENABLED
    ? createPoller({
        db,
        log: log.child({ part: "poller" }),
        userAgent: redditUserAgent(env),
        minSpacingMs: env.INGEST_MIN_SPACING_MS,
        dedupe: {
          windowHours: env.DEDUPE_WINDOW_HOURS,
          similarity: env.DEDUPE_SIMILARITY,
        },
        acquireLock: () =>
          acquireSessionLock(env.DATABASE_URL, "redlance:reddit-poller", log),
        upkeep: () =>
          runUpkeep(db, log.child({ part: "upkeep" }), {
            maxGroupSize: env.INGEST_MAX_GROUP,
          }),
        upkeepIntervalMs: UPKEEP_INTERVAL_MS,
      })
    : null;
  const analyser = env.ANALYSIS_ENABLED
    ? createAnalyser({
        db,
        llm,
        log: log.child({ part: "analyser" }),
        model: env.VERTEX_MODEL_FAST,
        dailyBudgetMicros: Math.round(env.ANALYSIS_DAILY_BUDGET_USD * 1e6),
        concurrency: env.WORKER_CONCURRENCY,
        listen: () =>
          createPgListener(env.DATABASE_URL, log, JOB_POSTS_CHANNEL),
      })
    : null;
  // Matches analysed posts to users: woken by NOTIFY post_analysed (its own listener connection).
  const matcher = createMatcherFromEnv(env, {
    db,
    log: log.child({ part: "matcher" }),
  });
  // AI re-scores of strong matches, within each plan's daily cap: woken by NOTIFY matches.
  const rescorer = createRescorerFromEnv(env, {
    db,
    llm,
    log: log.child({ part: "rescorer" }),
  });
  // Comment + first DM drafts the user asked for: woken by NOTIFY drafts. Logs an error at
  // start if a draft model has no price (the drafting budget can't work without one).
  const drafter = createDrafterFromEnv(env, {
    db,
    llm,
    log: log.child({ part: "drafter" }),
  });
  // Rewrites each user's voice notes every few sends: woken by NOTIFY voice.
  const voice = createVoiceUpdaterFromEnv(env, {
    db,
    llm,
    log: log.child({ part: "voice" }),
  });
  // Alert router (always) and Telegram sender + bot (only with a bot token), after the matcher.
  const alerts = createAlertsFromEnv(env, {
    db,
    log: log.child({ part: "alerts" }),
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "worker stopping");
    await Promise.all([
      runner.stop(),
      poller?.stop(),
      analyser?.stop(),
      matcher?.stop(),
      rescorer?.stop(),
      drafter?.stop(),
      voice?.stop(),
      alerts?.stop(),
    ]);
    await Promise.race([
      pool.end().catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await runner.start();
  poller?.start();
  await analyser?.start();
  await matcher?.start();
  await rescorer?.start();
  await drafter?.start();
  await voice?.start();
  await alerts?.start();
  log.info(
    {
      appEnv: env.APP_ENV,
      credentials: env.credentials.kind,
      modelFast: env.VERTEX_MODEL_FAST,
      modelSmart: env.VERTEX_MODEL_SMART,
      concurrency: env.WORKER_CONCURRENCY,
      ingest: env.INGEST_ENABLED,
      analysis: env.ANALYSIS_ENABLED,
      matching: env.MATCHING_ENABLED,
      rescore: rescorer !== null,
      drafts: drafter !== null,
      voice: voice !== null,
      alerts: alerts !== null,
      telegram: alerts !== null && Boolean(env.TELEGRAM_BOT_TOKEN),
      draftModel: env.DRAFT_MODEL,
      rewriteModel: env.REWRITE_MODEL,
    },
    "worker started",
  );
}

void main();
