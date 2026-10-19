/**
 * Post-analysis eval: runs the real model over the labelled synthetic posts and prints field
 * accuracy, cost and latency against the plan's bar.
 *
 *   npm run eval:posts -w @redlance/worker
 *
 * Needs GOOGLE_CLOUD_PROJECT/LOCATION and Google credentials (like the resume eval).
 * Not part of `npm test`. About 32 calls on Flash-Lite: well under a cent.
 */
import { readFileSync } from "node:fs";
import type { JobPostRow } from "@redlance/db";
import type { AttemptRecord } from "@redlance/llm";
import { parseWorkerEnv } from "../../../src/env";
import {
  PIPELINE_VERSION,
  analysePost,
} from "../../../src/ingest/analyse-post";
import { createLlmFromEnv } from "../../../src/llm";
import {
  BAR,
  FIELDS,
  accuracy,
  scorePost,
  type LabelledPost,
  type PostScore,
} from "./score";

const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");
const posts = (
  JSON.parse(
    readFileSync(new URL("./posts.json", import.meta.url), "utf8"),
  ) as LabelledPost[]
).filter((p) => !only || only.includes(p.name));

const env = parseWorkerEnv(process.env);
const llm = createLlmFromEnv(env);
const model = env.VERTEX_MODEL_FAST;

const row = (p: LabelledPost, i: number): JobPostRow => ({
  id: `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`,
  source: "reddit",
  externalId: `t3_eval${i}`,
  fetchedVia: "rss",
  community: p.community,
  url: `https://www.reddit.com/r/${p.community}/comments/eval${i}/x/`,
  title: p.title,
  body: p.body,
  author: null,
  postedAt: new Date("2026-09-30T12:00:00Z"),
  sourceUpdatedAt: null,
  firstSeenAt: new Date(),
  firstSeenFeedId: null,
  preKind: "unknown",
  analysisStatus: "running",
  analysisAttempts: 1,
  analysisRunAfter: new Date(),
  analysisLockedAt: new Date(),
  analysisError: null,
  duplicateOf: null,
});

console.log(
  `Post eval: ${posts.length} posts, ${model}, ${PIPELINE_VERSION}\n`,
);
const scores: PostScore[] = [];
let micros = 0;
const latencies: number[] = [];
for (const [i, p] of posts.entries()) {
  const t0 = Date.now();
  const attempts: AttemptRecord[] = [];
  try {
    const got = await analysePost(row(p, i), {
      llm,
      model,
      onAttempt: (a) => attempts.push(a),
    });
    const s = scorePost(p.expected, got);
    scores.push(s);
    const wrong = FIELDS.filter((f) => s[f] === false);
    console.log(
      `${wrong.length ? "✗" : "✓"} ${p.name.padEnd(28)} ${got.kind.padEnd(9)} ${got.payType.padEnd(16)} ${wrong.length ? `wrong: ${wrong.join(", ")}` : ""}`,
    );
    if (wrong.length && process.argv.includes("--verbose"))
      console.log(
        `    got categories=${got.categories.join(",")} skills=${got.skillIds.join(",")} redFlags=${got.redFlags.join(",")} · expected ${JSON.stringify(p.expected)}`,
      );
  } catch (err) {
    scores.push({ kind: false });
    console.log(`✗ ${p.name.padEnd(28)} failed: ${(err as Error).message}`);
  }
  latencies.push(Date.now() - t0);
  micros += attempts.reduce((n, a) => n + (a.usage?.costMicros ?? 0), 0);
}

const acc = accuracy(scores);
console.log("\nField accuracy:");
let pass = true;
for (const f of FIELDS) {
  const { right, total } = acc[f];
  if (!total) continue;
  const pct = right / total;
  const bar = BAR[f];
  const ok = bar === undefined || pct >= bar;
  if (!ok) pass = false;
  console.log(
    `  ${f.padEnd(15)} ${String(right).padStart(3)}/${total}  ${(pct * 100).toFixed(0).padStart(3)}%${bar ? `  (bar ${bar * 100}%) ${ok ? "ok" : "BELOW"}` : ""}`,
  );
}
latencies.sort((a, b) => a - b);
console.log(
  `\nCost: $${(micros / 1e6).toFixed(5)} total, $${(micros / 1e6 / posts.length).toFixed(6)} a post · latency p50 ${latencies[Math.floor(latencies.length / 2)]} ms, max ${latencies.at(-1)} ms`,
);
console.log(
  pass ? "\nMeets the bar." : "\nBelow the bar: fix the prompt before launch.",
);
process.exit(pass ? 0 : 1);
