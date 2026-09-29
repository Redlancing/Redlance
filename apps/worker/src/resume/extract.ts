import { Worker } from "node:worker_threads";
import { ResumeError } from "./errors";

export { MAX_PDF_PAGES, checkDocxZip, extractTextInline } from "./extract-inline";

const WORKER_TIMEOUT_MS = 20_000;

type Reply =
  | { ok: true; text: string }
  | { ok: false; code: "NO_TEXT" | "UNSUPPORTED_FILE" };

/**
 * Parses in a worker thread with memory limits and a hard timer, so a pathological file can
 * neither exhaust the worker process's memory nor block its event loop. Any failure of the
 * thread (crash, out of memory, timeout) becomes UNSUPPORTED_FILE.
 */
export function extractText(
  bytes: Uint8Array,
  type: "pdf" | "docx",
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(bytes); // transferring must not detach the caller's buffer
    let done = false;
    const worker = new Worker(new URL("./extract-worker.ts", import.meta.url), {
      // The process runs under tsx; make sure the thread can load TypeScript too.
      execArgv: ["--import", "tsx"],
      workerData: { bytes: copy, type },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64 },
    });
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const fail = (code: "NO_TEXT" | "UNSUPPORTED_FILE" = "UNSUPPORTED_FILE") =>
      finish(() => reject(new ResumeError(code, "The file could not be read.")));
    const timer = setTimeout(() => fail(), opts.timeoutMs ?? WORKER_TIMEOUT_MS);
    worker.once("message", (m: Reply) =>
      m.ok ? finish(() => resolve(m.text)) : fail(m.code),
    );
    worker.once("error", () => fail());
    worker.once("exit", () => fail());
  });
}
