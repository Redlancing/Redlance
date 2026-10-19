import { parentPort, workerData } from "node:worker_threads";
import { ResumeError } from "./errors";
import { extractTextInline } from "./extract-inline";

const { bytes, type } = workerData as {
  bytes: Uint8Array;
  type: "pdf" | "docx";
};

extractTextInline(bytes, type).then(
  (text) => parentPort!.postMessage({ ok: true, text }),
  (e) =>
    parentPort!.postMessage({
      ok: false,
      code: e instanceof ResumeError ? e.code : "UNSUPPORTED_FILE",
    }),
);
