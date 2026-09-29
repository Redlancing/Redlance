import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "./env";

const base = {
  APP_ENV: "local",
  DATABASE_URL: "postgres://x",
  LLM_MODE: "fake",
};

describe("parseWorkerEnv", () => {
  it("applies defaults", () => {
    const env = parseWorkerEnv(base);
    expect(env.VERTEX_MODEL_FAST).toBe("gemini-3.5-flash-lite");
    expect(env.VERTEX_MODEL_SMART).toBe("gemini-3.8-flash");
    expect(env.WORKER_CONCURRENCY).toBe(4);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it("rejects fake outside local/test", () => {
    expect(() =>
      parseWorkerEnv({ ...base, APP_ENV: "production", GITHUB_TOKEN: "t" }),
    ).toThrow(/LLM_MODE=fake/);
  });

  it("requires project and location for vertex", () => {
    expect(() => parseWorkerEnv({ ...base, LLM_MODE: "vertex" })).toThrow(
      /GOOGLE_CLOUD_PROJECT[\s\S]*GOOGLE_CLOUD_LOCATION/,
    );
    expect(
      parseWorkerEnv({
        ...base,
        LLM_MODE: "vertex",
        GOOGLE_CLOUD_PROJECT: "p",
        GOOGLE_CLOUD_LOCATION: "us-central1",
      }).LLM_MODE,
    ).toBe("vertex");
  });

  it("rejects API keys", () => {
    expect(() => parseWorkerEnv({ ...base, GEMINI_API_KEY: "k" })).toThrow(
      /Use Vertex AI credentials, not an API key/,
    );
    expect(() => parseWorkerEnv({ ...base, GOOGLE_API_KEY: "k" })).toThrow(
      /Use Vertex AI credentials/,
    );
  });

  it("requires GITHUB_TOKEN outside local", () => {
    expect(() =>
      parseWorkerEnv({
        ...base,
        APP_ENV: "staging",
        LLM_MODE: "vertex",
        GOOGLE_CLOUD_PROJECT: "p",
        GOOGLE_CLOUD_LOCATION: "l",
      }),
    ).toThrow(/GITHUB_TOKEN/);
  });
});
