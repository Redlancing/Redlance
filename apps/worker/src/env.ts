import { existsSync } from "node:fs";
import { ALERT_MAX_AGE_HOURS_DEFAULT } from "@redlance/core";
import { z } from "zod";

export type WorkerEnv = {
  APP_ENV: "local" | "test" | "staging" | "production";
  DATABASE_URL: string;
  LOG_LEVEL: string;
  GOOGLE_CLOUD_PROJECT: string;
  GOOGLE_CLOUD_LOCATION: string;
  VERTEX_MODEL_FAST: string;
  VERTEX_MODEL_SMART: string;
  GITHUB_TOKEN?: string;
  WORKER_CONCURRENCY: number;
  /** Poll Reddit (Phase 2). Only one worker polls at a time (advisory lock). */
  INGEST_ENABLED: boolean;
  /** Analyse collected posts with the model (Phase 3). */
  ANALYSIS_ENABLED: boolean;
  /** Daily cap on post-analysis spend, in USD (UTC day). */
  ANALYSIS_DAILY_BUDGET_USD: number;
  /** Subreddits per combined feed URL. */
  INGEST_MAX_GROUP: number;
  /** Floor between Reddit requests: 65 s minimum (1 a minute per IP; sooner still got 429s). */
  INGEST_MIN_SPACING_MS: number;
  /** A new post is a cross-post when a same-author post this similar (pg_trgm, 0–1) is recent. */
  DEDUPE_SIMILARITY: number;
  /** How far back (hours) an earlier post by the same author can be a duplicate's original. */
  DEDUPE_WINDOW_HOURS: number;
  /** Contact for the User-Agent (an email or u/name), so Reddit can reach us. */
  REDDIT_UA_CONTACT?: string;
  /** Match analysed posts to users (docs/matching/plan/04-matcher.md). */
  MATCHING_ENABLED: boolean;
  /** A match goes to the AI re-score queue at this rule score or above (0–100). */
  RESCORE_THRESHOLD: number;
  /** Posts older than this many days are never matched. */
  MATCH_MAX_AGE_DAYS: number;
  /** AI re-score of strong matches (docs/matching/plan/05-rescorer.md); needs MATCHING_ENABLED. */
  RESCORE_ENABLED: boolean;
  /** Daily cap on AI re-score spend, in USD (UTC day), across all users. */
  RESCORE_DAILY_BUDGET_USD: number;
  /** Write drafts (docs/drafts/plan/07-worker-drafts.md). */
  DRAFTS_ENABLED: boolean;
  /** Learn each user's voice from what they send (docs/drafts/plan/09-voice.md); needs DRAFTS_ENABLED. */
  VOICE_ENABLED: boolean;
  /** First drafts and "different project" rewrites. Defaults to VERTEX_MODEL_FAST (Flash-Lite, since 2026-10-20). */
  DRAFT_MODEL: string;
  /** Style and typed rewrites. Defaults to VERTEX_MODEL_FAST. */
  REWRITE_MODEL: string;
  /** Drafts written at once (1-16). */
  DRAFT_CONCURRENCY: number;
  /** Daily drafting spend across all users (USD, UTC day) at which to log an alert. */
  DRAFT_BUDGET_ALERT_USD: number;
  /** Daily drafting spend across all users (USD, UTC day) at which new drafts pause. */
  DRAFT_BUDGET_PAUSE_USD: number;
  /** Run the alert router, and the Telegram sender and bot when a token is set (docs/alerts/). */
  ALERTS_ENABLED: boolean;
  /** From @BotFather. Unset: no sender or bot, and the router records skipped_no_channel. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  /** Bot-wide sends per second (Telegram allows about 30). */
  TELEGRAM_MAX_PER_SECOND: number;
  /** A match older than this many hours is not alerted. */
  ALERT_MAX_AGE_HOURS: number;
  /** The web app's origin, for the links in messages. Required when a bot token is set. */
  APP_ORIGIN?: string;
  /**
   * How the worker signs in to Vertex AI. "adc" = Application Default Credentials
   * (gcloud login locally, Workload Identity Federation on EC2). "service-account-key" =
   * a key file named by GOOGLE_APPLICATION_CREDENTIALS — a temporary testing fallback.
   */
  credentials: { kind: "adc" } | { kind: "service-account-key"; path: string };
};

