import {
  createClient,
  createVertexTransport,
  type LlmClient,
} from "@redlance/llm";
import type { WorkerEnv } from "./env";

export function createLlmFromEnv(env: WorkerEnv): LlmClient {
  return createClient(
    createVertexTransport({
      project: env.GOOGLE_CLOUD_PROJECT,
      location: env.GOOGLE_CLOUD_LOCATION,
    }),
  );
}
