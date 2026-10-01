# Local Dev Foundation and API Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postgres and Valkey running in two local Docker containers, a `@redlance/db` package with migrations, and the shared server code (settings, logging, errors, Redis rate limiting, dev session, `apiRoute()` wrapper) exposed through `/api/v1/health`, `/api/v1/me` and `/api/v1/dev/session`.

**Architecture:** The Next.js app runs on the host with `npm run dev`; only Postgres (`db`) and Valkey (`cache`) run in Docker Compose, each in its own container. Server-only code lives in `apps/web/src/server/`; database schema and migrations live in `packages/db`. Every API route goes through one wrapper that checks session → origin → input → per-user rate limit (Redis token bucket, one Lua command) before the handler runs.

**Tech Stack:** Node 24 LTS · Next.js 16 route handlers · Postgres 17 + pgvector · Valkey 8 · Drizzle ORM 0.45 + `pg` 8 · drizzle-kit 0.31 · ioredis 6 (RESP2) · zod 4 · pino 10 · Vitest 5 · tsx 4

**Spec:** `docs/foundation/local-dev-design.md`

## Global Constraints

- Node **24 LTS** (`.nvmrc` = `24`); `engines.node` stays `>=20.9.0`.
- Postgres image `pgvector/pgvector:pg17`; Valkey image `valkey/valkey:8`; two separate containers named `db` and `cache`.
- Container ports publish on `127.0.0.1` only.
- Settings come only from environment variables, validated with zod at startup. No code branches on "local vs production" except the dev session, which must refuse to run unless `APP_ENV=local`.
- The schema changes only through committed drizzle-kit migrations.
- Redis client: ioredis with `protocol: 2`, `enableOfflineQueue: false`, `commandTimeout: 1000`. Each rate-limited API call costs exactly **1** Redis command; each quota check costs exactly **1**.
- Rate-limit keys: `rl:{<subject>}:<bucket>`; quota keys: `q:{<subject>}:<name>:<yyyymmdd>`; `<subject>` is `u:<userId>` or `ip:<ip>`.
- Token bucket fails **open** when Redis is unavailable; daily quota fails **closed** (HTTP 503).
- All API routes live under `/api/v1`. Every error body is `{ "error": { "code", "message", "requestId", "details"? } }`.
- `GET /api/v1/health` (no `deep`) must not touch Postgres or Redis.
- Server-only modules start with `import "server-only";`.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Redis unreachable:** API requests must not hang; the bucket answers "allowed" within 1 s and the quota returns 503. Test: Task 5, "fails fast when Redis is down".
- **Malformed request bodies** (not JSON, empty body, wrong field types): 400 `INVALID_INPUT`, never 500. Test: Task 7, "invalid JSON body".
- **Bad session cookies** (tampered signature, garbage, user deleted or blocked): treated as signed out (401), never 500. Test: Task 6, "getSession rejects…".
- **Missing `Origin` on a POST** (curl, old clients, cross-site forms): 403 `BAD_ORIGIN`. Test: Task 7, "missing origin".
- **Double-submitted sign-in** (same email twice at once, or with different Gmail spellings): one user row, every response 200. Tests: Task 6 "concurrent sign-ins", Task 7 "dev session concurrent POSTs".

---

## File map

| File | Responsibility |
|---|---|
| `.nvmrc` | Node version pin |
| `docker-compose.yml` | `db` (Postgres) and `cache` (Valkey) containers |
| `docker/postgres/init/01-test-db.sql` | Creates `redlance_test` on first start |
| `package.json` (root) | `dev`, `db:*`, `test` scripts |
| `packages/db/package.json`, `tsconfig.json`, `drizzle.config.ts`, `vitest.config.ts` | Package setup |
| `packages/db/src/schema.ts` | `users` table |
| `packages/db/src/client.ts` | `createDb(url)` → Drizzle client + pool |
| `packages/db/src/errors.ts` | `pgErrorCode(err)` |
| `packages/db/src/migrate.ts` | `runMigrations(url)` |
| `packages/db/src/migrate-cli.ts` | CLI entry for `db:migrate` |
| `packages/db/src/index.ts` | Public exports |
| `packages/db/migrations/*` | Generated SQL (committed) |
| `packages/db/src/db.test.ts` | Migration + table tests |
| `apps/web/.env.example` | Every setting with local defaults |
| `apps/web/next.config.ts` | `transpilePackages` |
| `apps/web/vitest.config.ts`, `apps/web/test/*` | Test harness, shared helpers |
| `apps/web/src/instrumentation.ts` | Validates settings at server start |
| `apps/web/src/server/env.ts` | Settings schema, `parseEnv`, `getEnv` |
| `apps/web/src/server/errors.ts` | `ApiError`, `errorResponse` |
| `apps/web/src/server/http.ts` | `json`, `readCookie`, `clientIp` |
| `apps/web/src/server/email.ts` | `normalizeEmail` |
| `apps/web/src/server/logger.ts` | `getLogger` |
| `apps/web/src/server/db.ts` | `getDb`, `closeDb` |
| `apps/web/src/server/redis.ts` | `createRedis`, `getRedis`, `redisReady`, `closeRedis` |
| `apps/web/src/server/rate-limit/scripts.ts` | Lua sources |
| `apps/web/src/server/rate-limit/index.ts` | `createRateLimiter`, `getRateLimiter`, `BUCKETS` |
| `apps/web/src/server/session.ts` | Dev session: sign in, cookies, `getSession` |
| `apps/web/src/server/api-route.ts` | `apiRoute()` wrapper |
| `apps/web/src/app/api/v1/health/route.ts` | Liveness + deep readiness |
| `apps/web/src/app/api/v1/me/route.ts` | Current user |
| `apps/web/src/app/api/v1/dev/session/route.ts` | Dev sign in/out |

---

### Task 1: Local containers, Node pin and root scripts

**Files:**
- Create: `.nvmrc`, `docker-compose.yml`, `docker/postgres/init/01-test-db.sql`
- Modify: `package.json` (root) scripts

**Interfaces:**
- Produces: Postgres at `postgres://redlance:redlance@127.0.0.1:5432/redlance` and `…/redlance_test`; Valkey at `redis://127.0.0.1:6379`; root scripts `db:up`, `db:down`, `db:reset`, `db:migrate`, `db:generate`, `dev`, `test`.

- [ ] **Step 1: Create a branch and commit the approved docs**

```bash
git checkout -b feat/local-foundation
git add CLAUDE.md docs/superpowers
git commit -m "Add platform decisions, CDN/WAF and local foundation specs, and the foundation plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Pin Node**

Create `.nvmrc`:

```
24
```

Run: `fnm use` (or `nvm use`), then `node --version`
Expected: `v24.x.x`

- [ ] **Step 3: Create the Postgres init script**

Create `docker/postgres/init/01-test-db.sql`:

```sql
-- Runs once, the first time the db volume is created.
CREATE DATABASE redlance_test;
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
name: redlance

services:
  db:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: redlance
      POSTGRES_PASSWORD: redlance
      POSTGRES_DB: redlance
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U redlance -d redlance"]
      interval: 2s
      timeout: 3s
      retries: 30

  cache:
    image: valkey/valkey:8
    # Rate-limit counters and caches only: no persistence needed.
    command: ["valkey-server", "--save", "", "--appendonly", "no"]
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 30

volumes:
  db-data:
