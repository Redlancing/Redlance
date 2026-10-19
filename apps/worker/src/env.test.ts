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

  it("17: parses and bounds the matching settings", () => {
    const d = parseWorkerEnv(base);
    expect(d.MATCHING_ENABLED).toBe(true);
    expect(d.RESCORE_THRESHOLD).toBe(50);
    expect(d.MATCH_MAX_AGE_DAYS).toBe(7);
    const env = parseWorkerEnv({
      ...base,
      MATCHING_ENABLED: "false",
      RESCORE_THRESHOLD: "0",
      MATCH_MAX_AGE_DAYS: "30",
    });
    expect(env.MATCHING_ENABLED).toBe(false);
    expect(env.RESCORE_THRESHOLD).toBe(0);
    expect(env.MATCH_MAX_AGE_DAYS).toBe(30);
    expect(parseWorkerEnv({ ...base, RESCORE_THRESHOLD: "100" })).toMatchObject(
      { RESCORE_THRESHOLD: 100 },
    );
    expect(() => parseWorkerEnv({ ...base, MATCHING_ENABLED: "yes" })).toThrow(
      /MATCHING_ENABLED/,
    );
    for (const v of ["-1", "101", "50.5", "x"])
      expect(() => parseWorkerEnv({ ...base, RESCORE_THRESHOLD: v })).toThrow(
        /RESCORE_THRESHOLD/,
      );
    for (const v of ["0", "31", "1.5"])
      expect(() => parseWorkerEnv({ ...base, MATCH_MAX_AGE_DAYS: v })).toThrow(
        /MATCH_MAX_AGE_DAYS/,
      );
  });

  it("23: parses and bounds the re-score settings", () => {
    const d = parseWorkerEnv(base);
    expect(d.RESCORE_ENABLED).toBe(false);
    expect(d.RESCORE_DAILY_BUDGET_USD).toBe(5);
    expect(
      parseWorkerEnv({ ...base, RESCORE_ENABLED: "true" }).RESCORE_ENABLED,
    ).toBe(true);
    const env = parseWorkerEnv({
      ...base,
      RESCORE_ENABLED: "false",
      RESCORE_DAILY_BUDGET_USD: "0.25",
    });
    expect(env.RESCORE_ENABLED).toBe(false);
    expect(env.RESCORE_DAILY_BUDGET_USD).toBe(0.25);
    for (const v of ["0", "1000"])
      expect(
        parseWorkerEnv({ ...base, RESCORE_DAILY_BUDGET_USD: v })
          .RESCORE_DAILY_BUDGET_USD,
      ).toBe(Number(v));
    expect(() => parseWorkerEnv({ ...base, RESCORE_ENABLED: "1" })).toThrow(
      /RESCORE_ENABLED/,
    );
    for (const v of ["-1", "1000.01", "x"])
      expect(() =>
        parseWorkerEnv({ ...base, RESCORE_DAILY_BUDGET_USD: v }),
      ).toThrow(/RESCORE_DAILY_BUDGET_USD/);
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

describe("drafting budget settings", () => {
  it("defaults to alert at $40 and pause at $80", () => {
    const env = parseWorkerEnv(base);
    expect(env.DRAFT_BUDGET_ALERT_USD).toBe(40);
    expect(env.DRAFT_BUDGET_PAUSE_USD).toBe(80);
  });

  it("parses and bounds the values (0 to 10,000; alert not above pause)", () => {
    const env = parseWorkerEnv({
      ...base,
      DRAFT_BUDGET_ALERT_USD: "10",
      DRAFT_BUDGET_PAUSE_USD: "20",
    });
    expect(env.DRAFT_BUDGET_ALERT_USD).toBe(10);
    expect(env.DRAFT_BUDGET_PAUSE_USD).toBe(20);
    for (const v of ["-1", "10001"])
      expect(() =>
        parseWorkerEnv({ ...base, DRAFT_BUDGET_PAUSE_USD: v }),
      ).toThrow(/DRAFT_BUDGET_PAUSE_USD/);
    expect(() =>
      parseWorkerEnv({
        ...base,
        DRAFT_BUDGET_ALERT_USD: "90",
        DRAFT_BUDGET_PAUSE_USD: "80",
      }),
    ).toThrow(/DRAFT_BUDGET_ALERT_USD/);
  });
});

describe("drafting settings", () => {
  it("21: defaults: on, Flash for drafts, Flash-Lite for rewrites, 4 at a time", () => {
    const env = parseWorkerEnv(base);
    expect(env.DRAFTS_ENABLED).toBe(true);
    expect(env.VOICE_ENABLED).toBe(true);
    expect(env.DRAFT_MODEL).toBe("gemini-3.8-flash");
    expect(env.REWRITE_MODEL).toBe("gemini-3.5-flash-lite");
    expect(env.DRAFT_CONCURRENCY).toBe(4);
  });

  it("21: the models default to whatever VERTEX_MODEL_SMART / _FAST are", () => {
    const env = parseWorkerEnv({
      ...base,
      VERTEX_MODEL_SMART: "smart-x",
      VERTEX_MODEL_FAST: "fast-x",
    });
    expect(env.DRAFT_MODEL).toBe("smart-x");
    expect(env.REWRITE_MODEL).toBe("fast-x");
    const own = parseWorkerEnv({
      ...base,
      DRAFT_MODEL: "d",
      REWRITE_MODEL: "r",
      DRAFTS_ENABLED: "false",
      VOICE_ENABLED: "false",
    });
    expect(own.VOICE_ENABLED).toBe(false);
    expect(own.DRAFT_MODEL).toBe("d");
    expect(own.REWRITE_MODEL).toBe("r");
    expect(own.DRAFTS_ENABLED).toBe(false);
  });

  it("21: bounds DRAFT_CONCURRENCY to 1-16", () => {
    expect(
      parseWorkerEnv({ ...base, DRAFT_CONCURRENCY: "16" }).DRAFT_CONCURRENCY,
    ).toBe(16);
    expect(
      parseWorkerEnv({ ...base, DRAFT_CONCURRENCY: "1" }).DRAFT_CONCURRENCY,
    ).toBe(1);
    for (const v of ["0", "17", "2.5", "x"])
      expect(() => parseWorkerEnv({ ...base, DRAFT_CONCURRENCY: v })).toThrow(
        /DRAFT_CONCURRENCY/,
      );
    expect(() => parseWorkerEnv({ ...base, DRAFTS_ENABLED: "yes" })).toThrow(
      /DRAFTS_ENABLED/,
    );
  });
});
