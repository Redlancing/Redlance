import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClient, createFakeTransport, LlmError, type GenerateRequest, type Transport } from "./index";

const schema = z.object({ name: z.string() });
const base = (over: Partial<GenerateRequest<{ name: string }>> = {}): GenerateRequest<{ name: string }> => ({
  model: "gemini-3.5-flash-lite", system: "s", prompt: "p", schema,
  maxOutputTokens: 100, timeoutMs: 1000, ...over,
});
const sleep = async () => {};

describe("generateStructured", () => {
  it("returns parsed data with usage and cost", async () => {
    const c = createClient(createFakeTransport(() => ({ name: "a" })), { sleep });
    const r = await c.generateStructured(base());
    expect(r.data).toEqual({ name: "a" });
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]!.outcome).toBe("ok");
    expect(r.attempts[0]!.usage!.costMicros).toBeGreaterThan(0);
  });

  it("retries invalid JSON once", async () => {
    let n = 0;
    const c = createClient(createFakeTransport(() => (n++ === 0 ? "not json" : { name: "b" })), { sleep });
    const r = await c.generateStructured(base());
    expect(r.attempts.map((a) => a.outcome)).toEqual(["invalid_output", "ok"]);
  });

  it("throws invalid_output after two bad attempts", async () => {
    const c = createClient(createFakeTransport(() => "nope"), { sleep });
    const e = await c.generateStructured(base()).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.kind).toBe("invalid_output");
    expect(e.attempts).toHaveLength(2);
  });

  it("treats a wrong type as invalid_output", async () => {
    const c = createClient(createFakeTransport(() => ({ name: 5 })), { sleep });
    const e = await c.generateStructured(base()).catch((x) => x);
    expect(e.kind).toBe("invalid_output");
  });

  it("times out, retries once, then throws timeout", async () => {
    const hang: Transport = (_r, _s, signal) =>
      new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("abort"))));
    const c = createClient(hang, { sleep });
    const e = await c.generateStructured(base({ timeoutMs: 20 })).catch((x) => x);
    expect(e.kind).toBe("timeout");
    expect(e.attempts.map((a: { outcome: string }) => a.outcome)).toEqual(["timeout", "timeout"]);
  });

  it("retries rate_limited", async () => {
    let n = 0;
    const c = createClient(createFakeTransport(() => {
      if (n++ === 0) throw new LlmError("rate_limited", "429");
      return { name: "x" };
    }), { sleep });
    const r = await c.generateStructured(base());
    expect(r.attempts.map((a) => a.outcome)).toEqual(["error", "ok"]);
  });

  it.each(["quota_exhausted", "bad_request"] as const)("does not retry %s", async (kind) => {
    const c = createClient(createFakeTransport(() => { throw new LlmError(kind, "x"); }), { sleep });
    const e = await c.generateStructured(base()).catch((x) => x);
    expect(e.kind).toBe(kind);
    expect(e.attempts).toHaveLength(1);
  });

  it("does not retry when the outer signal is aborted", async () => {
    const c = createClient(createFakeTransport(() => ({ name: "a" })), { sleep });
    const e = await c.generateStructured(base({ signal: AbortSignal.abort() })).catch((x) => x);
    expect(e.kind).toBe("aborted");
    expect(e.attempts.length).toBeLessThanOrEqual(1);
  });
});
