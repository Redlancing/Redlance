import "server-only";
import { z } from "zod";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const empty = (v: unknown) => (v === "" ? undefined : v);
/** A dollar amount from 0 to 10,000; an empty value means the default. */
const usd = (fallback: number) =>
  z.preprocess(empty, z.coerce.number().min(0).max(10_000).default(fallback));

const schema = z
  .object({
    APP_ENV: z.enum(["local", "staging", "production"]),
    APP_ORIGIN: z.url(),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL"),
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, "must be a redis:// or rediss:// URL"),
    AUTH_MODE: z.enum(["dev", "cognito"]),
    DEV_SESSION_SECRET: z
      .string()
      .min(32, "must be at least 32 characters")
      .optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** The alerts bot's @username, for t.me deep links. Unset: linking Telegram is unavailable. */
    TELEGRAM_BOT_USERNAME: z.preprocess(
      empty,
      z
        .string()
        .regex(
          /^[A-Za-z0-9_]{5,32}$/,
          "must be a Telegram bot username (5-32 letters, digits or underscores)",
        )
        .regex(/bot$/i, 'must end with "bot"')
        .optional(),
    ),
    /** Daily drafting spend across all users (USD, UTC day): log an alert at this level... */
    DRAFT_BUDGET_ALERT_USD: usd(40),
    /** ...and pause new drafts at this level (docs/drafts/README.md §10). */
    DRAFT_BUDGET_PAUSE_USD: usd(80),
  })
  .superRefine((value, ctx) => {
    if (value.DRAFT_BUDGET_ALERT_USD > value.DRAFT_BUDGET_PAUSE_USD) {
      ctx.addIssue({
        code: "custom",
        path: ["DRAFT_BUDGET_ALERT_USD"],
        message: "must not be above DRAFT_BUDGET_PAUSE_USD",
      });
    }
    if (value.AUTH_MODE === "dev" && value.APP_ENV !== "local") {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "AUTH_MODE=dev is only allowed when APP_ENV=local",
      });
    }
    if (
      value.AUTH_MODE === "dev" &&
      !LOCAL_HOSTS.has(new URL(value.APP_ORIGIN).hostname)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "AUTH_MODE=dev is only allowed when APP_ORIGIN is localhost",
      });
    }
    if (value.AUTH_MODE === "dev" && !value.DEV_SESSION_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["DEV_SESSION_SECRET"],
        message: "is required when AUTH_MODE=dev",
      });
    }
  });

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  override name = "EnvError";
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) =>
        `  - ${issue.path.map(String).join(".") || "(settings)"}: ${issue.message}`,
    );
    throw new EnvError(`Invalid environment settings:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