```

- [ ] **Step 5: Add root scripts**

In the root `package.json`, replace the `"scripts"` block with:

```json
"scripts": {
  "dev": "docker compose up -d --wait && npm run dev -w @redlance/web",
  "build": "npm run build -w @redlance/web",
  "start": "npm run start -w @redlance/web",
  "lint": "npm run lint --workspaces --if-present",
  "typecheck": "npm run typecheck --workspaces --if-present",
  "test": "npm run test --workspaces --if-present",
  "db:up": "docker compose up -d --wait",
  "db:down": "docker compose down",
  "db:reset": "docker compose down -v && docker compose up -d --wait && npm run db:migrate",
  "db:migrate": "npm run db:migrate -w @redlance/db",
  "db:generate": "npm run db:generate -w @redlance/db",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

- [ ] **Step 6: Start the containers and verify**

Run: `npm run db:up`
Expected: both services reported `Healthy`. (If port 5432 or 6379 is taken, stop the local Postgres/Redis using it first.)

Run: `docker compose exec db psql -U redlance -lqt | cut -d'|' -f1 | grep -w redlance_test`
Expected: `redlance_test`

Run: `docker compose exec cache valkey-cli ping`
Expected: `PONG`

Run: `docker compose ps --format '{{.Name}} {{.Ports}}'`
Expected: ports shown as `127.0.0.1:5432->5432/tcp` and `127.0.0.1:6379->6379/tcp` (not `0.0.0.0`).

- [ ] **Step 7: Commit**

```bash
git add .nvmrc docker-compose.yml docker/postgres/init/01-test-db.sql package.json
git commit -m "Add local Postgres and Valkey containers and root dev scripts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `@redlance/db` package with the users table and migrations

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/vitest.config.ts`
- Create: `packages/db/src/schema.ts`, `client.ts`, `errors.ts`, `migrate.ts`, `migrate-cli.ts`, `index.ts`
- Create (generated): `packages/db/migrations/0000_enable_vector.sql`, `0001_init.sql`, `meta/*`
- Test: `packages/db/src/db.test.ts`

**Interfaces:**
- Consumes: Postgres from Task 1.
- Produces (import from `@redlance/db`):
  - `users` table with columns `id`, `authSub`, `email`, `emailNormalized`, `status: "active" | "blocked"`, `createdAt`, `lastLoginAt`; type `User`.
  - `createDb(url: string, options?: { max?: number }): { db: Database; pool: pg.Pool }`; type `Database`.
  - `pgErrorCode(err: unknown): string | undefined`.
- Produces (import from `@redlance/db/migrate`): `runMigrations(url: string): Promise<void>`.

- [ ] **Step 1: Create the package files**

`packages/db/package.json`:

```json
{
  "name": "@redlance/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./migrate": "./src/migrate.ts"
  },
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node --env-file-if-exists=../../apps/web/.env.local --import tsx src/migrate-cli.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.3",
    "pg": "^8.23.0"
  },
  "devDependencies": {
    "@types/node": "^24",
    "@types/pg": "^8.23.1",
    "drizzle-kit": "^0.31.11",
    "tsx": "^4.23.15",
    "typescript": "^5",
    "vitest": "^5.0.2"
  }
}
```

`packages/db/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "drizzle.config.ts", "vitest.config.ts"]
}
```

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

`packages/db/vitest.config.ts`:

```ts
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
```

Run: `npm install` (from the repo root)
Expected: installs without errors; `node_modules/@redlance/db` links to `packages/db`.

- [ ] **Step 2: Write the schema, client and helpers**

`packages/db/src/schema.ts`:

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Cognito `sub` later; "dev|<normalized email>" in dev mode.
  authSub: text("auth_sub").notNull().unique(),
  email: text("email").notNull(),
  emailNormalized: text("email_normalized").notNull().unique(),
  status: text("status", { enum: ["active", "blocked"] }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
```

`packages/db/src/client.ts`:

```ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export function createDb(
  url: string,
  options: { max?: number } = {},
): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}
```

`packages/db/src/errors.ts`:

```ts
/** Postgres error code (e.g. "23505" unique violation), looking through Drizzle's wrapper errors. */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (typeof current === "object" && "code" in current && typeof current.code === "string") {
      return current.code;
    }
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return undefined;
}
```

`packages/db/src/migrate.ts`:

```ts
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
```

`packages/db/src/migrate-cli.ts`:

```ts
import { runMigrations } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (copy apps/web/.env.example to apps/web/.env.local).");
  process.exit(1);
}
await runMigrations(url);
console.log("Migrations applied.");
```

`packages/db/src/index.ts`:

```ts
export * from "./schema";
export { createDb, type Database } from "./client";
export { pgErrorCode } from "./errors";
```

- [ ] **Step 3: Generate the migrations**

Run (from `packages/db`): `npx drizzle-kit generate --custom --name enable_vector`
Expected: creates `migrations/0000_enable_vector.sql` (empty) and `migrations/meta/`.

Replace the contents of `packages/db/migrations/0000_enable_vector.sql` with:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Run (from `packages/db`): `npx drizzle-kit generate --name init`
Expected: creates `migrations/0001_init.sql` containing `CREATE TABLE "users"` with `gen_random_uuid()`, `users_auth_sub_unique` and `users_email_normalized_unique`.

- [ ] **Step 4: Write the failing test**

`packages/db/src/db.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, pgErrorCode, users } from "./index";
import { runMigrations } from "./migrate";

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url, { max: 2 });

beforeAll(async () => {
  await runMigrations(url);
});

beforeEach(async () => {
  await db.execute(sql`truncate table users cascade`);
});

afterAll(async () => {
  await pool.end();
});

describe("migrations", () => {
  it("can run twice without failing", async () => {
    await expect(runMigrations(url)).resolves.toBeUndefined();
  });

  it("enables the vector extension", async () => {
    const result = await db.execute(sql`select extname from pg_extension where extname = 'vector'`);
    expect(result.rows).toHaveLength(1);
  });
});

