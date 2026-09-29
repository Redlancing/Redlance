import { LlmError } from "./errors";
import type { GenerateRequest, Transport } from "./types";

/**
 * A transport for tests and LLM_MODE=fake. `respond` returns a value (JSON-encoded
 * for the caller; a string is passed through as-is) or throws/returns nothing useful.
 * It may throw an LlmError. It never resolves after the signal aborts.
 */
export function createFakeTransport(
  respond: (req: GenerateRequest<unknown>) => unknown | Promise<unknown>,
): Transport {
  return async (req, _schema, signal) => {
    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new LlmError("timeout", "aborted"));
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    });
    const value = await Promise.race([Promise.resolve(respond(req)), aborted]);
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return {
      text,
      usage: { model: req.model, inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 },
    };
  };
}
