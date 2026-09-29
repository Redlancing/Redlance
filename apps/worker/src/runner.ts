import {
  claimNextImportJob,
  completeImportJob,
  failImportJob,
  pgErrorCode,
  requeueStaleImportJobs,
  setImportStage,
  type Database,
  type ImportJob,
  type ImportKind,
} from "@redlance/db";
import type { LlmClient } from "@redlance/llm";
import type { WorkerEnv } from "./env";
import { JobError, type JobHandler } from "./jobs/types";
import type { Logger } from "./logger";

export type RunnerOptions = {
  db: Database;
  listen: () => Promise<{
    onNotify(cb: () => void): void;
    close(): Promise<void>;
  }>;
  handlers: Partial<Record<ImportKind, JobHandler>>;
  env: WorkerEnv;
  log: Logger;
  llm: LlmClient;
  concurrency?: number;
  pollMs?: number;
  sweepMs?: number;
  jobTimeoutMs?: number;
};

const SHUTDOWN_REASON = Symbol("shutdown");

export function createRunner(opts: RunnerOptions) {
  const { db, handlers, env, log, llm } = opts;
  const concurrency = opts.concurrency ?? env.WORKER_CONCURRENCY;
  const pollMs = opts.pollMs ?? 5000;
  const sweepMs = opts.sweepMs ?? 60_000;
  const jobTimeoutMs = opts.jobTimeoutMs ?? 90_000;

  const running = new Set<Promise<void>>();
  /** One controller per running job, so stop() can abort them. */
  const controllers = new Set<AbortController>();
  let listener: Awaited<ReturnType<RunnerOptions["listen"]>> | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let started = false;
  let pumping: Promise<void> | null = null;
  let pumpAgain = false;

  async function runJob(job: ImportJob): Promise<void> {
    const started = Date.now();
    const handler = handlers[job.kind];
    let status = "done";
    let errorCode: string | null = null;
    try {
      if (!handler) {
        errorCode = "UNSUPPORTED_JOB";
        status = await failImportJob(db, job.id, job.attempts, {
          errorCode,
          retryable: false,
        });
        return;
      }
      const ac = new AbortController();
      controllers.add(ac);
      let timer: NodeJS.Timeout | undefined;
      try {
        // stop() aborts with SHUTDOWN_REASON; the job then fails as SHUTDOWN
        // (retryable) even if the handler ignores the signal.
        const shutdown = new Promise<never>((_, reject) => {
          ac.signal.addEventListener(
            "abort",
            () => {
              if (ac.signal.reason === SHUTDOWN_REASON)
                reject(new JobError("SHUTDOWN", true, "worker stopping"));
            },
            { once: true },
          );
        });
        shutdown.catch(() => {});
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            ac.abort();
            reject(new JobError("TIMEOUT", true, "job timed out"));
          }, jobTimeoutMs);
        });
        timeout.catch(() => {}); // always has a handler, even if the handler throws first
        const work = Promise.resolve().then(() =>
          handler(job, {
            db,
            log: log.child({ jobId: job.id }),
            env,
            llm,
            setStage: (stage) =>
              setImportStage(db, job.id, job.attempts, stage),
            signal: ac.signal,
          }),
        );
        work.catch(() => {}); // a late rejection after timeout must not be unhandled
        const outcome = await Promise.race([work, timeout, shutdown]);
        const owned = await completeImportJob(
          db,
          job.id,
          job.attempts,
          outcome,
        );
        if (!owned) {
          status = "lost";
          log.warn(
            { jobId: job.id },
            "claim lost before completion; result dropped",
          );
        }
      } finally {
        clearTimeout(timer);
        controllers.delete(ac);
      }
    } catch (err) {
      const je = err instanceof JobError ? err : new JobError("INTERNAL", true);
      errorCode = je.code;
      if (!(err instanceof JobError)) {
        // Never log err.message: it may contain resume text. Frames only.
        const e = err instanceof Error ? err : undefined;
        log.error(
          {
            jobId: job.id,
            kind: job.kind,
            errName: e?.name ?? typeof err,
            pgCode: pgErrorCode(err),
            stack: e?.stack
              ?.split("\n")
              .filter((l) => /^\s+at /.test(l))
              .join("\n"),
          },
          "job failed with an unexpected error",
        );
      }
      try {
        status = await failImportJob(db, job.id, job.attempts, {
          errorCode: je.code,
          retryable: je.retryable,
        });
      } catch (dbErr) {
        status = "unrecorded";
        log.error(
          {
            jobId: job.id,
            errName: (dbErr as Error)?.name,
            pgCode: pgErrorCode(dbErr),
          },
          "could not record job failure",
        );
      }
    } finally {
      log.info(
        {
          jobId: job.id,
          kind: job.kind,
          status,
          attempts: job.attempts,
          durationMs: Date.now() - started,
          errorCode,
        },
        "job finished",
      );
    }
  }

  async function pumpOnce(): Promise<void> {
    while (!stopping && running.size < concurrency) {
      let job: ImportJob | null;
      try {
        job = await claimNextImportJob(db);
      } catch (err) {
        log.error({ err: (err as Error).message }, "claim failed");
        return;
      }
      if (!job) return;
      const p: Promise<void> = runJob(job).finally(() => {
        running.delete(p);
        void pump(); // a slot freed up
      });
      running.add(p);
    }
  }

  function pump(): Promise<void> {
    if (stopping) return Promise.resolve();
    if (pumping) {
      pumpAgain = true;
      return pumping;
    }
    pumping = (async () => {
      try {
        do {
          pumpAgain = false;
          await pumpOnce();
        } while (pumpAgain && !stopping);
      } finally {
        pumping = null;
      }
    })();
    return pumping;
  }

  async function sweep() {
    try {
      const n = await requeueStaleImportJobs(db);
      if (n > 0) {
        log.warn({ count: n }, "re-queued stale jobs");
        void pump();
      }
    } catch (err) {
      log.error({ err: (err as Error).message }, "stale sweep failed");
    }
  }

  return {
    async start() {
      if (started) return;
      started = true;
      const l = await opts.listen();
      listener = l;
      if (stopping) return void (await l.close());
      l.onNotify(() => void pump());
      pollTimer = setInterval(() => void pump(), pollMs);
      sweepTimer = setInterval(() => void sweep(), sweepMs);
      await sweep();
      if (stopping) return;
      await pump();
    },
    async stop(graceMs = 30_000) {
      stopping = true;
      if (pollTimer) clearInterval(pollTimer);
      if (sweepTimer) clearInterval(sweepTimer);
      if (pumping) await pumping.catch(() => {});
      // Abort running jobs 5 s before the grace period ends (at once for a
      // short grace), so they fail as SHUTDOWN and are re-queued now instead
      // of waiting for the stale sweep.
      const abortAll = () => {
        for (const ac of controllers) ac.abort(SHUTDOWN_REASON);
      };
      const abortTimer = setTimeout(abortAll, Math.max(0, graceMs - 5000));
      let graceTimer: NodeJS.Timeout | undefined;
      const grace = new Promise<void>((resolve) => {
        graceTimer = setTimeout(resolve, graceMs);
      });
      await Promise.race([
        (async () => {
          while (running.size > 0) await Promise.allSettled([...running]);
        })(),
        grace,
      ]);
      clearTimeout(graceTimer);
      clearTimeout(abortTimer);
      if (running.size > 0) {
        log.warn({ running: running.size }, "stopping with jobs still running");
      }
      await listener?.close();
    },
    /** Resolves once nothing is running or being claimed (used by tests). */
    async idle() {
      for (;;) {
        if (pumping) await pumping.catch(() => {});
        else if (running.size > 0) await Promise.allSettled([...running]);
        else return;
      }
    },
  };
}
