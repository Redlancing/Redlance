import { Worker } from "node:worker_threads";
import { JobError } from "../jobs/types";
import type { Logger } from "../logger";
import { ResumeError } from "./errors";

export {
  MAX_PDF_PAGES,
  checkDocxZip,
  extractTextInline,
} from "./extract-inline";

const WORKER_TIMEOUT_MS = 5_000;

/**
 * Per-thread memory limit: JS heap plus external memory (ArrayBuffers, which is what pdf.js
 * allocates when it inflates a content stream). `resourceLimits` caps only the JS heap — a
 * thread capped at 64 MB of heap held 600 MB of Uint8Arrays in a test — so the parent polls
 * the thread instead. A normal resume peaks at ~25–35 MB (tsx + pdf.js or mammoth loaded,
 * measured on 10-page fixtures); 128 MB leaves room for big files and stays well under the 256 MB heap cap, so up to
 * WORKER_CONCURRENCY (4) threads hold at most ~0.5 GB plus one poll's growth each.
 */
export const MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
/** `getHeapStatistics()` is answered by the thread even mid-way through a synchronous loop. */
const MEMORY_POLL_MS = 50;

type Reply =
  | { ok: true; text: string }
  | { ok: false; code: "NO_TEXT" | "UNSUPPORTED_FILE" };

/** Errors that mean the thread itself couldn't start (our fault, not the file's). */
function isStartFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return false;
  if (code === "ERR_WORKER_OUT_OF_MEMORY") return false; // the file blew the limit
  return code.startsWith("ERR_WORKER_") || code === "ERR_MODULE_NOT_FOUND";
}

/**
 * Parses in a worker thread with memory limits, a memory watchdog and a hard timer, so a
 * pathological file can neither exhaust the worker process's memory nor block its event loop.
 * Any failure of the thread (crash, out of memory, over the watchdog limit, timeout) becomes
 * UNSUPPORTED_FILE, except a thread that can't
 * start at all (a deploy problem), which is a retryable INTERNAL. Failures are logged with the
 * path, exit code and error name/code only — never a message, which may quote the file.
 */
export function extractText(
  bytes: Uint8Array,
  type: "pdf" | "docx",
  opts: { timeoutMs?: number; log?: Logger; workerUrl?: URL } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(bytes); // transferring must not detach the caller's buffer
    let done = false;
    let worker: Worker;
    const logFailure = (
      path: "error" | "exit" | "timeout" | "memory",
      extra: { exitCode?: number; err?: unknown; memoryMb?: number } = {},
    ) => {
      const e = extra.err as { name?: unknown; code?: unknown } | undefined;
      opts.log?.warn(
        {
          path,
          exitCode: extra.exitCode,
          memoryMb: extra.memoryMb,
          errName: typeof e?.name === "string" ? e.name : undefined,
          errCode: typeof e?.code === "string" ? e.code : undefined,
        },
        "resume text extraction thread failed",
      );
    };
    try {
      worker = new Worker(
        opts.workerUrl ?? new URL("./extract-worker.ts", import.meta.url),
        {
          // The process runs under tsx; make sure the thread can load TypeScript too.
          execArgv: ["--import", "tsx"],
          workerData: { bytes: copy, type },
          transferList: [copy.buffer],
          resourceLimits: {
            maxOldGenerationSizeMb: 256,
            maxYoungGenerationSizeMb: 64,
          },
        },
      );
    } catch (err) {
      logFailure("error", { err });
      reject(
        new JobError("INTERNAL", true, "the extraction thread could not start"),
      );
      return;
    }
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      void worker.terminate();
      fn();
    };
    const fail = (code: "NO_TEXT" | "UNSUPPORTED_FILE" = "UNSUPPORTED_FILE") =>
      finish(() =>
        reject(new ResumeError(code, "The file could not be read.")),
      );
    const timer = setTimeout(() => {
      if (!done) logFailure("timeout");
      fail();
    }, opts.timeoutMs ?? WORKER_TIMEOUT_MS);
    // One poll in flight at a time; a poll that fails (the thread is exiting) is ignored, since
    // the exit/error listeners settle the promise.
    let polling = false;
    const watchdog = setInterval(() => {
      if (polling || done) return;
      polling = true;
      worker.getHeapStatistics().then(
        (s) => {
          polling = false;
          const used = s.used_heap_size + s.external_memory;
          if (done || used <= MEMORY_LIMIT_BYTES) return;
          logFailure("memory", { memoryMb: Math.round(used / 1024 / 1024) });
          fail();
        },
        () => {
          polling = false;
        },
      );
    }, MEMORY_POLL_MS);
    worker.once("message", (m: Reply) =>
      m.ok ? finish(() => resolve(m.text)) : fail(m.code),
    );
    worker.once("error", (err) => {
      if (done) return;
      logFailure("error", { err });
      if (isStartFailure(err))
        finish(() =>
          reject(
            new JobError(
              "INTERNAL",
              true,
              "the extraction thread could not start",
            ),
          ),
        );
      else fail();
    });
    worker.once("exit", (exitCode) => {
      if (done) return;
      logFailure("exit", { exitCode });
      fail();
    });
  });
}