const empty = (v: unknown) => (v === "" ? undefined : v);
const optional = z.preprocess(empty, z.string().min(1).optional());

const schema = z.object({
  APP_ENV: z.enum(["local", "test", "staging", "production"]),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.preprocess(empty, z.string().default("info")),
  GOOGLE_CLOUD_PROJECT: optional,
  GOOGLE_CLOUD_LOCATION: optional,
  VERTEX_MODEL_FAST: z.preprocess(
    empty,
    z.string().default("gemini-3.5-flash-lite"),
  ),
  VERTEX_MODEL_SMART: z.preprocess(
    empty,
    z.string().default("gemini-3.8-flash"),
  ),
  GITHUB_TOKEN: optional,
  GOOGLE_APPLICATION_CREDENTIALS: optional,
  WORKER_CONCURRENCY: z.preprocess(
    empty,
    z.coerce.number().int().min(1).max(32).default(4),
  ),
  INGEST_ENABLED: z.preprocess(
    empty,
    z.enum(["true", "false"]).default("true"),
  ),
  ANALYSIS_ENABLED: z.preprocess(
    empty,
    z.enum(["true", "false"]).default("true"),
  ),
  ANALYSIS_DAILY_BUDGET_USD: z.preprocess(
    empty,
    z.coerce.number().min(0).max(1000).default(2),
  ),
  INGEST_MAX_GROUP: z.preprocess(
    empty,
    z.coerce.number().int().min(1).max(120).default(80),
  ),
  INGEST_MIN_SPACING_MS: z.preprocess(
    empty,
    z.coerce.number().int().min(65_000).max(3_600_000).default(65_000),
  ),
  DEDUPE_SIMILARITY: z.preprocess(
    empty,
    z.coerce.number().min(0.3).max(0.95).default(0.8),
  ),
  DEDUPE_WINDOW_HOURS: z.preprocess(
    empty,
    z.coerce.number().int().min(1).max(336).default(72),
  ),
  MATCHING_ENABLED: z.preprocess(
    empty,
    z.enum(["true", "false"]).default("true"),
  ),
  RESCORE_THRESHOLD: z.preprocess(
    empty,
    z.coerce.number().int().min(0).max(100).default(50),
  ),
  MATCH_MAX_AGE_DAYS: z.preprocess(
    empty,
    z.coerce.number().int().min(1).max(30).default(7),
  ),
  RESCORE_ENABLED: z.preprocess(
    empty,
    z.enum(["true", "false"]).default("false"),
  ),
  RESCORE_DAILY_BUDGET_USD: z.preprocess(
    empty,
    z.coerce.number().min(0).max(1000).default(5),
  ),
  DRAFTS_ENABLED: z.preprocess(
    empty,
    z.enum(["true", "false"]).default("true"),
  ),
  VOICE_ENABLED: z.preprocess(empty, z.enum(["true", "false"]).default("true")),
  DRAFT_MODEL: optional,
  REWRITE_MODEL: optional,
  DRAFT_CONCURRENCY: z.preprocess(
    empty,
    z.coerce.number().int().min(1).max(16).default(4),
  ),
  DRAFT_BUDGET_ALERT_USD: z.preprocess(
    empty,
    z.coerce.number().min(0).max(10_000).default(40),
  ),
  DRAFT_BUDGET_PAUSE_USD: z.preprocess(
    empty,
    z.coerce.number().min(0).max(10_000).default(80),
  ),
  ALERTS_ENABLED: z.preprocess(
    empty,
    z.enum(["true", "false"]).default("true"),
  ),
  // The message never includes the value: a token in a log is a leaked token.
  TELEGRAM_BOT_TOKEN: z.preprocess(
    empty,
    z
      .string()
      .regex(
        /^\d+:[A-Za-z0-9_-]{30,}$/,
        "does not look like a bot token (expected <digits>:<30+ characters>)",
      )
      .optional(),
  ),
  TELEGRAM_BOT_USERNAME: optional,
  TELEGRAM_MAX_PER_SECOND: z.preprocess(
    empty,
    z.coerce.number().int().min(1).max(30).default(25),
  ),
  ALERT_MAX_AGE_HOURS: z.preprocess(
    empty,
    z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(ALERT_MAX_AGE_HOURS_DEFAULT),
  ),
  APP_ORIGIN: z.preprocess(
    empty,
    z
      .url({ protocol: /^https?$/, message: "must be an http(s) URL" })
      .optional(),
  ),
  REDDIT_UA_CONTACT: z.preprocess(
    empty,
    z
      .string()
      .regex(/^[\w.+@/-]{3,80}$/, "an email or u/name, no spaces")
      .optional(),
  ),
});

