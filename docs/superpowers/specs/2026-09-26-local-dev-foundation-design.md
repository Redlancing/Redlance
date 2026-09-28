# Local dev foundation and API skeleton — design

Date: 2026-09-26 · Status: draft for review

## Goal

Give Redlance a local environment that behaves like production, and the shared server code every feature builds on: database access, Redis, per-user rate limiting, a standard API route wrapper, errors, logs and a dev-only session. No AWS is needed. Login (Cognito), onboarding and ingestion come in later specs and plug into what this one creates.

## Where this sits

Production (later): `CloudFront → WAF (per-IP limits) → EC2 server (Docker: web app + worker + Postgres, the same images as locally)`, with Redis on **Upstash** (managed, Redis protocol over TLS).
Locally the app server runs directly on the Mac (instant reload) and Postgres and Valkey run as two separate Docker containers. See `CLAUDE.md` → Planned stack.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Node version | **24 LTS**, pinned in `.nvmrc` (and in the Dockerfile when the deploy spec adds it); `engines` stays `>=20.9` | Laptop and server run the same runtime |
| Postgres | `pgvector/pgvector:pg17` | Same major version and extension as production |
| Redis | Local: `valkey/valkey:8` container. Production: **Upstash** (free tier: 500K commands/month, 256 MB; then $0.20 per 100K commands) | Both speak the Redis protocol, so only `REDIS_URL` differs (`redis://` locally, `rediss://` with TLS on Upstash). Local tests run offline and don't use Upstash's monthly commands. |
| DB access | **Drizzle ORM** + `pg` connection pool (max 10 per process) in `packages/db` | TypeScript schema, SQL-like queries, versioned migrations |
| Redis client | `ioredis` 6 over TCP, with `protocol: 2` (RESP2) | The most widely used Node Redis client, maintained by Redis. RESP2 works with local Valkey, Upstash and ElastiCache alike. Supports Lua scripts (`EVALSHA`), which Upstash supports too. |
| Settings | Environment variables validated with **zod** at startup | A missing setting crashes at boot with a clear message |
| Logs | **pino**, one JSON line per request | Readable locally, searchable in CloudWatch later |
| Tests | **Vitest**; integration tests run against the Compose Postgres and Valkey | Tests use the same engines as production |
| Session until Cognito | `AUTH_MODE=dev` fake session, refused outside `APP_ENV=local` | Build signed-in features before AWS is available |

## Repo layout (new and changed)

```
.nvmrc                              24
docker-compose.yml                  db (Postgres) and cache (Valkey), two separate containers
.env.example                        every setting, with local defaults
apps/web/
  next.config.ts                    transpilePackages: ["@redlance/db"]
  src/server/                       server-only code (imports "server-only")
    env.ts                          zod schema for settings
    db.ts                           re-exports the pooled Drizzle client
    redis.ts                        one shared ioredis client
    logger.ts                       pino instance
    errors.ts                       ApiError + error codes
    rate-limit/
      index.ts                      rateLimiter.consume() / quota.consume()
      scripts.ts                    the two Lua scripts (token bucket, daily quota) as strings
    session.ts                      getSession(): dev mode now, Cognito later
    api-route.ts                    apiRoute() wrapper
  src/app/api/v1/
    health/route.ts                 GET: liveness (no dependencies); ?deep=1 checks db + cache
    me/route.ts                     GET: current user (proves the whole chain)
    dev/session/route.ts            POST/DELETE: sign in/out as a dev user (local only)
packages/db/                        @redlance/db
  src/schema.ts                     users table
  src/client.ts                     pool + Drizzle client
  drizzle.config.ts
  migrations/                       generated SQL, committed
```

## How it runs locally

```
Your Mac                                   Docker (two separate containers)
┌──────────────────────────────┐           ┌───────────────────────────────┐
│ Next.js dev server           │ ────────► │ db:    pgvector/pgvector:pg17 │
│ (npm run dev, instant reload)│ ────────► │ cache: valkey/valkey:8        │
└──────────────────────────────┘           └───────────────────────────────┘
```

