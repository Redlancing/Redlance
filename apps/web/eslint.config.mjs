import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Redis clients must come from createRedis() so they get the retry strategy,
    // auth-failure handling, outage logging and first-connection tracking.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/server/redis.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Redis']",
          message:
            "Create Redis clients with createRedis() from src/server/redis.ts, not `new Redis()`.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
