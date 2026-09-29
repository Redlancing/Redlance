import { statSync } from "node:fs";
import { basename } from "node:path";
import { createDb } from "@redlance/db";
import { createPgListener } from "./db";
import { parseWorkerEnv } from "./env";
import { handlers } from "./jobs";
import { createLlmFromEnv } from "./llm";
import { createLogger } from "./logger";
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
  if (
    env.LLM_MODE === "vertex" &&
    env.credentials.kind === "service-account-key"
  ) {
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
    max: env.WORKER_CONCURRENCY + 2,
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

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "worker stopping");
    await runner.stop();
    await Promise.race([
      pool.end().catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await runner.start();
  log.info(
    {
      appEnv: env.APP_ENV,
      llmMode: env.LLM_MODE,
      credentials: env.LLM_MODE === "vertex" ? env.credentials.kind : undefined,
      modelFast: env.VERTEX_MODEL_FAST,
      modelSmart: env.VERTEX_MODEL_SMART,
      concurrency: env.WORKER_CONCURRENCY,
    },
    "worker started",
  );
}

void main();
