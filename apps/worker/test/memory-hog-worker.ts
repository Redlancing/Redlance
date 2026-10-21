import { workerData } from "node:worker_threads";

// Test-only stand-in for extract-worker.ts: allocates ArrayBuffers (memory outside the JS heap,
// like a decompressing parser) until it is killed or reaches 2 GB. The "file" bytes name the
// mode: "sync" never yields, "async" yields between allocations. It never replies.
const mode = new TextDecoder().decode(
  (workerData as { bytes: Uint8Array }).bytes,
);
const MB = 1024 * 1024;
const keep: Uint8Array[] = [];
const grab = () => {
  const end = Date.now() + 2;
  while (Date.now() < end); // ~0.5 GB/s, so polls land mid-growth
  keep.push(new Uint8Array(MB).fill(1));
};
if (mode === "sync") {
  for (let i = 0; i < 2048; i++) grab();
} else {
  for (let i = 0; i < 2048; i++) {
    grab();
    await new Promise((r) => setImmediate(r));
  }
}
