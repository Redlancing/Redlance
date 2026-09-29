import type { z } from "zod";
import type { LlmErrorKind } from "./errors";

export type Usage = {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** The thinking share of outputTokens, when the provider reports it. */
  thoughtTokens?: number;
  costMicros: number;
  latencyMs: number;
};

export type AttemptRecord = {
  attempt: number;
  outcome: "ok" | "timeout" | "error" | "invalid_output";
  usage?: Usage;
  error?: LlmErrorKind;
};

export type Thinking = "off" | "low";

export type GenerateRequest<T> = {
  model: string;
  system: string;
  prompt: string;
  /** Validates the parsed JSON. */
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  timeoutMs: number;
  temperature?: number;
  thinking?: Thinking;
  retries?: number;
  retryDelayMs?: number;
  /** Outer deadline. */
  signal?: AbortSignal;
};

export type GenerateResult<T> = { data: T; attempts: AttemptRecord[] };

export interface LlmClient {
  generateStructured<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

export type RawResponse = {
  text: string;
  usage: Omit<Usage, "costMicros" | "latencyMs">;
};

export type Transport = (
  req: GenerateRequest<unknown>,
  jsonSchema: unknown,
  signal: AbortSignal,
) => Promise<RawResponse>;
