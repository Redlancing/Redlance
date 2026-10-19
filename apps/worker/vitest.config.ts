import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    fileParallelism: false,
    env: {
      // Override to give a parallel run its own database.
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgres://redlance:redlance@127.0.0.1:5432/redlance_test_worker",
    },
  },
});
