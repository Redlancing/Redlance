import { describe, expect, it } from "vitest";
import { parseWorkerEnv, redditUserAgent } from "./env";

const base = {
  APP_ENV: "local",
  DATABASE_URL: "postgres://x",
  GOOGLE_CLOUD_PROJECT: "p",
  GOOGLE_CLOUD_LOCATION: "global",
};

describe("parseWorkerEnv", () => {
  it("applies defaults", () => {
    const env = parseWorkerEnv(base);
    expect(env.VERTEX_MODEL_FAST).toBe("gemini-3.5-flash-lite");
    expect(env.VERTEX_MODEL_SMART).toBe("gemini-3.8-flash");
    expect(env.WORKER_CONCURRENCY).toBe(4);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.INGEST_ENABLED).toBe(true);
    expect(env.ANALYSIS_ENABLED).toBe(true);
    expect(env.ANALYSIS_DAILY_BUDGET_USD).toBe(2);
    expect(env.INGEST_MAX_GROUP).toBe(80);
    expect(env.INGEST_MIN_SPACING_MS).toBe(65_000);
    expect(env.DEDUPE_SIMILARITY).toBe(0.8);
    expect(env.DEDUPE_WINDOW_HOURS).toBe(72);
  });

  it("parses and bounds the dedupe settings", () => {
    const env = parseWorkerEnv({
      ...base,
      DEDUPE_SIMILARITY: "0.7",
      DEDUPE_WINDOW_HOURS: "24",
    });
    expect(env.DEDUPE_SIMILARITY).toBe(0.7);
    expect(env.DEDUPE_WINDOW_HOURS).toBe(24);
    for (const v of ["0.2", "1.5"])
      expect(() => parseWorkerEnv({ ...base, DEDUPE_SIMILARITY: v })).toThrow(
        /DEDUPE_SIMILARITY/,
      );
    for (const v of ["0", "400", "1.5"])
      expect(() => parseWorkerEnv({ ...base, DEDUPE_WINDOW_HOURS: v })).toThrow(
        /DEDUPE_WINDOW_HOURS/,
      );
  });

  it("always requires project and location for Vertex", () => {
    expect(() =>
      parseWorkerEnv({ APP_ENV: "local", DATABASE_URL: "postgres://x" }),
    ).toThrow(/GOOGLE_CLOUD_PROJECT[\s\S]*GOOGLE_CLOUD_LOCATION/);
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
      parseWorkerEnv({ ...base, APP_ENV: "staging", REDDIT_UA_CONTACT: "u/x" }),
    ).toThrow(/GITHUB_TOKEN/);
  });

  it("parses the ingestion switches", () => {
    const env = parseWorkerEnv({
      ...base,
      INGEST_ENABLED: "false",
      ANALYSIS_ENABLED: "false",
    });
    expect(env.INGEST_ENABLED).toBe(false);
    expect(env.ANALYSIS_ENABLED).toBe(false);
  });

  it("never allows Reddit requests closer than 65 s", () => {
    expect(() =>
      parseWorkerEnv({ ...base, INGEST_MIN_SPACING_MS: "60000" }),
    ).toThrow(/INGEST_MIN_SPACING_MS/);
    expect(
      parseWorkerEnv({ ...base, INGEST_MIN_SPACING_MS: "90000" })
        .INGEST_MIN_SPACING_MS,
    ).toBe(90_000);
  });

  it("requires a Reddit contact outside local only while ingestion is on", () => {
    const staging = { ...base, APP_ENV: "staging", GITHUB_TOKEN: "t" };
    expect(() => parseWorkerEnv(staging)).toThrow(/REDDIT_UA_CONTACT/);
    expect(() =>
      parseWorkerEnv({ ...staging, INGEST_ENABLED: "false" }),
    ).not.toThrow();
    expect(() =>
      parseWorkerEnv({ ...staging, REDDIT_UA_CONTACT: "has space" }),
    ).toThrow(/REDDIT_UA_CONTACT/);
  });
});

describe("redditUserAgent", () => {
  it("adds the contact when set", () => {
    expect(redditUserAgent({})).toBe(
      "web:app.redlance.ingest:v1 (+https://redlance.app)",
    );
    expect(redditUserAgent({ REDDIT_UA_CONTACT: "u/redlance" })).toBe(
      "web:app.redlance.ingest:v1 (+https://redlance.app; u/redlance)",
    );
  });
});

describe("service-account key (temporary fallback)", () => {
  it("uses Application Default Credentials when no key file is set", () => {
    expect(parseWorkerEnv(base).credentials).toEqual({ kind: "adc" });
  });

  it("accepts a key file that exists", () => {
    const env = parseWorkerEnv(
      { ...base, GOOGLE_APPLICATION_CREDENTIALS: "/keys/vertex-key.json" },
      { fileExists: (p) => p === "/keys/vertex-key.json" },
    );
    expect(env.credentials).toEqual({
      kind: "service-account-key",
      path: "/keys/vertex-key.json",
    });
  });

  it("refuses to start when the key file is missing", () => {
    expect(() =>
      parseWorkerEnv(
        { ...base, GOOGLE_APPLICATION_CREDENTIALS: "/nope.json" },
        { fileExists: () => false },
      ),
    ).toThrow(
      /GOOGLE_APPLICATION_CREDENTIALS points to a file that doesn't exist/,
    );
  });
});
