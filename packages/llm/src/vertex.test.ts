import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateContent = vi.fn();
const ctor = vi.fn();
vi.mock("@google/genai", () => ({
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW" },
  GoogleGenAI: class {
    models = { generateContent };
    constructor(opts: unknown) {
      ctor(opts);
    }
  },
}));

import { createVertexTransport } from "./vertex";
import { createClient } from "./generate";
import type { GenerateRequest } from "./types";

const req: GenerateRequest<unknown> = {
  model: "gemini-3.5-flash-lite",
  system: "sys",
  prompt: "hi",
  schema: z.object({}),
  maxOutputTokens: 300,
  timeoutMs: 1000,
};
const schema = { type: "object" };
const withDollar = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
};

beforeEach(() => {
  generateContent.mockReset();
  ctor.mockReset();
});

describe("vertex transport", () => {
  it("uses Vertex, never an API key, and maps config and usage", async () => {
    generateContent.mockResolvedValue({
      text: '{"a":1}',
      usageMetadata: {
        promptTokenCount: 10,
        cachedContentTokenCount: 4,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 2,
      },
    });
    const t = createVertexTransport({ project: "p", location: "us-central1" });
    const signal = new AbortController().signal;
    const r = await t(req, schema, signal);
    expect(ctor).toHaveBeenCalledWith({
      vertexai: true,
      project: "p",
      location: "us-central1",
    });
    expect(ctor.mock.calls[0]![0]).not.toHaveProperty("apiKey");
    const arg = generateContent.mock.calls[0]![0];
    expect(arg.model).toBe("gemini-3.5-flash-lite");
    expect(arg.config).toMatchObject({
      systemInstruction: "sys",
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      temperature: 0,
      maxOutputTokens: 300,
      abortSignal: signal,
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    });
    expect(r).toEqual({
      text: '{"a":1}',
      usage: {
        model: "gemini-3.5-flash-lite",
        inputTokens: 10,
        cachedInputTokens: 4,
        outputTokens: 7,
      },
    });
  });

  it("strips $schema from the schema it sends", async () => {
    generateContent.mockResolvedValue({ text: "{}" });
    const t = createVertexTransport({ project: "p", location: "l" });
    await t(req, withDollar, new AbortController().signal);
    expect(generateContent.mock.calls[0]![0].config.responseJsonSchema).toEqual(
      { type: "object" },
    );
  });

  it("maps RESOURCE_EXHAUSTED throttling to rate_limited, and the client retries it", async () => {
    generateContent
      .mockRejectedValueOnce({
        status: 429,
        message:
          "Resource exhausted. Please try again later. RESOURCE_EXHAUSTED",
      })
      .mockResolvedValueOnce({ text: "{}" });
    const t = createVertexTransport({ project: "p", location: "l" });
    const c = createClient(t, { sleep: async () => {} });
    const r = await c.generateStructured(req);
    expect(r.attempts.map((a) => a.outcome)).toEqual(["error", "ok"]);
    generateContent.mockRejectedValueOnce({
      status: 429,
      message: "Quota exceeded. RESOURCE_EXHAUSTED",
    });
    await expect(
      t(req, schema, new AbortController().signal),
    ).rejects.toMatchObject({
      kind: "rate_limited",
    });
  });

  it("maps a daily quota 429 to quota_exhausted", async () => {
    const t = createVertexTransport({ project: "p", location: "l" });
    generateContent.mockRejectedValueOnce({
      status: 429,
      message:
        "Quota exceeded for quota metric 'generate_content_requests_per_day'. RESOURCE_EXHAUSTED",
    });
    await expect(
      t(req, schema, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "quota_exhausted" });
    generateContent.mockRejectedValueOnce({
      status: 429,
      message: "You exceeded your requests per day limit",
    });
    await expect(
      t(req, schema, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "quota_exhausted" });
    generateContent.mockRejectedValueOnce({
      status: 429,
      message: "Billing account has no credit",
    });
    await expect(
      t(req, schema, new AbortController().signal),
    ).rejects.toMatchObject({ kind: "quota_exhausted" });
  });

  it("maps plain 429, 503 and 400", async () => {
    const t = createVertexTransport({ project: "p", location: "l" });
    const s = new AbortController().signal;
    generateContent.mockRejectedValueOnce({
      status: 429,
      message: "slow down",
    });
    await expect(t(req, schema, s)).rejects.toMatchObject({
      kind: "rate_limited",
    });
    generateContent.mockRejectedValueOnce({ status: 503 });
    await expect(t(req, schema, s)).rejects.toMatchObject({ kind: "server" });
    generateContent.mockRejectedValueOnce({ status: 400 });
    await expect(t(req, schema, s)).rejects.toMatchObject({
      kind: "bad_request",
    });
  });
});