describe("users table", () => {
  it("fills defaults on insert", async () => {
    const [user] = await db
      .insert(users)
      .values({ authSub: "dev|a@example.com", email: "A@example.com", emailNormalized: "a@example.com" })
      .returning();
    expect(user!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user!.status).toBe("active");
    expect(user!.createdAt).toBeInstanceOf(Date);
    expect(user!.lastLoginAt).toBeNull();
  });

  it("rejects a duplicate normalized email with a unique violation", async () => {
    await db.insert(users).values({ authSub: "dev|a", email: "a@example.com", emailNormalized: "a@example.com" });
    const attempt = db
      .insert(users)
      .values({ authSub: "dev|b", email: "A@example.com", emailNormalized: "a@example.com" });
    await expect(attempt).rejects.toSatisfy((err: unknown) => pgErrorCode(err) === "23505");
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npm test -w @redlance/db`
Expected: 4 tests PASS. (If the migrations weren't generated in Step 3, "enables the vector extension" and the insert tests fail with `relation "users" does not exist`.)

- [ ] **Step 6: Apply migrations to the dev database**

This needs `apps/web/.env.local`, which Task 3 creates. Skip it now; Task 3 Step 8 runs it.

- [ ] **Step 7: Commit**

```bash
git add packages/db package.json package-lock.json
git commit -m "Add @redlance/db with the users table and migrations" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Settings validation, test harness and startup check

**Files:**
- Create: `apps/web/.env.example`, `apps/web/vitest.config.ts`, `apps/web/test/server-only-stub.ts`, `apps/web/test/test-env.ts`, `apps/web/test/global-setup.ts`
- Create: `apps/web/src/server/env.ts`, `apps/web/src/instrumentation.ts`
- Modify: `apps/web/package.json` (dependencies, `test` script), `apps/web/next.config.ts`
- Test: `apps/web/src/server/env.test.ts`

**Interfaces:**
- Consumes: `runMigrations` from `@redlance/db/migrate`.
- Produces:
  - `type Env = { APP_ENV: "local" | "staging" | "production"; APP_ORIGIN: string; DATABASE_URL: string; REDIS_URL: string; AUTH_MODE: "dev" | "cognito"; DEV_SESSION_SECRET?: string; LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent" }`
  - `parseEnv(source: Record<string, string | undefined>): Env` (throws `EnvError`)
  - `getEnv(): Env` (memoized, reads `process.env`)
  - `TEST_ENV` (test settings object) in `apps/web/test/test-env.ts`

- [ ] **Step 1: Add dependencies and scripts**

Run (repo root):

In `apps/web/package.json`, add `"@redlance/db": "*"` to `"dependencies"` (links the local workspace package), then run from the repo root:

```bash
npm install -w @redlance/web zod@^4.6.5 pino@^10.3.1 ioredis@^6.0.0 drizzle-orm@^0.45.3 server-only@^0.0.1
npm install -w @redlance/web -D vitest@^5.0.2
```

Expected: `ls -l node_modules/@redlance/db` shows a symlink to `../../packages/db`.

In `apps/web/package.json` add to `"scripts"`:

```json
"test": "vitest run"
```

In `apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@redlance/db"],
};

export default nextConfig;
```

- [ ] **Step 2: Create the test harness**

`apps/web/test/server-only-stub.ts`:

```ts
// Vitest runs outside React Server Components; the real package would throw.
export {};
```

`apps/web/test/test-env.ts`:

```ts
export const TEST_ENV = {
  APP_ENV: "local",
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://redlance:redlance@127.0.0.1:5432/redlance_test",
  REDIS_URL: "redis://127.0.0.1:6379/15",
  AUTH_MODE: "dev",
  DEV_SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
  LOG_LEVEL: "silent",
} as const;
```

`apps/web/test/global-setup.ts`:

```ts
import { runMigrations } from "@redlance/db/migrate";
import { TEST_ENV } from "./test-env";

export default async function setup(): Promise<void> {
  await runMigrations(TEST_ENV.DATABASE_URL);
}
```

`apps/web/vitest.config.ts`:

```ts
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
```

- [ ] **Step 3: Write the failing test**

`apps/web/src/server/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const omit = (source: Record<string, string>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));

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
    expect(parseEnv({ ...valid, REDIS_URL: "rediss://default:pw@host.upstash.io:6379" }).REDIS_URL).toMatch(/^rediss:/);
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
    expect(() => parseEnv({ ...valid, APP_ENV: "production" })).toThrowError(/AUTH_MODE=dev is only allowed when APP_ENV=local/);
  });

  it("requires a 32+ character DEV_SESSION_SECRET in dev mode", () => {
    expect(() => parseEnv({ ...valid, DEV_SESSION_SECRET: "short" })).toThrowError(/DEV_SESSION_SECRET/);
    expect(() => parseEnv(omit(valid, "DEV_SESSION_SECRET"))).toThrowError(/DEV_SESSION_SECRET/);
  });

  it("does not need DEV_SESSION_SECRET in cognito mode", () => {
    const rest = omit(valid, "DEV_SESSION_SECRET");
    expect(parseEnv({ ...rest, APP_ENV: "production", AUTH_MODE: "cognito" }).AUTH_MODE).toBe("cognito");
  });

  it("rejects a non-Postgres DATABASE_URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://x" })).toThrowError(/DATABASE_URL/);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run db:up && npm test -w @redlance/web`
Expected: FAIL, `Cannot find module './env'` (or similar).

- [ ] **Step 5: Implement `env.ts`**

`apps/web/src/server/env.ts`:

```ts
import "server-only";
import { z } from "zod";

const schema = z
  .object({
    APP_ENV: z.enum(["local", "staging", "production"]),
    APP_ORIGIN: z.url(),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL"),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, "must be a redis:// or rediss:// URL"),
    AUTH_MODE: z.enum(["dev", "cognito"]),
    DEV_SESSION_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .superRefine((value, ctx) => {
    if (value.AUTH_MODE === "dev" && value.APP_ENV !== "local") {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "AUTH_MODE=dev is only allowed when APP_ENV=local",
      });
    }
    if (value.AUTH_MODE === "dev" && !value.DEV_SESSION_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["DEV_SESSION_SECRET"],
        message: "is required when AUTH_MODE=dev",
      });
    }
  });

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  override name = "EnvError";
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.map(String).join(".") || "(settings)"}: ${issue.message}`,
    );
    throw new EnvError(`Invalid environment settings:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @redlance/web`
Expected: 7 tests PASS.

- [ ] **Step 7: Add the startup check and `.env.example`**

`apps/web/src/instrumentation.ts`:

```ts
// Runs once when the server starts: crash immediately if settings are missing or invalid.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./server/env");
    getEnv();
  }
}
```

`apps/web/.env.example`:

```bash
# Copy to apps/web/.env.local for local development.
APP_ENV=local
APP_ORIGIN=http://localhost:3000
DATABASE_URL=postgres://redlance:redlance@127.0.0.1:5432/redlance
REDIS_URL=redis://127.0.0.1:6379
AUTH_MODE=dev
# Generate with: openssl rand -base64 32
DEV_SESSION_SECRET=replace-with-output-of-openssl-rand-base64-32
LOG_LEVEL=debug
```

- [ ] **Step 8: Create `.env.local`, migrate the dev database, and check the startup failure**

```bash
cp apps/web/.env.example apps/web/.env.local
sed -i '' "s|^DEV_SESSION_SECRET=.*|DEV_SESSION_SECRET=$(openssl rand -base64 32)|" apps/web/.env.local
npm run db:migrate
```

Expected: `Migrations applied.`

Check the startup failure: temporarily comment out `DATABASE_URL` in `apps/web/.env.local`, run `npm run dev -w @redlance/web`, open `http://localhost:3000`.
Expected: the terminal shows `Invalid environment settings:` and `DATABASE_URL`. Restore the line and stop the server.

- [ ] **Step 9: Commit**

```bash
git add apps/web package-lock.json
git commit -m "Validate settings at startup and add the web test harness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server core: errors, HTTP helpers, email, logger, db and Redis clients

**Files:**
- Create: `apps/web/src/server/errors.ts`, `http.ts`, `email.ts`, `logger.ts`, `db.ts`, `redis.ts`
- Test: `apps/web/src/server/errors.test.ts`, `http.test.ts`, `email.test.ts`

**Interfaces:**
- Consumes: `getEnv()` (Task 3); `createDb`, `Database` (Task 2).
- Produces:
  - `type ErrorCode = "UNAUTHENTICATED" | "BAD_ORIGIN" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "RATE_LIMITED" | "QUOTA_EXCEEDED" | "UNAVAILABLE" | "INTERNAL"`
  - `class ApiError extends Error { code: ErrorCode; status: number; details?: unknown; headers?: Record<string, string>; constructor(code, message, details?, headers?) }`
  - `errorResponse(err: ApiError, requestId: string): Response`
  - `json(status: number, body: unknown, headers?: HeadersInit): Response`
  - `readCookie(request: Request, name: string): string | undefined`
  - `clientIp(request: Request): string`
  - `normalizeEmail(email: string): string`
  - `getLogger(): Logger` (pino)
  - `getDb(): Database`, `closeDb(): Promise<void>`
  - `REDIS_OPTIONS`, `createRedis(url: string, overrides?: RedisOptions): Redis`, `getRedis(): Redis`, `redisReady(redis: Redis, timeoutMs?: number): Promise<void>`, `closeRedis(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/server/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError, errorResponse } from "./errors";

describe("ApiError", () => {
  it.each([
    ["UNAUTHENTICATED", 401],
    ["BAD_ORIGIN", 403],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["INVALID_INPUT", 400],
    ["RATE_LIMITED", 429],
    ["QUOTA_EXCEEDED", 429],
    ["UNAVAILABLE", 503],
    ["INTERNAL", 500],
  ] as const)("maps %s to %i", (code, status) => {
    expect(new ApiError(code, "m").status).toBe(status);
  });
});

describe("errorResponse", () => {
  it("uses the standard error shape and passes headers through", async () => {
    const res = errorResponse(
      new ApiError("RATE_LIMITED", "Slow down.", undefined, { "Retry-After": "5" }),
      "req-1",
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(await res.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Slow down.", requestId: "req-1" },
    });
  });

  it("includes details when present", async () => {
    const res = errorResponse(new ApiError("INVALID_INPUT", "Bad.", [{ path: "email" }]), "r");
    expect((await res.json()).error.details).toEqual([{ path: "email" }]);
  });
});
```

`apps/web/src/server/http.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clientIp, readCookie } from "./http";

const withHeaders = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/x", { headers });

describe("readCookie", () => {
  it("finds a cookie among several", () => {
    expect(readCookie(withHeaders({ cookie: "a=1; rl_dev_session=abc.def; b=2" }), "rl_dev_session")).toBe("abc.def");
  });
  it("returns undefined when missing or when there is no cookie header", () => {
    expect(readCookie(withHeaders({ cookie: "a=1" }), "rl_dev_session")).toBeUndefined();
    expect(readCookie(withHeaders({}), "rl_dev_session")).toBeUndefined();
  });
  it("returns undefined for a malformed encoded value instead of throwing", () => {
    expect(readCookie(withHeaders({ cookie: "rl_dev_session=%E0%A4%A" }), "rl_dev_session")).toBeUndefined();
  });
});

describe("clientIp", () => {
  it("uses the first X-Forwarded-For entry", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("falls back to unknown", () => {
    expect(clientIp(withHeaders({}))).toBe("unknown");
  });
});
```

`apps/web/src/server/email.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it.each([
    ["  Alex@Example.com ", "alex@example.com"],
    ["alex+jobs@example.com", "alex@example.com"],
    ["A.L.E.X+x@gmail.com", "alex@gmail.com"],
    ["a.lex@googlemail.com", "alex@gmail.com"],
    ["a.lex@company.co.uk", "a.lex@company.co.uk"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @redlance/web`
Expected: FAIL, modules `./errors`, `./http`, `./email` not found.

- [ ] **Step 3: Implement the modules**

`apps/web/src/server/errors.ts`:

```ts
import "server-only";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "BAD_ORIGIN"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "UNAVAILABLE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  BAD_ORIGIN: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export function errorResponse(err: ApiError, requestId: string): Response {
  const error = {
    code: err.code,
    message: err.message,
    requestId,
    ...(err.details === undefined ? {} : { details: err.details }),
  };
  return Response.json({ error }, { status: err.status, headers: err.headers });
}
```

`apps/web/src/server/http.ts`:

```ts
import "server-only";

export function json(status: number, body: unknown, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Client IP for per-IP limits. Only trustworthy behind CloudFront (which sets
 * X-Forwarded-For), because the production server accepts traffic only from it.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
```

`apps/web/src/server/email.ts`:

```ts
import "server-only";

/** Lowercase, drop "+tag", and for Gmail drop dots, so one person maps to one account. */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}
```

`apps/web/src/server/logger.ts`:

```ts
import "server-only";
import pino, { type Logger } from "pino";
import { getEnv } from "./env";

let logger: Logger | undefined;

export function getLogger(): Logger {
  logger ??= pino({ level: getEnv().LOG_LEVEL, base: { service: "web" } });
  return logger;
}
```

`apps/web/src/server/db.ts`:

```ts
import "server-only";
import { createDb, type Database } from "@redlance/db";
import { getEnv } from "./env";

type DbHandle = ReturnType<typeof createDb>;

// Kept on globalThis so dev hot reloads reuse one pool instead of leaking connections.
const store = globalThis as unknown as { __redlanceDb?: DbHandle };

export function getDb(): Database {
  store.__redlanceDb ??= createDb(getEnv().DATABASE_URL, { max: 10 });
  return store.__redlanceDb.db;
}

export async function closeDb(): Promise<void> {
  const handle = store.__redlanceDb;
  store.__redlanceDb = undefined;
  await handle?.pool.end();
}
```

`apps/web/src/server/redis.ts`:

```ts
import "server-only";
import { Redis, type RedisOptions } from "ioredis";
import { getEnv } from "./env";
import { getLogger } from "./logger";

export const REDIS_OPTIONS: RedisOptions = {
  protocol: 2, // RESP2: works the same on Valkey, Upstash and ElastiCache
  enableOfflineQueue: false, // fail fast instead of queueing while disconnected
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  commandTimeout: 1000,
};

export function createRedis(url: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(url, { ...REDIS_OPTIONS, ...overrides });
  client.on("error", () => {
    // Connection errors surface as rejected commands; callers decide fail-open/closed.
  });
  return client;
}

const store = globalThis as unknown as { __redlanceRedis?: Redis };

export function getRedis(): Redis {
  if (!store.__redlanceRedis) {
    const client = createRedis(getEnv().REDIS_URL);
    client.on("error", (err) => getLogger().warn({ err }, "redis connection error"));
    store.__redlanceRedis = client;
  }
  return store.__redlanceRedis;
}

export async function redisReady(redis: Redis, timeoutMs = 3000): Promise<void> {
  if (redis.status === "ready") return;
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      redis.off("ready", onReady);
      reject(new Error(`Redis not ready after ${timeoutMs} ms`));
    }, timeoutMs);
    redis.once("ready", onReady);
  });
}

export async function closeRedis(): Promise<void> {
  const client = store.__redlanceRedis;
  store.__redlanceRedis = undefined;
  client?.disconnect();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @redlance/web`
Expected: all tests PASS (env + errors + http + email).

Run: `npm run typecheck -w @redlance/web`
Expected: no errors. (If `protocol` is reported as not in `RedisOptions`, check `node_modules/ioredis/built/redis/RedisOptions.d.ts` for the option's name in the installed version and use that.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server
git commit -m "Add server core: errors, HTTP helpers, email normalization, logger, db and Redis clients" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Per-user rate limiting in Redis

**Files:**
- Create: `apps/web/src/server/rate-limit/scripts.ts`, `apps/web/src/server/rate-limit/index.ts`
- Test: `apps/web/src/server/rate-limit/rate-limit.test.ts`

**Interfaces:**
- Consumes: `createRedis`, `getRedis`, `redisReady` (Task 4); `getLogger` (Task 4); `ApiError` (Task 4).
- Produces:
  - `type BucketConfig = { capacity: number; refillPerSec: number }`
  - `BUCKETS: { api: BucketConfig; health: BucketConfig }` (api: 30 / 2 per sec; health: 10 / 0.2 per sec)
  - `type LimitResult = { allowed: boolean; remaining: number; retryAfterMs: number }`
  - `type QuotaResult = { allowed: boolean; remaining: number; resetAt: Date }`
  - `createRateLimiter(redis: Redis, log: Pick<Logger, "error">): RateLimiter` with
    - `consume(subject: string, bucket: string, config: BucketConfig): Promise<LimitResult>` (fails open)
    - `consumeQuota(subject: string, name: string, limit: number, now?: Date): Promise<QuotaResult>` (throws `ApiError("UNAVAILABLE")` when Redis fails)
  - `getRateLimiter(): RateLimiter` (shared instance on `getRedis()`)

- [ ] **Step 1: Write the failing test**

`apps/web/src/server/rate-limit/rate-limit.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ENV } from "../../../test/test-env";
import { ApiError } from "../errors";
import { createRedis, redisReady } from "../redis";
import { createRateLimiter } from "./index";

const redis = createRedis(TEST_ENV.REDIS_URL);
const log = { error: vi.fn() };
const limiter = createRateLimiter(redis, log);

beforeAll(async () => {
  await redisReady(redis);
});

beforeEach(async () => {
  await redis.flushdb();
  log.error.mockReset();
});

afterAll(() => {
  redis.disconnect();
});

describe("token bucket", () => {
  it("allows capacity requests, then denies with a retry time", async () => {
    const config = { capacity: 30, refillPerSec: 2 };
    for (let i = 0; i < 30; i++) {
      expect((await limiter.consume("u:1", "api", config)).allowed).toBe(true);
    }
    const denied = await limiter.consume("u:1", "api", config);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(500);
  });

  it("refills over time", async () => {
    const config = { capacity: 2, refillPerSec: 20 };
    await limiter.consume("u:1", "t", config);
    await limiter.consume("u:1", "t", config);
    expect((await limiter.consume("u:1", "t", config)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 120));
    expect((await limiter.consume("u:1", "t", config)).allowed).toBe(true);
  });

  it("never over-spends under concurrency", async () => {
    const config = { capacity: 10, refillPerSec: 0.001 };
    const results = await Promise.all(
      Array.from({ length: 25 }, () => limiter.consume("u:1", "c", config)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("keeps subjects independent and uses hash-tagged keys", async () => {
    const config = { capacity: 1, refillPerSec: 0.001 };
    expect((await limiter.consume("u:1", "api", config)).allowed).toBe(true);
    expect((await limiter.consume("u:2", "api", config)).allowed).toBe(true);
    expect(await redis.exists("rl:{u:1}:api")).toBe(1);
  });
});

describe("daily quota", () => {
  const now = new Date("2026-09-26T10:00:00Z");

  it("allows up to the limit per UTC day", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await limiter.consumeQuota("u:1", "import", 3, now)).allowed).toBe(true);
    }
    const denied = await limiter.consumeQuota("u:1", "import", 3, now);
    expect(denied).toMatchObject({ allowed: false, remaining: 0 });
    expect(denied.resetAt.toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("starts fresh on the next day and expires its key", async () => {
    for (let i = 0; i < 3; i++) await limiter.consumeQuota("u:1", "import", 3, now);
    const nextDay = new Date("2026-09-27T00:00:01Z");
    expect((await limiter.consumeQuota("u:1", "import", 3, nextDay)).allowed).toBe(true);
    const ttl = await redis.ttl("q:{u:1}:import:20260926");
    expect(ttl).toBeGreaterThan(86_000);
    expect(ttl).toBeLessThanOrEqual(172_800);
  });
});

describe("Redis command cost", () => {
  it("uses exactly one command per consume and per quota check", async () => {
    await limiter.consume("u:1", "api", { capacity: 5, refillPerSec: 1 }); // loads the script
    await limiter.consumeQuota("u:1", "warm", 5); // loads the script
    const spy = vi.spyOn(redis, "sendCommand");
    await limiter.consume("u:1", "api", { capacity: 5, refillPerSec: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await limiter.consumeQuota("u:1", "import", 5);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("when Redis is down", () => {
  const down = createRedis("redis://127.0.0.1:6399", { retryStrategy: () => null });
  const downLimiter = createRateLimiter(down, log);
  afterAll(() => down.disconnect());

  it("fails fast: the bucket allows and logs, the quota returns 503", async () => {
    const started = Date.now();
    const result = await downLimiter.consume("u:1", "api", { capacity: 30, refillPerSec: 2 });
    expect(result.allowed).toBe(true);
    expect(log.error).toHaveBeenCalledTimes(1);

    const quota = downLimiter.consumeQuota("u:1", "import", 3);
    await expect(quota).rejects.toBeInstanceOf(ApiError);
    await expect(quota).rejects.toMatchObject({ code: "UNAVAILABLE", status: 503 });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @redlance/web -- src/server/rate-limit`
Expected: FAIL, `Cannot find module './index'`.

- [ ] **Step 3: Implement the scripts and the limiter**

`apps/web/src/server/rate-limit/scripts.ts`:

```ts
import "server-only";

/**
 * Token bucket. KEYS[1] = bucket key. ARGV = capacity, refill per ms, cost.
 * Uses the Redis clock so several app servers agree on time.
 * Returns { allowed (0|1), remaining tokens (floored), retry after ms }.
 */
export const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
tokens = math.min(capacity, tokens + math.max(0, now - ts) * refill_per_ms)
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end
redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', key, math.ceil(capacity / refill_per_ms) + 1000)
local retry_ms = 0
if allowed == 0 then
  retry_ms = math.ceil((cost - tokens) / refill_per_ms)
end
return { allowed, math.floor(tokens), retry_ms }
`;

/**
 * Daily quota. KEYS[1] = quota key (includes the UTC date). ARGV = limit, ttl seconds.
 * Returns { allowed (0|1), count after this call }.
 */
export const QUOTA_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
if count > tonumber(ARGV[1]) then
  return { 0, count }
end
return { 1, count }
`;
```

`apps/web/src/server/rate-limit/index.ts`:

```ts
import "server-only";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { ApiError } from "../errors";
import { getLogger } from "../logger";
import { getRedis } from "../redis";
import { QUOTA_LUA, TOKEN_BUCKET_LUA } from "./scripts";

export type BucketConfig = { capacity: number; refillPerSec: number };

export const BUCKETS = {
  api: { capacity: 30, refillPerSec: 2 },
  health: { capacity: 10, refillPerSec: 0.2 },
} satisfies Record<string, BucketConfig>;

export type LimitResult = { allowed: boolean; remaining: number; retryAfterMs: number };
export type QuotaResult = { allowed: boolean; remaining: number; resetAt: Date };

type ScriptedRedis = Redis & {
  rlTakeToken(key: string, capacity: number, refillPerMs: number, cost: number): Promise<[number, number, number]>;
  rlQuota(key: string, limit: number, ttlSec: number): Promise<[number, number]>;
};

function withScripts(redis: Redis): ScriptedRedis {
  const scripted = redis as ScriptedRedis;
  if (typeof scripted.rlTakeToken !== "function") {
    redis.defineCommand("rlTakeToken", { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA });
    redis.defineCommand("rlQuota", { numberOfKeys: 1, lua: QUOTA_LUA });
  }
  return scripted;
}

const QUOTA_TTL_SEC = 2 * 24 * 60 * 60;

export function createRateLimiter(redis: Redis, log: Pick<Logger, "error">) {
  const r = withScripts(redis);

  return {
    /** Token bucket for every API call. Fails open: a Redis outage must not take the site down. */
    async consume(subject: string, bucket: string, config: BucketConfig): Promise<LimitResult> {
      try {
        const [allowed, remaining, retryAfterMs] = await r.rlTakeToken(
          `rl:{${subject}}:${bucket}`,
          config.capacity,
          config.refillPerSec / 1000,
          1,
        );
        return { allowed: allowed === 1, remaining, retryAfterMs };
      } catch (err) {
        log.error({ err, subject, bucket }, "rate limiter unavailable; allowing request");
        return { allowed: true, remaining: config.capacity, retryAfterMs: 0 };
      }
    },

    /** Per-UTC-day quota for expensive actions. Fails closed: never risk unlimited LLM spend. */
    async consumeQuota(subject: string, name: string, limit: number, now = new Date()): Promise<QuotaResult> {
      const day = now.toISOString().slice(0, 10).replaceAll("-", "");
      const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      let result: [number, number];
      try {
        result = await r.rlQuota(`q:{${subject}}:${name}:${day}`, limit, QUOTA_TTL_SEC);
      } catch (err) {
        log.error({ err, subject, name }, "quota check unavailable; denying request");
        throw new ApiError("UNAVAILABLE", "This action is temporarily unavailable. Please try again shortly.");
      }
      const [allowed, count] = result;
      return { allowed: allowed === 1, remaining: Math.max(0, limit - count), resetAt };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

let shared: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  shared ??= createRateLimiter(getRedis(), getLogger());
  return shared;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @redlance/web -- src/server/rate-limit`
Expected: 8 tests PASS. If the command-cost test reports 2 calls, the script wasn't loaded by the warm-up; check that the warm-up calls use the same `limiter`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/rate-limit
git commit -m "Add Redis token bucket and daily quota, one command each" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dev session

**Files:**
- Create: `apps/web/src/server/session.ts`, `apps/web/test/helpers.ts`
- Test: `apps/web/src/server/session.test.ts`

**Interfaces:**
- Consumes: `getEnv`, `getDb`, `closeDb`, `getRedis`, `redisReady`, `closeRedis`, `normalizeEmail`, `readCookie`, `ApiError`; `users` from `@redlance/db`.
- Produces:
  - `DEV_SESSION_COOKIE = "rl_dev_session"`
  - `type Session = { userId: string; email: string }`
  - `encodeDevSession(userId: string, secret: string): string`
  - `decodeDevSession(token: string, secret: string): string | null`
  - `signInDevUser(email: string): Promise<Session>` (throws `ApiError("FORBIDDEN")` for blocked users)
  - `devSessionCookie(userId: string): string`, `clearDevSessionCookie(): string`
  - `getSession(request: Request): Promise<Session | null>`
  - Test helpers: `resetState(): Promise<void>`, `cookieFor(email?: string): Promise<string>`, `req(path: string, init?: RequestInit): Request`, `closeAll(): Promise<void>`

- [ ] **Step 1: Write the test helpers**

`apps/web/test/helpers.ts`:

```ts
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db";
import { closeRedis, getRedis, redisReady } from "@/server/redis";
import { DEV_SESSION_COOKIE, encodeDevSession, signInDevUser } from "@/server/session";
import { TEST_ENV } from "./test-env";

export async function resetState(): Promise<void> {
  await getDb().execute(sql`truncate table users cascade`);
  await redisReady(getRedis());
  await getRedis().flushdb();
}

export async function cookieFor(email = "dev@example.com"): Promise<string> {
  const session = await signInDevUser(email);
  return `${DEV_SESSION_COOKIE}=${encodeDevSession(session.userId, TEST_ENV.DEV_SESSION_SECRET)}`;
}

export function req(path: string, init?: RequestInit): Request {
  return new Request(`${TEST_ENV.APP_ORIGIN}${path}`, init);
}

export async function closeAll(): Promise<void> {
  await closeDb();
  await closeRedis();
}
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/server/session.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { users } from "@redlance/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, req, resetState } from "../../test/helpers";
import { TEST_ENV } from "../../test/test-env";
import { getDb } from "./db";
import {
  DEV_SESSION_COOKIE,
  decodeDevSession,
  devSessionCookie,
  encodeDevSession,
  getSession,
  signInDevUser,
} from "./session";

const secret = TEST_ENV.DEV_SESSION_SECRET;
const withCookie = (value: string) => req("/api/v1/me", { headers: { cookie: `${DEV_SESSION_COOKIE}=${value}` } });

beforeEach(resetState);
afterAll(closeAll);

describe("dev session tokens", () => {
  it("round-trips a user id", () => {
    const id = "6f1c1f3a-1b2c-4d5e-8f90-123456789abc";
    expect(decodeDevSession(encodeDevSession(id, secret), secret)).toBe(id);
  });

  it("rejects a wrong secret, a tampered id and garbage", () => {
    const id = "6f1c1f3a-1b2c-4d5e-8f90-123456789abc";
    const token = encodeDevSession(id, secret);
    expect(decodeDevSession(token, "another-secret-that-is-32-chars-long!!")).toBeNull();
    expect(decodeDevSession(token.replace("6f1c", "7f1c"), secret)).toBeNull();
    expect(decodeDevSession("garbage", secret)).toBeNull();
    expect(decodeDevSession(".", secret)).toBeNull();
  });
});

describe("signInDevUser", () => {
  it("creates the user once and reuses it for other spellings of the same Gmail", async () => {
    const first = await signInDevUser("A.lex+jobs@Gmail.com");
    const second = await signInDevUser("alex@gmail.com");
    expect(second.userId).toBe(first.userId);
    const rows = await getDb().select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ authSub: "dev|alex@gmail.com", emailNormalized: "alex@gmail.com" });
    expect(rows[0]!.lastLoginAt).toBeInstanceOf(Date);
  });

  it("handles concurrent sign-ins for one email without errors", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => signInDevUser("same@example.com")));
    expect(new Set(results.map((r) => r.userId)).size).toBe(1);
    expect(await getDb().select().from(users)).toHaveLength(1);
  });

  it("refuses a blocked user", async () => {
    const { userId } = await signInDevUser("blocked@example.com");
    await getDb().update(users).set({ status: "blocked" }).where(eq(users.id, userId));
    await expect(signInDevUser("blocked@example.com")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("getSession", () => {
  it("returns the signed-in user", async () => {
    const { userId } = await signInDevUser("me@example.com");
    expect(await getSession(withCookie(encodeDevSession(userId, secret)))).toEqual({
      userId,
      email: "me@example.com",
    });
  });

  it("returns null without a cookie", async () => {
    expect(await getSession(req("/api/v1/me"))).toBeNull();
  });

  it("rejects tampered, garbage, deleted-user and blocked-user cookies", async () => {
    const { userId } = await signInDevUser("me@example.com");
    const good = encodeDevSession(userId, secret);
    expect(await getSession(withCookie(`${good}x`))).toBeNull();
    expect(await getSession(withCookie("not-a-token"))).toBeNull();

    await getDb().update(users).set({ status: "blocked" }).where(eq(users.id, userId));
    expect(await getSession(withCookie(good))).toBeNull();

    await getDb().execute(sql`truncate table users cascade`);
    expect(await getSession(withCookie(good))).toBeNull();
  });
});

describe("devSessionCookie", () => {
  it("is httpOnly, SameSite=Lax, and not Secure on http origins", () => {
    const cookie = devSessionCookie("6f1c1f3a-1b2c-4d5e-8f90-123456789abc");
    expect(cookie).toContain(`${DEV_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w @redlance/web -- src/server/session`
Expected: FAIL, `Cannot find module './session'` (helpers import it too).

- [ ] **Step 4: Implement `session.ts`**

`apps/web/src/server/session.ts`:

```ts
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { users } from "@redlance/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { normalizeEmail } from "./email";
import { getEnv } from "./env";
import { ApiError } from "./errors";
import { readCookie } from "./http";

export const DEV_SESSION_COOKIE = "rl_dev_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Session = { userId: string; email: string };

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function encodeDevSession(userId: string, secret: string): string {
  return `${userId}.${sign(userId, secret)}`;
}

export function decodeDevSession(token: string, secret: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(userId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return UUID_RE.test(userId) ? userId : null;
}

function devSecret(): string {
  const env = getEnv();
  if (env.AUTH_MODE !== "dev" || !env.DEV_SESSION_SECRET) {
    throw new Error("Dev sessions are only available when AUTH_MODE=dev.");
  }
  return env.DEV_SESSION_SECRET;
}

export async function signInDevUser(email: string): Promise<Session> {
  const normalized = normalizeEmail(email);
  const now = new Date();
  const [user] = await getDb()
    .insert(users)
    .values({ authSub: `dev|${normalized}`, email: email.trim(), emailNormalized: normalized, lastLoginAt: now })
    .onConflictDoUpdate({ target: users.authSub, set: { lastLoginAt: now } })
    .returning({ id: users.id, email: users.email, status: users.status });
  if (!user || user.status !== "active") {
    throw new ApiError("FORBIDDEN", "This account is blocked.");
  }
  return { userId: user.id, email: user.email };
}

export function devSessionCookie(userId: string): string {
  const secure = getEnv().APP_ORIGIN.startsWith("https://") ? "; Secure" : "";
  return `${DEV_SESSION_COOKIE}=${encodeDevSession(userId, devSecret())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

export function clearDevSessionCookie(): string {
  return `${DEV_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getSession(request: Request): Promise<Session | null> {
  if (getEnv().AUTH_MODE === "cognito") {
    throw new Error("AUTH_MODE=cognito is not implemented yet; it arrives with the login spec.");
  }
  const token = readCookie(request, DEV_SESSION_COOKIE);
  if (!token) return null;
  const userId = decodeDevSession(token, devSecret());
  if (!userId) return null;
  const [user] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "active")))
    .limit(1);
  return user ? { userId: user.id, email: user.email } : null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @redlance/web -- src/server/session`
Expected: 9 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/session.ts apps/web/src/server/session.test.ts apps/web/test/helpers.ts
git commit -m "Add the dev-only session with signed cookies" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `apiRoute()` wrapper and the three endpoints

**Files:**
- Create: `apps/web/src/server/api-route.ts`
- Create: `apps/web/src/app/api/v1/health/route.ts`, `apps/web/src/app/api/v1/me/route.ts`, `apps/web/src/app/api/v1/dev/session/route.ts`
- Test: `apps/web/src/server/api-route.test.ts`, `apps/web/src/app/api/v1/routes.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–6.
- Produces:
  - `apiRoute<S extends z.ZodType | undefined = undefined, A extends boolean = true>(options: { auth?: A; input?: S; rateLimit?: false | { bucket: string; config?: BucketConfig }; handler: (ctx: { request: Request; input: S extends z.ZodType ? z.infer<S> : undefined; user: A extends true ? Session : Session | null; log: Logger; requestId: string }) => Promise<Response> }): (request: Request) => Promise<Response>`
  - `GET /api/v1/health`, `GET /api/v1/health?deep=1`, `GET /api/v1/me`, `POST|DELETE /api/v1/dev/session`

- [ ] **Step 1: Write the failing wrapper test**

`apps/web/src/server/api-route.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeAll, cookieFor, req, resetState } from "../../test/helpers";
import { TEST_ENV } from "../../test/test-env";
import { apiRoute } from "./api-route";
import { ApiError } from "./errors";
import { json } from "./http";

beforeEach(resetState);
afterAll(closeAll);

const origin = { origin: TEST_ENV.APP_ORIGIN };

const echo = apiRoute({
  input: z.object({ name: z.string().min(1) }),
  handler: async ({ user, input }) => json(200, { userId: user.userId, name: input.name }),
});

const search = apiRoute({
  input: z.object({ q: z.string() }),
  handler: async ({ input }) => json(200, { q: input.q }),
});

const tight = apiRoute({
  rateLimit: { bucket: "tight", config: { capacity: 2, refillPerSec: 0.001 } },
  handler: async () => json(200, { ok: true }),
});

const boom = apiRoute({
  handler: async () => {
    throw new Error("secret connection string postgres://admin:pw@db");
  },
});

const notFound = apiRoute({
  handler: async () => {
    throw new ApiError("NOT_FOUND", "No such thing.");
  },
});

const post = (cookie: string, body: string, headers: Record<string, string> = origin) =>
  req("/api/v1/x", { method: "POST", headers: { cookie, "content-type": "application/json", ...headers }, body });

describe("apiRoute", () => {
  it("401s without a session and returns the standard error shape", async () => {
    const res = await echo(req("/api/v1/x", { method: "POST", headers: origin, body: "{}" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("403s a POST with a missing origin", async () => {
    const res = await echo(post(await cookieFor(), JSON.stringify({ name: "a" }), {}));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("BAD_ORIGIN");
  });

  it("403s a POST from another origin", async () => {
    const res = await echo(post(await cookieFor(), JSON.stringify({ name: "a" }), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("400s an invalid JSON body", async () => {
    const res = await echo(post(await cookieFor(), "{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("400s an empty body", async () => {
    const res = await echo(post(await cookieFor(), ""));
    expect(res.status).toBe(400);
  });

  it("400s schema failures with field details", async () => {
    const res = await echo(post(await cookieFor(), JSON.stringify({ name: 42 })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details[0].path).toBe("name");
  });

  it("passes the user and parsed input to the handler and echoes x-request-id", async () => {
    const res = await echo(post(await cookieFor("a@example.com"), JSON.stringify({ name: "Ada" }), { ...origin, "x-request-id": "abc-123" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("abc-123");
    const body = await res.json();
    expect(body.name).toBe("Ada");
    expect(body.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("parses GET input from the query string", async () => {
    const res = await search(req("/api/v1/x?q=react", { headers: { cookie: await cookieFor() } }));
    expect(await res.json()).toEqual({ q: "react" });
  });

  it("429s with Retry-After once the bucket is empty", async () => {
    const cookie = await cookieFor();
    const call = () => tight(req("/api/v1/x", { headers: { cookie } }));
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
  });

  it("maps ApiError to its status", async () => {
    const res = await notFound(req("/api/v1/x", { headers: { cookie: await cookieFor() } }));
    expect(res.status).toBe(404);
  });

  it("hides unexpected error details behind a 500", async () => {
    const res = await boom(req("/api/v1/x", { headers: { cookie: await cookieFor() } }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("INTERNAL");
    expect(text).not.toContain("secret");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @redlance/web -- src/server/api-route`
Expected: FAIL, `Cannot find module './api-route'`.

- [ ] **Step 3: Implement `api-route.ts`**

`apps/web/src/server/api-route.ts`:

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { z } from "zod";
import { getEnv } from "./env";
import { ApiError, errorResponse } from "./errors";
import { clientIp } from "./http";
import { getLogger } from "./logger";
import { BUCKETS, type BucketConfig, getRateLimiter } from "./rate-limit";
import { getSession, type Session } from "./session";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const QUERY_INPUT = new Set(["GET", "HEAD", "DELETE"]);

type RateLimitOption = false | { bucket: string; config?: BucketConfig };

type HandlerContext<I, A extends boolean> = {
  request: Request;
  input: I;
  user: A extends true ? Session : Session | null;
  log: Logger;
  requestId: string;
};

type ApiRouteOptions<S extends z.ZodType | undefined, A extends boolean> = {
  auth?: A;
  input?: S;
  rateLimit?: RateLimitOption;
  handler: (ctx: HandlerContext<S extends z.ZodType ? z.infer<S> : undefined, A>) => Promise<Response>;
};

function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(getEnv().APP_ORIGIN).origin) {
    throw new ApiError("BAD_ORIGIN", "Request origin not allowed.");
  }
}

async function parseInput(request: Request, url: URL, schema: z.ZodType): Promise<unknown> {
  let raw: unknown;
  if (QUERY_INPUT.has(request.method)) {
    raw = Object.fromEntries(url.searchParams);
  } else {
    try {
      raw = await request.json();
    } catch {
      throw new ApiError("INVALID_INPUT", "Request body must be valid JSON.");
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      "INVALID_INPUT",
      "Some fields are invalid.",
      result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
    );
  }
  return result.data;
}

async function enforceRateLimit(option: RateLimitOption | undefined, user: Session | null, request: Request) {
  if (option === false) return;
  const { bucket, config } = option ?? { bucket: "api" };
  const limits = config ?? (BUCKETS as Record<string, BucketConfig>)[bucket] ?? BUCKETS.api;
  const subject = user ? `u:${user.userId}` : `ip:${clientIp(request)}`;
  const result = await getRateLimiter().consume(subject, bucket, limits);
  if (!result.allowed) {
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    throw new ApiError("RATE_LIMITED", `Too many requests. Try again in ${seconds} seconds.`, undefined, {
      "Retry-After": String(seconds),
    });
  }
}

/**
 * Every /api/v1 route goes through this: session → origin → input → rate limit → handler,
 * stopping at the first failure, with one log line per request.
 */
export function apiRoute<S extends z.ZodType | undefined = undefined, A extends boolean = true>(
  options: ApiRouteOptions<S, A>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const started = performance.now();
    const requestId =
      request.headers.get("x-request-id") ?? request.headers.get("x-amzn-trace-id") ?? randomUUID();
    const url = new URL(request.url);
    const log = getLogger().child({ requestId });
    let userId: string | undefined;
    let response: Response;

    try {
      const user = await getSession(request);
      if ((options.auth ?? true) && !user) throw new ApiError("UNAUTHENTICATED", "Please sign in.");
      userId = user?.userId;
      if (MUTATING.has(request.method)) checkOrigin(request);
      const input = options.input ? await parseInput(request, url, options.input) : undefined;
      await enforceRateLimit(options.rateLimit, user, request);
      response = await options.handler({
        request,
        input,
        user,
        log,
        requestId,
      } as HandlerContext<S extends z.ZodType ? z.infer<S> : undefined, A>);
    } catch (err) {
      if (!(err instanceof ApiError)) log.error({ err }, "unhandled error");
      response = errorResponse(err instanceof ApiError ? err : new ApiError("INTERNAL", "Something went wrong."), requestId);
    }

    response.headers.set("x-request-id", requestId);
    log.info(
      {
        userId,
        method: request.method,
        path: url.pathname,
        status: response.status,
        durationMs: Math.round(performance.now() - started),
      },
      "request",
    );
    return response;
  };
}
```

- [ ] **Step 4: Run the wrapper tests to verify they pass**

Run: `npm test -w @redlance/web -- src/server/api-route`
Expected: 11 tests PASS.

- [ ] **Step 5: Write the failing route tests**

`apps/web/src/app/api/v1/routes.test.ts`:

```ts
import { users } from "@redlance/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, cookieFor, req, resetState } from "../../../../test/helpers";
import { TEST_ENV } from "../../../../test/test-env";
import { getDb } from "@/server/db";
import { getRedis } from "@/server/redis";
import { DEV_SESSION_COOKIE } from "@/server/session";
import { GET as health } from "./health/route";
import { GET as me } from "./me/route";
import { DELETE as signOut, POST as signIn } from "./dev/session/route";

beforeEach(resetState);
afterAll(closeAll);

const signInRequest = (email: string) =>
  req("/api/v1/dev/session", {
    method: "POST",
    headers: { origin: TEST_ENV.APP_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

describe("GET /api/v1/health", () => {
  it("answers liveness without touching Redis", async () => {
    const spy = vi.spyOn(getRedis(), "sendCommand");
    const res = await health(req("/api/v1/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("checks Postgres and Redis with ?deep=1", async () => {
    const res = await health(req("/api/v1/health?deep=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok", cache: "ok" });
  });
});

describe("POST /api/v1/dev/session", () => {
  it("creates the user and sets an httpOnly session cookie", async () => {
    const res = await signIn(signInRequest("New@Example.com"));
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe("New@Example.com");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${DEV_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
  });

  it("400s an invalid email", async () => {
    expect((await signIn(signInRequest("not-an-email"))).status).toBe(400);
  });

  it("handles concurrent POSTs for one email", async () => {
    const responses = await Promise.all(Array.from({ length: 3 }, () => signIn(signInRequest("dup@example.com"))));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await getDb().select().from(users)).toHaveLength(1);
  });

  it("DELETE clears the cookie", async () => {
    const res = await signOut(req("/api/v1/dev/session", { method: "DELETE", headers: { origin: TEST_ENV.APP_ORIGIN } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("GET /api/v1/me", () => {
  it("401s when signed out", async () => {
    expect((await me(req("/api/v1/me"))).status).toBe(401);
  });

  it("returns the signed-in user", async () => {
    const res = await me(req("/api/v1/me", { headers: { cookie: await cookieFor("me@example.com") } }));
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe("me@example.com");
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npm test -w @redlance/web -- src/app/api/v1`
Expected: FAIL, route modules not found.

- [ ] **Step 7: Implement the routes**

`apps/web/src/app/api/v1/health/route.ts`:

```ts
import { sql } from "drizzle-orm";
import { apiRoute } from "@/server/api-route";
import { getDb } from "@/server/db";
import { json } from "@/server/http";
import { getRedis } from "@/server/redis";

async function check(probe: () => Promise<unknown>): Promise<"ok" | "down"> {
  try {
    await probe();
    return "ok";
  } catch {
    return "down";
  }
}

const deepCheck = apiRoute({
  auth: false,
  rateLimit: { bucket: "health" },
  handler: async () => {
    const [db, cache] = await Promise.all([
      check(() => getDb().execute(sql`select 1`)),
      check(() => getRedis().ping()),
    ]);
    const ok = db === "ok" && cache === "ok";
    return json(ok ? 200 : 503, { status: ok ? "ok" : "degraded", db, cache });
  },
});

// Liveness (default) touches nothing: servers probe it every few seconds and
// Upstash bills per command. ?deep=1 is for deploys and occasional monitoring.
export async function GET(request: Request): Promise<Response> {
  if (new URL(request.url).searchParams.get("deep") === "1") return deepCheck(request);
  return json(200, { status: "ok" });
}
```

`apps/web/src/app/api/v1/me/route.ts`:

```ts
import { apiRoute } from "@/server/api-route";
import { json } from "@/server/http";

export const GET = apiRoute({
  handler: async ({ user }) => json(200, { user: { id: user.userId, email: user.email } }),
});
```

`apps/web/src/app/api/v1/dev/session/route.ts`:

```ts
import { z } from "zod";
import { apiRoute } from "@/server/api-route";
import { getEnv } from "@/server/env";
import { json } from "@/server/http";
import { clearDevSessionCookie, devSessionCookie, signInDevUser } from "@/server/session";

const notFound = () => json(404, { error: { code: "NOT_FOUND", message: "Not found.", requestId: "" } });

const signIn = apiRoute({
  auth: false,
  input: z.object({ email: z.email() }),
  handler: async ({ input }) => {
    const session = await signInDevUser(input.email);
    return json(200, { user: { id: session.userId, email: session.email } }, {
      "Set-Cookie": devSessionCookie(session.userId),
    });
  },
});

const signOut = apiRoute({
  auth: false,
  rateLimit: false,
  handler: async () => new Response(null, { status: 204, headers: { "Set-Cookie": clearDevSessionCookie() } }),
});

// Local-only: this route does not exist unless AUTH_MODE=dev.
export async function POST(request: Request): Promise<Response> {
  return getEnv().AUTH_MODE === "dev" ? signIn(request) : notFound();
}

export async function DELETE(request: Request): Promise<Response> {
  return getEnv().AUTH_MODE === "dev" ? signOut(request) : notFound();
}
```

- [ ] **Step 8: Run all tests, lint and typecheck**

Run: `npm test`
Expected: every test in `@redlance/db` and `@redlance/web` PASSES.

Run: `npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Try it by hand**

Run: `npm run dev` and, in another terminal:

```bash
curl -s localhost:3000/api/v1/health                   # {"status":"ok"}
curl -s "localhost:3000/api/v1/health?deep=1"          # {"status":"ok","db":"ok","cache":"ok"}
curl -s localhost:3000/api/v1/me                       # 401 UNAUTHENTICATED
curl -s -c /tmp/rl.txt -H 'origin: http://localhost:3000' -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}' localhost:3000/api/v1/dev/session
curl -s -b /tmp/rl.txt localhost:3000/api/v1/me        # {"user":{...}}
```

Expected: the outputs shown in the comments, and one JSON log line per request in the dev server terminal.

Then check readiness reporting: `docker compose stop db`, run `curl -s -w ' %{http_code}\n' "localhost:3000/api/v1/health?deep=1"` → `{"status":"degraded","db":"down","cache":"ok"} 503`, while `curl -s localhost:3000/api/v1/health` still returns `{"status":"ok"}`. Restart with `docker compose start db`.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/server/api-route.ts apps/web/src/server/api-route.test.ts apps/web/src/app/api
git commit -m "Add the apiRoute wrapper and the health, me and dev session endpoints" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Developer docs

**Files:**
- Modify: `README.md` (add a "Local development" section)
- Modify: `CLAUDE.md` ("Repo layout and commands" section)

- [ ] **Step 1: Add "Local development" to `README.md`**

Append:

````markdown
## Local development

Needs Docker Desktop and Node 24 (`fnm use` reads `.nvmrc`).

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # then set DEV_SESSION_SECRET: openssl rand -base64 32
npm run db:up        # Postgres (db) and Valkey (cache) in Docker
npm run db:migrate
npm run dev          # Next.js on http://localhost:3000, instant reload
npm test             # unit + integration tests (needs db and cache running)
```

- Sign in locally: `POST /api/v1/dev/session {"email": "..."}` (only exists when `AUTH_MODE=dev`).
- Change the schema: edit `packages/db/src/schema.ts`, run `npm run db:generate`, commit the new file in `packages/db/migrations/`, run `npm run db:migrate`.
- Start from scratch: `npm run db:reset` (deletes local data).
````

- [ ] **Step 2: Update `CLAUDE.md`**

In "Repo layout and commands", after the `apps/web` bullet add:

```markdown
- `packages/db` — `@redlance/db`: Drizzle schema, client and migrations (Postgres 17 + pgvector). Change the schema only via `npm run db:generate` + committed migrations.
- Server-only code lives in `apps/web/src/server/`. Every API route is under `/api/v1` and wraps its handler in `apiRoute()` (session → origin → input → Redis rate limit). Settings come from env vars validated in `src/server/env.ts`; copy `apps/web/.env.example` to `.env.local`.
```

and replace the "Commands:" line with:

```markdown
Commands: `npm run dev` (starts Docker db + cache, then Next) · `npm test` · `npm run db:up|db:down|db:migrate|db:generate|db:reset` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run format`. Add shadcn components with `npx shadcn@latest add <name> -c apps/web`.
```

- [ ] **Step 3: Verify from a clean start**

```bash
npm run db:reset
npm test
```

Expected: reset recreates the containers and applies migrations; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document local development" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
