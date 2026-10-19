// Checks Vertex AI access with the worker's settings: which Gemini models the project can
// see, and which model version actually answers for our two configured models.
// Run: npm run vertex:check -w @redlance/worker   (reads apps/worker/.env.local)
import { GoogleGenAI } from "@google/genai";
import { createClient, createVertexTransport } from "@redlance/llm";
import { z } from "zod";

const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION ?? "global";
const models = [
  ["fast", process.env.VERTEX_MODEL_FAST ?? "gemini-3.5-flash-lite"],
  ["smart", process.env.VERTEX_MODEL_SMART ?? "gemini-3.8-flash"],
] as const;

if (!project) {
  console.error("Set GOOGLE_CLOUD_PROJECT in apps/worker/.env.local");
  process.exit(1);
}
console.log(
  `Project ${project}, location ${location}, credentials: ${
    process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? "service-account key file"
      : "Application Default Credentials"
  }\n`,
);

const ai = new GoogleGenAI({ vertexai: true, project, location });

function describeError(err: unknown): string {
  const e = err as { status?: number; message?: string };
  const firstLine = (e.message ?? String(err)).split("\n")[0]?.slice(0, 300);
  return `${e.status ?? "?"} ${firstLine}`;
}

// 1. Gemini base models visible to this project in this location.
try {
  const names: string[] = [];
  const pager = await ai.models.list({
    config: { queryBase: true, pageSize: 100 },
  });
  for await (const m of pager) {
    const name = m.name?.replace(/^publishers\/google\/models\//, "") ?? "";
    if (/gemini/i.test(name)) names.push(name);
    if (names.length >= 60) break;
  }
  console.log(`Gemini models listed (${names.length}):`);
  for (const n of names.sort()) console.log(`  - ${n}`);
} catch (err) {
  console.log(`Could not list models: ${describeError(err)}`);
}

// 2. A tiny structured call to each configured model through our own client
//    (@redlance/llm: JSON schema, timeout, retry, thinking-level fallback).
console.log("\nTest calls (through @redlance/llm, like the worker):");
const client = createClient(createVertexTransport({ project, location }));
for (const [role, model] of models) {
  const started = performance.now();
  try {
    const res = await client.generateStructured({
      model,
      system: "Answer only with JSON matching the schema.",
      prompt: 'Return {"answer": "OK"}.',
      schema: z.object({ answer: z.string() }),
      maxOutputTokens: 50,
      timeoutMs: 15_000,
    });
    const ms = Math.round(performance.now() - started);
    const u = res.attempts.at(-1)?.usage;
    console.log(
      `  ${role.padEnd(5)} ${model} → ${JSON.stringify(res.data)} in ${ms} ms ` +
        `(attempts ${res.attempts.length}, tokens in ${u?.inputTokens ?? "?"}, out ${u?.outputTokens ?? "?"}, cost ${u?.costMicros ?? 0} µ$)`,
    );
  } catch (err) {
    console.log(`  ${role.padEnd(5)} ${model} → FAILED: ${describeError(err)}`);
  }
}
