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
        credentials: keyPath
          ? { kind: "service-account-key", path: keyPath }
          : { kind: "adc" },
      } as WorkerEnv;
    }
  }
  throw new Error(`Invalid worker environment:\n- ${problems.join("\n- ")}`);
}
