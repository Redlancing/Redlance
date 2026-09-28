import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    env: {
      TEST_DATABASE_URL: "postgres://redlance:redlance@127.0.0.1:5432/redlance_test",
    },
  },
});
