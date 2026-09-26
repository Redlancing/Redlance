import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const omit = (source: Record<string, string>, ...keys: string[]) =>
  Object.fromEntries(
    Object.entries(source).filter(([key]) => !keys.includes(key)),
  );

const valid: Record<string, string> = {
  APP_ENV: "local",
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
  REDIS_URL: "redis://127.0.0.1:6379",
  AUTH_MODE: "dev",
  DEV_SESSION_SECRET: "x".repeat(32),
};

describe("parseEnv", () => {
  it("accepts valid local settings and defaults LOG_LEVEL to info", () => {
    const env = parseEnv(valid);
    expect(env.APP_ENV).toBe("local");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("accepts a TLS Redis URL (Upstash)", () => {
    expect(
      parseEnv({
        ...valid,
        REDIS_URL: "rediss://default:pw@host.upstash.io:6379",
      }).REDIS_URL,
    ).toMatch(/^rediss:/);
  });

  it("lists every missing setting in one error", () => {
    const rest = omit(valid, "DATABASE_URL", "REDIS_URL");
    expect(() => parseEnv(rest)).toThrowError(EnvError);
    try {
      parseEnv(rest);
    } catch (err) {
      expect((err as Error).message).toContain("DATABASE_URL");
      expect((err as Error).message).toContain("REDIS_URL");
    }
  });

  it("refuses the dev session outside local", () => {
    expect(() => parseEnv({ ...valid, APP_ENV: "production" })).toThrowError(
      /AUTH_MODE=dev is only allowed when APP_ENV=local/,
    );
  });

  it("refuses the dev session on a non-localhost origin even when APP_ENV=local", () => {
    expect(() =>
      parseEnv({ ...valid, APP_ORIGIN: "https://redlance.app" }),
    ).toThrowError(/localhost/);
    expect(
      parseEnv({ ...valid, APP_ORIGIN: "http://127.0.0.1:3100" }).AUTH_MODE,
    ).toBe("dev");
  });

  it("requires a 32+ character DEV_SESSION_SECRET in dev mode", () => {
    expect(() =>
      parseEnv({ ...valid, DEV_SESSION_SECRET: "short" }),
    ).toThrowError(/DEV_SESSION_SECRET/);
    expect(() => parseEnv(omit(valid, "DEV_SESSION_SECRET"))).toThrowError(
      /DEV_SESSION_SECRET/,
    );
  });

  it("does not need DEV_SESSION_SECRET in cognito mode", () => {
    const rest = omit(valid, "DEV_SESSION_SECRET");
    expect(
      parseEnv({ ...rest, APP_ENV: "production", AUTH_MODE: "cognito" })
        .AUTH_MODE,
    ).toBe("cognito");
  });

  it("rejects a non-Postgres DATABASE_URL", () => {
    expect(() =>
      parseEnv({ ...valid, DATABASE_URL: "mysql://x" }),
    ).toThrowError(/DATABASE_URL/);
  });
});