- `npm run dev` starts the two containers (if they aren't running) and then the Next.js dev server on the host. Code changes reload instantly; nothing is rebuilt in Docker.
- `db` and `cache` publish their ports on `127.0.0.1` only, never on all interfaces. Data lives in named volumes, so it survives restarts.
- Production practices kept locally: same Postgres and Valkey versions as production, migrations as the only way to change the schema, settings only from environment variables (validated at startup), per-user rate limiting in Redis, the same `apiRoute()` checks as production.

## Settings (`src/server/env.ts`)

| Variable | Example (local) | Notes |
|---|---|---|
| `APP_ENV` | `local` | `local` · `staging` · `production` |
| `APP_ORIGIN` | `http://localhost:3000` | Used by the Origin check |
| `DATABASE_URL` | `postgres://redlance:redlance@127.0.0.1:5432/redlance` | |
| `REDIS_URL` | `redis://127.0.0.1:6379` | |
| `AUTH_MODE` | `dev` | `dev` or `cognito`. **Startup fails if `AUTH_MODE=dev` and `APP_ENV` isn't `local`.** |
| `DEV_SESSION_SECRET` | 32+ random characters | Signs the dev session cookie; required only when `AUTH_MODE=dev` |
| `LOG_LEVEL` | `debug` | |

Validation runs once when the server starts; the error lists every missing or invalid variable.

## Database

First migration creates only what this spec uses:

```
users
  id              uuid primary key default gen_random_uuid()
  auth_sub        text not null unique     -- Cognito `sub` later; "dev|<email>" in dev mode
  email           text not null
  email_normalized text not null unique    -- lowercased; Gmail dots and +tags removed
  status          text not null default 'active'   -- active | blocked
  created_at      timestamptz not null default now()
  last_login_at   timestamptz
```

The `vector` extension is enabled in this migration so later features don't need a special step. Migrations are generated by `drizzle-kit`, committed, and applied with `npm run db:migrate` (locally, in tests, and later on the server before the app starts). The schema is never edited by hand in any environment.

## Rate limiting (`src/server/rate-limit`)

Two mechanisms behind one module:

| | Token bucket (`rateLimiter.consume`) | Daily quota (`quota.consume`) |
|---|---|---|
| For | Every authenticated API call | Expensive actions (imports, drafts) |
| Rule | Bucket of `capacity` tokens, refilled at `refillPerSec`; each call takes 1 | `limit` uses per UTC day |
| Default | 30 tokens, 2/sec per user | Set per action |
| Redis | One Lua script (`TIME` → `HMGET` → refill → take → `HSET` + `PEXPIRE`), atomic, 1 command | One Lua script (`INCR`, `EXPIRE` 2 days on first use), atomic, 1 command |
| Key | `rl:{u:<userId>}:<bucket>` | `q:{u:<userId>}:<name>:<yyyymmdd>` |
| If Redis is down | **Allow** and log an error (a cache outage shouldn't take the site down) | **Deny** with 503 (never risk unlimited LLM spend) |

- Both return `{ allowed, remaining, resetAt }`; a denied call becomes HTTP 429 with a `Retry-After` header.
- The `{u:<userId>}` part is a Redis hash tag: all of one user's keys land on the same shard if we ever move to clustered Valkey (ElastiCache Serverless), so the Lua script keeps working.

## Session (`src/server/session.ts`)

`getSession(request) → { userId, email } | null`.

- **Dev mode:** reads an `httpOnly` cookie `rl_dev_session` holding a signed user ID (HMAC with `DEV_SESSION_SECRET`). `POST /api/v1/dev/session {email}` upserts the user (`auth_sub = "dev|<email>"`) and sets the cookie; `DELETE` clears it. The dev route returns 404 unless `AUTH_MODE=dev`.
- **Cognito mode (later spec):** verifies the Cognito access token from cookies with `aws-jwt-verify`, then looks up the user by `auth_sub`. Callers don't change.

## API route wrapper (`src/server/api-route.ts`)

Every `/api/v1` handler is written as:

```ts
export const POST = apiRoute({
  auth: true,                          // default true
  input: someZodSchema,                // body for POST/PUT/PATCH, query for GET
  rateLimit: { bucket: "api" },        // default; `false` to skip
  handler: async ({ user, input, log }) => json(200, { ... }),
});
```

It runs, in order, stopping at the first failure:

1. Assign a request ID (reuse `x-request-id` / `x-amzn-trace-id` if present) and start a child logger.
2. **Auth:** `getSession()` → 401 `UNAUTHENTICATED`.
3. **Origin check** on POST/PUT/PATCH/DELETE: `Origin` must equal `APP_ORIGIN` → 403 `BAD_ORIGIN`.
4. **Input:** zod parse → 400 `INVALID_INPUT` with field errors.
5. **Rate limit:** token bucket → 429 `RATE_LIMITED`.
6. **Handler.** An `ApiError` becomes its status and code; anything else becomes 500 `INTERNAL` (details logged, not returned).
7. Log one line: request ID, user ID, method, route, status, duration.

Every error response has one shape:

```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Try again in 12 seconds.", "requestId": "…" } }
```

## Endpoints in this spec

| Endpoint | Auth | Does |
|---|---|---|
| `GET /api/v1/health` | No, no rate limit | **Liveness:** 200 `{status:"ok"}` without touching Postgres or Redis. Used by server health checks, which call it every few seconds (pinging Upstash on each probe would burn ~100K+ commands a month). |
| `GET /api/v1/health?deep=1` | No, rate limited per IP | **Readiness:** `SELECT 1` and `PING`; 200 `{status:"ok", db:"ok", cache:"ok"}` or 503 with the failing part. Called at deploy time and by monitoring every ~5 minutes. |
| `GET /api/v1/me` | Yes | Returns the signed-in user. Exercises the whole wrapper. |
| `POST/DELETE /api/v1/dev/session` | No (local only) | Dev sign-in/out |

`proxy.ts` is not added yet; it arrives with the first signed-in page (onboarding).

## Testing

- **Unit:** env validation (missing / invalid / dev-mode-outside-local), error mapping, email normalization.
- **Integration** (against Compose `db` + `cache`, a separate `redlance_test` database):
  - token bucket: 30 quick calls pass, the 31st gets 429, refill after waiting; two parallel callers never overspend (atomicity).
  - daily quota: limit reached → denied; different day key → allowed.
  - Redis stopped: bucket allows, quota denies.
  - `apiRoute`: 401 without session, 403 on bad origin, 400 on bad input, 429 when limited, 200 path, 500 hides details.
  - `/health` stays 200 when Postgres is stopped; `/health?deep=1` reports 503.
  - Commands per request: an authenticated API call costs exactly 1 Redis command (`EVALSHA`); a quota check adds 1 (`EVALSHA`). Asserted in a test so the Upstash budget stays predictable.

Command: `npm test` (unit + integration; needs `db` and `cache` running).

## Out of scope

Cognito login, Mailpit, onboarding screens, S3/MinIO, SQS/ElasticMQ, the worker, CI workflow, EC2 deployment. The production Dockerfile, `output: "standalone"` and a "2 app copies behind a proxy" check move to the deployment spec. Each arrives with the feature that needs it.

## Prerequisites (owner: Aryan)

- Docker Desktop installed and running.
- `brew install fnm && fnm install 24 && fnm use 24` (or any Node 24 install).

## Impact on the Phases 0–2 spec

Adding API routes means the web app needs a running server, so the static-export idea in `2026-09-26-cdn-waf-foundation-design.md` is replaced: CloudFront's origin becomes the EC2 server (static files still cached at the edge). That spec gets updated when we return to AWS.
