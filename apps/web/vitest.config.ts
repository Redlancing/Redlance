import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { TEST_ENV } from "./test/test-env";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    env: { ...TEST_ENV },
  },
});
