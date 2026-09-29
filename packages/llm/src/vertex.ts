import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { LlmError } from "./errors";
import type { Transport } from "./types";

function statusOf(e: unknown): number | undefined {
  if (e && typeof e === "object") {
    const o = e as { status?: unknown; code?: unknown };
    if (typeof o.status === "number") return o.status;
    if (typeof o.code === "number") return o.code;
  }
  return undefined;
}

const UNSUPPORTED_THINKING_RE = /thinking level is unsupported/i;

function isUnsupportedThinking(e: unknown): boolean {
  const message =
    e instanceof Error
      ? e.message
      : String((e as { message?: unknown })?.message ?? "");
  return statusOf(e) === 400 && UNSUPPORTED_THINKING_RE.test(message);
}

const HARD_QUOTA_RE = /per[ _-]?day|daily|billing|quota metric .*per_day/i;

function mapError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  const status = statusOf(e);
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  if (status === 429) {
    // On Vertex, RESOURCE_EXHAUSTED is usually short-lived throttling (shared
    // capacity), so a 429 is retryable unless it clearly names a hard quota.
    return HARD_QUOTA_RE.test(message)
      ? new LlmError("quota_exhausted", "Vertex AI quota exhausted", {
          cause: e,
        })
      : new LlmError("rate_limited", "Vertex AI rate limited", { cause: e });
  }
  if (status !== undefined && status >= 500)
    return new LlmError("server", `Vertex AI server error ${status}`, {
      cause: e,
    });
  if (status !== undefined && status >= 400)
    return new LlmError(
      "bad_request",
      `Vertex AI rejected the request (${status})`,
      { cause: e },
    );
  return new LlmError("server", "Vertex AI network failure", { cause: e });
}

export function createVertexTransport(cfg: {
  project: string;
  location: string;
}): Transport {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: cfg.project,
    location: cfg.location,
  });
  // Some models reject the MINIMAL thinking level (e.g. gemini-3.8-flash on Vertex answers
  // 400 "Thinking level is unsupported"). Such models get LOW instead, remembered per model.
  const minimalUnsupported = new Set<string>();
  const levelFor = (req: { model: string; thinking?: "off" | "low" }) =>
    req.thinking === "low" || minimalUnsupported.has(req.model)
      ? ThinkingLevel.LOW
      : ThinkingLevel.MINIMAL;

  return async (req, rawSchema, signal) => {
    // Vertex may reject the top-level $schema key that zod adds.
    const { $schema: _omit, ...jsonSchema } = (rawSchema ?? {}) as Record<
      string,
      unknown
    >;
    const call = (thinkingLevel: ThinkingLevel) =>
      ai.models.generateContent({
        model: req.model,
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          temperature: req.temperature ?? 0,
          maxOutputTokens: req.maxOutputTokens,
          // Gemini 3.x models take a thinking level, not a budget.
          thinkingConfig: { thinkingLevel },
          abortSignal: signal,
        },
      });
    try {
      const level = levelFor(req);
      let res;
      try {
        res = await call(level);
      } catch (e) {
        if (level !== ThinkingLevel.MINIMAL || !isUnsupportedThinking(e))
          throw e;
        minimalUnsupported.add(req.model);
        res = await call(ThinkingLevel.LOW);
      }
      const u = res.usageMetadata;
      return {
        text: res.text ?? "",
        usage: {
          model: req.model,
          inputTokens: u?.promptTokenCount ?? 0,
          cachedInputTokens: u?.cachedContentTokenCount ?? 0,
          outputTokens:
            (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
          thoughtTokens: u?.thoughtsTokenCount ?? 0,
        },
      };
    } catch (e) {
      throw mapError(e);
    }
  };
}