export function parseWorkerEnv(
  raw: Record<string, string | undefined>,
  deps: { fileExists?: (path: string) => boolean } = {},
): WorkerEnv {
  const fileExists = deps.fileExists ?? existsSync;
  const problems: string[] = [];
  if (raw.GEMINI_API_KEY || raw.GOOGLE_API_KEY) {
    problems.push("Use Vertex AI credentials, not an API key");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.join(".") || "env"}: ${issue.message}`);
    }
  } else {
    const env = parsed.data;
    // Resume imports always use Gemini on Vertex AI (tests stub the client instead).
    if (!env.GOOGLE_CLOUD_PROJECT)
      problems.push("GOOGLE_CLOUD_PROJECT is required (Vertex AI)");
    if (!env.GOOGLE_CLOUD_LOCATION)
      problems.push("GOOGLE_CLOUD_LOCATION is required (Vertex AI)");
    if (
      !env.GITHUB_TOKEN &&
      env.APP_ENV !== "local" &&
      env.APP_ENV !== "test"
    ) {
      problems.push("GITHUB_TOKEN is required outside local");
    }
    if (
      env.INGEST_ENABLED === "true" &&
      !env.REDDIT_UA_CONTACT &&
      env.APP_ENV !== "local" &&
      env.APP_ENV !== "test"
    ) {
      problems.push(
        "REDDIT_UA_CONTACT is required outside local when ingestion is on (Reddit asks for a contact)",
      );
    }
    if (env.DRAFT_BUDGET_ALERT_USD > env.DRAFT_BUDGET_PAUSE_USD) {
      problems.push(
        "DRAFT_BUDGET_ALERT_USD must not be above DRAFT_BUDGET_PAUSE_USD",
      );
    }
    if (env.TELEGRAM_BOT_TOKEN && !env.APP_ORIGIN) {
      problems.push(
        "APP_ORIGIN is required when TELEGRAM_BOT_TOKEN is set (the links in alerts)",
      );
    }
    const keyPath = env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyPath && !fileExists(keyPath)) {
      problems.push(
        "GOOGLE_APPLICATION_CREDENTIALS points to a file that doesn't exist",
      );
    }
    if (problems.length === 0) {
      const { GOOGLE_APPLICATION_CREDENTIALS: _key, ...rest } = env;
      return {
        ...rest,
        INGEST_ENABLED: env.INGEST_ENABLED === "true",
        ANALYSIS_ENABLED: env.ANALYSIS_ENABLED === "true",
        MATCHING_ENABLED: env.MATCHING_ENABLED === "true",
        RESCORE_ENABLED: env.RESCORE_ENABLED === "true",
        DRAFTS_ENABLED: env.DRAFTS_ENABLED === "true",
        VOICE_ENABLED: env.VOICE_ENABLED === "true",
        ALERTS_ENABLED: env.ALERTS_ENABLED === "true",
        APP_ORIGIN: env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : undefined,
        DRAFT_MODEL: env.DRAFT_MODEL ?? env.VERTEX_MODEL_FAST,
        REWRITE_MODEL: env.REWRITE_MODEL ?? env.VERTEX_MODEL_FAST,
        credentials: keyPath
          ? { kind: "service-account-key", path: keyPath }
          : { kind: "adc" },
      } as WorkerEnv;
    }
  }
  throw new Error(`Invalid worker environment:\n- ${problems.join("\n- ")}`);
}

/** Reddit asks for a descriptive User-Agent with a way to reach the operator. */
export function redditUserAgent(
  env: Pick<WorkerEnv, "REDDIT_UA_CONTACT">,
): string {
  const contact = env.REDDIT_UA_CONTACT ? `; ${env.REDDIT_UA_CONTACT}` : "";
  return `web:app.redlance.ingest:v1 (+https://redlance.app${contact})`;
}
