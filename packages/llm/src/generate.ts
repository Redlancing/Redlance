import { z } from "zod";
import { LlmError } from "./errors";
import { costMicros } from "./prices";
import type { AttemptRecord, GenerateRequest, GenerateResult, LlmClient, Transport } from "./types";

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolves true after the delay, false if the signal aborts first. */
async function sleepUnlessAborted(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!signal) return (await sleep(ms), true);
  if (signal.aborted) return false;
  let onAbort!: () => void;
  const aborted = new Promise<false>((r) => {
    onAbort = () => r(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([sleep(ms).then(() => true as const), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function createClient(
  transport: Transport,
  opts: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): LlmClient {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  return {
    async generateStructured<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
      const { $schema: _omit, ...jsonSchema } = z.toJSONSchema(req.schema) as Record<string, unknown>;
      const maxAttempts = 1 + (req.retries ?? 1);
      const attempts: AttemptRecord[] = [];
      let last: LlmError | undefined;

      for (let n = 1; n <= maxAttempts; n++) {
        if (req.signal?.aborted) {
          last = new LlmError("aborted", "aborted by caller");
          break;
        }
        const ctrl = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, req.timeoutMs);
        const onOuter = () => ctrl.abort();
        req.signal?.addEventListener("abort", onOuter, { once: true });
        const start = now();
        try {
          // Race so the attempt ends when its controller aborts, even if the transport ignores the signal.
          const abortedP = new Promise<never>((_, reject) => {
            ctrl.signal.addEventListener("abort", () => reject(new Error("attempt aborted")), { once: true });
          });
          const call = transport(req as GenerateRequest<unknown>, jsonSchema, ctrl.signal);
          call.catch(() => {}); // avoid unhandled rejection if we stop waiting
          const raw = await Promise.race([call, abortedP]);
          const usage = {
            ...raw.usage,
            costMicros: costMicros(raw.usage.model, raw.usage),
            latencyMs: now() - start,
          };
          let parsed: T | undefined;
          let parsedOk = true;
          try {
            parsed = req.schema.parse(JSON.parse(raw.text));
          } catch (e) {
            attempts.push({ attempt: n, outcome: "invalid_output", usage, error: "invalid_output" });
            last = new LlmError("invalid_output", "model output failed validation", { cause: e });
            parsedOk = false;
          }
          if (parsedOk) {
            attempts.push({ attempt: n, outcome: "ok", usage });
            return { data: parsed!, attempts };
          }
        } catch (e) {
          let err: LlmError;
          if (req.signal?.aborted) err = new LlmError("aborted", "aborted by caller", { cause: e });
          else if (timedOut) err = new LlmError("timeout", `timed out after ${req.timeoutMs} ms`, { cause: e });
          else if (e instanceof LlmError) err = e;
          else err = new LlmError("server", "unexpected LLM failure", { cause: e });
          attempts.push({
            attempt: n,
            outcome: err.kind === "timeout" ? "timeout" : "error",
            error: err.kind,
          });
          last = err;
        } finally {
          clearTimeout(timer);
          req.signal?.removeEventListener("abort", onOuter);
        }
        if (!last!.retryable) break;
        if (n < maxAttempts) {
          const slept = await sleepUnlessAborted(sleep, req.retryDelayMs ?? 1000, req.signal);
          if (!slept) {
            last = new LlmError("aborted", "aborted by caller");
            break;
          }
        }
      }

      const final = last ?? new LlmError("server", "no attempt made");
      final.attempts = attempts;
      throw final;
    },
  };
}
