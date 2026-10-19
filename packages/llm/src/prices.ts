// USD per million tokens.
//
// gemini-3.8-flash: $0.75 input / $3.75 output — the introductory price through
// 2026-12-31; from 2027-01-01 it becomes $1.50 input / $7.50 output (update then).
// Source: https://www.requesty.ai/models/vertex/gemini-3.8-flash (accessed 2026-09-29);
// verify on the official Vertex pricing page
// (https://cloud.google.com/vertex-ai/generative-ai/pricing).
// Its cached-input price is unverified: it uses the same 10%-of-input ratio as
// the other entries until a published figure is confirmed.
//
// gemini-3.5-flash-lite: UNVERIFIED placeholder prices — the model id and its
// numbers were not confirmed on the Vertex pricing page. Replace before relying
// on its cost figures.
export const PRICES: Record<
  string,
  {
    inputPerMillion: number;
    cachedInputPerMillion: number;
    outputPerMillion: number;
  }
> = {
  "gemini-3.5-flash-lite": {
    inputPerMillion: 0.1,
    cachedInputPerMillion: 0.01,
    outputPerMillion: 0.4,
  },
  "gemini-3.8-flash": {
    inputPerMillion: 0.75,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 3.75,
  },
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
      console.warn(
        `@redlance/llm: no price for model "${model}", cost recorded as 0`,
      );
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
