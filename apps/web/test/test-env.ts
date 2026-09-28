export const TEST_ENV = {
  APP_ENV: "local",
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://redlance:redlance@127.0.0.1:5432/redlance_test",
  REDIS_URL: "redis://127.0.0.1:6379/15",
  AUTH_MODE: "dev",
  DEV_SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
  LOG_LEVEL: "silent",
} as const;
