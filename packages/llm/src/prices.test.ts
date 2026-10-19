import { describe, expect, it, vi } from "vitest";
import { costMicros, PRICES } from "./index";

describe("costMicros", () => {
  const m = "gemini-3.5-flash-lite";
  it("prices input", () => {
    expect(
      costMicros(m, {
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(Math.round(PRICES[m]!.inputPerMillion * 1e6));
  });
  it("uses the cached price for cached tokens", () => {
    expect(
      costMicros(m, {
        inputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(Math.round(PRICES[m]!.cachedInputPerMillion * 1e6));
  });
  it("prices output", () => {
    expect(
      costMicros(m, {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
      }),
    ).toBe(Math.round(PRICES[m]!.outputPerMillion * 1e6));
  });
  it("prices gemini-3.8-flash at the introductory Vertex rate", () => {
    expect(PRICES["gemini-3.8-flash"]).toEqual({
      inputPerMillion: 0.75,
      cachedInputPerMillion: 0.075,
      outputPerMillion: 3.75,
    });
    expect(
      costMicros("gemini-3.8-flash", {
        inputTokens: 1000,
        cachedInputTokens: 0,
        outputTokens: 1000,
      }),
    ).toBe(4500);
  });
  it("returns 0 and warns once for unknown models", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const u = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 };
    expect(costMicros("nope", u)).toBe(0);
    expect(costMicros("nope", u)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
