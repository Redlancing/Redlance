import "server-only";
import { z } from "zod";

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
  })
  .superRefine((value, ctx) => {
    if (value.AUTH_MODE === "dev" && value.APP_ENV !== "local") {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "AUTH_MODE=dev is only allowed when APP_ENV=local",
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
