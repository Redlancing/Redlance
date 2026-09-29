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

function mapError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  const status = statusOf(e);
  const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "";
  if (status === 429) {
    return /RESOURCE_EXHAUSTED|quota/i.test(message)
      ? new LlmError("quota_exhausted", "Vertex AI quota exhausted", { cause: e })
      : new LlmError("rate_limited", "Vertex AI rate limited", { cause: e });
  }
  if (status !== undefined && status >= 500) return new LlmError("server", `Vertex AI server error ${status}`, { cause: e });
  if (status !== undefined && status >= 400) return new LlmError("bad_request", `Vertex AI rejected the request (${status})`, { cause: e });
  return new LlmError("server", "Vertex AI network failure", { cause: e });
}

export function createVertexTransport(cfg: { project: string; location: string }): Transport {
  const ai = new GoogleGenAI({ vertexai: true, project: cfg.project, location: cfg.location });
  return async (req, jsonSchema, signal) => {
    try {
      const res = await ai.models.generateContent({
        model: req.model,
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          temperature: req.temperature ?? 0,
          maxOutputTokens: req.maxOutputTokens,
          // Gemini 3.x models take a thinking level, not a budget.
          thinkingConfig: {
            thinkingLevel: req.thinking === "low" ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
          },
          abortSignal: signal,
        },
      });
      const u = res.usageMetadata;
      return {
        text: res.text ?? "",
        usage: {
          model: req.model,
          inputTokens: u?.promptTokenCount ?? 0,
          cachedInputTokens: u?.cachedContentTokenCount ?? 0,
          outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        },
      };
    } catch (e) {
      throw mapError(e);
    }
  };
}
