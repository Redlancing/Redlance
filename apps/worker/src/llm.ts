import {
  createClient,
  createFakeTransport,
  createVertexTransport,
  type LlmClient,
} from "@redlance/llm";
import type { WorkerEnv } from "./env";
import { fakeResumeResponder } from "./fake-llm";

export function createLlmFromEnv(env: WorkerEnv): LlmClient {
  if (env.LLM_MODE === "fake") {
    return createClient(createFakeTransport(fakeResumeResponder));
  }
  return createClient(
    createVertexTransport({
      project: env.GOOGLE_CLOUD_PROJECT!,
      location: env.GOOGLE_CLOUD_LOCATION!,
    }),
  );
}
