// PLACEHOLDER PRICES (USD per million tokens). The Vertex AI pricing page
// (https://cloud.google.com/vertex-ai/generative-ai/pricing, checked 2026-09-29)
// could not be read by our fetch tool and these model ids were not confirmed there.
// Replace with the real numbers before relying on cost figures.
export const PRICES: Record<
  string,
  { inputPerMillion: number; cachedInputPerMillion: number; outputPerMillion: number }
> = {
  "gemini-3.5-flash-lite": { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.4 },
  "gemini-3.8-flash": { inputPerMillion: 0.3, cachedInputPerMillion: 0.03, outputPerMillion: 2.5 },
};

const warned = new Set<string>();

/** Cost in micro-dollars (USD per million tokens equals micros per token). */
export function costMicros(
  model: string,
  u: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
): number {
  const p = PRICES[model];
  if (!p) {
    if (!warned.has(model)) {
      warned.add(model);
      console.warn(`@redlance/llm: no price for model "${model}", cost recorded as 0`);
    }
    return 0;
  }
  const uncached = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return Math.round(
    uncached * p.inputPerMillion +
      u.cachedInputTokens * p.cachedInputPerMillion +
      u.outputTokens * p.outputPerMillion,
  );
}
