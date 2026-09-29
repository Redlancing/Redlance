import {
  createClient,
  createFakeTransport,
  createVertexTransport,
  type LlmClient,
} from "@redlance/llm";
import type { WorkerEnv } from "./env";

export function createLlmFromEnv(env: WorkerEnv): LlmClient {
  if (env.LLM_MODE === "fake") {
    // Placeholder responder; the resume pipeline swaps in its own.
    return createClient(createFakeTransport(() => ({})));
  }
  return createClient(
    createVertexTransport({
      project: env.GOOGLE_CLOUD_PROJECT!,
      location: env.GOOGLE_CLOUD_LOCATION!,
    }),
  );
}
