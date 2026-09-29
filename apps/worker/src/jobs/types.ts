import type { Database, ImportJob, ImportStage } from "@redlance/db";
import type { LlmClient } from "@redlance/llm";
import type { WorkerEnv } from "../env";
import type { Logger } from "../logger";

export class JobError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "JobError";
  }
}

export type JobOutcome = {
  result: unknown;
  sourceText?: string;
  contentHash?: string;
  pipelineVersion?: string;
};

export type JobContext = {
  db: Database;
  log: Logger;
  env: WorkerEnv;
  llm: LlmClient;
  setStage(stage: ImportStage): Promise<void>;
  signal: AbortSignal;
};

export type JobHandler = (
  job: ImportJob,
  ctx: JobContext,
) => Promise<JobOutcome>;
