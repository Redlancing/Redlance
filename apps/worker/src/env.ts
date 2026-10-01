import { existsSync } from "node:fs";
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
  /** Contact for the User-Agent (an email or u/name), so Reddit can reach us. */
  REDDIT_UA_CONTACT?: string;
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
